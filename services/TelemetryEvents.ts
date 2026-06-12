import type { PostHogEventProperties } from "@posthog/core";
import { Platform } from "react-native";

import type { CalendarPeriodInsight, InsightCard } from "@/services/InsightTypes";

export type ProtectionSource = "onboarding" | "focus_tab" | "insight_cta" | "replay_cta";
export type PermissionTrigger =
  | "onboarding"
  | "focus_mode"
  | "lock_mode"
  | "settings"
  | "insight_cta"
  | "home"
  | "replay";
export type NotificationType =
  | "morning_insight"
  | "weekly_report"
  | "monthly_report"
  | "permission_reminder";
export type ReplayDateType = "today" | "yesterday" | "historical";
export type InsightFeedbackSurface = "replay" | "progress";
export type InsightFeedbackVote = "up" | "down";
export type ReviewPromptSource = "morning_replay" | "dev_button";
export type SubscriptionStatus = "trial" | "active" | "expired";
export type ExpiredPaywallScreen = "intro" | "declined" | "returning";

export type TelemetryEventMap = {
  onboarding_started: { screen_name: string };
  onboarding_screen_viewed: { screen_name: string };
  onboarding_completed: {
    screen_name: string;
    selected_app_count: number;
    default_apps_removed_count: number;
    permission_result: string;
  };
  usage_access_prompt_shown: { screen_name: string };
  usage_access_granted: { screen_name: string; permission_result: "granted" };
  usage_access_denied: { screen_name: string; permission_result: "denied" };
  apps_selected_onboarding: {
    screen_name: string;
    selected_app_count: number;
    default_apps_removed_count: number;
  };
  app_opened: {
    local_date: string;
    open_count_for_day: number;
    open_hour_local: number;
    subscription_status?: SubscriptionStatus;
    hours_since_last_open?: number;
    days_since_last_open?: number;
  };
  subscription_access_reconciled: {
    reason:
      | "app_startup"
      | "app_resume"
      | "onboarding_completed"
      | "auth_state_changed"
      | "auth_sync_completed"
      | "customer_info_updated"
      | "dev_override"
      | "manual_restore";
    subscription_status: SubscriptionStatus;
    is_premium: boolean;
    trial_days_remaining?: number;
    expired_flow_state?: ExpiredPaywallScreen;
  };
  expired_app_opened: {
    local_date: string;
    open_count_for_day: number;
    open_hour_local: number;
    screen: ExpiredPaywallScreen;
    hours_since_last_open?: number;
    days_since_last_open?: number;
  };
  expired_paywall_viewed: {
    screen: ExpiredPaywallScreen;
    subscription_status: "expired";
  };
  expired_paywall_cta_clicked: {
    screen: ExpiredPaywallScreen;
    cta:
      | "get_lifetime_access"
      | "no_thanks"
      | "close_app"
      | "help_shape_brainrot"
      | "dev_force_trial"
      | "dev_force_active"
      | "dev_force_expired_intro"
      | "dev_force_expired_declined"
      | "dev_force_expired_returning";
    subscription_status: SubscriptionStatus;
  };
  expired_paywall_declined: {
    screen: "intro";
    subscription_status: "expired";
  };
  expired_paywall_reopened: {
    screen: "returning";
    subscription_status: "expired";
  };
  subscription_entitlement_activated: {
    source: "customer_info" | "restore" | "dev_override";
    subscription_status: "active";
  };
  subscription_restore_result: {
    success: boolean;
    has_active_entitlement: boolean;
    subscription_status?: SubscriptionStatus;
  };
  review_prompt_requested: {
    source: ReviewPromptSource;
    qualifying_visit_count?: number;
    prompt_attempt_number?: number;
    days_since_last_prompt?: number;
  };
  review_prompt_unavailable: {
    source: ReviewPromptSource;
    reason: "no_action" | "not_available" | "request_failed";
    qualifying_visit_count?: number;
    prompt_attempt_number?: number;
  };
  home_viewed: {
    brain_score: number;
    brain_status: string;
    monitored_app_count: number;
    has_usage_access: boolean;
    has_accessibility: boolean;
  };
  brain_score_viewed: {
    brain_score: number;
    brain_status: string;
    monitored_app_count: number;
    has_usage_access: boolean;
    has_accessibility: boolean;
  };
  first_full_day_data_ready: { brain_score: number; brain_status: string };
  first_insight_generated: { insight_type: string; app_package?: string; app_name?: string };
  first_insight_viewed: { insight_type: string; app_package?: string; app_name?: string };
  insight_generated: InsightTelemetryProps;
  insight_card_viewed: InsightTelemetryProps;
  insight_card_tapped: InsightTelemetryProps;
  insight_cta_clicked: InsightTelemetryProps;
  insight_dismissed: InsightTelemetryProps;
  insight_feedback_submitted: InsightFeedbackTelemetryProps;
  replay_viewed: ReplayTelemetryProps;
  replay_session_tapped: ReplayTelemetryProps & { app_name: string };
  replay_date_changed: ReplayTelemetryProps;
  replay_today_yesterday_switched: ReplayTelemetryProps;
  protection_level_changed: {
    app_name: string;
    old_level?: string;
    new_level: string;
    source: ProtectionSource;
  };
  limit_strength_changed: {
    app_name?: string;
    limit_strength: string;
    source: ProtectionSource | "settings";
  };
  app_added_to_protected: { app_name: string; new_level: string; source: ProtectionSource };
  app_removed_from_protected: { app_name: string; old_level?: string; source: ProtectionSource };
  pause_screen_shown: PauseTelemetryProps;
  pause_screen_countdown_completed: PauseTelemetryProps;
  pause_screen_continue_clicked: PauseTelemetryProps;
  pause_screen_exit_clicked: PauseTelemetryProps;
  pause_screen_snoozed: PauseTelemetryProps;
  focus_mode_started: {
    duration_minutes?: number;
    locked_app_count: number;
    apps_blocked: number;
  };
  focus_mode_completed: {
    duration_minutes?: number;
    locked_app_count: number;
    apps_blocked: number;
  };
  focus_mode_cancelled: {
    duration_minutes?: number;
    locked_app_count: number;
    apps_blocked: number;
    cancel_reason?: string;
  };
  focus_mode_duration_selected: { duration_minutes: number };
  lock_screen_shown: PauseTelemetryProps;
  emergency_pass_used: {
    app_name: string;
    pass_count_remaining: number;
  };
  emergency_passes_exhausted: {
    app_name: string;
    pass_count_remaining: 0;
  };
  accessibility_prompt_shown: PermissionTelemetryProps;
  accessibility_granted: PermissionTelemetryProps;
  accessibility_denied: PermissionTelemetryProps;
  accessibility_helper_opened: PermissionTelemetryProps;
  overlay_permission_granted: PermissionTelemetryProps;
  notification_permission_granted: PermissionTelemetryProps;
  notification_sent: {
    notification_type: NotificationType;
    insight_type?: string;
    app_name?: string;
    brain_score?: number;
  };
  notification_opened: {
    notification_type: NotificationType;
    insight_type?: string;
    app_name?: string;
    brain_score?: number;
  };
  notification_dismissed: {
    notification_type: NotificationType;
    insight_type?: string;
    app_name?: string;
    brain_score?: number;
  };
  blocking_debug: {
    stage: string;
    package_name?: string;
    app_name?: string;
    protection_mode?: string;
    reason?: string;
    source?: string;
  };
};

