import { NativeModules, Platform } from 'react-native';
import { database } from './database';

const { UsageStatsModule } = NativeModules;

interface InstalledApp {
  packageName: string;
  appName: string;
  isRecommended: boolean;
}

export interface UsageData {
  packageName: string;
  appName: string;
  totalTimeMs: number;
  lastTimeUsed: number;
}

export class UsageService {
  private static readonly RECOMMENDED_APPS = [
    { packageName: 'com.google.android.youtube', appName: 'YouTube', isRecommended: true },
    { packageName: 'com.instagram.android', appName: 'Instagram', isRecommended: true },
    { packageName: 'com.ss.android.ugc.tiktok', appName: 'TikTok', isRecommended: true },
    { packageName: 'com.whatsapp', appName: 'WhatsApp', isRecommended: true },
    { packageName: 'com.facebook.katana', appName: 'Facebook', isRecommended: true },
    { packageName: 'com.twitter.android', appName: 'Twitter', isRecommended: true },
    { packageName: 'com.snapchat.android', appName: 'Snapchat', isRecommended: true },
    { packageName: 'com.reddit.frontpage', appName: 'Reddit', isRecommended: true },
    { packageName: 'com.zhiliaoapp.musically', appName: 'TikTok', isRecommended: true },
    { packageName: 'com.discord', appName: 'Discord', isRecommended: true },
  ];

  static async isUsageAccessGranted(): Promise<boolean> {
    try {
      if (Platform.OS !== 'android') {
        console.warn('Usage access is only supported on Android');
        return false;
      }

      if (!UsageStatsModule) {
        console.warn('UsageStatsModule not available');
        return false;
      }

      return await UsageStatsModule.isUsageAccessGranted();
    } catch (error) {
      console.error('Error checking usage access:', error);
      return false;
    }
  }

  static async forceRefreshPermission(): Promise<boolean> {
    try {
      if (Platform.OS !== 'android' || !UsageStatsModule) {
        return false;
      }

      return await UsageStatsModule.forceRefreshPermission();
    } catch (error) {
      console.error('Error force refreshing permission:', error);
      return false;
    }
  }
  
  static async openUsageAccessSettings(): Promise<void> {
    try {
      if (Platform.OS !== 'android') {
        console.warn('Usage access settings only available on Android');
        return;
      }

      if (!UsageStatsModule) {
        console.warn('UsageStatsModule not available');
        return;
      }

      await UsageStatsModule.openUsageAccessSettings();
    } catch (error) {
      console.error('Error opening usage settings:', error);
      throw error;
    }
  }

  static async getInstalledApps(): Promise<InstalledApp[]> {
    try {
      if (Platform.OS !== 'android') {
        console.warn('App listing only supported on Android, returning recommended apps');
        return this.RECOMMENDED_APPS;
      }

      if (!UsageStatsModule || !UsageStatsModule.getInstalledMonitoredApps) {
        console.warn('UsageStatsModule not available, returning recommended apps');
        return this.RECOMMENDED_APPS;
      }

      const installedApps = await UsageStatsModule.getInstalledMonitoredApps();
      
      if (!installedApps || installedApps.length === 0) {
        console.warn('No apps returned from native module, using fallback');
        return this.RECOMMENDED_APPS;
      }

      return installedApps;
    } catch (error) {
      console.error('Error getting installed apps:', error);
      return this.RECOMMENDED_APPS;
    }
  }

  static async getUsageSince(startTimeMs: number): Promise<UsageData[]> {
    try {
      if (Platform.OS !== 'android') {
        console.warn('Usage data only supported on Android');
        return [];
      }

      if (!UsageStatsModule || !UsageStatsModule.getUsageSince) {
        console.warn('UsageStatsModule not available');
        return [];
      }

      const usageData = await UsageStatsModule.getUsageSince(startTimeMs);
      return usageData || [];
    } catch (error) {
      console.error('Error getting usage data:', error);
      return [];
    }
  }

