import { Alert, AppState, AppStateStatus } from 'react-native';

import { HistoricalDataService } from './HistoricalDataService';
import { TelemetryService } from './TelemetryService';
import type { ProtectionSource } from './TelemetryEvents';
import { UnifiedUsageService } from './UnifiedUsageService';
import { UsageService } from './UsageService';
import { database, type AppSettings } from './database';

export type ProtectionMode = 'monitor' | 'limit' | 'locked' | 'ignore';

export interface ProtectedApp {
  packageName: string;
  appName: string;
  monitored: boolean;
  dailyLimitMs: number;
  protectionMode: ProtectionMode;
}

const LEGACY_MIGRATION_KEY = 'focus_protection_migrated_v1';
const PROTECTED_APPS_KEY = 'protected_apps';
const FOCUS_SESSION_ACTIVE_KEY = 'focus_session_active';
const FOCUS_SESSION_STARTED_AT_KEY = 'focus_session_started_at';
const APP_BLOCKING_ENABLED_KEY = 'app_blocking_enabled';
const LIMIT_INTERVAL_MINUTES = 15;
const LOCKED_PASSES_PER_DAY = 2;

export class AppBlockingService {
  private static instance: AppBlockingService;
  private isInitialized = false;
  private protectedApps = new Map<string, ProtectedApp>();
  private fallbackPollingInterval?: ReturnType<typeof setInterval>;
  private hasAccessibilityPermission = false;
  private currentForegroundApp?: string;
  private currentForegroundAppStartedAt?: number;
  private lastFallbackBlockAt = 0;
  private limitOverlayShownAt = new Map<string, number>();
  private focusSessionActive = false;

  static getInstance(): AppBlockingService {
    if (!this.instance) {
      this.instance = new AppBlockingService();
    }
    return this.instance;
  }

  private constructor() {
    AppState.addEventListener('change', this.handleAppStateChange);
  }

  async initialize(): Promise<void> {
    try {
      await this.migrateLegacyConfigIfNeeded();
      await this.loadState();
      await this.syncNativeConfig();
      await this.applyRuntimeBehavior();
      this.isInitialized = true;
    } catch (error) {
      console.error('Error initializing AppBlockingService:', error);
    }
  }

  async refreshFromSettings(): Promise<void> {
    await this.initialize();
  }

  async getProtectedApps(): Promise<ProtectedApp[]> {
    await this.loadState();
    return Array.from(this.protectedApps.values()).sort((a, b) =>
      a.appName.localeCompare(b.appName)
    );
  }

  async setProtectionMode(
    packageName: string,
    appName: string,
    protectionMode: ProtectionMode,
    source: ProtectionSource = 'focus_tab'
  ): Promise<void> {
    if (protectionMode === 'ignore') {
      await this.removeProtectedApp(packageName, source);
      return;
    }

    const existing = this.protectedApps.get(packageName);
    const previousMode = existing?.protectionMode;
    const settings = await database.getAppSettings();
    const matched =
      settings.find((item) => item.packageName === packageName) ||
      existing;

    await database.updateAppSettings({
      packageName,
      appName: appName || matched?.appName || UnifiedUsageService.getAppDisplayName(packageName),
      monitored: true,
      dailyLimitMs: matched?.dailyLimitMs || 2 * 60 * 60 * 1000,
      protectionMode,
    });

    const protectedPackages = await this.getProtectedPackages();
    protectedPackages.add(packageName);
    await this.saveProtectedPackages(protectedPackages);
    await this.persistMonitoredPackagesFromSettings();
    await this.refreshDerivedData();
    TelemetryService.track('protection_level_changed', {
      app_name: appName || matched?.appName || UnifiedUsageService.getAppDisplayName(packageName),
      old_level: previousMode,
      new_level: protectionMode,
      source,
    });
  }

