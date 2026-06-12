export type InsightCategory =
  | 'opportunity_cost'
  | 'awareness'
  | 'pattern'
  | 'comparison'
  | 'intervention'
  | 'success'
  | 'improvement'
  | 'behavioral';

export type InsightAction =
  | {
      type: 'start_focus_session';
    }
  | {
      type: 'set_app_mode_limit';
      packageName: string;
      appName: string;
    }
  | {
      type: 'set_app_mode_locked';
      packageName: string;
      appName: string;
    }
  | {
      type: 'open_replay_at_time_window';
      moment: string;
    }
  | {
      type: 'open_focus_screen';
    }
  | {
      type: 'open_permissions_accessibility';
    };

export interface InsightPriorityBreakdown {
  severity: number;
  actionability: number;
  confidence: number;
  novelty: number;
  freshness: number;
  finalPriority: number;
}

export interface InsightCard {
  id: string;
  insightType: string;
  category: InsightCategory;
  priority: number;
  headline: string;
  subtext: string;
  chips?: string[];
  actionLabel: string;
  action: InsightAction;
  relatedAppPackage?: string;
  subjectAppPackage?: string;
  subjectMoment?: string;
  actionKey: string;
  evidenceStrength: number;
  scoreBreakdown: InsightPriorityBreakdown;
}

export type CalendarInsightPeriodType = 'week' | 'month';

export type CalendarInsightHeroVariant = 'morning' | 'app_opens' | 'night';

export type CalendarInsightType =
  | 'calendar_morning_pattern'
  | 'calendar_top_app_opens'
  | 'calendar_late_night';

export interface CalendarInsightHeadlineSegment {
  text: string;
  color?: string;
}

export type CalendarInsightEvidence =
  | {
      kind: 'morning';
      title: string;
      body: string;
      sharePercent: number;
      axisLabels: string[];
      values: number[];
      highlightedIndexes: number[];
    }
  | {
      kind: 'app_opens';
      title: string;
      body: string;
      comparisonRows: {
        label: string;
        value: number;
        highlighted?: boolean;
      }[];
    }
  | {
      kind: 'night';
      title: string;
      body: string;
      axisLabels: string[];
      values: number[];
      highlightedIndexes: number[];
    };

export interface CalendarPeriodInsight {
  id: string;
  periodType: CalendarInsightPeriodType;
  insightType: CalendarInsightType;
  heroVariant: CalendarInsightHeroVariant;
  headlineSegments: CalendarInsightHeadlineSegment[];
  summaryText: string;
  whyTitle: string;
  whyBody: string;
  evidence: CalendarInsightEvidence;
  recommendationTitle: string;
  recommendationBody: string;
  actionLabel: string;
  action: InsightAction;
  relatedAppPackage?: string;
  relatedAppName?: string;
  metricLabel?: string;
  metricValue?: string;
  severity: 'low' | 'medium' | 'high';
  priority: number;
}

export interface RecentInsightMemoryEntry {
  id: string;
  insightType?: string;
  category: InsightCategory;
  subjectAppPackage?: string;
  subjectMoment?: string;
  actionKey: string;
}

export interface RecentInsightActionMemory {
  actionKey: string;
  actedAt: number;
}

export interface RecentInsightMemory {
  shownByDate: Record<string, RecentInsightMemoryEntry[]>;
  acted: RecentInsightActionMemory[];
  persistedByDate: Record<string, PersistedDailyInsights>;
}

export interface PersistedDailyInsights {
  date: string;
  savedAt: number;
  rankedInsights: InsightCard[];
}

export type InsightLoadState = 'generated' | 'persisted' | 'missing';

export interface DailyInsightSignals {
  totalDistractingMs: number;
  totalMonitoredOpens: number;
  longestSessionMs: number;
  averageSessionMs: number;
  lateNightUsageMs: number;
  morningUsageMs: number;
  beforeLunchUsageMs: number;
  wakeWindowUsageMs: number;
  wakeWindowOpenCount: number;
  awakeSpanMinutes: number;
  distractionCadenceMinutes: number;
  firstDistractionAt?: string | null;
  lastDistractionAt?: string | null;
  longestSessionStartedAt?: string | null;
  dominantHour?: number | null;
  dominantHourSharePercent: number;
  topAppPackage?: string | null;
  topAppName?: string | null;
  topAppMs: number;
  topAppOpenCount: number;
  topAppSharePercent: number;
  limitDismissals: number;
  bypassCount: number;
  abandonedCount: number;
  improvementVsYesterdayMs: number;
  improvementVsYesterdayOpens: number;
  improvementVs7DayBaselineMs: number;
  improvementVs7DayBaselineOpens: number;
  dominantMoment?: string | null;
  dominantMomentPercent: number;
}
