import { Platform } from 'react-native';

import { CapabilitiesService } from './CapabilitiesService';
import { UnifiedUsageService } from './UnifiedUsageService';
import { database, type AppSettings } from './database';

export type PermissionNudgeAction =
  | 'usage_access'
  | 'accessibility'
  | 'overlay'
  | 'notifications'
  | 'background_reliability'
  | 'battery_optimization'
  | 'lock_screen_guidance'
  | 'tracking_stale';

export type PermissionNudgeKind = 'actionable' | 'advisory';

export interface PermissionNudge {
  id: string;
  action: PermissionNudgeAction;
  kind: PermissionNudgeKind;
  title: string;
  body: string;
  helperText: string;
  severity: 'info' | 'warning' | 'critical';
  ctaLabel: string;
}

export interface PermissionHealth {
  usageAccess: boolean;
  accessibility: boolean;
  overlay: boolean;
  notifications: boolean;
  backgroundReliabilityLikelyNeeded: boolean;
  batteryOptimizationIgnored: boolean;
  trackingStale: boolean;
  lockScreenNotificationGuidanceNeeded: boolean;
  manufacturer: string;
  nudges: PermissionNudge[];
  actionableNudges: PermissionNudge[];
  advisoryNudges: PermissionNudge[];
}

const NUDGE_DISMISS_MS = 24 * 60 * 60 * 1000;
const STALE_TRACKING_MS = 26 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOME_PROMPT_FIRST_SHOW_DAY = 4;
const HOME_PROMPT_MAX_IMPRESSIONS = 2;
const HOME_PROMPT_SNOOZE_DAYS = 7;
const RECENT_PERMISSION_FLOW_SUPPRESS_MS = 3 * DAY_MS;
const INSTALL_FIRST_SEEN_KEY = 'install_first_seen_at';
const HOME_PROMPT_DISMISSED_AT_KEY = 'permission_home_prompt_dismissed_at';
const HOME_PROMPT_IMPRESSIONS_KEY = 'permission_home_prompt_impressions';

