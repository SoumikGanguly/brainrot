// UsageMonitoringService.ts - WITH EXTENSIVE LOGGING

import { AppState, AppStateStatus } from 'react-native';
import { database } from './database';
import { NotificationService } from './NotificationService';
import { UsageService } from './UsageService';

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

export class UsageMonitoringService {
  private static instance: UsageMonitoringService;
  private isMonitoring = false;
  private backgroundInterval?: ReturnType<typeof setInterval>;
  private appTrackers: Map<string, AppUsageTracker> = new Map();
  private isNativeRealtimeActive = false;
  private checkCount = 0; // Track iterations
  
  private static readonly THRESHOLDS: UsageThreshold[] = [
    { duration: 30 * 60 * 1000, intensity: 'mild' },
    { duration: 45 * 60 * 1000, intensity: 'normal' },
    { duration: 60 * 60 * 1000, intensity: 'harsh' },
    { duration: 90 * 60 * 1000, intensity: 'critical' },
    { duration: 120 * 60 * 1000, intensity: 'critical' },
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

  async initialize(): Promise<void> {
    try {
      console.log('========================================');
      console.log('🔄 INITIALIZING USAGE MONITORING SERVICE');
      console.log('========================================');
      
      await NotificationService.initialize();
      await this.initializeTodayTrackers();
      
      const monitoringEnabled = await database.getMeta('monitoring_enabled');
      if (monitoringEnabled === 'true') {
        await this.startMonitoring();
      }
      
      console.log('✅ Usage monitoring service initialized');
      console.log('========================================\n');
    } catch (error) {
      console.error('❌ Error initializing usage monitoring:', error);
    }
  }

  private async initializeTodayTrackers(): Promise<void> {
    try {
      const monitoredAppsData = await database.getMeta('monitored_apps');
      if (!monitoredAppsData) {
        console.log('⚠️ No monitored apps found, using defaults');
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
      const todayUsage = await UsageService.getTodayUsage();
      
      console.log(`📱 Initializing trackers for ${monitoredPackages.length} monitored apps...`);
      
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
        
        console.log(`   ✓ ${appName} - ${Math.round((usageData?.totalTimeMs || 0) / 60000)}min today`);
      }
      
      console.log(`✅ Initialized trackers for ${this.appTrackers.size} monitored apps`);
    } catch (error) {
      console.error('Error initializing trackers for apps:', error);
    }
  }

  async startMonitoring(): Promise<boolean> {
    if (this.isMonitoring) {
      console.log('⚠️ Monitoring already active');
      return true;
    }

    try {
      console.log('\n🎬 STARTING COMPREHENSIVE MONITORING');
      
      const hasAccess = await UsageService.isUsageAccessGranted();
      if (!hasAccess) {
        console.error('❌ Usage access not granted, cannot start monitoring');
        return false;
      }
      console.log('✅ Usage access granted');

      this.startBackgroundMonitoring();
      
      const nativeStarted = await this.startNativeRealtimeMonitoring();
      console.log(`Native realtime: ${nativeStarted ? '✅' : '⚠️ Not available'}`);
      
      this.isMonitoring = true;
      
      await database.setMeta('monitoring_enabled', 'true');
      await database.setMeta('monitoring_started_at', Date.now().toString());
      
      console.log('🎬 Monitoring started - will log every check\n');
      
      setTimeout(() => this.checkUsageAndNotify(), 5000);
      
      return true;
    } catch (error) {
      console.error('❌ Error starting usage monitoring:', error);
      return false;
    }
  }

  async stopMonitoring(): Promise<void> {
    console.log('⏹️ Stopping monitoring...');
    
    this.isMonitoring = false;
    
    if (this.backgroundInterval) {
      clearInterval(this.backgroundInterval);
      this.backgroundInterval = undefined;
    }

    await this.stopNativeRealtimeMonitoring();
    await database.setMeta('monitoring_enabled', 'false');

    console.log('✅ Usage monitoring stopped');
  }

  private startBackgroundMonitoring(): void {
    this.backgroundInterval = setInterval(() => {
      this.checkUsageAndNotify();
    }, 10 * 60 * 1000); // 10 minutes

    console.log('   ✓ Background checks: Every 10 minutes');
  }

  private async startNativeRealtimeMonitoring(): Promise<boolean> {
    try {
      const success = await UsageService.startRealtimeAppDetection();
      this.isNativeRealtimeActive = success;
      
      if (success) {
        console.log('   ✓ Native realtime detection started');
      } else {
        console.log('   ⚠️ Native realtime not available');
      }
      
      return success;
    } catch (error) {
      console.error('   ❌ Error starting native realtime:', error);
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

  async checkUsageAndNotify(): Promise<void> {
    try {
      this.checkCount++;
      
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`🔍 USAGE CHECK #${this.checkCount} at ${new Date().toLocaleTimeString()}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      
      const notificationsEnabled = await database.getMeta('notifications_enabled');
      if (notificationsEnabled === 'false') {
        console.log('⏭️  Notifications disabled, skipping check');
        return;
      }

      const snoozeUntilStr = await database.getMeta('notifications_snooze_until');
      const snoozeUntil = snoozeUntilStr ? parseInt(snoozeUntilStr) : 0;
      if (Date.now() < snoozeUntil) {
        console.log('⏭️  Notifications snoozed, skipping check');
        return;
      }

      // ✅ NEW: Get current foreground app using native method
      console.log('🎯 Detecting current foreground app (native method)...');
      const currentForegroundApp = await UsageService.getCurrentForegroundApp();
      
      if (currentForegroundApp) {
        console.log(`✅ CURRENT FOREGROUND APP:`);
        console.log(`   Name: ${currentForegroundApp.appName}`);
        console.log(`   Package: ${currentForegroundApp.packageName}`);
        
        // Check if it's a monitored app
        const tracker = this.appTrackers.get(currentForegroundApp.packageName);
        if (tracker) {
          console.log(`   ✅ This is a MONITORED app!`);
          console.log(`   Current usage today: ${this.formatDuration(tracker.totalTodayMs)}`);
          
          // Trigger immediate check for this app
          await this.checkSpecificAppUsage(currentForegroundApp.packageName);
        } else {
          console.log(`   ℹ️  Not a monitored app`);
        }
      } else {
        console.log('⚠️  Could not detect current foreground app');
        console.log('   Possible reasons:');
        console.log('   - Home screen is active');
        console.log('   - System UI is in foreground');
        console.log('   - No app opened in last 3 seconds');
      }
      
      // Also check overall usage for all monitored apps
      console.log('\n📊 Checking usage for all monitored apps...');
      const todayUsage = await UsageService.getTodayUsage();
      
      if (!todayUsage || todayUsage.length === 0) {
        console.log('⚠️  NO USAGE DATA RETURNED');
        console.log('   This could mean:');
        console.log('   - No apps used today');
        console.log('   - Usage permission not granted');
        console.log('   - Native module not returning data');
        return;
      }
      
      console.log(`✅ Got usage data for ${todayUsage.length} apps`);
      
      // Log top 5 apps
      const topApps = todayUsage
        .sort((a, b) => b.totalTimeMs - a.totalTimeMs)
        .slice(0, 5);
      
      console.log('\n📱 Top 5 apps by usage today:');
      topApps.forEach((app, index) => {
        const minutes = Math.round(app.totalTimeMs / 60000);
        const isMonitored = this.appTrackers.has(app.packageName) ? '⭐' : '  ';
        console.log(`   ${isMonitored} ${index + 1}. ${app.appName} - ${minutes} minutes`);
      });
      
      // Update trackers and check thresholds
      let notificationsSent = 0;
      console.log('\n🔔 Checking notification thresholds...');
      
      for (const [packageName, tracker] of this.appTrackers) {
        const currentUsage = todayUsage.find(u => u.packageName === packageName);
        const currentTotalMs = currentUsage?.totalTimeMs || 0;
        
        if (currentTotalMs > tracker.totalTodayMs) {
          const previousMs = tracker.totalTodayMs;
          tracker.totalTodayMs = currentTotalMs;
          tracker.lastCheckedMs = Date.now();
          
          console.log(`   📈 ${tracker.appName}: ${this.formatDuration(previousMs)} → ${this.formatDuration(currentTotalMs)}`);

          const sent = await this.checkThresholdsForApp(tracker);
          if (sent) notificationsSent++;
        }
      }
      
      if (notificationsSent > 0) {
        console.log(`\n📢 Sent ${notificationsSent} usage notifications`);
      } else {
        console.log('\n✓ No notifications needed');
      }
      
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      
    } catch (error) {
      console.error('\n❌ ERROR in checkUsageAndNotify:', error);
      console.error('Stack:', error instanceof Error ? error.stack : 'No stack trace');
    }
  }

  async checkSpecificAppUsage(packageName: string): Promise<void> {
    try {
      console.log(`\n🔎 Checking specific app: ${packageName}`);
      
      const tracker = this.appTrackers.get(packageName);
      if (!tracker) {
        console.log(`   ⚠️  No tracker found for ${packageName}`);
        return;
      }

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      
      const currentTotalMs = await UsageService.getAppUsage(packageName, startOfDay.getTime());
      
      if (currentTotalMs > tracker.totalTodayMs) {
        tracker.totalTodayMs = currentTotalMs;
        tracker.lastCheckedMs = Date.now();
        
        console.log(`   ✅ Updated usage for ${tracker.appName}: ${this.formatDuration(currentTotalMs)}`);
        
        await this.checkThresholdsForApp(tracker);
      }
      
    } catch (error) {
      console.error(`❌ Error checking specific app usage for ${packageName}:`, error);
    }
  }

  private async checkThresholdsForApp(tracker: AppUsageTracker): Promise<boolean> {
    let notificationSent = false;
    
    for (let i = 0; i < UsageMonitoringService.THRESHOLDS.length; i++) {
      const threshold = UsageMonitoringService.THRESHOLDS[i];
      
      if (tracker.totalTodayMs >= threshold.duration) {
        if (!tracker.notificationsSent.has(i)) {
          const usageTimeFormatted = this.formatDuration(tracker.totalTodayMs);
          
          try {
            const sent = await NotificationService.scheduleUsageAlert(
              tracker.appName,
              usageTimeFormatted,
              threshold.intensity
            );

            if (!sent) {
              continue;
            }

            tracker.notificationsSent.add(i);
            
            const today = new Date().toISOString().split('T')[0];
            await database.saveNotificationHistory(
              tracker.packageName,
              threshold.intensity,
              today
            );
            
            console.log(`📢 Sent ${threshold.intensity} notification for ${tracker.appName} after ${usageTimeFormatted}`);
            notificationSent = true;
            break;
            
          } catch (error) {
            console.error(`❌ Error sending notification for ${tracker.appName}:`, error);
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

  private handleAppStateChange = (nextAppState: AppStateStatus) => {
    if (nextAppState === 'active') {
      this.startMonitoring();
    } else if (nextAppState === 'background') {
      this.handleAppGoingBackground();
    }
  };

  private async handleAppGoingBackground(): Promise<void> {
    const backgroundEnabled = await database.getMeta('background_checks_enabled');
    if (backgroundEnabled === 'false') {
      console.log('Background monitoring disabled, stopping monitoring');
      await this.stopMonitoring();
    } else {
      console.log('Continuing monitoring in background');
    }
  }

  async refreshMonitoredApps(): Promise<void> {
    try {
      console.log('🔄 Refreshing monitored apps...');
      
      const monitoredAppsData = await database.getMeta('monitored_apps');
      if (!monitoredAppsData) return;

      const monitoredPackages = JSON.parse(monitoredAppsData) as string[];
      
      for (const [packageName] of this.appTrackers) {
        if (!monitoredPackages.includes(packageName)) {
          this.appTrackers.delete(packageName);
          console.log(`   ✗ Removed tracker for ${packageName}`);
        }
      }
      
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
          
          console.log(`   ✓ Added tracker for ${appName}`);
        }
      }
      
      console.log(`✅ Refreshed trackers - now tracking ${this.appTrackers.size} apps`);
      
    } catch (error) {
      console.error('Error refreshing monitored apps:', error);
    }
  }

  async resetDailyTracking(): Promise<void> {
    console.log('🔄 Resetting daily tracking...');
    
    for (const tracker of this.appTrackers.values()) {
      tracker.totalTodayMs = 0;
      tracker.notificationsSent.clear();
      tracker.lastCheckedMs = Date.now();
    }
    
    console.log('✅ Daily tracking reset completed');
  }

  async triggerManualCheck(): Promise<void> {
    console.log('\n🔨 MANUAL CHECK TRIGGERED\n');
    await this.checkUsageAndNotify();
  }

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

  getDebugInfo(): object {
    return {
      isMonitoring: this.isMonitoring,
      trackersCount: this.appTrackers.size,
      backgroundInterval: !!this.backgroundInterval,
      nativeRealtimeActive: this.isNativeRealtimeActive,
      checkCount: this.checkCount,
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
