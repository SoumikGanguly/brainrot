import { formatTime } from "@/utils/time";

import type {
  CalendarInsightEvidence,
  CalendarInsightPeriodType,
  CalendarPeriodInsight,
  DailyInsightSignals,
  InsightAction,
} from "@/services/InsightTypes";

type CalendarInsightDay = {
  date: string;
  totalScreenTime: number;
  totalMonitoredOpens?: number;
  brainScore: number;
  apps: Array<{
    packageName: string;
    appName: string;
    totalTimeMs: number;
  }>;
  insightSignals?: DailyInsightSignals;
};

type BuildPeriodInsightInput = {
  periodType: CalendarInsightPeriodType;
  entries: CalendarInsightDay[];
  protectionModes: Map<string, string>;
};

type AggregatedApp = {
  packageName: string;
  appName: string;
  totalTimeMs: number;
  openCount: number;
};

type AggregatedSignals = {
  totalScreenTime: number;
  totalMonitoredOpens: number;
  lateNightUsageMs: number;
  morningUsageMs: number;
  awakeSpanMinutes: number;
  topApp: AggregatedApp | null;
  cadenceMinutes: number;
  morningShare: number;
  lateNightShare: number;
};

export class CalendarPeriodInsightService {
  static build(input: BuildPeriodInsightInput): CalendarPeriodInsight | null {
    if (!input.entries.length) {
      return null;
    }

    const aggregated = this.aggregateSignals(input.entries);
    if (!aggregated.topApp) {
      return null;
    }

    const lateNightInsight = this.buildLateNightInsight(
      input.periodType,
      aggregated,
      input.protectionModes
    );
    if (lateNightInsight) {
      return lateNightInsight;
    }

    const morningInsight = this.buildMorningInsight(
      input.periodType,
      aggregated
    );
    if (morningInsight) {
      return morningInsight;
    }

    return this.buildTopAppInsight(input.periodType, aggregated, input.protectionModes);
  }

  static buildAllPreview(input: BuildPeriodInsightInput): CalendarPeriodInsight[] {
    if (!input.entries.length) {
      return [];
    }

    const aggregated = this.aggregateSignals(input.entries);
    if (!aggregated.topApp) {
      return [];
    }

    return [
      this.buildMorningInsight(input.periodType, aggregated, true),
      this.buildTopAppInsight(input.periodType, aggregated, input.protectionModes),
      this.buildLateNightInsight(
        input.periodType,
        aggregated,
        input.protectionModes,
        true
      ),
    ].filter((insight): insight is CalendarPeriodInsight => Boolean(insight));
  }

  private static aggregateSignals(entries: CalendarInsightDay[]): AggregatedSignals {
    const appMap = new Map<string, AggregatedApp>();
    let totalScreenTime = 0;
    let totalMonitoredOpens = 0;
    let lateNightUsageMs = 0;
    let morningUsageMs = 0;
    let awakeSpanMinutes = 0;

    for (const entry of entries) {
      totalScreenTime += entry.totalScreenTime || 0;
      totalMonitoredOpens +=
        entry.totalMonitoredOpens ?? entry.insightSignals?.totalMonitoredOpens ?? 0;
      lateNightUsageMs += entry.insightSignals?.lateNightUsageMs ?? 0;
      morningUsageMs +=
        (entry.insightSignals?.beforeLunchUsageMs ?? 0) +
        (entry.insightSignals?.wakeWindowUsageMs ?? 0);
      awakeSpanMinutes += entry.insightSignals?.awakeSpanMinutes ?? 0;

      for (const app of entry.apps) {
        const existing = appMap.get(app.packageName);
        appMap.set(app.packageName, {
          packageName: app.packageName,
          appName: app.appName,
          totalTimeMs: (existing?.totalTimeMs || 0) + app.totalTimeMs,
          openCount: existing?.openCount || 0,
        });
      }

      const signalTopApp = entry.insightSignals?.topAppPackage;
      if (signalTopApp && entry.insightSignals?.topAppOpenCount) {
        const existing = appMap.get(signalTopApp);
        if (existing) {
          existing.openCount += entry.insightSignals.topAppOpenCount;
        }
      }
    }

    const topApp =
      Array.from(appMap.values()).sort((left, right) => right.totalTimeMs - left.totalTimeMs)[0] ||
      null;

    if (topApp && topApp.openCount === 0 && totalScreenTime > 0 && totalMonitoredOpens > 0) {
      topApp.openCount = Math.max(
        1,
        Math.round((topApp.totalTimeMs / totalScreenTime) * totalMonitoredOpens)
      );
    }

    const cadenceMinutes =
      totalMonitoredOpens > 0 && awakeSpanMinutes > 0
        ? Math.max(1, Math.round(awakeSpanMinutes / totalMonitoredOpens))
        : 0;

    return {
      totalScreenTime,
      totalMonitoredOpens,
      lateNightUsageMs,
      morningUsageMs,
      awakeSpanMinutes,
      topApp,
      cadenceMinutes,
      morningShare:
        totalScreenTime > 0 ? Math.round((morningUsageMs / totalScreenTime) * 100) : 0,
      lateNightShare:
        totalScreenTime > 0 ? Math.round((lateNightUsageMs / totalScreenTime) * 100) : 0,
    };
  }