export class PermissionHealthService {
  static async getPermissionHealth(): Promise<PermissionHealth> {
    const [
      usageAccess,
      accessibility,
      overlay,
      notifications,
      manufacturerInfo,
      settings,
      monitoringEnabled,
      lastSyncAtRaw,
      monitoringDiagnostics,
    ] = await Promise.all([
      CapabilitiesService.hasUsageAccess(),
      CapabilitiesService.hasAccessibilityPermission(),
      CapabilitiesService.hasOverlayPermission(),
      CapabilitiesService.hasNotificationPermission(),
      UnifiedUsageService.getManufacturerInfo(),
      database.getAppSettings(),
      database.getMeta('monitoring_enabled'),
      database.getMeta('last_successful_usage_sync_at'),
      UnifiedUsageService.getMonitoringDiagnostics().catch(() => null),
    ]);

    const protectedSettings = settings.filter((setting) => Boolean(setting.protectionMode));
    const needsAccessibility = protectedSettings.some(
      (setting) => setting.protectionMode === 'locked' || setting.protectionMode === 'limit'
    );
    const needsOverlay = protectedSettings.some((setting) => setting.protectionMode === 'limit');
    const lastSyncAt = parseInt(lastSyncAtRaw || '0', 10);
    const trackingStale =
      monitoringEnabled === 'true' &&
      usageAccess &&
      (lastSyncAt <= 0 || Date.now() - lastSyncAt > STALE_TRACKING_MS);
    const batteryOptimizationIgnored =
      monitoringDiagnostics?.batteryOptimizationIgnored ?? Platform.OS !== 'android';
    const lockScreenNotificationGuidanceNeeded =
      monitoringDiagnostics?.lockScreenNotificationGuidanceNeeded ??
      shouldSuggestLockScreenGuidance(manufacturerInfo?.manufacturer);
    const backgroundReliabilityLikelyNeeded =
      Platform.OS === 'android' &&
      (Boolean(manufacturerInfo?.needsSpecialPermission) || !batteryOptimizationIgnored);

    const actionableNudges: PermissionNudge[] = [];
    const advisoryNudges: PermissionNudge[] = [];

    if (!usageAccess) {
      actionableNudges.push({
        id: 'usage_access_missing',
        action: 'usage_access',
        kind: 'actionable',
        title: 'Allow app usage access',
        body: 'Brainrot needs this Android access to build your score, replay, and daily insights.',
        helperText: 'Open App usage access, choose Brainrot, and allow access.',
        severity: 'critical',
        ctaLabel: 'Open settings',
      });
    }

    if (needsAccessibility && !accessibility) {
      actionableNudges.push({
        id: 'accessibility_missing',
        action: 'accessibility',
        kind: 'actionable',
        title: 'Enable app protection',
        body: 'Accessibility lets Lock Mode and Focus Sessions catch distractions the moment they open.',
        helperText: 'Open Accessibility, find Brainrot, and turn the service on.',
        severity: 'critical',
        ctaLabel: 'Open settings',
      });
    }

    if (needsOverlay && !overlay) {
      actionableNudges.push({
        id: 'overlay_missing',
        action: 'overlay',
        kind: 'actionable',
        title: 'Allow pause screens over apps',
        body: 'Brainrot can still track usage, but Limit Mode cannot show its pause screen without overlay access.',
        helperText: 'Open Display over other apps, choose Brainrot, and allow it.',
        severity: 'warning',
        ctaLabel: 'Open settings',
      });
    }

    if (!notifications) {
      actionableNudges.push({
        id: 'notifications_missing',
        action: 'notifications',
        kind: 'actionable',
        title: 'Allow reminders and fixed status updates',
        body: 'Notifications keep replay reminders and the fixed focus-status notification visible.',
        helperText: 'Allow notifications for Brainrot, including lock-screen display if your phone offers that option.',
        severity: 'info',
        ctaLabel: 'Allow',
      });
    }

    if (!batteryOptimizationIgnored) {
      advisoryNudges.push({
        id: 'battery_optimization',
        action: 'battery_optimization',
        kind: 'advisory',
        title: 'Battery restrictions may pause tracking',
        body: 'Your phone is still optimizing Brainrot in the background, which can delay score and replay updates.',
        helperText: 'Allow unrestricted battery for Brainrot so background checks and the fixed notification stay reliable.',
        severity: 'warning',
        ctaLabel: 'Fix now',
      });
    }

    if (trackingStale) {
      advisoryNudges.push({
        id: 'tracking_stale',
        action: 'tracking_stale',
        kind: 'advisory',
        title: 'Tracking looks stale',
        body: 'The last usage sync is old. A battery or background setting may be stopping updates.',
        helperText: getManufacturerHelperText(manufacturerInfo?.manufacturer, settings),
        severity: 'warning',
        ctaLabel: 'Recheck',
      });
    }

    if (manufacturerInfo?.needsSpecialPermission) {
      advisoryNudges.push({
        id: 'background_reliability',
        action: 'background_reliability',
        kind: 'advisory',
        title: manufacturerInfo.title || 'Keep Brainrot running reliably',
        body:
          'Your phone may need extra background, autostart, or pop-up permissions so monitoring and pause screens stay reliable.',
        helperText: getManufacturerHelperText(manufacturerInfo?.manufacturer, settings),
        severity: 'info',
        ctaLabel: manufacturerInfo.canOpenDirectly ? 'Open OEM settings' : 'Review steps',
      });
    }

    if (lockScreenNotificationGuidanceNeeded) {
      advisoryNudges.push({
        id: 'lock_screen_guidance',
        action: 'lock_screen_guidance',
        kind: 'advisory',
        title: 'Lock-screen notification visibility may need review',
        body: 'Some phones hide Brainrot notifications on the lock screen until you allow them manually.',
        helperText:
          'If the fixed focus notification is missing from the lock screen, allow lock-screen notifications for Brainrot in your phone settings.',
        severity: 'info',
        ctaLabel: manufacturerInfo?.canOpenDirectly ? 'Open app settings' : 'Review steps',
      });
    }

    const actionableVisible = await this.filterDismissed(actionableNudges);
    const advisoryVisible = await this.filterDismissed(advisoryNudges);

    return {
      usageAccess,
      accessibility,
      overlay,
      notifications,
      backgroundReliabilityLikelyNeeded,
      batteryOptimizationIgnored,
      trackingStale,
      lockScreenNotificationGuidanceNeeded,
      manufacturer: manufacturerInfo?.manufacturer || 'Android',
      nudges: [...actionableVisible, ...advisoryVisible],
      actionableNudges: actionableVisible,
      advisoryNudges: advisoryVisible,
    };
  }

  static async getHomeBottomSheetNudge(): Promise<PermissionNudge | null> {
    const health = await this.getPermissionHealth();
    const candidate = health.actionableNudges[0] ?? health.advisoryNudges[0] ?? null;
    if (!candidate) {
      return null;
    }

    const installAt = await this.getInstallTimestamp();
    const daysSinceInstall = Math.floor((Date.now() - installAt) / DAY_MS);
    const dismissedAt = parseInt((await database.getMeta(HOME_PROMPT_DISMISSED_AT_KEY)) || '0', 10);
    const impressionCount = parseInt((await database.getMeta(HOME_PROMPT_IMPRESSIONS_KEY)) || '0', 10);
    const helperExposure = await CapabilitiesService.getPermissionHelperExposure();
    const snoozed =
      dismissedAt > 0 && Date.now() - dismissedAt < HOME_PROMPT_SNOOZE_DAYS * DAY_MS;
    const recentlyHelped =
      helperExposure.lastOpenedAt > 0 &&
      Date.now() - helperExposure.lastOpenedAt < RECENT_PERMISSION_FLOW_SUPPRESS_MS;

    if (
      daysSinceInstall < HOME_PROMPT_FIRST_SHOW_DAY ||
      impressionCount >= HOME_PROMPT_MAX_IMPRESSIONS ||
      snoozed ||
      recentlyHelped
    ) {
      return null;
    }

    return candidate;
  }

