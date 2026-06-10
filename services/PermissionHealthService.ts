import { Platform } from 'react-native';

import { CapabilitiesService } from './CapabilitiesService';
import { UnifiedUsageService } from './UnifiedUsageService';
import { database, type AppSettings } from './database';

export type PermissionNudgeAction =
  | 'usage_access'
  | 'accessibility'
  | 'overlay'
  | 'background_reliability'
  | 'tracking_stale';

export interface PermissionNudge {
  id: string;
  action: PermissionNudgeAction;
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
  backgroundReliabilityLikelyNeeded: boolean;
  trackingStale: boolean;
  manufacturer: string;
  nudges: PermissionNudge[];
}

const NUDGE_DISMISS_MS = 24 * 60 * 60 * 1000;
const STALE_TRACKING_MS = 26 * 60 * 60 * 1000;

export class PermissionHealthService {
  static async getPermissionHealth(): Promise<PermissionHealth> {
    const [usageAccess, accessibility, overlay, manufacturerInfo, settings, monitoringEnabled, lastSyncAtRaw] =
      await Promise.all([
        CapabilitiesService.hasUsageAccess(),
        CapabilitiesService.hasAccessibilityPermission(),
        CapabilitiesService.hasOverlayPermission(),
        UnifiedUsageService.getManufacturerInfo(),
        database.getAppSettings(),
        database.getMeta('monitoring_enabled'),
        database.getMeta('last_successful_usage_sync_at'),
      ]);

    const protectedSettings = settings.filter((setting) => Boolean(setting.protectionMode));
    const needsAccessibility = protectedSettings.some((setting) =>
      setting.protectionMode === 'locked' || setting.protectionMode === 'limit'
    );
    const needsOverlay = protectedSettings.some((setting) => setting.protectionMode === 'limit');
    const lastSyncAt = parseInt(lastSyncAtRaw || '0', 10);
    const trackingStale =
      monitoringEnabled === 'true' &&
      usageAccess &&
      (lastSyncAt <= 0 || Date.now() - lastSyncAt > STALE_TRACKING_MS);
    const backgroundReliabilityLikelyNeeded =
      Platform.OS === 'android' && Boolean(manufacturerInfo?.needsSpecialPermission);

    const nudges: PermissionNudge[] = [];
    if (!usageAccess) {
      nudges.push({
        id: 'usage_access_missing',
        action: 'usage_access',
        title: 'Usage Access is off',
        body: 'Brainrot cannot build your score or Replay without Android Usage Access.',
        helperText: 'Open Usage Access, choose Brainrot, then turn permission on.',
        severity: 'critical',
        ctaLabel: 'Fix now',
      });
    }

    if (needsAccessibility && !accessibility) {
      nudges.push({
        id: 'accessibility_missing',
        action: 'accessibility',
        title: 'Locked protection needs Accessibility',
        body: 'Lock Mode and Focus Sessions need Accessibility to catch protected apps as they open.',
        helperText: 'Open Accessibility settings, find Brainrot, and enable the service.',
        severity: 'critical',
        ctaLabel: 'Fix now',
      });
    }

    if (needsOverlay && !overlay) {
      nudges.push({
        id: 'overlay_missing',
        action: 'overlay',
        title: 'Limit Mode needs overlay permission',
        body: 'Brainrot can track usage, but it cannot show the pause screen until overlay permission is allowed.',
        helperText: 'Open Display over other apps, choose Brainrot, then allow it.',
        severity: 'warning',
        ctaLabel: 'Fix now',
      });
    }

    if (trackingStale) {
      nudges.push({
        id: 'tracking_stale',
        action: 'tracking_stale',
        title: 'Tracking looks stale',
        body: 'The last usage sync is old. A battery or background setting may be stopping updates.',
        helperText: getManufacturerHelperText(manufacturerInfo?.manufacturer, settings),
        severity: 'warning',
        ctaLabel: 'Recheck',
      });
    }

    if (backgroundReliabilityLikelyNeeded) {
      nudges.push({
        id: 'background_reliability',
        action: 'background_reliability',
        title: manufacturerInfo?.title || 'Background reliability may need help',
        body: manufacturerInfo?.instructions || 'Your phone may restrict background monitoring unless Brainrot is allowed to run reliably.',
        helperText: getManufacturerHelperText(manufacturerInfo?.manufacturer, settings),
        severity: 'info',
        ctaLabel: manufacturerInfo?.canOpenDirectly ? 'Fix now' : 'Recheck',
      });
    }

    const visibleNudges = [];
    for (const nudge of nudges) {
      if (!(await this.isDismissed(nudge.id))) {
        visibleNudges.push(nudge);
      }
    }

    return {
      usageAccess,
      accessibility,
      overlay,
      backgroundReliabilityLikelyNeeded,
      trackingStale,
      manufacturer: manufacturerInfo?.manufacturer || 'Android',
      nudges: visibleNudges,
    };
  }

  static async dismissNudge(id: string): Promise<void> {
    await database.setMeta(`permission_nudge_dismissed_${id}`, Date.now().toString());
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
    if (nudge.action === 'background_reliability') {
      return CapabilitiesService.openBackgroundReliabilitySettings('settings');
    }
    return UnifiedUsageService.isNativeModuleAvailable()
      ? UnifiedUsageService.isUsageAccessGranted()
      : false;
  }

  private static async isDismissed(id: string): Promise<boolean> {
    const dismissedAt = parseInt((await database.getMeta(`permission_nudge_dismissed_${id}`)) || '0', 10);
    return dismissedAt > 0 && Date.now() - dismissedAt < NUDGE_DISMISS_MS;
  }
}

function getManufacturerHelperText(
  manufacturer?: string,
  settings: AppSettings[] = []
): string {
  const brand = (manufacturer || '').toLowerCase();
  const hasLimitOrLock = settings.some((setting) =>
    setting.protectionMode === 'limit' || setting.protectionMode === 'locked'
  );
  const suffix = hasLimitOrLock
    ? 'This matters more when Limit Mode, Lock Mode, or Focus Sessions are enabled.'
    : 'This keeps score and Replay updates dependable.';

  if (brand.includes('samsung')) {
    return `Samsung: allow unrestricted battery for Brainrot and keep it out of Sleeping apps. ${suffix}`;
  }
  if (brand.includes('xiaomi') || brand.includes('redmi')) {
    return `Xiaomi/Redmi: allow Autostart and set Battery Saver to No restrictions. ${suffix}`;
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
    return `Oppo/Realme/Vivo/Huawei: allow autostart, background activity, and unrestricted battery. ${suffix}`;
  }
  return `Pixel/generic Android: if updates stall, allow unrestricted battery for Brainrot. ${suffix}`;
}
