import { NativeModules, Platform } from 'react-native';

const { UsageStatsModule } = NativeModules;

interface InstalledApp {
  packageName: string;
  appName: string;
  isRecommended: boolean;
}

interface UsageData {
  packageName: string;
  appName: string;
  totalTimeMs: number;
  lastTimeUsed: number;
}

export class UsageService {
  // Default recommended apps for fallback
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

      if (UsageStatsModule.forceRefreshPermission) {
        return await UsageStatsModule.forceRefreshPermission();
      } else {
        // Fallback: just check permission again after a short delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        return await this.isUsageAccessGranted();
      }
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

  // Helper method to check if specific app is installed
  static async isAppInstalled(packageName: string): Promise<boolean> {
    try {
      const installedApps = await this.getInstalledApps();
      return installedApps.some(app => app.packageName === packageName);
    } catch (error) {
      console.error('Error checking if app is installed:', error);
      return false;
    }
  }

  // Get usage for specific app
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

  // Get total screen time for a period
  static async getTotalScreenTime(startTimeMs: number): Promise<number> {
    try {
      const usageData = await this.getUsageSince(startTimeMs);
      return usageData.reduce((total, usage) => total + usage.totalTimeMs, 0);
    } catch (error) {
      console.error('Error getting total screen time:', error);
      return 0;
    }
  }

  // Get most used apps for a period
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

  // Check if native module is properly connected
  static isNativeModuleAvailable(): boolean {
    return Platform.OS === 'android' && !!UsageStatsModule && !!UsageStatsModule.isUsageAccessGranted;
  }

  // Get human readable app name from package name
  static getAppDisplayName(packageName: string): string {
    const knownApp = this.RECOMMENDED_APPS.find(app => app.packageName === packageName);
    if (knownApp) {
      return knownApp.appName;
    }

    // Try to extract a readable name from package name
    const parts = packageName.split('.');
    const lastPart = parts[parts.length - 1];
    return lastPart.charAt(0).toUpperCase() + lastPart.slice(1);
  }

  // Validate that we have proper permissions
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
        message: `Permission check failed: ${error.message}`
      };
    }
  }
}