  static async recordHomeBottomSheetShown(): Promise<void> {
    const impressionCount = parseInt((await database.getMeta(HOME_PROMPT_IMPRESSIONS_KEY)) || '0', 10);
    await database.setMeta(
      HOME_PROMPT_IMPRESSIONS_KEY,
      String(Math.min(HOME_PROMPT_MAX_IMPRESSIONS, impressionCount + 1))
    );
  }

  static async dismissNudge(id: string): Promise<void> {
    await database.setMeta(`permission_nudge_dismissed_${id}`, Date.now().toString());
  }

  static async dismissHomeBottomSheet(id: string): Promise<void> {
    await Promise.all([
      this.dismissNudge(id),
      database.setMeta(HOME_PROMPT_DISMISSED_AT_KEY, Date.now().toString()),
    ]);
  }

  static async runNudgeAction(nudge: PermissionNudge): Promise<boolean> {
    if (nudge.action === 'usage_access') {
      return CapabilitiesService.ensureUsageAccess('settings');
    }
    if (nudge.action === 'accessibility') {
      return CapabilitiesService.ensureAccessibilityPermission('settings');
    }
    if (nudge.action === 'overlay') {
      await CapabilitiesService.ensureOverlayPermission('settings');
      return false;
    }
    if (nudge.action === 'notifications') {
      return CapabilitiesService.ensureNotificationPermission('settings');
    }
    if (nudge.action === 'battery_optimization') {
      return CapabilitiesService.requestBatteryOptimizationExemption('settings');
    }
    if (nudge.action === 'background_reliability' || nudge.action === 'lock_screen_guidance') {
      return CapabilitiesService.openBackgroundReliabilitySettings('settings');
    }
    return UnifiedUsageService.isNativeModuleAvailable()
      ? UnifiedUsageService.isUsageAccessGranted()
      : false;
  }

  private static async filterDismissed(nudges: PermissionNudge[]): Promise<PermissionNudge[]> {
    const visibleNudges: PermissionNudge[] = [];
    for (const nudge of nudges) {
      if (!(await this.isDismissed(nudge.id))) {
        visibleNudges.push(nudge);
      }
    }
    return visibleNudges;
  }

  private static async isDismissed(id: string): Promise<boolean> {
    const dismissedAt = parseInt((await database.getMeta(`permission_nudge_dismissed_${id}`)) || '0', 10);
    return dismissedAt > 0 && Date.now() - dismissedAt < NUDGE_DISMISS_MS;
  }

  private static async getInstallTimestamp(): Promise<number> {
    const existing = await database.getMeta(INSTALL_FIRST_SEEN_KEY);
    if (existing) {
      return parseInt(existing, 10);
    }

    const onboardingCompletedAt = await database.getMeta('onboarding_completed_at');
    const timestamp = parseInt(onboardingCompletedAt || '', 10) || Date.now();
    await database.setMeta(INSTALL_FIRST_SEEN_KEY, timestamp.toString());
    return timestamp;
  }
}

function getManufacturerHelperText(
  manufacturer?: string,
  settings: AppSettings[] = []
): string {
  const brand = (manufacturer || '').toLowerCase();
  const hasLimitOrLock = settings.some(
    (setting) => setting.protectionMode === 'limit' || setting.protectionMode === 'locked'
  );
  const suffix = hasLimitOrLock
    ? 'This matters more when Limit Mode, Lock Mode, or Focus Sessions are enabled.'
    : 'This keeps score, replay, and the fixed notification dependable.';

  if (brand.includes('samsung')) {
    return `Samsung: allow unrestricted battery for Brainrot and keep it out of Sleeping apps. ${suffix}`;
  }
  if (brand.includes('xiaomi') || brand.includes('redmi')) {
    return `Xiaomi/Redmi: allow Autostart, background pop-up windows, unrestricted battery, and lock-screen notifications if MIUI hides them. ${suffix}`;
  }
  if (brand.includes('oneplus')) {
    return `OnePlus: disable battery optimization for Brainrot and allow background activity. ${suffix}`;
  }
  if (brand.includes('motorola')) {
    return `Motorola: allow background usage and avoid aggressive battery restrictions. ${suffix}`;
  }
  if (brand.includes('nothing')) {
    return `Nothing: allow background activity and unrestricted battery for Brainrot. ${suffix}`;
  }
  if (
    brand.includes('oppo') ||
    brand.includes('realme') ||
    brand.includes('vivo') ||
    brand.includes('huawei')
  ) {
    return `Oppo/Realme/Vivo/Huawei: allow autostart, background activity, unrestricted battery, and lock-screen notifications for Brainrot. ${suffix}`;
  }
  return `Pixel/generic Android: if updates stall, allow unrestricted battery for Brainrot. ${suffix}`;
}

function shouldSuggestLockScreenGuidance(manufacturer?: string): boolean {
  const brand = (manufacturer || '').toLowerCase();
  return ['xiaomi', 'redmi', 'oppo', 'realme', 'vivo', 'huawei'].some((token) =>
    brand.includes(token)
  );
}
