import { NativeModules, Platform } from 'react-native';

import { database } from './database';

const UsageStatsModule = NativeModules.UsageStatsModule;

/**
 * Unified Usage Service - Combines UsageService and UsageMonitoringService
 * Eliminates duplicate functionality and provides a single API for usage tracking
 */
export class UnifiedUsageService {
  private static instance: UnifiedUsageService;

  // Core monitoring state
  private isMonitoring = false;
  private checkInterval?: ReturnType<typeof setInterval>;
  private appTrackers: Map<string, AppUsageTracker> = new Map();

  // Recommended apps list
  private static readonly RECOMMENDED_APPS = [
    { packageName: 'com.google.android.youtube', appName: 'YouTube', isRecommended: true },
    { packageName: 'com.instagram.android', appName: 'Instagram', isRecommended: true },
    { packageName: 'com.zhiliaoapp.musically', appName: 'TikTok', isRecommended: true },
    { packageName: 'com.facebook.katana', appName: 'Facebook', isRecommended: true },
    { packageName: 'com.twitter.android', appName: 'Twitter (X)', isRecommended: true },
    { packageName: 'com.reddit.frontpage', appName: 'Reddit', isRecommended: true },
    { packageName: 'com.snapchat.android', appName: 'Snapchat', isRecommended: true },
    { packageName: 'com.netflix.mediaclient', appName: 'Netflix', isRecommended: true },
    { packageName: 'com.whatsapp', appName: 'WhatsApp', isRecommended: true },
    { packageName: 'com.discord', appName: 'Discord', isRecommended: true },
  ];

  // Notification thresholds (in milliseconds)
  private static readonly THRESHOLDS: UsageThreshold[] = [
    { duration: 30 * 60 * 1000, intensity: 'mild' },     // 30 minutes
    { duration: 45 * 60 * 1000, intensity: 'normal' },   // 45 minutes
    { duration: 60 * 60 * 1000, intensity: 'harsh' },    // 1 hour
    { duration: 90 * 60 * 1000, intensity: 'critical' }, // 1.5 hours
    { duration: 120 * 60 * 1000, intensity: 'critical' }, // 2 hours
  ];

  static getInstance(): UnifiedUsageService {
    if (!this.instance) {
      this.instance = new UnifiedUsageService();
    }
    return this.instance;
  }

  // ========== NATIVE MODULE AVAILABILITY ==========

  static isNativeModuleAvailable(): boolean {
    return Platform.OS === 'android' && !!UsageStatsModule && !!UsageStatsModule.isUsageAccessGranted;
  }

  // ========== CORE USAGE DATA METHODS ==========

  static async getUsageSince(startTime: number): Promise<AppUsageData[]> {
    if (!this.isNativeModuleAvailable()) {
      return [];
    }

    try {
      // const endTime = Date.now();
      const usage = await UsageStatsModule.getUsageSince(startTime);

      // Filter and format the data
      const formattedUsage = usage
        .filter((app: any) => app.totalTimeInForeground > 0)
        .map((app: any) => ({
          packageName: app.packageName,
          appName: this.getAppDisplayName(app.packageName),
          totalTimeMs: app.totalTimeInForeground,
          lastTimeUsed: app.lastTimeUsed,
          firstTimeStamp: app.firstTimeStamp,
          lastTimeStamp: app.lastTimeStamp,
        }));

      return formattedUsage;
    } catch (error) {
      console.error('Error getting usage stats:', error);
      return [];
    }
  }

