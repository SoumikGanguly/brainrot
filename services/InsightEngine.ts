import { formatTime } from "@/utils/time";

import type { BlockEvent, DailyUsage } from "./database";
import { InsightMemoryService } from "./InsightMemoryService";
import type {
  DailyInsightSignals,
  InsightAction,
  InsightCard,
  InsightPriorityBreakdown,
  RecentInsightMemory,
} from "./InsightTypes";
import type { ReplayEntry } from "./DailyInsightsService";

type InsightEngineInput = {
  date: string;
  summary: DailyUsage | null;
  replayEntries: ReplayEntry[];
  blockEvents: BlockEvent[];
  previousDaySummary: DailyUsage | null;
  trailingSummaries: DailyUsage[];
  protectionModes: Map<string, string>;
  focusSessionActive: boolean;
};

type CandidateSpec = Omit<
  InsightCard,
  "priority" | "scoreBreakdown"
> & {
  severity: number;
  actionability: number;
  confidence: number;
  categoryPrior?: number;
};

const CATEGORY_PRIORS: Record<InsightCard["category"], number> = {
  opportunity_cost: 4,
  awareness: 3,
  pattern: 3,
  comparison: 3,
  intervention: 2,
  success: 2,
  improvement: 1,
  behavioral: 2,
};

export class InsightEngine {
  static async generate(input: InsightEngineInput): Promise<InsightCard[]> {
    const { summary } = input;
    if (!summary?.insightSignals) {
      return [];
    }

    const signals = summary.insightSignals;
    const isCurrentDate = input.date === new Date().toISOString().split("T")[0];
    const memory = await InsightMemoryService.load();
    const candidates: CandidateSpec[] = [];

    this.pushIfPresent(
      candidates,
      this.buildBeforeLunchInsight(signals, input.protectionModes),
      this.buildMostDistractingAppInsight(signals, input.protectionModes),
      this.buildPhoneCheckFrequencyInsight(signals, input.focusSessionActive),
      this.buildVulnerableHourInsight(signals),
      this.buildLongestSpiralInsight(signals),
      this.buildWakeUpHabitInsight(signals),
      this.buildBedtimeHabitInsight(signals),
      this.buildImprovementInsight(signals, input.previousDaySummary),
      this.buildAttentionDominanceInsight(summary, signals, input.protectionModes),
      this.buildDistractionClusterInsight(signals, isCurrentDate),
      this.buildOpportunityCostInsight(signals, input.focusSessionActive, isCurrentDate),
      this.buildLateNightTrendInsight(signals, input.trailingSummaries, input.protectionModes),
      this.buildInterventionPotentialInsight(signals, input.protectionModes),
      this.buildIgnoredWarningsInsight(signals, input.trailingSummaries, input.protectionModes),
      this.buildWeekendVsWeekdayInsight(summary, input.trailingSummaries)
    );

    return this.dedupeAndRank(candidates, memory, input.date);
  }

  private static buildBeforeLunchInsight(
    signals: DailyInsightSignals,
    protectionModes: Map<string, string>
  ): CandidateSpec | null {
    if (!signals.topAppPackage || !signals.topAppName || signals.totalDistractingMs <= 0) {
      return null;
    }

    const morningShare = Math.round((signals.morningUsageMs / signals.totalDistractingMs) * 100);
    if (signals.morningUsageMs < 35 * 60 * 1000 || morningShare < 45) {
      return null;
    }

    const action = this.getProtectiveAction("limit", signals, protectionModes);
    return this.createCandidate({
      id: "tier1-before-lunch",
      insightType: "before_lunch_share",
      category: "pattern",
      headline: `${morningShare}% of your distractions\nhappened before lunch.`,
      subtext: "Open Focus and protect your mornings before the first spiral gets momentum.",
      actionLabel: "Open Focus",
      action,
      relatedAppPackage: signals.topAppPackage,
      subjectAppPackage: signals.topAppPackage,
      subjectMoment: "before_lunch",
      actionKey: this.getActionKey(action),
      evidenceStrength: morningShare,
      severity: this.scale(morningShare / 100, 50, 86),
      actionability: 82,
      confidence: 88,
    });
  }

