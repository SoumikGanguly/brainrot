import { database, type AppSession, type BlockEvent, type DailyUsage } from './database';
import { HistoricalDataService } from './HistoricalDataService';

export type DayMoment = 'Early morning' | 'Before lunch' | 'Mid day' | 'Evening' | 'Before bed';

export interface ReplayEntry {
  packageName: string;
  appName: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  moment: DayMoment;
}

export interface DailyInsights {
  date: string;
  summary: DailyUsage | null;
  sessions: AppSession[];
  blockEvents: BlockEvent[];
  replayEntries: ReplayEntry[];
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
    options: { forceSummaryRefresh?: boolean; minSessionDurationMs?: number } = {}
  ): Promise<DailyInsights> {
    const { forceSummaryRefresh = false, minSessionDurationMs = 60000 } = options;

    await HistoricalDataService.getInstance().rebuildSummaryForDate(date, {
      force: forceSummaryRefresh,
    });

    const [summary, sessions, blockEvents] = await Promise.all([
      database.getDailySummary(date),
      database.getAppSessionsForDate(date, { monitoredOnly: true, minDurationMs: minSessionDurationMs }),
      database.getBlockEventsForDate(date),
    ]);

    const replayEntries = this.buildReplayEntries(sessions);
    const wastedTimeMs = replayEntries.reduce((sum, entry) => sum + entry.durationMs, 0);
    const biggestTimeLeak = this.buildBiggestTimeLeak(summary, replayEntries, wastedTimeMs);

    return {
      date,
      summary,
      sessions,
      blockEvents,
      replayEntries,
      wastedTimeMs,
      biggestTimeLeak,
      integrity: {
        source: summary?.summarySource || 'missing',
        deltaMs: summary?.integrityDeltaMs ?? 0,
        isConsistent: (summary?.integrityDeltaMs ?? 0) <= 2 * 60 * 1000,
      },
    };
  }

  buildReplayEntries(sessions: AppSession[]): ReplayEntry[] {
    const sortedSessions = [...sessions].sort(
      (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
    );

    return sortedSessions.map((session) => {
      return {
        packageName: session.packageName,
        appName: session.appName,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        durationMs: session.durationMs,
        moment: this.getMomentLabel(session.startedAt),
      };
    });
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
    for (const entry of replayEntries) {
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
    if (hour >= 4 && hour < 8) return 'Early morning';
    if (hour >= 8 && hour < 12) return 'Before lunch';
    if (hour >= 12 && hour < 16) return 'Mid day';
    if (hour >= 16 && hour < 22) return 'Evening';
    return 'Before bed';
  }
}