export type InsightTelemetryProps = {
  insight_type: string;
  app_package?: string;
  app_name?: string;
  severity: string;
  recommended_action: string;
  cta_type: string;
};

export type InsightFeedbackTelemetryProps = {
  surface: InsightFeedbackSurface;
  insight_type: string;
  app_package?: string;
  severity: string;
  vote: InsightFeedbackVote;
};

export type ReplayTelemetryProps = {
  date_type: ReplayDateType;
  total_distraction_ms: number;
  open_count: number;
  top_app?: string;
  session_count: number;
};

export type PauseTelemetryProps = {
  app_name: string;
  session_duration_ms?: number;
  daily_usage_ms?: number;
  open_count_today?: number;
  pause_number_today?: number;
  limit_strength?: string;
  message_type: "soft" | "hard";
};

export type PermissionTelemetryProps = {
  trigger: PermissionTrigger;
  device_brand: string;
  android_version: string;
};

export type TelemetryEventName = keyof TelemetryEventMap;

export function buildPermissionTelemetry(trigger: PermissionTrigger): PermissionTelemetryProps {
  const platformConstants = (Platform as unknown as { constants?: { Brand?: string } }).constants;
  return {
    trigger,
    device_brand: platformConstants?.Brand || "unknown",
    android_version: String(Platform.Version ?? "unknown"),
  };
}

export function buildInsightTelemetry(insight: InsightCard): InsightTelemetryProps {
  return {
    insight_type: getInsightTelemetryType(insight),
    app_package: insight.relatedAppPackage || insight.subjectAppPackage || undefined,
    app_name: insight.relatedAppPackage ? undefined : undefined,
    severity: getInsightSeverity(insight),
    recommended_action: insight.action.type,
    cta_type: insight.action.type,
  };
}

export function buildCalendarInsightTelemetry(
  insight: CalendarPeriodInsight
): InsightTelemetryProps {
  return {
    insight_type: insight.insightType,
    app_package: insight.relatedAppPackage || undefined,
    app_name: insight.relatedAppName || undefined,
    severity: insight.severity,
    recommended_action: insight.action.type,
    cta_type: `calendar_${insight.periodType}:${insight.action.type}`,
  };
}

export function buildInsightFeedbackTelemetry(
  insight: InsightCard,
  surface: InsightFeedbackSurface,
  vote: InsightFeedbackVote
): InsightFeedbackTelemetryProps {
  return {
    surface,
    insight_type: getInsightTelemetryType(insight),
    app_package: insight.relatedAppPackage || insight.subjectAppPackage || undefined,
    severity: getInsightSeverity(insight),
    vote,
  };
}

export function buildCalendarInsightFeedbackTelemetry(
  insight: CalendarPeriodInsight,
  surface: InsightFeedbackSurface,
  vote: InsightFeedbackVote
): InsightFeedbackTelemetryProps {
  return {
    surface,
    insight_type: insight.insightType,
    app_package: insight.relatedAppPackage || undefined,
    severity: insight.severity,
    vote,
  };
}

export function getInsightTelemetryType(
  insight: Pick<InsightCard, "insightType" | "category" | "id">
): string {
  return insight.insightType || insight.id || insight.category;
}

export function getInsightSeverity(insight: InsightCard): string {
  const priority = insight.scoreBreakdown?.finalPriority ?? insight.priority ?? 0;
  if (priority >= 80) {
    return "high";
  }
  if (priority >= 50) {
    return "medium";
  }
  return "low";
}

export function withDefinedProperties<T extends PostHogEventProperties>(properties: T): T {
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined)
  ) as T;
}