  async addProtectedApps(
    apps: Array<{ packageName: string; appName: string }>,
    source: ProtectionSource = 'focus_tab'
  ): Promise<void> {
    const existingSettings = await database.getAppSettings();
    const existingMap = new Map(existingSettings.map((setting) => [setting.packageName, setting]));
    const protectedPackages = await this.getProtectedPackages();

    for (const app of apps) {
      const existing = existingMap.get(app.packageName);
      await database.updateAppSettings({
        packageName: app.packageName,
        appName: app.appName,
        monitored: true,
        dailyLimitMs: existing?.dailyLimitMs || 2 * 60 * 60 * 1000,
        protectionMode: existing?.protectionMode || 'monitor',
      });
      protectedPackages.add(app.packageName);
    }

    await this.saveProtectedPackages(protectedPackages);
    await this.persistMonitoredPackagesFromSettings();
    await this.refreshDerivedData();
    for (const app of apps) {
      TelemetryService.track('app_added_to_protected', {
        app_name: app.appName,
        new_level: existingMap.get(app.packageName)?.protectionMode || 'monitor',
        source,
      });
    }
  }

  async removeProtectedApp(packageName: string, source: ProtectionSource = 'focus_tab'): Promise<void> {
    const existing = this.protectedApps.get(packageName);
    if (!existing) {
      return;
    }

    await database.updateAppSettings({
      packageName,
      appName: existing.appName,
      monitored: false,
      dailyLimitMs: existing.dailyLimitMs || 2 * 60 * 60 * 1000,
      protectionMode: null,
    });

    const protectedPackages = await this.getProtectedPackages();
    protectedPackages.delete(packageName);
    await this.saveProtectedPackages(protectedPackages);
    await this.persistMonitoredPackagesFromSettings();
    await this.refreshDerivedData();
    TelemetryService.track('app_removed_from_protected', {
      app_name: existing.appName,
      old_level: existing.protectionMode,
      source,
    });
  }

  async startFocusSession(): Promise<boolean> {
    const protectedApps = await this.getProtectedApps();
    const activeProtectedApps = protectedApps.filter((app) => app.protectionMode !== 'ignore');
    if (activeProtectedApps.length === 0) {
      Alert.alert('No Protected Apps', 'Add at least one protected app before starting a focus session.');
      return false;
    }

    const accessibilityGranted = await UnifiedUsageService.hasAccessibilityPermission();
    if (!accessibilityGranted) {
      Alert.alert(
        'Accessibility Required',
        'Focus Session locks protected apps, so Accessibility must be enabled first.'
      );
      const granted = await UnifiedUsageService.openAccessibilitySettings().then(() => false).catch(() => false);
      await this.loadState();
      return granted;
    }

    this.focusSessionActive = true;
    await database.setMeta(APP_BLOCKING_ENABLED_KEY, 'true');
    await database.setMeta(FOCUS_SESSION_ACTIVE_KEY, 'true');
    await database.setMeta(FOCUS_SESSION_STARTED_AT_KEY, Date.now().toString());
    await this.syncNativeConfig();
    await this.applyRuntimeBehavior();
    TelemetryService.track('focus_mode_started', {
      locked_app_count: activeProtectedApps.length,
      apps_blocked: activeProtectedApps.length,
    });
    return true;
  }

  async endFocusSession(): Promise<void> {
    const startedAt = parseInt((await database.getMeta(FOCUS_SESSION_STARTED_AT_KEY)) || '0', 10);
    const activeApps = Array.from(this.protectedApps.values()).filter((app) => app.protectionMode !== 'ignore');
    this.focusSessionActive = false;
    await database.setMeta(FOCUS_SESSION_ACTIVE_KEY, 'false');
    await database.setMeta(FOCUS_SESSION_STARTED_AT_KEY, '');
    await this.syncNativeConfig();
    await this.applyRuntimeBehavior();
    TelemetryService.track('focus_mode_completed', {
      duration_minutes: startedAt > 0 ? Math.max(1, Math.round((Date.now() - startedAt) / 60000)) : undefined,
      locked_app_count: activeApps.length,
      apps_blocked: activeApps.length,
    });
  }