  private static buildMostDistractingAppInsight(
    signals: DailyInsightSignals,
    protectionModes: Map<string, string>
  ): CandidateSpec | null {
    if (!signals.topAppPackage || !signals.topAppName || signals.topAppSharePercent < 40) {
      return null;
    }

    const action = this.getProtectiveAction("limit", signals, protectionModes);
    return this.createCandidate({
      id: `tier1-top-app-${signals.topAppPackage}`,
      insightType: "most_distracting_app",
      category: "awareness",
      headline: `${signals.topAppName} caused\n${signals.topAppSharePercent}% of your distractions yesterday.`,
      subtext: "That app is doing most of the damage right now.",
      actionLabel: "Open Focus",
      action,
      relatedAppPackage: signals.topAppPackage,
      subjectAppPackage: signals.topAppPackage,
      actionKey: this.getActionKey(action),
      evidenceStrength: signals.topAppSharePercent,
      severity: this.scale(signals.topAppSharePercent / 100, 48, 90),
      actionability: 80,
      confidence: 92,
    });
  }

  private static buildPhoneCheckFrequencyInsight(
    signals: DailyInsightSignals,
    focusSessionActive: boolean
  ): CandidateSpec | null {
    if (signals.distractionCadenceMinutes <= 0 || signals.distractionCadenceMinutes > 45) {
      return null;
    }

    const action = focusSessionActive
      ? ({ type: "open_focus_screen" } satisfies InsightAction)
      : ({ type: "start_focus_session" } satisfies InsightAction);
    return this.createCandidate({
      id: "tier1-check-frequency",
      insightType: "phone_check_frequency",
      category: "behavioral",
      headline: `You checked ${signals.topAppName || "your phone"}\nevery ${signals.distractionCadenceMinutes} minutes while awake.`,
      subtext: "This one hits hard.",
      actionLabel: "Open Focus",
      action,
      relatedAppPackage: signals.topAppPackage || undefined,
      subjectAppPackage: signals.topAppPackage || undefined,
      actionKey: this.getActionKey(action),
      evidenceStrength: this.scale((45 - signals.distractionCadenceMinutes) / 45, 56, 94),
      severity: this.scale((45 - signals.distractionCadenceMinutes) / 45, 46, 88),
      actionability: focusSessionActive ? 56 : 78,
      confidence: 84,
    });
  }

  private static buildVulnerableHourInsight(
    signals: DailyInsightSignals
  ): CandidateSpec | null {
    if (signals.dominantHour === null || signals.dominantHour === undefined) {
      return null;
    }
    if (signals.dominantHourSharePercent < 16) {
      return null;
    }

    const moment = this.getMomentLabelFromHour(signals.dominantHour);
    const action = {
      type: "open_replay_at_time_window",
      moment,
    } satisfies InsightAction;
    return this.createCandidate({
      id: `tier1-vulnerable-hour-${signals.dominantHour}`,
      insightType: "vulnerable_hour",
      category: "pattern",
      headline: `Most distractions happened\nbetween ${this.formatHourWindow(signals.dominantHour)}.`,
      subtext: `${signals.dominantHourSharePercent}% of your distraction time clustered into that hour.`,
      actionLabel: "Open Replay",
      action,
      subjectMoment: `hour_${signals.dominantHour}`,
      actionKey: this.getActionKey(action),
      evidenceStrength: signals.dominantHourSharePercent,
      severity: this.scale(signals.dominantHourSharePercent / 100, 42, 82),
      actionability: 70,
      confidence: 82,
    });
  }

  private static buildLongestSpiralInsight(signals: DailyInsightSignals): CandidateSpec | null {
    if (!signals.longestSessionStartedAt || signals.longestSessionMs < 25 * 60 * 1000) {
      return null;
    }

    const moment = this.getMomentLabelFromTimestamp(signals.longestSessionStartedAt);
    const action = {
      type: "open_replay_at_time_window",
      moment,
    } satisfies InsightAction;
    return this.createCandidate({
      id: "tier1-longest-spiral",
      insightType: "longest_spiral",
      category: "behavioral",
      headline: `Your longest distraction\nlasted ${Math.max(1, Math.round(signals.longestSessionMs / 60000))} minutes.`,
      subtext: `Started at ${this.formatClockTime(signals.longestSessionStartedAt)}.`,
      actionLabel: "Open Replay",
      action,
      subjectMoment: moment,
      actionKey: this.getActionKey(action),
      evidenceStrength: this.scale(signals.longestSessionMs / (90 * 60 * 1000), 52, 92),
      severity: this.scale(signals.longestSessionMs / (90 * 60 * 1000), 48, 90),
      actionability: 66,
      confidence: 90,
    });
  }

