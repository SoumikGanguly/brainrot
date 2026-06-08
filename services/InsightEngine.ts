import { formatTime } from '@/utils/time';

import type { BlockEvent, DailyUsage } from './database';
import { InsightMemoryService } from './InsightMemoryService';
import type {
  DailyInsightSignals,
  InsightAction,
  InsightCard,
  InsightPriorityBreakdown,
  RecentInsightMemory,
} from './InsightTypes';
import type { ReplayEntry } from './DailyInsightsService';

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
  'priority' | 'scoreBreakdown'
> & {
  severity: number;
  actionability: number;
  confidence: number;
  categoryPrior?: number;
};

const CATEGORY_PRIORS: Record<InsightCard['category'], number> = {
  opportunity_cost: 4,
  awareness: 3,
  pattern: 3,
  comparison: 3,
  intervention: 2,
  improvement: 1,
  behavioral: 2,
};

const OPPORTUNITY_EQUIVALENTS = [
  {
    key: 'workouts',
    unitMinutes: 45,
    render: (count: number) => `${count} x 45-minute workouts`,
  },
  {
    key: 'guitar',
    unitMinutes: 30,
    render: (count: number) => `${count} x 30-minute guitar sessions`,
  },
] as const;

export class InsightEngine {
  static async generate(input: InsightEngineInput): Promise<InsightCard[]> {
    const { summary } = input;
    if (!summary?.insightSignals) {
      return [];
    }

    const isCurrentDate = input.date === new Date().toISOString().split('T')[0];
    const signals = summary.insightSignals;
    const memory = await InsightMemoryService.load();
    const candidates: CandidateSpec[] = [];

    const opportunity = this.buildOpportunityInsight(
      signals,
      input.focusSessionActive,
      isCurrentDate
    );
    if (opportunity) candidates.push(opportunity);

    const awareness = this.buildAwarenessInsight(signals, input.protectionModes);
    if (awareness) candidates.push(awareness);

    const pattern = this.buildPatternInsight(signals, input.replayEntries, isCurrentDate);
    if (pattern) candidates.push(pattern);

    const comparison = this.buildComparisonInsight(
      signals,
      summary,
      input.trailingSummaries,
      input.protectionModes
    );
    if (comparison) candidates.push(comparison);

    const intervention = this.buildInterventionInsight(signals, input.protectionModes);
    if (intervention) candidates.push(intervention);

    const improvement = this.buildImprovementInsight(signals);
    if (improvement) candidates.push(improvement);

    const behavioral = this.buildBehavioralInsight(
      signals,
      input.focusSessionActive,
      isCurrentDate
    );
    if (behavioral) candidates.push(behavioral);

    return this.dedupeAndRank(candidates, memory, input.date);
  }

  private static buildOpportunityInsight(
    signals: DailyInsightSignals,
    focusSessionActive: boolean,
    isCurrentDate: boolean
  ): CandidateSpec | null {
    if (signals.totalDistractingMs < 45 * 60 * 1000) {
      return null;
    }

    const chips = this.buildOpportunityEquivalents(signals.totalDistractingMs);
    if (chips.length === 0) {
      return null;
    }

    const action = focusSessionActive
      ? ({ type: 'open_focus_screen' } satisfies InsightAction)
      : ({ type: 'start_focus_session' } satisfies InsightAction);

    return this.createCandidate({
      id: 'opportunity-cost',
      category: 'opportunity_cost',
      headline: isCurrentDate
        ? `You have lost ${formatTime(signals.totalDistractingMs)} today.`
        : `You lost ${formatTime(signals.totalDistractingMs)} that day.`,
      subtext: 'That was enough time to reclaim for things you would actually remember doing.',
      chips,
      actionLabel: focusSessionActive ? 'Open Focus' : 'Start Focus Mode today',
      action,
      actionKey: this.getActionKey(action),
      evidenceStrength: 96,
      severity: this.scale(signals.totalDistractingMs / (4 * 60 * 60 * 1000), 45, 98),
      actionability: focusSessionActive ? 44 : 92,
      confidence: 95,
    });
  }