  async isFocusSessionActive(): Promise<boolean> {
    this.focusSessionActive = (await database.getMeta(FOCUS_SESSION_ACTIVE_KEY)) === 'true';
    return this.focusSessionActive;
  }

  async evaluateForegroundApp(packageName: string, appName?: string): Promise<void> {
    const effectiveMode = this.getEffectiveMode(packageName);
    if (!effectiveMode || effectiveMode === 'monitor' || effectiveMode === 'ignore') {
      return;
    }

    if (this.hasAccessibilityPermission) {
      await this.syncNativeConfig();
      return;
    }

    if (effectiveMode === 'locked') {
      TelemetryService.track('blocking_debug', {
        stage: 'launch_missed',
        package_name: packageName,
        app_name: appName,
        protection_mode: effectiveMode,
        reason: 'accessibility_missing',
        source: 'js_fallback',
      });
      Alert.alert(
        'Accessibility Required',
        'Locked protection needs Accessibility access on Android. Enable Accessibility to enforce Locked mode and Focus Sessions.'
      );
      return;
    }

    const now = Date.now();
    if (now - this.lastFallbackBlockAt < 1500) {
      return;
    }

    const hasOverlayPermission = await UnifiedUsageService.hasOverlayPermission();
    if (!hasOverlayPermission) {
      TelemetryService.track('blocking_debug', {
        stage: 'launch_missed',
        package_name: packageName,
        app_name: appName,
        protection_mode: effectiveMode,
        reason: 'overlay_missing',
        source: 'js_fallback',
      });
      Alert.alert(
        'Overlay Permission Required',
        'Limit mode fallback needs Display over other apps permission.'
      );
      return;
    }

    const lastShownAt = this.limitOverlayShownAt.get(packageName) || 0;
    if (lastShownAt !== 0 && now - lastShownAt < LIMIT_INTERVAL_MINUTES * 60 * 1000) {
      return;
    }

    this.lastFallbackBlockAt = now;
    this.limitOverlayShownAt.set(packageName, now);
    TelemetryService.track('blocking_debug', {
      stage: 'fallback_enforcement',
      package_name: packageName,
      app_name: appName,
      protection_mode: effectiveMode,
      source: 'js_fallback',
    });
    await UnifiedUsageService.showBlockingOverlay(
      packageName,
      appName || this.protectedApps.get(packageName)?.appName || UnifiedUsageService.getAppDisplayName(packageName),
      'soft',
      'js_fallback'
    );
  }

  async forceCheckCurrentApp(): Promise<void> {
    const currentForegroundApp = await UsageService.getCurrentForegroundApp();
    if (!currentForegroundApp?.packageName) {
      return;
    }

    await this.evaluateForegroundApp(currentForegroundApp.packageName, currentForegroundApp.appName);
  }

  async resetDailyLimits(): Promise<void> {
    await this.syncNativeConfig();
  }

  getFocusStatus(): {
    protectedAppsCount: number;
    protectedApps: Array<{ packageName: string; protectionMode: ProtectionMode }>;
    currentApp?: string;
    monitoring: boolean;
    accessibilityEnabled: boolean;
    focusSessionActive: boolean;
  } {
    return {
      protectedAppsCount: this.protectedApps.size,
      protectedApps: Array.from(this.protectedApps.values()).map((app) => ({
        packageName: app.packageName,
        protectionMode: app.protectionMode,
      })),
      currentApp: this.currentForegroundApp,
      monitoring: !!this.fallbackPollingInterval,
      accessibilityEnabled: this.hasAccessibilityPermission,
      focusSessionActive: this.focusSessionActive,
    };
  }

  async cleanup(): Promise<void> {
    this.stopFallbackMonitoring();
    this.currentForegroundApp = undefined;
    this.isInitialized = false;
    await this.syncNativeConfig();
  }