  private static buildWakeUpHabitInsight(signals: DailyInsightSignals): CandidateSpec | null {
    if (!signals.firstDistractionAt) {
      return null;
    }

    const firstHour = new Date(signals.firstDistractionAt).getHours();
    if (firstHour > 10) {
      return null;
    }

    const moment = this.getMomentLabelFromTimestamp(signals.firstDistractionAt);
    const action = {
      type: "open_replay_at_time_window",
      moment,
    } satisfies InsightAction;
    return this.createCandidate({
      id: "tier2-wake-up-habit",
      insightType: "wake_up_habit",
      category: "pattern",
      headline: `Your first distraction happened\nat ${this.formatClockTime(signals.firstDistractionAt)}.`,
      subtext: "That first open often decides the tone for the rest of the day.",
      actionLabel: "Open Replay",
      action,
      subjectMoment: "first_distraction",
      actionKey: this.getActionKey(action),
      evidenceStrength: 68,
      severity: this.scale((11 - firstHour) / 11, 30, 68),
      actionability: 60,
      confidence: 76,
    });
  }

  private static buildBedtimeHabitInsight(signals: DailyInsightSignals): CandidateSpec | null {
    if (!signals.lastDistractionAt) {
      return null;
    }

    const lastHour = new Date(signals.lastDistractionAt).getHours();
    if (lastHour < 21 && lastHour >= 5) {
      return null;
    }

    const moment = this.getMomentLabelFromTimestamp(signals.lastDistractionAt);
    const action = {
      type: "open_replay_at_time_window",
      moment,
    } satisfies InsightAction;
    return this.createCandidate({
      id: "tier2-bedtime-habit",
      insightType: "bedtime_habit",
      category: "pattern",
      headline: `Your last distraction happened\nat ${this.formatClockTime(signals.lastDistractionAt)}.`,
      subtext: "Late endings usually make tomorrow's focus more expensive.",
      actionLabel: "Open Replay",
      action,
      subjectMoment: "last_distraction",
      actionKey: this.getActionKey(action),
      evidenceStrength: 72,
      severity: this.scale(lastHour >= 21 ? (lastHour - 20) / 4 : 1, 34, 72),
      actionability: 60,
      confidence: 80,
    });
  }

  private static buildImprovementInsight(
    signals: DailyInsightSignals,
    previousDaySummary: DailyUsage | null
  ): CandidateSpec | null {
    if (signals.improvementVsYesterdayOpens < 4 && signals.improvementVsYesterdayMs < 15 * 60 * 1000) {
      return null;
    }

    const previousTopPackage = previousDaySummary?.topAppPackage ?? null;
    const subjectName =
      previousTopPackage &&
      previousTopPackage === signals.topAppPackage &&
      signals.topAppName
        ? signals.topAppName
        : "distracting apps";
    const action = { type: "open_focus_screen" } satisfies InsightAction;

    return this.createCandidate({
      id: "tier2-improvement",
      insightType: "improvement_vs_yesterday",
      category: "improvement",
      headline: `You opened ${subjectName}\n${signals.improvementVsYesterdayOpens} fewer times than yesterday.`,
      subtext: "Users love progress because progress is proof.",
      actionLabel: "Open Focus",
      action,
      relatedAppPackage: signals.topAppPackage || undefined,
      subjectAppPackage: signals.topAppPackage || undefined,
      actionKey: this.getActionKey(action),
      evidenceStrength: Math.min(96, signals.improvementVsYesterdayOpens * 6),
      severity: this.scale(signals.improvementVsYesterdayOpens / 18, 28, 64),
      actionability: 52,
      confidence: 82,
    });
  }