  private static buildAwarenessInsight(
    signals: DailyInsightSignals,
    protectionModes: Map<string, string>
  ): CandidateSpec | null {
    if (!signals.topAppName || !signals.topAppPackage || signals.topAppOpenCount < 8) {
      return null;
    }

    const mode = protectionModes.get(signals.topAppPackage) || 'monitor';
    const action =
      mode === 'monitor'
        ? ({
            type: 'set_app_mode_limit',
            packageName: signals.topAppPackage,
            appName: signals.topAppName,
          } satisfies InsightAction)
        : ({ type: 'open_focus_screen' } satisfies InsightAction);

    return this.createCandidate({
      id: `awareness-${signals.topAppPackage}`,
      category: 'awareness',
      headline: `You opened ${signals.topAppName}\n${signals.topAppOpenCount} times.`,
      subtext: 'Frequent checking is usually where attention gets fragmented first.',
      actionLabel: mode === 'monitor' ? 'Enable Limit Mode' : 'Open Focus',
      action,
      relatedAppPackage: signals.topAppPackage,
      subjectAppPackage: signals.topAppPackage,
      actionKey: this.getActionKey(action),
      evidenceStrength: Math.min(100, signals.topAppOpenCount * 4),
      severity: this.scale(signals.topAppOpenCount / 32, 38, 88),
      actionability: mode === 'monitor' ? 84 : 46,
      confidence: 88,
    });
  }

  private static buildPatternInsight(
    signals: DailyInsightSignals,
    replayEntries: ReplayEntry[],
    isCurrentDate: boolean
  ): CandidateSpec | null {
    if (
      signals.wakeWindowUsageMs >= 20 * 60 * 1000 &&
      signals.wakeWindowOpenCount >= 2
    ) {
      const action = {
        type: 'open_replay_at_time_window',
        moment: 'Early morning',
      } satisfies InsightAction;

      return this.createCandidate({
        id: 'pattern-wake-window',
        category: 'pattern',
        headline: 'Most of your distractions happen\nwithin 30 minutes of waking up.',
        subtext: isCurrentDate
          ? `That first stretch has already cost you ${formatTime(signals.wakeWindowUsageMs)} today.`
          : `That first stretch cost you ${formatTime(signals.wakeWindowUsageMs)} that day.`,
        actionLabel: 'Tap to see replay',
        action,
        subjectMoment: 'Early morning',
        actionKey: this.getActionKey(action),
        evidenceStrength: 84,
        severity: this.scale(signals.wakeWindowUsageMs / (90 * 60 * 1000), 35, 82),
        actionability: 74,
        confidence: 86,
      });
    }

    if (!signals.dominantMoment || signals.dominantMomentPercent < 38) {
      return null;
    }

    const hasMatchingReplay = replayEntries.some((entry) => entry.moment === signals.dominantMoment);
    if (!hasMatchingReplay) {
      return null;
    }

    const action = {
      type: 'open_replay_at_time_window',
      moment: signals.dominantMoment,
    } satisfies InsightAction;

    return this.createCandidate({
      id: `pattern-${signals.dominantMoment}`,
      category: 'pattern',
      headline: `Most distractions happen\n${this.getMomentWindowCopy(signals.dominantMoment)}.`,
      subtext: isCurrentDate
        ? `${signals.dominantMomentPercent}% of today's distraction time has landed there.`
        : `${signals.dominantMomentPercent}% of that day's distraction time landed there.`,
      actionLabel: 'Tap to see replay',
      action,
      subjectMoment: signals.dominantMoment,
      actionKey: this.getActionKey(action),
      evidenceStrength: signals.dominantMomentPercent,
      severity: this.scale(signals.dominantMomentPercent / 100, 32, 78),
      actionability: 76,
      confidence: 90,
    });
  }