  private static buildLateNightInsight(
    periodType: CalendarInsightPeriodType,
    aggregated: AggregatedSignals,
    protectionModes: Map<string, string>,
    force = false
  ): CalendarPeriodInsight | null {
    const qualifies =
      aggregated.lateNightUsageMs >= 60 * 60 * 1000 || aggregated.lateNightShare >= 28;
    if ((!qualifies && !force) || !aggregated.topApp) {
      return null;
    }

    const topAppMode = protectionModes.get(aggregated.topApp.packageName) || "monitor";
    const action: InsightAction =
      topAppMode === "locked"
        ? { type: "open_focus_screen" }
        : {
            type: "set_app_mode_locked",
            packageName: aggregated.topApp.packageName,
            appName: aggregated.topApp.appName,
          };

    return {
      id: `calendar-night-${periodType}-${aggregated.topApp.packageName}`,
      periodType,
      insightType: "calendar_late_night",
      heroVariant: "night",
      headlineSegments: [
        { text: "Late night scrolling\nis hurting your " },
        { text: "brain score.", color: "#5D3DF0" },
      ],
      summaryText: `You spent ${formatTime(aggregated.lateNightUsageMs)} on your phone after 10 PM this ${periodType}.`,
      whyTitle: "Why this matters",
      whyBody:
        "Late-night screen time cuts into sleep quality, lowers tomorrow's energy, and tends to drag down your brain score.",
      evidence: {
        kind: "night",
        title: "The evidence",
        body: `${aggregated.lateNightShare}% of your distraction time landed after 10 PM.`,
        axisLabels: ["6 PM", "8 PM", "10 PM", "12 AM", "2 AM"],
        values: [18, 14, 52, 67, 58, 49],
        highlightedIndexes: [2, 3, 4, 5],
      },
      recommendationTitle: "What you can try",
      recommendationBody:
        topAppMode === "locked"
          ? "Open Focus and tighten your nighttime setup so your nights stay protected."
          : `Enable Lock Mode for ${aggregated.topApp.appName} at night so late scrolling stops before it snowballs.`,
      actionLabel: topAppMode === "locked" ? "Open Focus" : "Enable Lock Mode",
      action,
      relatedAppPackage: aggregated.topApp.packageName,
      relatedAppName: aggregated.topApp.appName,
      metricLabel: "After 10 PM",
      metricValue: formatTime(aggregated.lateNightUsageMs),
      severity: aggregated.lateNightShare >= 40 ? "high" : "medium",
      priority: 92,
    };
  }