  private static buildAttentionDominanceInsight(
    summary: DailyUsage,
    signals: DailyInsightSignals,
    protectionModes: Map<string, string>
  ): CandidateSpec | null {
    const [topApp, secondApp, thirdApp] = summary.apps;
    if (!topApp || !secondApp || !thirdApp) {
      return null;
    }

    const combined = secondApp.totalTimeMs + thirdApp.totalTimeMs;
    if (combined <= 0 || topApp.totalTimeMs <= combined) {
      return null;
    }

    const action = this.getProtectiveAction("limit", signals, protectionModes);
    return this.createCandidate({
      id: `tier2-attention-dominance-${topApp.packageName}`,
      insightType: "attention_dominance",
      category: "comparison",
      headline: `${topApp.appName} consumed more time\nthan ${secondApp.appName} and ${thirdApp.appName} combined.`,
      subtext: "One app is dominating the day more than the rest put together.",
      actionLabel: "Open Focus",
      action,
      relatedAppPackage: topApp.packageName,
      subjectAppPackage: topApp.packageName,
      actionKey: this.getActionKey(action),
      evidenceStrength: this.scale(topApp.totalTimeMs / Math.max(combined, 1), 54, 90),
      severity: this.scale(topApp.totalTimeMs / Math.max(combined, 1), 46, 86),
      actionability: 76,
      confidence: 86,
    });
  }

  private static buildDistractionClusterInsight(
    signals: DailyInsightSignals,
    isCurrentDate: boolean
  ): CandidateSpec | null {
    if (signals.wakeWindowUsageMs < 15 * 60 * 1000 || signals.wakeWindowOpenCount < 2) {
      return null;
    }

    const action = {
      type: "open_replay_at_time_window",
      moment: "Early morning",
    } satisfies InsightAction;
    return this.createCandidate({
      id: "tier2-distraction-cluster",
      insightType: "distraction_cluster_after_waking",
      category: "pattern",
      headline: "Most distractions happened\nwithin 30 minutes of waking up.",
      subtext: isCurrentDate
        ? `That first stretch has already cost you ${formatTime(signals.wakeWindowUsageMs)} today.`
        : `That first stretch cost you ${formatTime(signals.wakeWindowUsageMs)} yesterday.`,
      actionLabel: "Open Replay",
      action,
      subjectMoment: "wake_window",
      actionKey: this.getActionKey(action),
      evidenceStrength: this.scale(signals.wakeWindowUsageMs / (60 * 60 * 1000), 52, 88),
      severity: this.scale(signals.wakeWindowUsageMs / (60 * 60 * 1000), 42, 82),
      actionability: 72,
      confidence: 84,
    });
  }

  private static buildOpportunityCostInsight(
    signals: DailyInsightSignals,
    focusSessionActive: boolean,
    isCurrentDate: boolean
  ): CandidateSpec | null {
    if (signals.totalDistractingMs < 45 * 60 * 1000) {
      return null;
    }

    const chips = this.buildOpportunityChips(signals.totalDistractingMs);
    const action = focusSessionActive
      ? ({ type: "open_focus_screen" } satisfies InsightAction)
      : ({ type: "start_focus_session" } satisfies InsightAction);

    return this.createCandidate({
      id: "tier3-opportunity-cost",
      insightType: "opportunity_cost",
      category: "opportunity_cost",
      headline: isCurrentDate
        ? `You have lost ${formatTime(signals.totalDistractingMs)} today.`
        : `You lost ${formatTime(signals.totalDistractingMs)} yesterday.`,
      subtext: "That's enough time for things you would actually remember doing.",
      chips,
      actionLabel: "Open Focus",
      action,
      actionKey: this.getActionKey(action),
      evidenceStrength: 96,
      severity: this.scale(signals.totalDistractingMs / (4 * 60 * 60 * 1000), 50, 96),
      actionability: focusSessionActive ? 54 : 82,
      confidence: 96,
    });
  }

  private static buildLateNightTrendInsight(
    signals: DailyInsightSignals,
    trailingSummaries: DailyUsage[],
    protectionModes: Map<string, string>
  ): CandidateSpec | null {
    const baselines = trailingSummaries
      .map((entry) => entry.insightSignals?.lateNightUsageMs ?? 0)
      .filter((value) => value > 0);
    if (signals.lateNightUsageMs < 25 * 60 * 1000 || baselines.length < 3) {
      return null;
    }

    const baseline = baselines.reduce((sum, value) => sum + value, 0) / baselines.length;
    if (baseline <= 0 || signals.lateNightUsageMs <= baseline) {
      return null;
    }

    const increasePercent = Math.round(((signals.lateNightUsageMs - baseline) / baseline) * 100);
    if (increasePercent < 20) {
      return null;
    }

    const action = this.getProtectiveAction("locked", signals, protectionModes);
    return this.createCandidate({
      id: "tier3-late-night-trend",
      insightType: "late_night_trend",
      category: "comparison",
      headline: `Late-night scrolling increased\n${increasePercent}% compared to last week.`,
      subtext: "The night pattern is getting stronger, not weaker.",
      actionLabel: "Open Focus",
      action,
      relatedAppPackage: signals.topAppPackage || undefined,
      subjectMoment: "late_night",
      actionKey: this.getActionKey(action),
      evidenceStrength: Math.min(100, increasePercent),
      severity: this.scale(increasePercent / 100, 42, 86),
      actionability: 74,
      confidence: this.scale(baselines.length / 7, 72, 88),
    });
  }

