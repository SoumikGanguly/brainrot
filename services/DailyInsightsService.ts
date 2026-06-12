import { database, type AppSession, type BlockEvent, type DailyUsage } from './database';
import { HistoricalDataService } from './HistoricalDataService';
import { InsightEngine } from './InsightEngine';
import { InsightMemoryService } from './InsightMemoryService';
import type { InsightCard, InsightLoadState } from './InsightTypes';

export type DayMoment =
  | 'Early morning'
  | 'Morning'
  | 'Mid day'
  | 'Before lunch'
  | 'Evening'
  | 'After bed';

export interface ReplayEntry {
  packageName: string;
  appName: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  moment: DayMoment;
  eventType: 'session' | 'short_open' | 'blocked' | 'emergency_pass' | 'cooldown';
  action?: BlockEvent['action'];
  blockType?: string;
  protectionContext?: BlockEvent['protectionContext'];
}

export interface DailyInsights {
  date: string;
  summary: DailyUsage | null;
  sessions: AppSession[];
  blockEvents: BlockEvent[];
  replayEntries: ReplayEntry[];
  primaryInsight: InsightCard | null;
  replayInsightCards: InsightCard[];
  rankedInsights: InsightCard[];
  wastedTimeMs: number;
  biggestTimeLeak: {
    packageName: string;
    appName: string;
    totalTimeMs: number;
    percentage: number;
  } | null;
  integrity: {
    source: 'sessions' | 'raw_usage' | 'missing';
    deltaMs: number;
    isConsistent: boolean;
  };
  insightLoadState: InsightLoadState;
}

interface DailyInsightsOptions {
  forceSummaryRefresh?: boolean;
  minSessionDurationMs?: number;
  allowInsightRegeneration?: boolean;
  preferPersistedInsights?: boolean;
}

export class DailyInsightsService {
  private static instance: DailyInsightsService;

  static getInstance(): DailyInsightsService {
    if (!this.instance) {
      this.instance = new DailyInsightsService();
    }
    return this.instance;
  }

  async getDailyInsights(
    date: string,
    options: DailyInsightsOptions = {}
  ): Promise<DailyInsights> {
    const {
      forceSummaryRefresh = false,
      minSessionDurationMs = 0,
      allowInsightRegeneration = true,
      preferPersistedInsights = true,
    } = options;

    await HistoricalDataService.getInstance().rebuildSummaryForDate(date, {
      force: forceSummaryRefresh,
    });

    const [summary, allSessions, blockEvents, persistedInsights, monitoredPackages] = await Promise.all([
      database.getDailySummary(date),
      database.getAppSessionsForDate(date, { minDurationMs: minSessionDurationMs }),
      database.getBlockEventsForDate(date),
      InsightMemoryService.getPersistedInsights(date),
      database.getMonitoredPackages(),
    ]);

    const monitoredSet = new Set(monitoredPackages);
    monitoredSet.delete('com.soumikganguly.brainrot');
    const sessions = allSessions.filter((session) =>
      monitoredSet.size === 0
        ? session.packageName !== 'com.soumikganguly.brainrot'
        : monitoredSet.has(session.packageName)
    );

    const replayEntries = this.buildReplayEntries(sessions, blockEvents);
    const wastedTimeMs = replayEntries.reduce(
      (sum, entry) =>
        entry.eventType === 'session' || entry.eventType === 'short_open'
          ? sum + entry.durationMs
          : sum,
      0
    );
    const biggestTimeLeak = this.buildBiggestTimeLeak(summary, replayEntries, wastedTimeMs);
    const isToday = date === this.getTodayDateString();
    const shouldUsePersistedOnly =
      preferPersistedInsights && Boolean(persistedInsights) && (!isToday || !allowInsightRegeneration);

    if (shouldUsePersistedOnly) {
      return this.buildResponse(
        date,
        summary,
        sessions,
        blockEvents,
        replayEntries,
        wastedTimeMs,
        biggestTimeLeak,
        persistedInsights?.rankedInsights || [],
        persistedInsights?.rankedInsights?.length ? 'persisted' : 'missing'
      );
    }

    const [previousDaySummary, trailingSummaries, protectionModes, focusSessionFlag] = await Promise.all([
      database.getDailySummary(this.shiftDate(date, -1)),
      this.getTrailingSummaries(date, 7),
      this.getProtectionModes(),
      database.getMeta('focus_session_active'),
    ]);
    let rankedInsights: InsightCard[] = [];
    let insightLoadState: InsightLoadState = 'missing';

    try {
      rankedInsights = await InsightEngine.generate({
        date,
        summary,
        replayEntries,
        blockEvents,
        previousDaySummary,
        trailingSummaries,
        protectionModes,
        focusSessionActive: focusSessionFlag === 'true',
      });

      if (rankedInsights.length === 0 && persistedInsights?.rankedInsights?.length) {
        rankedInsights = persistedInsights.rankedInsights;
        insightLoadState = 'persisted';
      } else {
        await InsightMemoryService.recordShownInsights(date, rankedInsights);
        await InsightMemoryService.savePersistedInsights(date, rankedInsights);
        insightLoadState = rankedInsights.length > 0 ? 'generated' : 'missing';
      }
    } catch (error) {
      console.warn(`Failed to generate insights for ${date}:`, error);
      rankedInsights = persistedInsights?.rankedInsights || [];
      insightLoadState = rankedInsights.length > 0 ? 'persisted' : 'missing';
    }

    return this.buildResponse(
      date,
      summary,
      sessions,
      blockEvents,
      replayEntries,
      wastedTimeMs,
      biggestTimeLeak,
      rankedInsights,
      insightLoadState
    );
  }

