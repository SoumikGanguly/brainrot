import { AppState, AppStateStatus } from 'react-native';
import { database } from './database';
import { NotificationService } from './NotificationService';
import { UsageService } from './UsageService';

interface UsageThreshold {
  duration: number; // in milliseconds
  intensity: 'mild' | 'normal' | 'harsh' | 'critical';
}

interface AppUsageTracker {
  packageName: string;
  appName: string;
  totalTodayMs: number;
  lastCheckedMs: number;
  notificationsSent: Set<number>; // Track which thresholds have been notified
}

export class UsageMonitoringService {
  private static instance: UsageMonitoringService;
  private isMonitoring = false;
  private backgroundInterval?: ReturnType<typeof setInterval>;
  private appTrackers: Map<string, AppUsageTracker> = new Map();
  private isNativeRealtimeActive = false;
  
  // Usage thresholds for notifications (in milliseconds)
  private static readonly THRESHOLDS: UsageThreshold[] = [
    { duration: 30 * 60 * 1000, intensity: 'mild' },     // 30 minutes
    { duration: 45 * 60 * 1000, intensity: 'normal' },   // 45 minutes
    { duration: 60 * 60 * 1000, intensity: 'harsh' },    // 1 hour
    { duration: 90 * 60 * 1000, intensity: 'critical' }, // 1.5 hours
    { duration: 120 * 60 * 1000, intensity: 'critical' }, // 2 hours
  ];

  static getInstance(): UsageMonitoringService {
    if (!this.instance) {
      this.instance = new UsageMonitoringService();
    }
    return this.instance;
  }

  private constructor() {
    AppState.addEventListener('change', this.handleAppStateChange);
  }

  private handleAppStateChange = (nextAppState: AppStateStatus) => {
    if (nextAppState === 'active') {
      // App came to foreground, restart monitoring
      this.startMonitoring();
    } else if (nextAppState === 'background') {
      // App went to background, but keep monitoring if enabled
      this.handleAppGoingBackground();
    }
  };

  async initialize(): Promise<void> {
    try {
      console.log('Initializing UsageMonitoringService...');
      
      // Initialize notification service
      await NotificationService.initialize();
      
      // Load today's usage data to initialize trackers
      await this.initializeTodayTrackers();
      
      // Check if monitoring should be started based on saved preferences
      const monitoringEnabled = await database.getMeta('monitoring_enabled');
      if (monitoringEnabled === 'true') {
        await this.startMonitoring();
      }
      
      console.log('Usage monitoring service initialized');
    } catch (error) {
      console.error('Error initializing usage monitoring:', error);
    }
  }

  private async initializeTodayTrackers(): Promise<void> {
    try {
      // Get monitored apps from database
      const monitoredAppsData = await database.getMeta('monitored_apps');
      if (!monitoredAppsData) {
        console.log('No monitored apps found, using defaults');
        // Set default monitored apps if none exist
        const defaultApps = [
          'com.google.android.youtube',
          'com.instagram.android',
          'com.ss.android.ugc.tiktok',
          'com.facebook.katana',
          'com.twitter.android'
        ];
        await database.setMeta('monitored_apps', JSON.stringify(defaultApps));
        await this.initializeTrackersForApps(defaultApps);
        return;
      }

      const monitoredPackages = JSON.parse(monitoredAppsData) as string[];
      await this.initializeTrackersForApps(monitoredPackages);
      
    } catch (error) {
      console.error('Error initializing today trackers:', error);
    }
  }

  private async initializeTrackersForApps(monitoredPackages: string[]): Promise<void> {
    try {
      // Get today's usage data
      const todayUsage = await UsageService.getTodayUsage();
      
      // Initialize trackers for monitored apps
      for (const packageName of monitoredPackages) {
        const usageData = todayUsage.find(u => u.packageName === packageName);
        const appName = UsageService.getAppDisplayName(packageName);
        
        this.appTrackers.set(packageName, {
          packageName,
          appName,
          totalTodayMs: usageData?.totalTimeMs || 0,
          lastCheckedMs: Date.now(),
          notificationsSent: new Set()
        });
      }
      
      console.log(`Initialized trackers for ${this.appTrackers.size} monitored apps`);
    } catch (error) {
      console.error('Error initializing trackers for apps:', error);
    }
  }

  async startMonitoring(): Promise<boolean> {
    if (this.isMonitoring) {
      console.log('Monitoring already active');
      return true;
    }

    try {
      console.log('Starting comprehensive monitoring...');
      
      // Check permissions first
      const hasAccess = await UsageService.isUsageAccessGranted();
      if (!hasAccess) {
        console.warn('Usage access not granted, cannot start monitoring');
        return false;
      }

      // Start background monitoring (JavaScript intervals)
      this.startBackgroundMonitoring();
      
      // Start native real-time monitoring (detects app opens immediately)
      const nativeStarted = await this.startNativeRealtimeMonitoring();
      
      this.isMonitoring = true;
      
      // Save monitoring state
      await database.setMeta('monitoring_enabled', 'true');
      await database.setMeta('monitoring_started_at', Date.now().toString());
      
      console.log(`Monitoring started - Background: true, Native realtime: ${nativeStarted}`);
      
      // Trigger initial check after 5 seconds
      setTimeout(() => this.checkUsageAndNotify(), 5000);
      
      return true;
    } catch (error) {
      console.error('Error starting usage monitoring:', error);
      return false;
    }
  }

