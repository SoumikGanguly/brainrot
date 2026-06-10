import { database, type AppSession, type UsageData } from './database';
import type { DailyInsightSignals } from './InsightTypes';
import { UsageService } from './UsageService';
import {
  calculateBrainScore,
  getBrainStateLabel,
  type BrainScoreMetrics,
} from '../utils/brainScore';

interface AggregatedAppUsage extends UsageData {
  openCount: number;
}

const SUMMARY_INTEGRITY_WARNING_MS = 2 * 60 * 1000;
const SESSION_REPLAY_FALLBACK_MS = 10 * 60 * 1000;
const DAILY_SUMMARY_VERSION = 'v3';

export class HistoricalDataService {
  private static instance: HistoricalDataService;
  
  static getInstance(): HistoricalDataService {
    if (!this.instance) {
      this.instance = new HistoricalDataService();
    }
    return this.instance;
  }

  async rebuildSummaryForDate(
    dateStr: string,
    options: { force?: boolean } = {}
  ): Promise<boolean> {
    try {
      const { force = false } = options;
      console.log(`Rebuilding daily summary for ${dateStr}`);

      if (!force) {
        const existingSummary = await database.getDailySummary(dateStr);
        if (existingSummary) {
          return true;
        }
      }

      const monitoredPackages = await database.getMonitoredPackages();
      const monitoredSet = new Set(monitoredPackages);
      monitoredSet.delete('com.soumikganguly.brainrot');

      let sessions = await database.getAppSessionsForDate(dateStr);
      if (sessions.length === 0) {
        sessions = await this.hydrateSessionsForDate(dateStr);
      }
      const rawUsage = await database.getDailyUsage(dateStr);

      if (rawUsage.length === 0 && sessions.length === 0) {
        console.log(`No raw usage data for ${dateStr}, skipping summary rebuild`);
        return false;
      }

      const sessionUsage = this.buildAggregatedUsageFromSessions(dateStr, sessions, monitoredSet);
      const rawUsageAggregated = this.buildAggregatedUsageFromRaw(dateStr, rawUsage, monitoredSet);
      const monitoredSessions = sessions.filter((session) =>
        monitoredSet.size === 0
          ? session.packageName !== 'com.soumikganguly.brainrot'
          : monitoredSet.has(session.packageName)
      );
      const blockEvents = await database.getBlockEventsForDate(dateStr);
      const sessionTotalMs = sessionUsage.reduce((sum, app) => sum + app.totalTimeMs, 0);
      const rawUsageTotalMs = rawUsageAggregated.reduce((sum, app) => sum + app.totalTimeMs, 0);
      const integrityDeltaMs = Math.abs(sessionTotalMs - rawUsageTotalMs);
      const shouldPreferRawUsage =
        rawUsageAggregated.length > 0 &&
        sessionUsage.length > 0 &&
        sessionTotalMs > rawUsageTotalMs &&
        integrityDeltaMs > SESSION_REPLAY_FALLBACK_MS;
      const monitoredUsage = shouldPreferRawUsage
        ? rawUsageAggregated
        : sessionUsage.length > 0
          ? sessionUsage
          : rawUsageAggregated;
      const summarySource: 'sessions' | 'raw_usage' =
        shouldPreferRawUsage || sessionUsage.length === 0 ? 'raw_usage' : 'sessions';
      const totalScreenTime = monitoredUsage.reduce((sum, app) => sum + app.totalTimeMs, 0);
      const totalMonitoredOpens = summarySource === 'sessions' ? monitoredSessions.length : 0;
      const longestSessionMs =
        summarySource === 'sessions'
          ? monitoredSessions.reduce((max, session) => Math.max(max, session.durationMs), 0)
          : 0;
      const averageSessionMs = totalMonitoredOpens > 0 ? Math.round(totalScreenTime / totalMonitoredOpens) : 0;
      const topApp = monitoredUsage[0] ?? null;
      const previousSummaries = await this.loadPreviousSummaries(dateStr, 7);
      const insightSignals = this.buildInsightSignals(
        monitoredSessions,
        monitoredUsage,
        blockEvents,
        totalScreenTime,
        totalMonitoredOpens,
        longestSessionMs,
        averageSessionMs,
        previousSummaries
      );
      const metrics: BrainScoreMetrics = {
        totalDistractingMinutes: totalScreenTime / 60000,
        totalMonitoredOpens,
        longestSessionMinutes: longestSessionMs / 60000,
        lateNightMinutes: insightSignals.lateNightUsageMs / 60000,
        beforeLunchMinutes: insightSignals.beforeLunchUsageMs / 60000,
        limitDismissals: insightSignals.limitDismissals,
        bypassCount: insightSignals.bypassCount,
        successfulAvoidances: insightSignals.abandonedCount,
        improvementVsYesterdayMinutes: insightSignals.improvementVsYesterdayMs / 60000,
        improvementVs7DayBaselineMinutes:
          insightSignals.improvementVs7DayBaselineMs / 60000,
      };
      const focusScore = calculateBrainScore(metrics);
      const brainHealthStatus = getBrainStateLabel(focusScore);

      const summary = {
        date: dateStr,
        totalScreenTime,
        brainScore: focusScore,
        apps: monitoredUsage.map(({ openCount: _openCount, ...app }) => app),
        totalDistractingMs: totalScreenTime,
        totalMonitoredOpens,
        longestSessionMs,
        averageSessionMs,
        topAppPackage: topApp?.packageName ?? null,
        topAppName: topApp?.appName ?? null,
        topAppMs: topApp?.totalTimeMs ?? 0,
        focusScore,
        brainHealthStatus,
        summarySource,
        sessionTotalMs,
        rawUsageTotalMs,
        integrityDeltaMs,
        summaryVersion: DAILY_SUMMARY_VERSION,
        insightSignals,
      };

      if (shouldPreferRawUsage) {
        console.warn(
          `Falling back to raw usage for ${dateStr}: sessions=${sessionTotalMs} raw=${rawUsageTotalMs} delta=${integrityDeltaMs}`
        );
      } else if (sessionUsage.length > 0 && rawUsageAggregated.length > 0 && integrityDeltaMs > SUMMARY_INTEGRITY_WARNING_MS) {
        console.warn(
          `Summary integrity drift on ${dateStr}: sessions=${sessionTotalMs} raw=${rawUsageTotalMs} delta=${integrityDeltaMs}`
        );
      }

      await database.saveDailySummary(dateStr, summary);
      return true;
    } catch (error) {
      console.error(`Error rebuilding summary for ${dateStr}:`, error);
      return false;
    }
  }