  static async getTodayUsage(): Promise<UsageData[]> {
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      return this.getUsageSince(startOfDay.getTime());
    } catch (error) {
      console.error('Error getting today usage:', error);
      return [];
    }
  }

  // Enhanced methods for realtime monitoring
  static async startRealtimeAppDetection(): Promise<boolean> {
    try {
      if (Platform.OS !== 'android' || !UsageStatsModule) {
        console.warn('Realtime app detection only supported on Android');
        return false;
      }

      const hasPermission = await this.isUsageAccessGranted();
      if (!hasPermission) {
        console.warn('Usage permission required for realtime detection');
        return false;
      }

      await UsageStatsModule.startRealtimeAppDetection();
      console.log('Started realtime app detection');
      return true;
    } catch (error) {
      console.error('Error starting realtime app detection:', error);
      return false;
    }
  }

  // Check if monitoring is currently active
  static async isMonitoringActive(): Promise<boolean> {
    try {
      const monitoringEnabled = await database.getMeta('monitoring_enabled');
      return monitoringEnabled === 'true';
    } catch (error) {
      console.error('Error checking monitoring status:', error);
      return false;
    }
  }

  static async stopRealtimeAppDetection(): Promise<boolean> {
    try {
      if (Platform.OS !== 'android' || !UsageStatsModule) {
        return false;
      }

      await UsageStatsModule.stopRealtimeAppDetection();
      console.log('Stopped realtime app detection');
      return true;
    } catch (error) {
      console.error('Error stopping realtime app detection:', error);
      return false;
    }
  }

  static async triggerManualUsageCheck(): Promise<void> {
    try {
      if (Platform.OS !== 'android' || !UsageStatsModule) {
        return;
      }

      UsageStatsModule.triggerUsageCheck();
      console.log('Triggered manual usage check');
    } catch (error) {
      console.error('Error triggering usage check:', error);
    }
  }

  // Start comprehensive monitoring (background + realtime)
  static async startComprehensiveMonitoring(): Promise<boolean> {
    try {
      console.log('Starting comprehensive monitoring...');
      
      const hasPermission = await this.isUsageAccessGranted();
      if (!hasPermission) {
        console.warn('Usage permission required for monitoring');
        return false;
      }

      // Start background monitoring with 15-minute intervals
      if (UsageStatsModule.startBackgroundMonitoring) {
        UsageStatsModule.startBackgroundMonitoring(15);
        console.log('Started background monitoring (15min intervals)');
      }

      // Start realtime app detection
      const realtimeStarted = await this.startRealtimeAppDetection();
      
      // Save monitoring state to database
      await database.setMeta('monitoring_enabled', 'true');
      await database.setMeta('monitoring_started_at', Date.now().toString());
      
      console.log(`Comprehensive monitoring started - Background: true, Realtime: ${realtimeStarted}`);
      return true;
    } catch (error) {
      console.error('Error starting comprehensive monitoring:', error);
      return false;
    }
  }

  static async stopComprehensiveMonitoring(): Promise<void> {
    try {
      console.log('Stopping comprehensive monitoring...');

      // Stop background monitoring
      if (UsageStatsModule.stopBackgroundMonitoring) {
        UsageStatsModule.stopBackgroundMonitoring();
      }

      // Stop realtime monitoring
      await this.stopRealtimeAppDetection();

      // Update monitoring state
      await database.setMeta('monitoring_enabled', 'false');
      
      console.log('Comprehensive monitoring stopped');
    } catch (error) {
      console.error('Error stopping comprehensive monitoring:', error);
    }
  }

  static async getWeekUsage(): Promise<UsageData[]> {
    try {
      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - 7);
      startOfWeek.setHours(0, 0, 0, 0);
      return this.getUsageSince(startOfWeek.getTime());
    } catch (error) {
      console.error('Error getting week usage:', error);
      return [];
    }
  }

  static async getMonthUsage(): Promise<UsageData[]> {
    try {
      const startOfMonth = new Date();
      startOfMonth.setDate(startOfMonth.getDate() - 30);
      startOfMonth.setHours(0, 0, 0, 0);
      return this.getUsageSince(startOfMonth.getTime());
    } catch (error) {
      console.error('Error getting month usage:', error);
      return [];
    }
  }

  static async isAppInstalled(packageName: string): Promise<boolean> {
    try {
      const installedApps = await this.getInstalledApps();
      return installedApps.some(app => app.packageName === packageName);
    } catch (error) {
      console.error('Error checking if app is installed:', error);
      return false;
    }
  }

  static async getAppUsage(packageName: string, startTimeMs: number): Promise<number> {
    try {
      const usageData = await this.getUsageSince(startTimeMs);
      const appUsage = usageData.find(usage => usage.packageName === packageName);
      return appUsage?.totalTimeMs || 0;
    } catch (error) {
      console.error('Error getting app usage:', error);
      return 0;
    }
  }

  static async getTotalScreenTime(startTimeMs: number): Promise<number> {
    try {
      const usageData = await this.getUsageSince(startTimeMs);
      return usageData.reduce((total, usage) => total + usage.totalTimeMs, 0);
    } catch (error) {
      console.error('Error getting total screen time:', error);
      return 0;
    }
  }

  static async getMostUsedApps(startTimeMs: number, limit: number = 5): Promise<UsageData[]> {
    try {
      const usageData = await this.getUsageSince(startTimeMs);
      return usageData
        .filter(usage => usage.totalTimeMs > 0)
        .sort((a, b) => b.totalTimeMs - a.totalTimeMs)
        .slice(0, limit);
    } catch (error) {
      console.error('Error getting most used apps:', error);
      return [];
    }
  }

  static isNativeModuleAvailable(): boolean {
    return Platform.OS === 'android' && !!UsageStatsModule && !!UsageStatsModule.isUsageAccessGranted;
  }

  static getAppDisplayName(packageName: string): string {
    const knownApp = this.RECOMMENDED_APPS.find(app => app.packageName === packageName);
    if (knownApp) {
      return knownApp.appName;
    }

    const parts = packageName.split('.');
    const lastPart = parts[parts.length - 1];
    return lastPart.charAt(0).toUpperCase() + lastPart.slice(1);
  }

  static async validatePermissions(): Promise<{ hasAccess: boolean; message: string }> {
    try {
      if (Platform.OS !== 'android') {
        return {
          hasAccess: false,
          message: 'Usage tracking is only supported on Android devices'
        };
      }

      if (!this.isNativeModuleAvailable()) {
        return {
          hasAccess: false,
          message: 'Usage tracking module is not properly configured'
        };
      }

      const hasAccess = await this.isUsageAccessGranted();
      return {
        hasAccess,
        message: hasAccess 
          ? 'Usage access granted' 
          : 'Usage access permission is required for tracking app usage'
      };
    } catch (error) {
      return {
        hasAccess: false,
        message: `Permission check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  // Method to reset daily tracking (called at midnight)
  static async resetDailyTracking(): Promise<void> {
    try {
      // This would typically be handled by the native module and background workers
      // but we can use it to clear any local state if needed
      console.log('Daily tracking reset requested');
      
      // Trigger the native module's reset if available
      if (this.isNativeModuleAvailable() && UsageStatsModule.resetDailyTracking) {
        UsageStatsModule.resetDailyTracking();
      }
      
      // Save the reset timestamp
      await database.setMeta('last_daily_reset', Date.now().toString());
      
    } catch (error) {
      console.error('Error resetting daily tracking:', error);
    }
  }

  static async getManufacturerInfo(): Promise<{
    manufacturer: string;
    needsSpecialPermission: boolean;
    title: string;
    instructions: string;
    canOpenDirectly: boolean;
  } | null> {
    try {
      if (Platform.OS !== 'android' || !UsageStatsModule) {
        return null;
      }
      
      return await UsageStatsModule.getManufacturerInfo();
    } catch (error) {
      console.error('Error getting manufacturer info:', error);
      return null;
    }
  }
  
  static async needsSpecialPermission(): Promise<boolean> {
    try {
      if (Platform.OS !== 'android' || !UsageStatsModule) {
        return false;
      }
      
      return await UsageStatsModule.needsSpecialPermission();
    } catch (error) {
      console.error('Error checking special permission:', error);
      return false;
    }
  }
  
  static async openManufacturerSettings(): Promise<boolean> {
    try {
      if (Platform.OS !== 'android' || !UsageStatsModule) {
        return false;
      }
      
      return await UsageStatsModule.openManufacturerSettings();
    } catch (error) {
      console.error('Error opening manufacturer settings:', error);
      return false;
    }
  }
  
  static async requestBatteryOptimizationExemption(): Promise<boolean> {
    try {
      if (Platform.OS !== 'android' || !UsageStatsModule) {
        return false;
      }
      
      return await UsageStatsModule.requestBatteryOptimizationExemption();
    } catch (error) {
      console.error('Error requesting battery exemption:', error);
      return false;
    }
  }

  static async hasOverlayPermission(): Promise<boolean> {
    try {
      if (Platform.OS !== 'android' || !UsageStatsModule) {
        return false;
      }
      
      return await UsageStatsModule.hasOverlayPermission();
    } catch (error) {
      console.error('Error checking overlay permission:', error);
      return false;
    }
  }
  
  static async requestOverlayPermission(): Promise<void> {
    try {
      if (Platform.OS !== 'android' || !UsageStatsModule) {
        return;
      }
      
      await UsageStatsModule.requestOverlayPermission();
    } catch (error) {
      console.error('Error requesting overlay permission:', error);
      throw error;
    }
  }
  
  static async startFloatingScore(
    appName: string,
    initialScore: number,
    timeMs: number
  ): Promise<boolean> {
    try {
      if (Platform.OS !== 'android' || !UsageStatsModule) {
        return false;
      }
      
      return await UsageStatsModule.startFloatingScore(appName, initialScore, timeMs);
    } catch (error) {
      console.error('Error starting floating score:', error);
      return false;
    }
  }
  
  static async updateFloatingScore(
    score: number,
    appName: string,
    timeMs: number
  ): Promise<void> {
    try {
      if (Platform.OS !== 'android' || !UsageStatsModule) {
        return;
      }
      
      UsageStatsModule.updateFloatingScore(score, appName, timeMs);
    } catch (error) {
      console.error('Error updating floating score:', error);
    }
  }
  
  static async stopFloatingScore(): Promise<boolean> {
    try {
      if (Platform.OS !== 'android' || !UsageStatsModule) {
        return false;
      }
      
      return await UsageStatsModule.stopFloatingScore();
    } catch (error) {
      console.error('Error stopping floating score:', error);
      return false;
    }
  }
}