  async syncNativeConfig(): Promise<void> {
    await this.loadState();
    await UnifiedUsageService.syncBlockingConfigToNative({
      protectedApps: Array.from(this.protectedApps.values()).map((app) => ({
        packageName: app.packageName,
        mode: app.protectionMode,
      })),
      focusSessionActive: this.focusSessionActive,
      blockingEnabled: true,
      limitIntervalMinutes: LIMIT_INTERVAL_MINUTES,
      lockedPassesPerDay: LOCKED_PASSES_PER_DAY,
    });
  }

  private async migrateLegacyConfigIfNeeded(): Promise<void> {
    const alreadyMigrated = await database.getMeta(LEGACY_MIGRATION_KEY);
    if (alreadyMigrated === 'true') {
      return;
    }

    const [existingSettings, monitoredPackages, blockedAppsData, legacyMode] = await Promise.all([
      database.getAppSettings(),
      database.getMonitoredPackages(),
      database.getMeta('blocked_apps'),
      database.getMeta('blocking_mode'),
    ]);

    const blockedPackages = new Set<string>(JSON.parse(blockedAppsData || '[]') as string[]);
    const monitoredSet = new Set<string>(monitoredPackages);
    const existingProtectedPackages = existingSettings
      .filter((setting) => setting.monitored || !!setting.protectionMode)
      .map((setting) => setting.packageName);
    const allPackages = new Set<string>([
      ...existingProtectedPackages,
      ...monitoredPackages,
      ...blockedPackages,
    ]);

    for (const packageName of allPackages) {
      const existing = existingSettings.find((setting) => setting.packageName === packageName);
      const monitored = monitoredSet.has(packageName);
      const protectionMode: ProtectionMode = blockedPackages.has(packageName)
        ? legacyMode === 'hard'
          ? 'locked'
          : 'limit'
        : 'monitor';

      await database.updateAppSettings({
        packageName,
        appName: existing?.appName || UnifiedUsageService.getAppDisplayName(packageName),
        monitored,
        dailyLimitMs: existing?.dailyLimitMs || 2 * 60 * 60 * 1000,
        protectionMode,
      });
    }

    await this.persistMonitoredPackagesFromSettings();
    await this.saveProtectedPackages(allPackages);
    await database.setMeta(FOCUS_SESSION_ACTIVE_KEY, 'false');
    await database.setMeta(FOCUS_SESSION_STARTED_AT_KEY, '');
    await database.setMeta(LEGACY_MIGRATION_KEY, 'true');
  }

  private async loadState(): Promise<void> {
    const settings = await database.getAppSettings();
    const protectedPackages = await this.getProtectedPackages();
    this.protectedApps.clear();

    for (const setting of settings) {
      if (!setting.protectionMode || !protectedPackages.has(setting.packageName)) {
        continue;
      }
      this.protectedApps.set(setting.packageName, {
        packageName: setting.packageName,
        appName: setting.appName,
        monitored: setting.monitored,
        dailyLimitMs: setting.dailyLimitMs,
        protectionMode: setting.protectionMode,
      });
    }

    this.hasAccessibilityPermission = await UnifiedUsageService.hasAccessibilityPermission();
    this.focusSessionActive = (await database.getMeta(FOCUS_SESSION_ACTIVE_KEY)) === 'true';
  }

  private async getProtectedPackages(): Promise<Set<string>> {
    try {
      const protectedAppsData = await database.getMeta(PROTECTED_APPS_KEY);
      if (protectedAppsData) {
        return new Set(JSON.parse(protectedAppsData) as string[]);
      }
    } catch (error) {
      console.warn('Failed to parse protected_apps meta:', error);
    }

    const monitoredPackages = await database.getMonitoredPackages();
    return new Set(monitoredPackages);
  }

  private async saveProtectedPackages(packages: Set<string>): Promise<void> {
    await database.setMeta(PROTECTED_APPS_KEY, JSON.stringify(Array.from(packages)));
  }

  private getEffectiveMode(packageName: string): ProtectionMode | null {
    const protectedApp = this.protectedApps.get(packageName);
    if (!protectedApp) {
      return null;
    }

    if (protectedApp.protectionMode === 'ignore') {
      return 'ignore';
    }

    if (this.focusSessionActive) {
      return 'locked';
    }

    return protectedApp.protectionMode;
  }