  buildReplayEntries(sessions: AppSession[], blockEvents: BlockEvent[] = []): ReplayEntry[] {
    const sortedSessions = [...sessions].sort(
      (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
    );

    const sessionEntries = sortedSessions.map((session) => {
      return {
        packageName: session.packageName,
        appName: session.appName,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        durationMs: session.durationMs,
        moment: this.getMomentLabel(session.startedAt),
        eventType: session.durationMs < 60000 ? 'short_open' : 'session',
      };
    });

    const blockEntries = blockEvents.map((event) => {
      const eventType =
        event.action === 'bypassed'
          ? 'emergency_pass'
          : event.action === 'cooldown_started'
            ? 'cooldown'
            : 'blocked';
      return {
        packageName: event.packageName,
        appName: event.appName,
        startedAt: event.triggeredAt,
        endedAt: event.resolvedAt || event.triggeredAt,
        durationMs: 0,
        moment: this.getMomentLabel(event.triggeredAt),
        eventType,
        action: event.action,
        blockType: event.blockType,
        protectionContext: event.protectionContext ?? null,
      } satisfies ReplayEntry;
    });

    return [...sessionEntries, ...blockEntries].sort(
      (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
    ) as ReplayEntry[];
  }

  private buildBiggestTimeLeak(
    summary: DailyUsage | null,
    replayEntries: ReplayEntry[],
    wastedTimeMs: number
  ): DailyInsights['biggestTimeLeak'] {
    if (summary?.apps?.length) {
      const topApp = summary.apps[0];
      return {
        packageName: topApp.packageName,
        appName: topApp.appName,
        totalTimeMs: topApp.totalTimeMs,
        percentage: summary.totalScreenTime > 0
          ? Math.round((topApp.totalTimeMs / summary.totalScreenTime) * 100)
          : 0,
      };
    }

    const appTotals = new Map<string, { appName: string; totalTimeMs: number }>();
    for (const entry of replayEntries.filter((entry) => entry.eventType === 'session' || entry.eventType === 'short_open')) {
      const existing = appTotals.get(entry.packageName);
      appTotals.set(entry.packageName, {
        appName: entry.appName,
        totalTimeMs: (existing?.totalTimeMs || 0) + entry.durationMs,
      });
    }

    const top = Array.from(appTotals.entries())
      .map(([packageName, value]) => ({ packageName, ...value }))
      .sort((a, b) => b.totalTimeMs - a.totalTimeMs)[0];

    if (!top) {
      return null;
    }

    return {
      ...top,
      percentage: wastedTimeMs > 0 ? Math.round((top.totalTimeMs / wastedTimeMs) * 100) : 0,
    };
  }

  private getMomentLabel(isoTimestamp: string): DayMoment {
    const hour = new Date(isoTimestamp).getHours();
    if (hour >= 4 && hour < 7) return 'Early morning';
    if (hour >= 7 && hour < 9) return 'Morning';
    if (hour >= 9 && hour < 12) return 'Mid day';
    if (hour >= 12 && hour < 14) return 'Before lunch';
    if (hour >= 14 && hour < 22) return 'Evening';
    return 'After bed';
  }

  private shiftDate(dateStr: string, dayDelta: number): string {
    const date = new Date(`${dateStr}T00:00:00`);
    date.setDate(date.getDate() + dayDelta);
    return date.toISOString().split('T')[0];
  }

  private async getTrailingSummaries(dateStr: string, days: number): Promise<DailyUsage[]> {
    const dateStrings = Array.from({ length: days }, (_, index) =>
      this.shiftDate(dateStr, -(index + 1))
    );
    const summaries = await Promise.all(dateStrings.map((date) => database.getDailySummary(date)));
    return summaries.filter((summary): summary is DailyUsage => Boolean(summary));
  }

  private async getProtectionModes(): Promise<Map<string, string>> {
    const settings = await database.getAppSettings();
    return new Map(
      settings
        .filter((setting) => Boolean(setting.protectionMode))
        .map((setting) => [setting.packageName, setting.protectionMode || 'monitor'])
    );
  }

  private buildResponse(
    date: string,
    summary: DailyUsage | null,
    sessions: AppSession[],
    blockEvents: BlockEvent[],
    replayEntries: ReplayEntry[],
    wastedTimeMs: number,
    biggestTimeLeak: DailyInsights['biggestTimeLeak'],
    rankedInsights: InsightCard[],
    insightLoadState: InsightLoadState
  ): DailyInsights {
    return {
      date,
      summary,
      sessions,
      blockEvents,
      replayEntries,
      primaryInsight: rankedInsights[0] ?? null,
      replayInsightCards: rankedInsights.slice(0, 2),
      rankedInsights,
      wastedTimeMs,
      biggestTimeLeak,
      integrity: {
        source: summary?.summarySource || 'missing',
        deltaMs: summary?.integrityDeltaMs ?? 0,
        isConsistent: (summary?.integrityDeltaMs ?? 0) <= 2 * 60 * 1000,
      },
      insightLoadState,
    };
  }

  private getTodayDateString(): string {
    return new Date().toISOString().split('T')[0];
  }
}