  private static buildComparisonInsight(
    signals: DailyInsightSignals,
    summary: DailyUsage,
    trailingSummaries: DailyUsage[],
    protectionModes: Map<string, string>
  ): CandidateSpec | null {
    const topApp = summary.apps[0];
    if (!topApp) {
      return null;
    }

    const historicalValues = trailingSummaries
      .map((day) => day.apps.find((app) => app.packageName === topApp.packageName)?.totalTimeMs || 0)
      .filter((value) => value > 0);

    if (historicalValues.length === 0) {
      return null;
    }

    const averagePreviousUsage =
      historicalValues.reduce((sum, value) => sum + value, 0) / historicalValues.length;
    if (averagePreviousUsage <= 0 || topApp.totalTimeMs <= averagePreviousUsage) {
      return null;
    }

    const increasePercent = Math.round(
      ((topApp.totalTimeMs - averagePreviousUsage) / averagePreviousUsage) * 100
    );
    if (increasePercent < 25) {
      return null;
    }

    const mode = protectionModes.get(topApp.packageName) || 'monitor';
    const action =
      mode === 'locked'
        ? ({ type: 'open_focus_screen' } satisfies InsightAction)
        : ({
            type: 'set_app_mode_locked',
            packageName: topApp.packageName,
            appName: topApp.appName,
          } satisfies InsightAction);

    return this.createCandidate({
      id: `comparison-${topApp.packageName}`,
      category: 'comparison',
      headline: `${topApp.appName} usage increased\n${increasePercent}% from last week.`,
      subtext: `${topApp.appName} is taking a bigger share of your attention than usual.`,
      actionLabel: mode === 'locked' ? 'Open Focus' : 'Enable Lock Mode',
      action,
      relatedAppPackage: topApp.packageName,
      subjectAppPackage: topApp.packageName,
      actionKey: this.getActionKey(action),
      evidenceStrength: Math.min(100, increasePercent),
      severity: this.scale(increasePercent / 100, 44, 90),
      actionability: mode === 'locked' ? 42 : 86,
      confidence: this.scale(historicalValues.length / 7, 68, 90),
    });
  }

  private static buildInterventionInsight(
    signals: DailyInsightSignals,
    protectionModes: Map<string, string>
  ): CandidateSpec | null {
    if (!signals.topAppPackage || !signals.topAppName || signals.topAppSharePercent < 35) {
      return null;
    }

    const mode = protectionModes.get(signals.topAppPackage) || 'monitor';
    if (mode !== 'monitor') {
      return null;
    }

    const action = {
      type: 'set_app_mode_limit',
      packageName: signals.topAppPackage,
      appName: signals.topAppName,
    } satisfies InsightAction;

    return this.createCandidate({
      id: `intervention-${signals.topAppPackage}`,
      category: 'intervention',
      headline: `Limit Mode could reduce\n${signals.topAppSharePercent}% of your distractions.`,
      subtext: `${signals.topAppName} caused most of yesterday's distraction time.`,
      actionLabel: 'Enable Limit Mode',
      action,
      relatedAppPackage: signals.topAppPackage,
      subjectAppPackage: signals.topAppPackage,
      actionKey: this.getActionKey(action),
      evidenceStrength: signals.topAppSharePercent,
      severity: this.scale(signals.topAppSharePercent / 100, 30, 76),
      actionability: 82,
      confidence: 82,
    });
  }

  private static buildImprovementInsight(
    signals: DailyInsightSignals
  ): CandidateSpec | null {
    if (signals.improvementVsYesterdayOpens < 5) {
      return null;
    }

    const action = { type: 'open_focus_screen' } satisfies InsightAction;

    return this.createCandidate({
      id: 'improvement-yesterday',
      category: 'improvement',
      headline: `You opened ${signals.topAppName || 'your distractions'}\n${signals.improvementVsYesterdayOpens} fewer times than yesterday.`,
      subtext: 'That is real progress. Reinforce it before the pattern snaps back.',
      actionLabel: 'Open Focus',
      action,
      relatedAppPackage: signals.topAppPackage || undefined,
      subjectAppPackage: signals.topAppPackage || undefined,
      actionKey: this.getActionKey(action),
      evidenceStrength: Math.min(100, signals.improvementVsYesterdayOpens * 5),
      severity: this.scale(signals.improvementVsYesterdayOpens / 20, 26, 62),
      actionability: 54,
      confidence: 84,
    });
  }

