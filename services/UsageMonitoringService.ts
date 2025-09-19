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
  private realtimeInterval?: ReturnType<typeof setInterval>;
  private appTrackers: Map<string, AppUsageTracker> = new Map();
  
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
      // Initialize notification service
      await NotificationService.initialize();
      
      // Load today's usage data to initialize trackers
      await this.initializeTodayTrackers();
      
      // Start monitoring based on settings
      await this.startMonitoring();
      
      console.log('Usage monitoring service initialized');
    } catch (error) {
      console.error('Error initializing usage monitoring:', error);
    }
  }

  private async initializeTodayTrackers(): Promise<void> {
    try {
      // Get monitored apps from database
      const monitoredAppsData = await database.getMeta('monitored_apps');
      if (!monitoredAppsData) return;

      const monitoredPackages = JSON.parse(monitoredAppsData) as string[];
      
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
    } catch (error) {
      console.error('Error initializing today trackers:', error);
    }
  }

  async startMonitoring(): Promise<void> {
    if (this.isMonitoring) return;

    try {
      // Check permissions first
      const hasAccess = await UsageService.isUsageAccessGranted();
      if (!hasAccess) {
        console.warn('Usage access not granted, cannot start monitoring');
        return;
      }

      // Check settings
      const backgroundEnabled = await database.getMeta('background_checks_enabled');
      const realtimeEnabled = await database.getMeta('realtime_monitoring_enabled');

      if (backgroundEnabled !== 'false') {
        this.startBackgroundMonitoring();
      }

      if (realtimeEnabled === 'true') {
        this.startRealtimeMonitoring();
      }

      this.isMonitoring = true;
      console.log('Usage monitoring started');
    } catch (error) {
      console.error('Error starting usage monitoring:', error);
    }
  }

  async stopMonitoring(): Promise<void> {
    this.isMonitoring = false;
    
    if (this.backgroundInterval) {
      clearInterval(this.backgroundInterval);
      this.backgroundInterval = undefined;
    }

    if (this.realtimeInterval) {
      clearInterval(this.realtimeInterval);
      this.realtimeInterval = undefined;
    }

    console.log('Usage monitoring stopped');
  }

  private startBackgroundMonitoring(): void {
    // Check usage every 15 minutes
    this.backgroundInterval = setInterval(() => {
      this.checkUsageAndNotify();
    }, 15 * 60 * 1000); // 15 minutes

    // Initial check
    setTimeout(() => this.checkUsageAndNotify(), 5000); // Check after 5 seconds
  }

  private startRealtimeMonitoring(): void {
    // Check usage every 2 minutes for real-time monitoring
    this.realtimeInterval = setInterval(() => {
      this.checkUsageAndNotify();
    }, 2 * 60 * 1000); // 2 minutes

    // Initial check
    setTimeout(() => this.checkUsageAndNotify(), 2000); // Check after 2 seconds
  }

  private async checkUsageAndNotify(): Promise<void> {
    try {
      console.log('Checking usage and sending notifications...');
      
      // Check if notifications are enabled
      const notificationsEnabled = await database.getMeta('notifications_enabled');
      if (notificationsEnabled === 'false') {
        return;
      }

      // Check if notifications are snoozed
      const snoozeUntilStr = await database.getMeta('notifications_snooze_until');
      const snoozeUntil = snoozeUntilStr ? parseInt(snoozeUntilStr) : 0;
      if (Date.now() < snoozeUntil) {
        return;
      }

      // Get current usage data
      const todayUsage = await UsageService.getTodayUsage();
      
      // Update trackers and check for notifications
      for (const [packageName, tracker] of this.appTrackers) {
        const currentUsage = todayUsage.find(u => u.packageName === packageName);
        const currentTotalMs = currentUsage?.totalTimeMs || 0;
        
        // Update tracker
        tracker.totalTodayMs = currentTotalMs;
        tracker.lastCheckedMs = Date.now();

        // Check thresholds and send notifications
        await this.checkThresholdsForApp(tracker);
      }
    } catch (error) {
      console.error('Error in checkUsageAndNotify:', error);
    }
  }

  private async checkThresholdsForApp(tracker: AppUsageTracker): Promise<void> {
    for (let i = 0; i < UsageMonitoringService.THRESHOLDS.length; i++) {
      const threshold = UsageMonitoringService.THRESHOLDS[i];
      
      // Check if usage has crossed this threshold
      if (tracker.totalTodayMs >= threshold.duration) {
        // Check if we've already sent notification for this threshold
        if (!tracker.notificationsSent.has(i)) {
          // Send notification
          const usageTimeFormatted = this.formatDuration(tracker.totalTodayMs);
          
          await NotificationService.scheduleUsageAlert(
            tracker.appName,
            usageTimeFormatted,
            threshold.intensity
          );

          // Mark this threshold as notified
          tracker.notificationsSent.add(i);
          
          console.log(`Sent ${threshold.intensity} notification for ${tracker.appName} after ${usageTimeFormatted}`);
        }
      }
    }
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
      this.stopMonitoring();
    }
  }

  // Public method to refresh monitored apps (call when settings change)
  async refreshMonitoredApps(): Promise<void> {
    try {
      const monitoredAppsData = await database.getMeta('monitored_apps');
      if (!monitoredAppsData) return;

      const monitoredPackages = JSON.parse(monitoredAppsData) as string[];
      
      // Remove trackers for apps no longer monitored
      for (const [packageName] of this.appTrackers) {
        if (!monitoredPackages.includes(packageName)) {
          this.appTrackers.delete(packageName);
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
        }
      }
    } catch (error) {
      console.error('Error refreshing monitored apps:', error);
    }
  }

  // Reset daily tracking (call at midnight or when date changes)
  async resetDailyTracking(): Promise<void> {
    for (const tracker of this.appTrackers.values()) {
      tracker.totalTodayMs = 0;
      tracker.notificationsSent.clear();
      tracker.lastCheckedMs = Date.now();
    }
    console.log('Daily tracking reset');
  }

  // Get current status
  getMonitoringStatus(): { 
    isMonitoring: boolean; 
    trackedApps: number; 
    backgroundEnabled: boolean; 
    realtimeEnabled: boolean; 
  } {
    return {
      isMonitoring: this.isMonitoring,
      trackedApps: this.appTrackers.size,
      backgroundEnabled: !!this.backgroundInterval,
      realtimeEnabled: !!this.realtimeInterval
    };
  }
}