  private async hydrateSessionsForDate(dateStr: string): Promise<AppSession[]> {
    try {
      const startOfDate = this.getStartOfLocalDay(dateStr);
      const nativeSessions = await UsageService.getSessionsSince(startOfDate.getTime());

      const sessionRows: AppSession[] = nativeSessions
        .filter((session) => this.getSessionDate(session) === dateStr)
        .map((session) => ({
          date: session.date || dateStr,
          packageName: session.packageName,
          appName: session.appName,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          durationMs: Math.round(session.durationMs),
          source: session.source || 'usage_events',
          wasMonitored: Boolean(session.wasMonitored),
        }));

      if (sessionRows.length === 0) {
        return [];
      }

      await database.saveAppSessions(sessionRows);
      return await database.getAppSessionsForDate(dateStr);
    } catch (error) {
      console.error(`Error hydrating sessions for ${dateStr}:`, error);
      return [];
    }
  }

  private getStartOfLocalDay(dateStr: string): Date {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day, 0, 0, 0, 0);
  }

  private getSessionDate(session: Pick<AppSession, 'date' | 'startedAt'>): string {
    if (session.date) {
      return session.date;
    }

    return session.startedAt.slice(0, 10);
  }

  private buildAggregatedUsageFromSessions(
    dateStr: string,
    sessions: AppSession[],
    monitoredSet: Set<string>
  ): AggregatedAppUsage[] {
    const filteredSessions = sessions.filter((session) =>
      monitoredSet.size === 0
        ? session.packageName !== 'com.soumikganguly.brainrot'
        : monitoredSet.has(session.packageName)
    );

    if (filteredSessions.length === 0) {
      return [];
    }

    const usageMap = new Map<string, AggregatedAppUsage>();
    for (const session of filteredSessions) {
      const existing = usageMap.get(session.packageName);
      if (existing) {
        existing.totalTimeMs += session.durationMs;
        existing.openCount += 1;
        continue;
      }

      usageMap.set(session.packageName, {
        packageName: session.packageName,
        appName: session.appName,
        totalTimeMs: session.durationMs,
        date: dateStr,
        openCount: 1,
      });
    }

    return Array.from(usageMap.values()).sort((a, b) => b.totalTimeMs - a.totalTimeMs);
  }

  private buildAggregatedUsageFromRaw(
    dateStr: string,
    rawUsage: UsageData[],
    monitoredSet: Set<string>
  ): AggregatedAppUsage[] {
    return (monitoredSet.size === 0
      ? rawUsage.filter((app) => app.packageName !== 'com.soumikganguly.brainrot')
      : rawUsage.filter((app) => monitoredSet.has(app.packageName))
    )
      .map((app) => ({
        ...app,
        date: dateStr,
        openCount: 0,
      }))
      .sort((a, b) => b.totalTimeMs - a.totalTimeMs);
  }

  private async loadPreviousSummaries(
    dateStr: string,
    trailingDays: number
  ): Promise<{ date: string; totalDistractingMs: number; totalMonitoredOpens: number }[]> {
    const dates = Array.from({ length: trailingDays }, (_, index) => {
      const date = new Date(`${dateStr}T00:00:00`);
      date.setDate(date.getDate() - (index + 1));
      return date.toISOString().split('T')[0];
    });

    const summaries = await Promise.all(dates.map((date) => database.getDailySummary(date)));
    return summaries
      .filter((summary): summary is NonNullable<typeof summary> => summary !== null)
      .map((summary) => ({
        date: summary.date,
        totalDistractingMs: summary.totalDistractingMs ?? summary.totalScreenTime,
        totalMonitoredOpens: summary.totalMonitoredOpens ?? 0,
      }));
  }

  private buildInsightSignals(
    monitoredSessions: AppSession[],
    monitoredUsage: AggregatedAppUsage[],
    blockEvents: Awaited<ReturnType<typeof database.getBlockEventsForDate>>,
    totalScreenTime: number,
    totalMonitoredOpens: number,
    longestSessionMs: number,
    averageSessionMs: number,
    previousSummaries: {
      date: string;
      totalDistractingMs: number;
      totalMonitoredOpens: number;
    }[]
  ): DailyInsightSignals {
    const firstSessionStartedAt = monitoredSessions[0]?.startedAt
      ? new Date(monitoredSessions[0].startedAt).getTime()
      : null;
    const lastSessionEndedAt = monitoredSessions[monitoredSessions.length - 1]?.endedAt
      ? new Date(monitoredSessions[monitoredSessions.length - 1].endedAt).getTime()
      : null;
    const awakeSpanMinutes =
      firstSessionStartedAt && lastSessionEndedAt && lastSessionEndedAt > firstSessionStartedAt
        ? Math.max(30, Math.round((lastSessionEndedAt - firstSessionStartedAt) / 60000))
        : 0;

    const usageByMoment = new Map<string, number>();
    let lateNightUsageMs = 0;
    let beforeLunchUsageMs = 0;
    let wakeWindowUsageMs = 0;
    let wakeWindowOpenCount = 0;

    for (const session of monitoredSessions) {
      const startedAt = new Date(session.startedAt).getTime();
      const moment = this.getMomentLabel(session.startedAt);
      usageByMoment.set(moment, (usageByMoment.get(moment) || 0) + session.durationMs);

      if (moment === 'After bed') {
        lateNightUsageMs += session.durationMs;
      }

      if (moment === 'Before lunch') {
        beforeLunchUsageMs += session.durationMs;
      }

      if (
        firstSessionStartedAt !== null &&
        startedAt - firstSessionStartedAt <= 30 * 60 * 1000
      ) {
        wakeWindowUsageMs += session.durationMs;
        wakeWindowOpenCount += 1;
      }
    }

    const dominantMomentEntry = Array.from(usageByMoment.entries()).sort(
      (a, b) => b[1] - a[1]
    )[0];
    const topAppPackage = monitoredUsage[0]?.packageName ?? null;
    const topAppName = monitoredUsage[0]?.appName ?? null;
    const topAppMs = monitoredUsage[0]?.totalTimeMs ?? 0;
    const topAppOpenCount = topAppPackage
      ? monitoredSessions.filter((session) => session.packageName === topAppPackage).length
      : 0;
    const yesterday = previousSummaries[0] || null;
    const weeklyAverageMs =
      previousSummaries.length > 0
        ? previousSummaries.reduce((sum, item) => sum + item.totalDistractingMs, 0) /
          previousSummaries.length
        : 0;
    const weeklyAverageOpens =
      previousSummaries.length > 0
        ? previousSummaries.reduce((sum, item) => sum + item.totalMonitoredOpens, 0) /
          previousSummaries.length
        : 0;

    return {
      totalDistractingMs: totalScreenTime,
      totalMonitoredOpens,
      longestSessionMs,
      averageSessionMs,
      lateNightUsageMs,
      beforeLunchUsageMs,
      wakeWindowUsageMs,
      wakeWindowOpenCount,
      awakeSpanMinutes,
      distractionCadenceMinutes:
        totalMonitoredOpens > 0 && awakeSpanMinutes > 0
          ? Math.max(1, Math.round(awakeSpanMinutes / totalMonitoredOpens))
          : 0,
      topAppPackage,
      topAppName,
      topAppMs,
      topAppOpenCount,
      topAppSharePercent:
        totalScreenTime > 0 ? Math.round((topAppMs / totalScreenTime) * 100) : 0,
      limitDismissals: blockEvents.filter(
        (event) =>
          (event.protectionContext === 'limit_mode' ||
            event.blockType === 'soft_block' ||
            event.blockType === 'soft' ||
            event.blockType === 'limit') &&
          (event.action === 'cooldown_started' || event.action === 'bypassed')
      ).length,
      bypassCount: blockEvents.filter((event) => event.action === 'bypassed').length,
      abandonedCount: blockEvents.filter((event) => event.action === 'abandoned').length,
      improvementVsYesterdayMs:
        yesterday ? yesterday.totalDistractingMs - totalScreenTime : 0,
      improvementVsYesterdayOpens:
        yesterday ? yesterday.totalMonitoredOpens - totalMonitoredOpens : 0,
      improvementVs7DayBaselineMs:
        weeklyAverageMs > 0 ? Math.round(weeklyAverageMs - totalScreenTime) : 0,
      improvementVs7DayBaselineOpens:
        weeklyAverageOpens > 0 ? Math.round(weeklyAverageOpens - totalMonitoredOpens) : 0,
      dominantMoment: dominantMomentEntry?.[0] ?? null,
      dominantMomentPercent:
        totalScreenTime > 0 && dominantMomentEntry
          ? Math.round((dominantMomentEntry[1] / totalScreenTime) * 100)
          : 0,
    };
  }

  private getMomentLabel(isoTimestamp: string): string {
    const hour = new Date(isoTimestamp).getHours();
    if (hour >= 4 && hour < 7) return 'Early morning';
    if (hour >= 7 && hour < 9) return 'Morning';
    if (hour >= 9 && hour < 12) return 'Mid day';
    if (hour >= 12 && hour < 14) return 'Before lunch';
    if (hour >= 14 && hour < 22) return 'Evening';
    return 'After bed';
  }

  async saveTodaySummary(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    await this.rebuildSummaryForDate(today);
  }

  async backfillHistoricalData(days: number = 30): Promise<void> {
    console.log(`Starting backfill for last ${days} days...`);
    let summariesCreated = 0;
    let summariesSkipped = 0;
    let errors = 0;

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      try {
        const existingSummary = await database.getDailySummary(dateStr);
        if (existingSummary) {
          summariesSkipped++;
          continue;
        }

        const rebuilt = await this.rebuildSummaryForDate(dateStr, { force: true });
        if (rebuilt) {
          summariesCreated++;
        }
      } catch (error) {
        console.error(`Error backfilling ${dateStr}:`, error);
        errors++;
      }
    }
    
    console.log(`Backfill completed: ${summariesCreated} created, ${summariesSkipped} skipped, ${errors} errors`);
  }

  // Method to force refresh a specific date's summary
  async refreshDailySummary(dateStr: string): Promise<boolean> {
    try {
      return await this.rebuildSummaryForDate(dateStr, { force: true });
    } catch (error) {
      console.error(`Error refreshing summary for ${dateStr}:`, error);
      return false;
    }
  }

  // Get summary stats for a date range
  async getSummaryStats(days: number = 7): Promise<{
    averageScreenTime: number;
    averageBrainScore: number;
    bestDay: { date: string; score: number };
    worstDay: { date: string; score: number };
    totalDays: number;
    improving: boolean;
  }> {
    try {
      const historicalData = await database.getHistoricalData(days);
      
      if (historicalData.length === 0) {
        return {
          averageScreenTime: 0,
          averageBrainScore: 100,
          bestDay: { date: '', score: 100 },
          worstDay: { date: '', score: 100 },
          totalDays: 0,
          improving: false
        };
      }

      const totalScreenTime = historicalData.reduce((sum, day) => sum + day.totalScreenTime, 0);
      const totalBrainScore = historicalData.reduce((sum, day) => sum + day.brainScore, 0);
      
      const averageScreenTime = totalScreenTime / historicalData.length;
      const averageBrainScore = totalBrainScore / historicalData.length;
      
      const bestDay = historicalData.reduce((best, current) => 
        current.brainScore > best.brainScore ? current : best
      );
      
      const worstDay = historicalData.reduce((worst, current) => 
        current.brainScore < worst.brainScore ? current : worst
      );
      
      // Check if improving (compare first half vs second half of period)
      const midpoint = Math.floor(historicalData.length / 2);
      const firstHalf = historicalData.slice(0, midpoint);
      const secondHalf = historicalData.slice(midpoint);
      
      const firstHalfAvgScore = firstHalf.reduce((sum, day) => sum + day.brainScore, 0) / firstHalf.length;
      const secondHalfAvgScore = secondHalf.reduce((sum, day) => sum + day.brainScore, 0) / secondHalf.length;
      
      const improving = secondHalfAvgScore > firstHalfAvgScore;
      
      return {
        averageScreenTime: Math.round(averageScreenTime),
        averageBrainScore: Math.round(averageBrainScore),
        bestDay: { date: bestDay.date, score: bestDay.brainScore },
        worstDay: { date: worstDay.date, score: worstDay.brainScore },
        totalDays: historicalData.length,
        improving
      };
      
    } catch (error) {
      console.error('Error getting summary stats:', error);
      return {
        averageScreenTime: 0,
        averageBrainScore: 100,
        bestDay: { date: '', score: 100 },
        worstDay: { date: '', score: 100 },
        totalDays: 0,
        improving: false
      };
    }
  }

  // Clean up old historical data beyond a certain number of days
  async cleanupOldData(keepDays: number = 365): Promise<void> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - keepDays);
      const cutoffDateStr = cutoffDate.toISOString().split('T')[0];
      
      console.log(`Cleaning up data older than ${cutoffDateStr}`);
      
      // This would need to be implemented in your database service
      // For now, just log what would be cleaned
      const oldData = await database.getHistoricalData(keepDays + 30);
      const oldEntries = oldData.filter(entry => entry.date < cutoffDateStr);
      
      console.log(`Found ${oldEntries.length} entries that could be cleaned up`);
      
      // Note: You'd implement actual cleanup in database service
      // database.deleteDataOlderThan(cutoffDateStr);
      
    } catch (error) {
      console.error('Error cleaning up old data:', error);
    }
  }
}