  async stopMonitoring(): Promise<void> {
    console.log('Stopping monitoring...');
    
    this.isMonitoring = false;
    
    // Stop background intervals
    if (this.backgroundInterval) {
      clearInterval(this.backgroundInterval);
      this.backgroundInterval = undefined;
    }

    // Stop native real-time monitoring
    await this.stopNativeRealtimeMonitoring();

    // Update database state
    await database.setMeta('monitoring_enabled', 'false');

    console.log('Usage monitoring stopped');
  }

  private startBackgroundMonitoring(): void {
    // Check usage every 10 minutes for background monitoring
    this.backgroundInterval = setInterval(() => {
      this.checkUsageAndNotify();
    }, 10 * 60 * 1000); // 10 minutes

    console.log('Background monitoring started (10min intervals)');
  }

  private async startNativeRealtimeMonitoring(): Promise<boolean> {
    try {
      // Use the enhanced UsageService method to start real-time app detection
      const success = await UsageService.startRealtimeAppDetection();
      this.isNativeRealtimeActive = success;
      
      if (success) {
        console.log('Native real-time app detection started');
        // The native module will now detect when monitored apps are opened
        // and call our usage checker automatically
      } else {
        console.warn('Failed to start native real-time monitoring');
      }
      
      return success;
    } catch (error) {
      console.error('Error starting native real-time monitoring:', error);
      return false;
    }
  }

  private async stopNativeRealtimeMonitoring(): Promise<void> {
    try {
      if (this.isNativeRealtimeActive) {
        await UsageService.stopRealtimeAppDetection();
        this.isNativeRealtimeActive = false;
        console.log('Native real-time monitoring stopped');
      }
    } catch (error) {
      console.error('Error stopping native real-time monitoring:', error);
    }
  }

  // This method will be called both by intervals and by native real-time detection
  async checkUsageAndNotify(): Promise<void> {
    try {
      console.log('Checking usage and sending notifications...');
      
      // Check if notifications are enabled
      const notificationsEnabled = await database.getMeta('notifications_enabled');
      if (notificationsEnabled === 'false') {
        console.log('Notifications disabled, skipping check');
        return;
      }

      // Check if notifications are snoozed
      const snoozeUntilStr = await database.getMeta('notifications_snooze_until');
      const snoozeUntil = snoozeUntilStr ? parseInt(snoozeUntilStr) : 0;
      if (Date.now() < snoozeUntil) {
        console.log('Notifications snoozed, skipping check');
        return;
      }

      // Get current usage data
      const todayUsage = await UsageService.getTodayUsage();
      console.log(`Checking ${todayUsage.length} apps for usage thresholds`);
      
      // Update trackers and check for notifications
      let notificationsSent = 0;
      for (const [packageName, tracker] of this.appTrackers) {
        const currentUsage = todayUsage.find(u => u.packageName === packageName);
        const currentTotalMs = currentUsage?.totalTimeMs || 0;
        
        // Only check if usage has increased since last check
        if (currentTotalMs > tracker.totalTodayMs) {
          tracker.totalTodayMs = currentTotalMs;
          tracker.lastCheckedMs = Date.now();

          // Check thresholds and send notifications
          const sent = await this.checkThresholdsForApp(tracker);
          if (sent) notificationsSent++;
        }
      }
      
      if (notificationsSent > 0) {
        console.log(`Sent ${notificationsSent} usage notifications`);
      }
      
    } catch (error) {
      console.error('Error in checkUsageAndNotify:', error);
    }
  }

  // Public method that can be called by native module when app is detected
  async checkSpecificAppUsage(packageName: string): Promise<void> {
    try {
      console.log(`Real-time check for app: ${packageName}`);
      
      const tracker = this.appTrackers.get(packageName);
      if (!tracker) {
        console.log(`No tracker found for ${packageName}`);
        return;
      }

      // Get fresh usage data for this specific app
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      
      const currentTotalMs = await UsageService.getAppUsage(packageName, startOfDay.getTime());
      
      if (currentTotalMs > tracker.totalTodayMs) {
        tracker.totalTodayMs = currentTotalMs;
        tracker.lastCheckedMs = Date.now();
        
        console.log(`Updated usage for ${tracker.appName}: ${this.formatDuration(currentTotalMs)}`);
        
        // Check thresholds immediately
        await this.checkThresholdsForApp(tracker);
      }
      
    } catch (error) {
      console.error(`Error checking specific app usage for ${packageName}:`, error);
    }
  }

