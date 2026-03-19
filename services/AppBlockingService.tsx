import { Alert, AppState, AppStateStatus } from 'react-native';
import { database } from './database';
import { UnifiedUsageService } from './UnifiedUsageService';
import { UsageService } from './UsageService';

export type BlockingMode = 'soft' | 'hard';

interface BlockedApp {
  packageName: string;
  appName: string;
}

export class AppBlockingService {
  private static instance: AppBlockingService;
  private isInitialized = false;
  private blockedApps = new Map<string, BlockedApp>();
  private fallbackPollingInterval?: ReturnType<typeof setInterval>;
  private blockingEnabled = false;
  private blockingMode: BlockingMode = 'soft';
  private bypassLimit = 3;
  private scheduleEnabled = false;
  private scheduleStart = '22:00';
  private scheduleEnd = '06:00';
  private hasAccessibilityPermission = false;
  private currentForegroundApp?: string;
  private lastFallbackBlockAt = 0;

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
      await this.loadBlockingSettings();
      await this.loadBlockedApps();
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

  async setBlockingEnabled(enabled: boolean): Promise<void> {
    this.blockingEnabled = enabled;
    await database.setMeta('app_blocking_enabled', enabled.toString());
    await this.syncNativeConfig();
    await this.applyRuntimeBehavior();
  }

  async setBlockingMode(mode: BlockingMode): Promise<void> {
    this.blockingMode = mode;
    await database.setMeta('blocking_mode', mode);
    await this.syncNativeConfig();
    await this.applyRuntimeBehavior();
  }

  async setBypassLimit(limit: number): Promise<void> {
    this.bypassLimit = limit;
    await database.setMeta('block_bypass_limit', limit.toString());
    await this.syncNativeConfig();
  }

  async updateSchedule(enabled: boolean, start: string, end: string): Promise<void> {
    this.scheduleEnabled = enabled;
    this.scheduleStart = start;
    this.scheduleEnd = end;
    await database.setMeta('block_schedule_enabled', enabled.toString());
    await database.setMeta('block_schedule_start', start);
    await database.setMeta('block_schedule_end', end);
    await this.syncNativeConfig();
  }

  async blockApp(packageName: string): Promise<void> {
    const appName = UnifiedUsageService.getAppDisplayName(packageName);
    this.blockedApps.set(packageName, { packageName, appName });
    await this.persistBlockedApps();
  }

  async unblockApp(packageName: string): Promise<void> {
    this.blockedApps.delete(packageName);
    await this.persistBlockedApps();
  }

  async evaluateForegroundApp(packageName: string, appName?: string): Promise<void> {
    if (!this.blockingEnabled || !this.blockedApps.has(packageName)) {
      return;
    }

    if (this.hasAccessibilityPermission) {
      await this.syncNativeConfig();
      return;
    }

    const now = Date.now();
    if (now - this.lastFallbackBlockAt < 3000 || this.blockingMode === 'hard') {
      if (this.blockingMode === 'hard') {
        Alert.alert(
          'Accessibility Required',
          'Hard block requires Accessibility access on Android. Enable Accessibility to turn hard blocking on.'
        );
      }
      return;
    }

    const hasOverlayPermission = await UnifiedUsageService.hasOverlayPermission();
    if (!hasOverlayPermission) {
      Alert.alert(
        'Overlay Permission Required',
        'Soft blocking fallback needs Display over other apps permission.'
      );
      return;
    }

    this.lastFallbackBlockAt = now;
    await UnifiedUsageService.showBlockingOverlay(
      packageName,
      appName || this.blockedApps.get(packageName)?.appName || UnifiedUsageService.getAppDisplayName(packageName),
      'soft'
    );
  }

  async resetDailyLimits(): Promise<void> {
    await this.syncNativeConfig();
  }

  async forceCheckCurrentApp(): Promise<void> {
    if (!this.blockingEnabled || this.hasAccessibilityPermission) {
      return;
    }

    const currentForegroundApp = await UsageService.getCurrentForegroundApp();
    if (!currentForegroundApp?.packageName) {
      return;
    }

    await this.evaluateForegroundApp(currentForegroundApp.packageName, currentForegroundApp.appName);
  }