  private static buildBehavioralInsight(
    signals: DailyInsightSignals,
    focusSessionActive: boolean,
    isCurrentDate: boolean
  ): CandidateSpec | null {
    const action = focusSessionActive
      ? ({ type: 'open_focus_screen' } satisfies InsightAction)
      : ({ type: 'start_focus_session' } satisfies InsightAction);

    if (signals.distractionCadenceMinutes > 0 && signals.distractionCadenceMinutes <= 25) {
      return this.createCandidate({
        id: 'behavioral-cadence',
        category: 'behavioral',
        headline: `You checked ${signals.topAppName || 'your phone'}\nonce every ${signals.distractionCadenceMinutes} minutes while awake.`,
        subtext: 'That kind of cadence keeps your attention from settling.',
        actionLabel: focusSessionActive ? 'Open Focus' : 'Start Focus Mode today',
        action,
        relatedAppPackage: signals.topAppPackage || undefined,
        subjectAppPackage: signals.topAppPackage || undefined,
        actionKey: this.getActionKey(action),
        evidenceStrength: this.scale((25 - signals.distractionCadenceMinutes) / 25, 50, 92),
        severity: this.scale((25 - signals.distractionCadenceMinutes) / 25, 36, 80),
        actionability: focusSessionActive ? 42 : 72,
        confidence: 80,
      });
    }

    if (signals.totalDistractingMs >= 50 * 60 * 1000) {
      return this.createCandidate({
        id: 'behavioral-eating',
        category: 'behavioral',
        headline: isCurrentDate
          ? `You have spent more time on ${signals.topAppName || 'distractions'}\nthan eating today.`
          : `You spent more time on ${signals.topAppName || 'distractions'}\nthan eating that day.`,
        subtext: 'That is a strong sign the day is bending around your impulses.',
        actionLabel: focusSessionActive ? 'Open Focus' : 'Start Focus Mode today',
        action,
        relatedAppPackage: signals.topAppPackage || undefined,
        subjectAppPackage: signals.topAppPackage || undefined,
        actionKey: this.getActionKey(action),
        evidenceStrength: 70,
        severity: this.scale(signals.totalDistractingMs / (3 * 60 * 60 * 1000), 28, 68),
        actionability: focusSessionActive ? 42 : 70,
        confidence: 68,
      });
    }

    return null;
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
          candidate.category,
          candidate.subjectAppPackage || '',
          candidate.subjectMoment || '',
          candidate.actionKey,
        ].join(':');
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
      candidate.severity * 0.38 +
        candidate.actionability * 0.2 +
        candidate.confidence * 0.16 +
        novelty * 0.18 +
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

    let novelty = 78;
    let categoryHits = 0;
    let appHits = 0;
    let momentHits = 0;

    for (const priorDate of priorDates) {
      const entries = memory.shownByDate[priorDate] || [];
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

    novelty -= categoryHits * 10;
    novelty -= appHits * 8;
    novelty -= momentHits * 6;

    const recentlyActed = memory.acted.some(
      (entry) =>
        entry.actionKey === candidate.actionKey &&
        Date.now() - entry.actedAt < 3 * 24 * 60 * 60 * 1000
    );
    if (recentlyActed) {
      novelty -= 22;
    }

    if (categoryHits === 0) {
      novelty += 10;
    }
    if (candidate.subjectAppPackage && appHits === 0) {
      novelty += 6;
    }
    if (candidate.subjectMoment && momentHits === 0) {
      novelty += 5;
    }

    return this.clamp(novelty, 18, 96);
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

  private static buildOpportunityEquivalents(totalMs: number): string[] {
    const totalMinutes = Math.floor(totalMs / 60000);
    const chips = OPPORTUNITY_EQUIVALENTS.map((item) => {
      const count = Math.floor(totalMinutes / item.unitMinutes);
      if (count < 1) {
        return null;
      }
      return item.render(count);
    }).filter((value): value is string => Boolean(value));

    return chips.slice(0, 3);
  }

  private static createCandidate(candidate: CandidateSpec): CandidateSpec {
    return {
      ...candidate,
      categoryPrior: candidate.categoryPrior ?? CATEGORY_PRIORS[candidate.category],
    };
  }

  private static getActionKey(action: InsightAction): string {
    switch (action.type) {
      case 'start_focus_session':
        return 'start_focus_session';
      case 'set_app_mode_limit':
        return `set_app_mode_limit:${action.packageName}`;
      case 'set_app_mode_locked':
        return `set_app_mode_locked:${action.packageName}`;
      case 'open_replay_at_time_window':
        return `open_replay_at_time_window:${action.moment}`;
      case 'open_focus_screen':
        return 'open_focus_screen';
      case 'open_permissions_accessibility':
        return 'open_permissions_accessibility';
    }
  }

  private static getMomentWindowCopy(moment: string): string {
    if (moment === 'After bed') return 'between 10 PM and 12 AM';
    if (moment === 'Before lunch') return 'between 12 PM and 2 PM';
    if (moment === 'Early morning') return 'between 4 AM and 7 AM';
    if (moment === 'Morning') return 'between 7 AM and 9 AM';
    if (moment === 'Mid day') return 'between 9 AM and 12 PM';
    return 'in the evening';
  }

  private static scale(value: number, min: number, max: number): number {
    return min + (max - min) * this.clamp(value, 0, 1);
  }

  private static clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}