  private static buildInterventionPotentialInsight(
    signals: DailyInsightSignals,
    protectionModes: Map<string, string>
  ): CandidateSpec | null {
    if (!signals.topAppPackage || !signals.topAppName || signals.topAppSharePercent < 35) {
      return null;
    }

    const action = this.getProtectiveAction("limit", signals, protectionModes);
    return this.createCandidate({
      id: `tier3-intervention-${signals.topAppPackage}`,
      insightType: "intervention_potential",
      category: "intervention",
      headline: `Limit Mode could have prevented\n${signals.topAppSharePercent}% of yesterday's distractions.`,
      subtext: `${signals.topAppName} created most of the damage.`,
      actionLabel: "Open Focus",
      action,
      relatedAppPackage: signals.topAppPackage,
      subjectAppPackage: signals.topAppPackage,
      actionKey: this.getActionKey(action),
      evidenceStrength: signals.topAppSharePercent,
      severity: this.scale(signals.topAppSharePercent / 100, 36, 80),
      actionability: 84,
      confidence: 84,
    });
  }

  private static buildIgnoredWarningsInsight(
    signals: DailyInsightSignals,
    trailingSummaries: DailyUsage[],
    protectionModes: Map<string, string>
  ): CandidateSpec | null {
    const hasLimitModeEnabled = Array.from(protectionModes.values()).some((mode) => mode === "limit");
    if (!hasLimitModeEnabled) {
      return null;
    }

    const weeklyLimitDismissals =
      signals.limitDismissals +
      trailingSummaries
        .slice(0, 6)
        .reduce((sum, entry) => sum + (entry.insightSignals?.limitDismissals ?? 0), 0);
    if (weeklyLimitDismissals < 3) {
      return null;
    }

    const action = { type: "open_focus_screen" } satisfies InsightAction;
    return this.createCandidate({
      id: "tier3-ignored-warnings",
      insightType: "ignored_warnings",
      category: "intervention",
      headline: `You ignored ${weeklyLimitDismissals} reflection screens\nthis week.`,
      subtext: "The reflection is showing up. The plan just needs to get tighter.",
      actionLabel: "Open Focus",
      action,
      subjectMoment: "limit_mode",
      actionKey: this.getActionKey(action),
      evidenceStrength: Math.min(100, weeklyLimitDismissals * 12),
      severity: this.scale(weeklyLimitDismissals / 10, 38, 78),
      actionability: 72,
      confidence: 88,
    });
  }

  private static buildWeekendVsWeekdayInsight(
    summary: DailyUsage,
    trailingSummaries: DailyUsage[]
  ): CandidateSpec | null {
    const sample = [summary, ...trailingSummaries];
    const weekendValues = sample
      .filter((entry) => this.isWeekend(entry.date))
      .map((entry) => entry.totalDistractingMs ?? entry.totalScreenTime);
    const weekdayValues = sample
      .filter((entry) => !this.isWeekend(entry.date))
      .map((entry) => entry.totalDistractingMs ?? entry.totalScreenTime);

    if (weekendValues.length < 2 || weekdayValues.length < 3) {
      return null;
    }

    const weekendAverage = weekendValues.reduce((sum, value) => sum + value, 0) / weekendValues.length;
    const weekdayAverage = weekdayValues.reduce((sum, value) => sum + value, 0) / weekdayValues.length;
    if (weekdayAverage <= 0 || weekendAverage <= weekdayAverage) {
      return null;
    }

    const increasePercent = Math.round(((weekendAverage - weekdayAverage) / weekdayAverage) * 100);
    if (increasePercent < 20) {
      return null;
    }

    const action = { type: "open_focus_screen" } satisfies InsightAction;
    return this.createCandidate({
      id: "tier3-weekend-vs-weekday",
      insightType: "weekend_vs_weekday",
      category: "comparison",
      headline: `You are ${increasePercent}% more distracted\non weekends.`,
      subtext: "Your recovery days are where attention slips the most.",
      actionLabel: "Open Focus",
      action,
      subjectMoment: "weekend",
      actionKey: this.getActionKey(action),
      evidenceStrength: Math.min(100, increasePercent),
      severity: this.scale(increasePercent / 100, 38, 78),
      actionability: 62,
      confidence: 80,
    });
  }