  getBlockingStatus(): {
    enabled: boolean;
    blockedAppsCount: number;
    blockedApps: string[];
    currentApp?: string;
    monitoring: boolean;
    bypassLimit: number;
    mode: BlockingMode;
    accessibilityEnabled: boolean;
  } {
    return {
      enabled: this.blockingEnabled,
      blockedAppsCount: this.blockedApps.size,
      blockedApps: Array.from(this.blockedApps.keys()),
      currentApp: this.currentForegroundApp,
      monitoring: !!this.fallbackPollingInterval,
      bypassLimit: this.bypassLimit,
      mode: this.blockingMode,
      accessibilityEnabled: this.hasAccessibilityPermission,
    };
  }

  async cleanup(): Promise<void> {
    this.stopFallbackMonitoring();
    this.blockingEnabled = false;
    this.currentForegroundApp = undefined;
    this.isInitialized = false;
    await this.syncNativeConfig();
  }

  private async loadBlockingSettings(): Promise<void> {
    this.blockingEnabled = (await database.getMeta('app_blocking_enabled')) === 'true';
    this.blockingMode = ((await database.getMeta('blocking_mode')) || 'soft') as BlockingMode;
    this.bypassLimit = parseInt((await database.getMeta('block_bypass_limit')) || '3', 10);
    this.scheduleEnabled = (await database.getMeta('block_schedule_enabled')) === 'true';
    this.scheduleStart = (await database.getMeta('block_schedule_start')) || '22:00';
    this.scheduleEnd = (await database.getMeta('block_schedule_end')) || '06:00';
    this.hasAccessibilityPermission = await UnifiedUsageService.hasAccessibilityPermission();
  }

  private async loadBlockedApps(): Promise<void> {
    const blockedAppsData = await database.getMeta('blocked_apps');
    const blockedPackages = blockedAppsData ? JSON.parse(blockedAppsData) as string[] : [];
    this.blockedApps.clear();

    for (const packageName of blockedPackages) {
      this.blockedApps.set(packageName, {
        packageName,
        appName: UnifiedUsageService.getAppDisplayName(packageName),
      });
    }
  }

  private async persistBlockedApps(): Promise<void> {
    await database.setMeta('blocked_apps', JSON.stringify(Array.from(this.blockedApps.keys())));
    await this.syncNativeConfig();
    await this.applyRuntimeBehavior();
  }

  private async syncNativeConfig(): Promise<void> {
    await UnifiedUsageService.syncBlockingConfigToNative({
      monitoredApps: await database.getMonitoredPackages(),
      blockedApps: Array.from(this.blockedApps.keys()),
      blockingEnabled: this.blockingEnabled,
      blockingMode: this.blockingMode,
      bypassLimit: this.bypassLimit,
      scheduleEnabled: this.scheduleEnabled,
      scheduleStart: this.scheduleStart,
      scheduleEnd: this.scheduleEnd,
    });
  }

  private async applyRuntimeBehavior(): Promise<void> {
    if (!this.blockingEnabled) {
      this.stopFallbackMonitoring();
      return;
    }

    this.hasAccessibilityPermission = await UnifiedUsageService.hasAccessibilityPermission();
    if (this.hasAccessibilityPermission) {
      this.stopFallbackMonitoring();
      return;
    }

    this.startFallbackMonitoring();
  }

  private startFallbackMonitoring(): void {
    this.stopFallbackMonitoring();
    this.fallbackPollingInterval = setInterval(() => {
      this.checkCurrentAppFallback();
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
        return;
      }

      if (currentForegroundApp.packageName === this.currentForegroundApp) {
        return;
      }

      this.currentForegroundApp = currentForegroundApp.packageName;
      await this.evaluateForegroundApp(currentForegroundApp.packageName, currentForegroundApp.appName);
    } catch (error) {
      console.error('Error checking blocked app fallback:', error);
    }
  }

  private handleAppStateChange = async (nextAppState: AppStateStatus) => {
    if (nextAppState === 'active' && this.isInitialized) {
      await this.initialize();
    }
  };
}

