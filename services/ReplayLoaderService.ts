import { DataSyncService } from "./DataSyncService";
import {
  DailyInsightsService,
  type DailyInsights,
  type ReplayEntry,
} from "./DailyInsightsService";
import type { InsightCard } from "./InsightTypes";
import type { DailyUsage } from "./database";
import { UnifiedUsageService } from "./UnifiedUsageService";

const DEFAULT_TIMEOUT_MS = 4_000;
const NO_REPLAY_MESSAGE =
  "No monitored distraction sessions were recorded for this day.";
type ReplayInsightOptions = {
  forceSummaryRefresh?: boolean;
  allowInsightRegeneration?: boolean;
  preferPersistedInsights?: boolean;
};

export interface ReplayLoadResult {
  state: "ready" | "empty" | "timeout" | "error";
  summary: DailyUsage | null;
  replayEntries: ReplayEntry[];
  wastedTimeMs: number;
  biggestTimeLeak: DailyInsights["biggestTimeLeak"];
  replayInsightCards: InsightCard[];
  emptyMessage: string;
  insightLoadState: DailyInsights["insightLoadState"] | "timeout" | "error";
  integrity: DailyInsights["integrity"] | null;
}

export class ReplayLoaderService {
  static async loadDay(
    date: string,
    options: {
      syncUsageBeforeLoad?: boolean;
      timeoutMs?: number;
      selectedMoment?: string;
    } = {},
  ): Promise<ReplayLoadResult> {
    const {
      syncUsageBeforeLoad = false,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      selectedMoment,
    } = options;

    try {
      if (
        syncUsageBeforeLoad &&
        UnifiedUsageService.isNativeModuleAvailable() &&
        (await UnifiedUsageService.isUsageAccessGranted())
      ) {
        await DataSyncService.getInstance().syncUsageData();
      }

      let insights = await this.loadInsightsWithTimeout(
        date,
        {
          allowInsightRegeneration: false,
          preferPersistedInsights: true,
        },
        timeoutMs,
      );

      if (!insights) {
        return this.buildTerminalResult("timeout");
      }

      if (
        insights.summary?.totalScreenTime &&
        insights.summary.totalScreenTime > 0 &&
        insights.replayEntries.length === 0
      ) {
        const rebuilt = await this.loadInsightsWithTimeout(
          date,
          {
            forceSummaryRefresh: true,
            allowInsightRegeneration: false,
            preferPersistedInsights: true,
          },
          timeoutMs,
        );
        if (rebuilt) {
          insights = rebuilt;
        }
      }

      const replayEntries = this.resolveReplayEntries(insights, selectedMoment);
      const replayUnavailable =
        replayEntries.length === 0 ||
        (insights.summary?.summarySource === "raw_usage" &&
          !insights.integrity.isConsistent);

      if (replayUnavailable) {
        return {
          state: "empty",
          summary: insights.summary,
          replayEntries: [],
          wastedTimeMs: insights.wastedTimeMs,
          biggestTimeLeak: insights.biggestTimeLeak,
          replayInsightCards: [],
          emptyMessage: NO_REPLAY_MESSAGE,
          insightLoadState: insights.insightLoadState,
          integrity: insights.integrity,
        };
      }

      return {
        state: "ready",
        summary: insights.summary,
        replayEntries,
        wastedTimeMs: insights.wastedTimeMs,
        biggestTimeLeak: insights.biggestTimeLeak,
        replayInsightCards: insights.replayInsightCards,
        emptyMessage: NO_REPLAY_MESSAGE,
        insightLoadState: insights.insightLoadState,
        integrity: insights.integrity,
      };
    } catch (error) {
      console.error("Error loading replay day:", error);
      return this.buildTerminalResult("error");
    }
  }

  private static async loadInsightsWithTimeout(
    date: string,
    options: ReplayInsightOptions,
    timeoutMs: number,
  ): Promise<DailyInsights | null> {
    const timeoutResult = Symbol("replay_timeout");
    const result = await Promise.race([
      DailyInsightsService.getInstance().getDailyInsights(date, options),
      new Promise<symbol>((resolve) => {
        setTimeout(() => resolve(timeoutResult), timeoutMs);
      }),
    ]);

    return result === timeoutResult ? null : (result as DailyInsights);
  }

  private static resolveReplayEntries(
    insights: DailyInsights,
    selectedMoment?: string,
  ): ReplayEntry[] {
    if (!selectedMoment) {
      return insights.replayEntries;
    }

    const matchingEntries = insights.replayEntries.filter(
      (entry) => entry.moment === selectedMoment,
    );
    return matchingEntries.length > 0 ? matchingEntries : insights.replayEntries;
  }

  private static buildTerminalResult(
    state: "timeout" | "error",
  ): ReplayLoadResult {
    return {
      state,
      summary: null,
      replayEntries: [],
      wastedTimeMs: 0,
      biggestTimeLeak: null,
      replayInsightCards: [],
      emptyMessage: NO_REPLAY_MESSAGE,
      insightLoadState: state,
      integrity: null,
    };
  }
}