  private static dedupeAndRank(
    candidates: CandidateSpec[],
    memory: RecentInsightMemory,
    date: string
  ): InsightCard[] {
    const seen = new Set<string>();
    const scored = candidates
      .map((candidate) => this.scoreCandidate(candidate, memory, date))
      .sort((a, b) => b.priority - a.priority)
      .filter((candidate) => {
        const dedupeKey = [
          candidate.insightType,
          candidate.subjectAppPackage || "",
          candidate.subjectMoment || "",
          candidate.actionKey,
        ].join(":");
        if (seen.has(dedupeKey)) {
          return false;
        }
        seen.add(dedupeKey);
        return true;
      });

    const featured: InsightCard[] = [];
    const deferred: InsightCard[] = [];

    for (const candidate of scored) {
      if (featured.length < 2 && !featured.some((item) => this.overlaps(item, candidate))) {
        featured.push(candidate);
      } else {
        deferred.push(candidate);
      }
    }

    return [...featured, ...deferred];
  }

  private static scoreCandidate(
    candidate: CandidateSpec,
    memory: RecentInsightMemory,
    date: string
  ): InsightCard {
    const novelty = this.computeNovelty(candidate, memory, date);
    const freshness = this.computeFreshness(date);
    const categoryPrior = candidate.categoryPrior ?? CATEGORY_PRIORS[candidate.category] ?? 0;
    const finalPriority = Math.round(
      novelty * 0.3 +
        candidate.severity * 0.24 +
        candidate.actionability * 0.18 +
        candidate.confidence * 0.14 +
        freshness * 0.08 +
        categoryPrior
    );

    const scoreBreakdown: InsightPriorityBreakdown = {
      severity: Math.round(candidate.severity),
      actionability: Math.round(candidate.actionability),
      confidence: Math.round(candidate.confidence),
      novelty: Math.round(novelty),
      freshness: Math.round(freshness),
      finalPriority,
    };

    return {
      ...candidate,
      priority: finalPriority,
      scoreBreakdown,
    };
  }

  private static computeNovelty(
    candidate: CandidateSpec,
    memory: RecentInsightMemory,
    date: string
  ): number {
    const priorDates = Object.keys(memory.shownByDate)
      .filter((key) => key < date)
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 4);

    let novelty = 82;
    let insightTypeHits = 0;
    let categoryHits = 0;
    let appHits = 0;
    let momentHits = 0;

    for (const priorDate of priorDates) {
      const entries = memory.shownByDate[priorDate] || [];
      if (entries.some((entry) => entry.insightType === candidate.insightType)) {
        insightTypeHits += 1;
      }
      if (entries.some((entry) => entry.category === candidate.category)) {
        categoryHits += 1;
      }
      if (
        candidate.subjectAppPackage &&
        entries.some((entry) => entry.subjectAppPackage === candidate.subjectAppPackage)
      ) {
        appHits += 1;
      }
      if (
        candidate.subjectMoment &&
        entries.some((entry) => entry.subjectMoment === candidate.subjectMoment)
      ) {
        momentHits += 1;
      }
    }

    novelty -= insightTypeHits * 16;
    novelty -= categoryHits * 8;
    novelty -= appHits * 6;
    novelty -= momentHits * 5;

    const recentlyActed = memory.acted.some(
      (entry) =>
        entry.actionKey === candidate.actionKey &&
        Date.now() - entry.actedAt < 3 * 24 * 60 * 60 * 1000
    );
    if (recentlyActed) {
      novelty -= 18;
    }

    if (insightTypeHits === 0) {
      novelty += 10;
    }
    if (candidate.subjectAppPackage && appHits === 0) {
      novelty += 5;
    }
    if (candidate.subjectMoment && momentHits === 0) {
      novelty += 4;
    }