  private async applyRuntimeBehavior(): Promise<void> {
    await this.loadState();
    const needsFallbackMonitoring = Array.from(this.protectedApps.values()).some((app) => {
      const effectiveMode = this.getEffectiveMode(app.packageName);
      return effectiveMode === 'limit';
    });

    if (this.hasAccessibilityPermission) {
      this.stopFallbackMonitoring();
      return;
    }

    if (needsFallbackMonitoring) {
      this.startFallbackMonitoring();
    } else {
      this.stopFallbackMonitoring();
    }
  }

  private startFallbackMonitoring(): void {
    this.stopFallbackMonitoring();
    this.fallbackPollingInterval = setInterval(() => {
      void this.checkCurrentAppFallback();
    }, 2000);
  }

  private stopFallbackMonitoring(): void {
    if (this.fallbackPollingInterval) {
      clearInterval(this.fallbackPollingInterval);
      this.fallbackPollingInterval = undefined;
    }
  }

  private async checkCurrentAppFallback(): Promise<void> {
    try {
      const currentForegroundApp = await UsageService.getCurrentForegroundApp();
      if (!currentForegroundApp?.packageName || currentForegroundApp.packageName === 'com.soumikganguly.brainrot') {
        this.currentForegroundApp = currentForegroundApp?.packageName;
        this.currentForegroundAppStartedAt = undefined;
        return;
      }

      const effectiveMode = this.getEffectiveMode(currentForegroundApp.packageName);
      if (!effectiveMode || effectiveMode === 'monitor' || effectiveMode === 'ignore') {
        this.currentForegroundApp = currentForegroundApp.packageName;
        this.currentForegroundAppStartedAt = undefined;
        return;
      }

      if (currentForegroundApp.packageName === this.currentForegroundApp) {
        if (effectiveMode === 'limit' && this.currentForegroundAppStartedAt) {
          const now = Date.now();
          const lastShownAt = this.limitOverlayShownAt.get(currentForegroundApp.packageName) || 0;
          if (lastShownAt === 0 || now - lastShownAt >= LIMIT_INTERVAL_MINUTES * 60 * 1000) {
            await this.evaluateForegroundApp(currentForegroundApp.packageName, currentForegroundApp.appName);
          }
        }
        return;
      }

      this.currentForegroundApp = currentForegroundApp.packageName;
      this.currentForegroundAppStartedAt = Date.now();

      if (effectiveMode === 'limit') {
        this.limitOverlayShownAt.set(currentForegroundApp.packageName, 0);
      }

      await this.evaluateForegroundApp(currentForegroundApp.packageName, currentForegroundApp.appName);
    } catch (error) {
      console.error('Error checking protected app fallback:', error);
    }
  }

  private async persistMonitoredPackagesFromSettings(): Promise<void> {
    const settings = await database.getAppSettings();
    const monitoredPackages = settings
      .filter((setting) => setting.monitored)
      .map((setting) => setting.packageName);
    await database.setMeta('monitored_apps', JSON.stringify(monitoredPackages));
    database.clearMonitoredCache();
  }

  private async refreshDerivedData(): Promise<void> {
    await this.loadState();
    await UnifiedUsageService.syncMonitoredAppsToNative(
      Array.from(this.protectedApps.values())
        .filter((app) => app.monitored)
        .map((app) => app.packageName)
    );
    await UnifiedUsageService.getInstance().refreshMonitoredApps();
    await this.syncNativeConfig();
    await this.applyRuntimeBehavior();
    const today = new Date().toISOString().split('T')[0];
    await HistoricalDataService.getInstance().rebuildSummaryForDate(today, { force: true });
  }

  private handleAppStateChange = async (nextAppState: AppStateStatus) => {
    if (nextAppState === 'active' && this.isInitialized) {
      await this.initialize();
    }
  };
}