  static async getTodayUsage(): Promise<AppUsageData[]> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return this.getUsageSince(startOfDay.getTime());
  }

  static async getAppUsage(packageName: string, startTime?: number): Promise<number> {
    const start = startTime || new Date().setHours(0, 0, 0, 0);
    const usage = await this.getUsageSince(start);
    const app = usage.find(u => u.packageName === packageName);
    return app?.totalTimeMs || 0;
  }

  static async getCurrentForegroundApp(): Promise<string | null> {
    if (!this.isNativeModuleAvailable()) {
      return null;
    }

    try {
      return await UsageStatsModule.getCurrentForegroundApp();
    } catch (error) {
      console.error('Error getting foreground app:', error);
      return null;
    }
  }

  // ========== INSTALLED APPS METHODS ==========

  static async getInstalledApps(): Promise<InstalledApp[]> {
    try {
      if (!this.isNativeModuleAvailable()) {
        console.warn('Native module not available, returning recommended apps');
        return this.RECOMMENDED_APPS;
      }

      if (!UsageStatsModule.getInstalledMonitoredApps) {
        console.warn('getInstalledMonitoredApps not available, returning recommended apps');
        return this.RECOMMENDED_APPS;
      }

      const installedApps = await UsageStatsModule.getInstalledMonitoredApps();

      if (!installedApps || installedApps.length === 0) {
        console.warn('No apps returned from native module, using fallback');
        return this.RECOMMENDED_APPS;
      }

      // Mark recommended apps
      const recommendedPackages = new Set(this.RECOMMENDED_APPS.map(a => a.packageName));

      return installedApps.map((app: any) => ({
        ...app,
        isRecommended: recommendedPackages.has(app.packageName)
      }));
    } catch (error) {
      console.error('Error getting installed apps:', error);
      return this.RECOMMENDED_APPS;
    }
  }

  // ========== MONITORING METHODS ==========

  async initialize(): Promise<void> {
    console.log('Initializing UnifiedUsageService...');

    // Initialize notification service
    const NotificationService = (await import('./NotificationService')).NotificationService;
    await NotificationService.initialize();

    // Initialize trackers for monitored apps
    await this.initializeTodayTrackers();

    // Check if monitoring should be started
    const monitoringEnabled = await database.getMeta('monitoring_enabled');
    if (monitoringEnabled === 'true') {
      await this.startMonitoring();
    }

    console.log('UnifiedUsageService initialized');
  }

  async startMonitoring(): Promise<void> {
    if (this.isMonitoring) {
      console.log('Monitoring already active');
      return;
    }

    console.log('Starting usage monitoring...');
    this.isMonitoring = true;

    // Save monitoring state
    await database.setMeta('monitoring_enabled', 'true');

    // Start background monitoring (every 30 seconds)
    this.startBackgroundMonitoring();

    // Start native realtime detection if available
    await this.startRealtimeDetection();

    console.log('Usage monitoring started');
  }

  async stopMonitoring(): Promise<void> {
    if (!this.isMonitoring) return;

    console.log('Stopping usage monitoring...');
    this.isMonitoring = false;

    // Stop background monitoring
    this.stopBackgroundMonitoring();

    // Stop native realtime detection
    await this.stopRealtimeDetection();

    // Save state
    await database.setMeta('monitoring_enabled', 'false');

    console.log('Usage monitoring stopped');
  }

  // Comprehensive monitoring methods for compatibility
  static async startComprehensiveMonitoring(): Promise<void> {
    const instance = UnifiedUsageService.getInstance();
    await instance.startMonitoring();
  }

  static async stopComprehensiveMonitoring(): Promise<void> {
    const instance = UnifiedUsageService.getInstance();
    await instance.stopMonitoring();
  }

  private startBackgroundMonitoring(): void {
    this.stopBackgroundMonitoring();

    // Check every 30 seconds
    this.checkInterval = setInterval(async () => {
      await this.checkUsageAndNotify();
    }, 30000);

    // Initial check
    this.checkUsageAndNotify();
  }

  private stopBackgroundMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
  }

  private async startRealtimeDetection(): Promise<void> {
    try {
      if (!UnifiedUsageService.isNativeModuleAvailable()) return;

      await UsageStatsModule.startRealtimeAppDetection();
      console.log('Native realtime detection started');
    } catch (error) {
      console.error('Error starting realtime detection:', error);
    }
  }

  private async stopRealtimeDetection(): Promise<void> {
    try {
      if (!UnifiedUsageService.isNativeModuleAvailable()) return;

      await UsageStatsModule.stopRealtimeAppDetection();
      console.log('Native realtime detection stopped');
    } catch (error) {
      console.error('Error stopping realtime detection:', error);
    }
  }

  // ========== NOTIFICATION LOGIC ==========

  private async checkUsageAndNotify(): Promise<void> {
    try {
      // Check if notifications are snoozed
      const snoozeUntilStr = await database.getMeta('notifications_snoozed_until');
      const snoozeUntil = snoozeUntilStr ? parseInt(snoozeUntilStr) : 0;
      if (Date.now() < snoozeUntil) {
        return;
      }

      // Get current usage data
      const todayUsage = await UnifiedUsageService.getTodayUsage();

      // Check each tracked app
      for (const [packageName, tracker] of this.appTrackers) {
        const currentUsage = todayUsage.find(u => u.packageName === packageName);
        const currentTotalMs = currentUsage?.totalTimeMs || 0;

        // Only check if usage has increased
        if (currentTotalMs > tracker.totalTodayMs) {
          tracker.totalTodayMs = currentTotalMs;
          tracker.lastCheckedMs = Date.now();

          // Check thresholds and send notifications
          await this.checkThresholdsForApp(tracker);
        }
      }
    } catch (error) {
      console.error('Error in checkUsageAndNotify:', error);
    }
  }

  private async checkThresholdsForApp(tracker: AppUsageTracker): Promise<boolean> {
    const NotificationService = (await import('./NotificationService')).NotificationService;

    for (const threshold of UnifiedUsageService.THRESHOLDS) {
      if (tracker.totalTodayMs >= threshold.duration &&
        !tracker.notificationsSent.has(threshold.duration)) {

        // Mark as sent
        tracker.notificationsSent.add(threshold.duration);

        // Send notification using the CORRECT method from NotificationService
        const minutes = Math.round(threshold.duration / 60000);
        await NotificationService.scheduleUsageAlert(
          tracker.appName,
          `${minutes} minutes`,
          threshold.intensity
        );

        console.log(`Sent ${threshold.intensity} notification for ${tracker.appName} at ${minutes} minutes`);
        return true;
      }
    }

    return false;
  }

  // ========== TRACKED APPS MANAGEMENT ==========

  async refreshMonitoredApps(): Promise<void> {
    try {
      const monitoredAppsData = await database.getMeta('monitored_apps');
      if (!monitoredAppsData) return;

      const monitoredPackages = JSON.parse(monitoredAppsData) as string[];

      // Remove trackers for apps no longer monitored
      for (const packageName of this.appTrackers.keys()) {
        if (!monitoredPackages.includes(packageName)) {
          this.appTrackers.delete(packageName);
        }
      }

      // Add new trackers
      const todayUsage = await UnifiedUsageService.getTodayUsage();
      for (const packageName of monitoredPackages) {
        if (!this.appTrackers.has(packageName)) {
          const usageData = todayUsage.find(u => u.packageName === packageName);
          const appName = UnifiedUsageService.getAppDisplayName(packageName);

          this.appTrackers.set(packageName, {
            packageName,
            appName,
            totalTodayMs: usageData?.totalTimeMs || 0,
            lastCheckedMs: Date.now(),
            notificationsSent: new Set()
          });
        }
      }

      console.log(`Tracking ${this.appTrackers.size} apps`);
    } catch (error) {
      console.error('Error refreshing monitored apps:', error);
    }
  }

  private async initializeTodayTrackers(): Promise<void> {
    await this.refreshMonitoredApps();
  }

  // ========== SPECIFIC APP CHECKING (Called by native module) ==========

  async checkSpecificAppUsage(packageName: string): Promise<void> {
    try {
      const tracker = this.appTrackers.get(packageName);
      if (!tracker) return;

      // Get fresh usage data for this specific app
      const currentTotalMs = await UnifiedUsageService.getAppUsage(packageName);

      if (currentTotalMs > tracker.totalTodayMs) {
        tracker.totalTodayMs = currentTotalMs;
        tracker.lastCheckedMs = Date.now();

        await this.checkThresholdsForApp(tracker);
      }

      // Trigger blocking check via coordinator
      const ServiceCoordinator = (await import('./ServiceCoordinator')).ServiceCoordinator;
      const coordinator = ServiceCoordinator.getInstance();
      // Call the public method instead of private
      await coordinator.triggerManualCheck(packageName);

    } catch (error) {
      console.error('Error checking specific app usage:', error);
    }
  }

  // ========== MANUAL TRIGGERS ==========

  async triggerManualCheck(): Promise<void> {
    console.log('Manual usage check triggered');
    await this.checkUsageAndNotify();
  }

  // ========== BLOCKING OVERLAY METHODS ==========

  static async showBlockingOverlay(
    packageName: string,
    appName: string,
    blockMode: 'soft' | 'hard'
  ): Promise<void> {
    if (!this.isNativeModuleAvailable()) {
      throw new Error('Blocking overlay only available on Android');
    }

    await UsageStatsModule.showBlockingOverlay(packageName, appName, blockMode);
  }

  static async startFloatingScore(
    appName: string,
    initialScore: number,
    timeMs: number
  ): Promise<boolean> {
    if (!this.isNativeModuleAvailable()) {
      return false;
    }

    return await UsageStatsModule.startFloatingScore(appName, initialScore, timeMs);
  }

  static async stopFloatingScore(): Promise<boolean> {
    if (!this.isNativeModuleAvailable()) {
      return false;
    }

    return await UsageStatsModule.stopFloatingScore();
  }

  // ========== PERMISSION METHODS ==========

  static async isUsageAccessGranted(): Promise<boolean> {
    if (!this.isNativeModuleAvailable()) {
      return false;
    }

    return await UsageStatsModule.isUsageAccessGranted();
  }

  static async requestUsageAccess(): Promise<void> {
    if (!this.isNativeModuleAvailable()) {
      throw new Error('Usage access only available on Android');
    }

    await UsageStatsModule.requestUsageAccess();
  }

  static async openUsageAccessSettings(): Promise<void> {
    if (!this.isNativeModuleAvailable()) {
      throw new Error('Usage access settings only available on Android');
    }

    await UsageStatsModule.openUsageAccessSettings();
  }

  static async forceRefreshPermission(): Promise<boolean> {
    if (!this.isNativeModuleAvailable()) {
      return false;
    }

    try {
      // Try to refresh by checking permission again
      const hasPermission = await UsageStatsModule.isUsageAccessGranted();

      // If still no permission, try a force check if available
      if (!hasPermission && UsageStatsModule.forceRefreshPermission) {
        return await UsageStatsModule.forceRefreshPermission();
      }

      return hasPermission;
    } catch (error) {
      console.error('Error refreshing permission:', error);
      return false;
    }
  }

  static async hasOverlayPermission(): Promise<boolean> {
    if (!this.isNativeModuleAvailable()) {
      return false;
    }

    return await UsageStatsModule.hasOverlayPermission();
  }

  static async requestOverlayPermission(): Promise<void> {
    if (!this.isNativeModuleAvailable()) {
      return;
    }

    await UsageStatsModule.requestOverlayPermission();
  }

  // ========== UTILITY METHODS ==========

  static getAppDisplayName(packageName: string): string {
    const appNameMap: Record<string, string> = {
      'com.instagram.android': 'Instagram',
      'com.zhiliaoapp.musically': 'TikTok',
      'com.facebook.katana': 'Facebook',
      'com.twitter.android': 'Twitter (X)',
      'com.reddit.frontpage': 'Reddit',
      'com.snapchat.android': 'Snapchat',
      'com.google.android.youtube': 'YouTube',
      'com.netflix.mediaclient': 'Netflix',
      'com.whatsapp': 'WhatsApp',
      'com.discord': 'Discord',
    };

    return appNameMap[packageName] ||
      (packageName.split('.').pop()?.charAt(0).toUpperCase() || '') +
      (packageName.split('.').pop()?.slice(1) || packageName);
  }

  // ========== DAILY RESET ==========

  async resetDailyTracking(): Promise<void> {
    console.log('Resetting daily tracking...');

    for (const tracker of this.appTrackers.values()) {
      tracker.totalTodayMs = 0;
      tracker.notificationsSent.clear();
      tracker.lastCheckedMs = Date.now();
    }

    console.log('Daily tracking reset completed');
  }

  // ========== STATUS METHODS ==========

  getMonitoringStatus(): MonitoringStatus {
    return {
      isMonitoring: this.isMonitoring,
      trackedApps: this.appTrackers.size,
      backgroundEnabled: !!this.checkInterval,
      trackingDetails: Array.from(this.appTrackers.values()).map(tracker => ({
        packageName: tracker.packageName,
        appName: tracker.appName,
        todayUsageMs: tracker.totalTodayMs,
        notificationCount: tracker.notificationsSent.size
      }))
    };
  }

  getDebugInfo(): object {
    return {
      isMonitoring: this.isMonitoring,
      trackersCount: this.appTrackers.size,
      backgroundInterval: !!this.checkInterval,
      trackers: Object.fromEntries(
        Array.from(this.appTrackers.entries()).map(([key, tracker]) => [
          key,
          {
            appName: tracker.appName,
            totalTodayMs: tracker.totalTodayMs,
            lastCheckedMs: tracker.lastCheckedMs,
            notificationsSent: Array.from(tracker.notificationsSent)
          }
        ])
      )
    };
  }
}

// Type definitions
interface AppUsageData {
  packageName: string;
  appName: string;
  totalTimeMs: number;
  lastTimeUsed?: number;
  firstTimeStamp?: number;
  lastTimeStamp?: number;
}

interface UsageThreshold {
  duration: number;
  intensity: 'mild' | 'normal' | 'harsh' | 'critical';
}

interface AppUsageTracker {
  packageName: string;
  appName: string;
  totalTodayMs: number;
  lastCheckedMs: number;
  notificationsSent: Set<number>;
}

interface MonitoringStatus {
  isMonitoring: boolean;
  trackedApps: number;
  backgroundEnabled: boolean;
  trackingDetails: {
    packageName: string;
    appName: string;
    todayUsageMs: number;
    notificationCount: number;
  }[];
}

interface InstalledApp {
  packageName: string;
  appName: string;
  isRecommended: boolean;
}