  private async checkThresholdsForApp(tracker: AppUsageTracker): Promise<boolean> {
    let notificationSent = false;
    
    for (let i = 0; i < UsageMonitoringService.THRESHOLDS.length; i++) {
      const threshold = UsageMonitoringService.THRESHOLDS[i];
      
      // Check if usage has crossed this threshold
      if (tracker.totalTodayMs >= threshold.duration) {
        // Check if we've already sent notification for this threshold
        if (!tracker.notificationsSent.has(i)) {
          // Send notification
          const usageTimeFormatted = this.formatDuration(tracker.totalTodayMs);
          
          try {
            await NotificationService.scheduleUsageAlert(
              tracker.appName,
              usageTimeFormatted,
              threshold.intensity
            );

            // Mark this threshold as notified
            tracker.notificationsSent.add(i);
            
            // Save notification history
            const today = new Date().toISOString().split('T')[0];
            await database.saveNotificationHistory(
              tracker.packageName,
              threshold.intensity,
              today
            );
            
            console.log(`Sent ${threshold.intensity} notification for ${tracker.appName} after ${usageTimeFormatted}`);
            notificationSent = true;
            
            // Only send one notification per check to avoid spam
            break;
            
          } catch (error) {
            console.error(`Error sending notification for ${tracker.appName}:`, error);
          }
        }
      }
    }
    
    return notificationSent;
  }

  private formatDuration(ms: number): string {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }

  private async handleAppGoingBackground(): Promise<void> {
    // Keep monitoring in background if background checks are enabled
    const backgroundEnabled = await database.getMeta('background_checks_enabled');
    if (backgroundEnabled === 'false') {
      console.log('Background monitoring disabled, stopping monitoring');
      await this.stopMonitoring();
    } else {
      console.log('Continuing monitoring in background');
    }
  }

  // Public method to refresh monitored apps (call when settings change)
  async refreshMonitoredApps(): Promise<void> {
    try {
      console.log('Refreshing monitored apps...');
      
      const monitoredAppsData = await database.getMeta('monitored_apps');
      if (!monitoredAppsData) return;

      const monitoredPackages = JSON.parse(monitoredAppsData) as string[];
      
      // Remove trackers for apps no longer monitored
      for (const [packageName] of this.appTrackers) {
        if (!monitoredPackages.includes(packageName)) {
          this.appTrackers.delete(packageName);
          console.log(`Removed tracker for ${packageName}`);
        }
      }
      
      // Add trackers for newly monitored apps
      const todayUsage = await UsageService.getTodayUsage();
      for (const packageName of monitoredPackages) {
        if (!this.appTrackers.has(packageName)) {
          const usageData = todayUsage.find(u => u.packageName === packageName);
          const appName = UsageService.getAppDisplayName(packageName);
          
          this.appTrackers.set(packageName, {
            packageName,
            appName,
            totalTodayMs: usageData?.totalTimeMs || 0,
            lastCheckedMs: Date.now(),
            notificationsSent: new Set()
          });
          
          console.log(`Added tracker for ${appName}`);
        }
      }
      
      console.log(`Refreshed trackers - now tracking ${this.appTrackers.size} apps`);
      
    } catch (error) {
      console.error('Error refreshing monitored apps:', error);
    }
  }

  // Reset daily tracking (call at midnight or when date changes)
  async resetDailyTracking(): Promise<void> {
    console.log('Resetting daily tracking...');
    
    for (const tracker of this.appTrackers.values()) {
      tracker.totalTodayMs = 0;
      tracker.notificationsSent.clear();
      tracker.lastCheckedMs = Date.now();
    }
    
    console.log('Daily tracking reset completed');
  }

  // Manual trigger for testing
  async triggerManualCheck(): Promise<void> {
    console.log('Manual usage check triggered');
    await this.checkUsageAndNotify();
  }

  // Get current status
  getMonitoringStatus(): { 
    isMonitoring: boolean; 
    trackedApps: number; 
    backgroundEnabled: boolean; 
    realtimeEnabled: boolean;
    trackingDetails: {
      packageName: string;
      appName: string;
      todayUsageMs: number;
      notificationCount: number;
    }[];
  } {
    return {
      isMonitoring: this.isMonitoring,
      trackedApps: this.appTrackers.size,
      backgroundEnabled: !!this.backgroundInterval,
      realtimeEnabled: this.isNativeRealtimeActive,
      trackingDetails: Array.from(this.appTrackers.values()).map(tracker => ({
        packageName: tracker.packageName,
        appName: tracker.appName,
        todayUsageMs: tracker.totalTodayMs,
        notificationCount: tracker.notificationsSent.size
      }))
    };
  }

  // Get detailed monitoring info for debugging
  getDebugInfo(): object {
    return {
      isMonitoring: this.isMonitoring,
      trackersCount: this.appTrackers.size,
      backgroundInterval: !!this.backgroundInterval,
      nativeRealtimeActive: this.isNativeRealtimeActive,
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