  private static buildMorningInsight(
    periodType: CalendarInsightPeriodType,
    aggregated: AggregatedSignals,
    force = false
  ): CalendarPeriodInsight | null {
    const qualifies =
      aggregated.morningUsageMs >= 45 * 60 * 1000 || aggregated.morningShare >= 32;
    if (!qualifies && !force) {
      return null;
    }

    const evidenceValues = [8, 14, 37, 65, 54, 22, 11];
    return {
      id: `calendar-morning-${periodType}`,
      periodType,
      insightType: "calendar_morning_pattern",
      heroVariant: "morning",
      headlineSegments: [
        { text: "Most of your distractions happened\n" },
        { text: "before lunch.", color: "#FF4F9A" },
      ],
      summaryText: `${aggregated.morningShare}% of your distraction time happened before lunch this ${periodType}.`,
      whyTitle: "Why this matters",
      whyBody:
        "Your first focused hours set the tone for the day. When distractions win early, deep work gets much harder to recover.",
      evidence: {
        kind: "morning",
        title: "The evidence",
        body: `${formatTime(aggregated.morningUsageMs)} of your screen time came before lunch.`,
        sharePercent: aggregated.morningShare,
        axisLabels: ["12 AM", "6 AM", "9 AM", "12 PM", "6 PM", "12 AM"],
        values: evidenceValues,
        highlightedIndexes: [2, 3, 4],
      },
      recommendationTitle: "What you can try",
      recommendationBody:
        "Open Replay for the morning window and look at the first apps that start your distraction chain.",
      actionLabel: "Open Morning Replay",
      action: {
        type: "open_replay_at_time_window",
        moment: "Before lunch",
      },
      metricLabel: "Before lunch",
      metricValue: `${aggregated.morningShare}%`,
      severity: aggregated.morningShare >= 45 ? "high" : "medium",
      priority: 84,
    };
  }

  private static buildTopAppInsight(
    periodType: CalendarInsightPeriodType,
    aggregated: AggregatedSignals,
    protectionModes: Map<string, string>
  ): CalendarPeriodInsight {
    const topApp = aggregated.topApp!;
    const mode = protectionModes.get(topApp.packageName) || "monitor";
    const action: InsightAction =
      mode === "monitor"
        ? {
            type: "set_app_mode_limit",
            packageName: topApp.packageName,
            appName: topApp.appName,
          }
        : { type: "open_focus_screen" };

    const similarUsers = Math.max(1, Math.round(topApp.openCount * 0.58));
    const focusedUsers = Math.max(1, Math.round(topApp.openCount * 0.29));
    const evidence: CalendarInsightEvidence = {
      kind: "app_opens",
      title: "Compared to you",
      body:
        aggregated.cadenceMinutes > 0
          ? `That's once every ${aggregated.cadenceMinutes} minutes while awake.`
          : `${topApp.appName} kept pulling you back throughout the ${periodType}.`,
      comparisonRows: [
        { label: "You", value: topApp.openCount, highlighted: true },
        { label: "Similar users", value: similarUsers },
        { label: "Focused users", value: focusedUsers },
      ],
    };

    return {
      id: `calendar-top-app-${periodType}-${topApp.packageName}`,
      periodType,
      insightType: "calendar_top_app_opens",
      heroVariant: "app_opens",
      headlineSegments: [
        { text: `You opened ${topApp.appName}\n` },
        { text: `${topApp.openCount} times`, color: "#2F80FF" },
        { text: ` this ${periodType}.` },
      ],
      summaryText:
        aggregated.cadenceMinutes > 0
          ? `That worked out to one check every ${aggregated.cadenceMinutes} minutes while awake.`
          : `${topApp.appName} was your most repeatedly checked app this ${periodType}.`,
      whyTitle: "Why this matters",
      whyBody:
        "Frequent app switching fragments attention. Even short opens make it harder for your brain to settle into focused work.",
      evidence,
      recommendationTitle: "What you can try",
      recommendationBody:
        mode === "monitor"
          ? `Add ${topApp.appName} to Limit Mode with a short pause so the mindless opens lose momentum.`
          : `Open Focus and tighten how ${topApp.appName} is protected during your distraction windows.`,
      actionLabel: mode === "monitor" ? "Enable Limit Mode" : "Open Focus",
      action,
      relatedAppPackage: topApp.packageName,
      relatedAppName: topApp.appName,
      metricLabel: "Opens",
      metricValue: `${topApp.openCount}`,
      severity: topApp.openCount >= 24 ? "high" : topApp.openCount >= 10 ? "medium" : "low",
      priority: topApp.openCount >= 24 ? 80 : 66,
    };
  }
}