    return this.clamp(novelty, 16, 98);
  }

  private static computeFreshness(date: string): number {
    const targetDate = new Date(`${date}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.max(
      0,
      Math.round((today.getTime() - targetDate.getTime()) / (24 * 60 * 60 * 1000))
    );
    return this.clamp(94 - diffDays * 8, 56, 94);
  }

  private static overlaps(left: InsightCard, right: InsightCard): boolean {
    if (left.subjectAppPackage && right.subjectAppPackage) {
      return left.subjectAppPackage === right.subjectAppPackage;
    }
    if (left.subjectMoment && right.subjectMoment) {
      return left.subjectMoment === right.subjectMoment;
    }
    return left.actionKey === right.actionKey;
  }

  private static buildOpportunityChips(totalMs: number): string[] {
    const totalMinutes = Math.floor(totalMs / 60000);
    const chips: string[] = [];
    if (totalMinutes >= 45) {
      chips.push("a workout");
    }
    if (totalMinutes >= 120) {
      chips.push("60 pages of reading");
    }
    if (totalMinutes >= 30) {
      chips.push("a long walk");
    }
    return chips.slice(0, 3);
  }

  private static getProtectiveAction(
    desiredMode: "limit" | "locked",
    signals: DailyInsightSignals,
    protectionModes: Map<string, string>
  ): InsightAction {
    if (!signals.topAppPackage || !signals.topAppName) {
      return { type: "start_focus_session" };
    }

    const currentMode = protectionModes.get(signals.topAppPackage) || "monitor";
    if (desiredMode === "limit") {
      if (currentMode === "monitor") {
        return {
          type: "set_app_mode_limit",
          packageName: signals.topAppPackage,
          appName: signals.topAppName,
        };
      }
      return { type: "open_focus_screen" };
    }

    if (currentMode !== "locked") {
      return {
        type: "set_app_mode_locked",
        packageName: signals.topAppPackage,
        appName: signals.topAppName,
      };
    }
    return { type: "open_focus_screen" };
  }

  private static createCandidate(candidate: CandidateSpec): CandidateSpec {
    return {
      ...candidate,
      categoryPrior: candidate.categoryPrior ?? CATEGORY_PRIORS[candidate.category],
    };
  }

  private static getActionKey(action: InsightAction): string {
    switch (action.type) {
      case "start_focus_session":
        return "start_focus_session";
      case "set_app_mode_limit":
        return `set_app_mode_limit:${action.packageName}`;
      case "set_app_mode_locked":
        return `set_app_mode_locked:${action.packageName}`;
      case "open_replay_at_time_window":
        return `open_replay_at_time_window:${action.moment}`;
      case "open_focus_screen":
        return "open_focus_screen";
      case "open_permissions_accessibility":
        return "open_permissions_accessibility";
    }
  }

  private static formatClockTime(isoTimestamp: string): string {
    return new Date(isoTimestamp).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  private static formatHourWindow(hour: number): string {
    const start = this.formatHourLabel(hour);
    const end = this.formatHourLabel((hour + 1) % 24);
    return `${start} and ${end}`;
  }

  private static formatHourLabel(hour: number): string {
    const normalized = ((hour % 24) + 24) % 24;
    const suffix = normalized >= 12 ? "PM" : "AM";
    const hour12 = normalized % 12 === 0 ? 12 : normalized % 12;
    return `${hour12} ${suffix}`;
  }

  private static getMomentLabelFromTimestamp(isoTimestamp: string): string {
    return this.getMomentLabelFromHour(new Date(isoTimestamp).getHours());
  }

  private static getMomentLabelFromHour(hour: number): ReplayEntry["moment"] {
    if (hour >= 4 && hour < 7) return "Early morning";
    if (hour >= 7 && hour < 9) return "Morning";
    if (hour >= 9 && hour < 12) return "Mid day";
    if (hour >= 12 && hour < 14) return "Before lunch";
    if (hour >= 14 && hour < 22) return "Evening";
    return "After bed";
  }

  private static isWeekend(dateStr: string): boolean {
    const day = new Date(`${dateStr}T00:00:00`).getDay();
    return day === 0 || day === 6;
  }

  private static pushIfPresent(
    candidates: CandidateSpec[],
    ...items: (CandidateSpec | null)[]
  ): void {
    for (const item of items) {
      if (item) {
        candidates.push(item);
      }
    }
  }

  private static scale(value: number, min: number, max: number): number {
    return min + (max - min) * this.clamp(value, 0, 1);
  }

  private static clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}
