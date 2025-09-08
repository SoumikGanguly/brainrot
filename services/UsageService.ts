import { NativeModules } from 'react-native';

const { UsageStatsModule } = NativeModules;

export class UsageService {
  static async isUsageAccessGranted(): Promise<boolean> {
    try {
      return await UsageStatsModule.isUsageAccessGranted();
    } catch (error) {
      console.error('Error checking usage access:', error);
      return false;
    }
  }

  static async openUsageAccessSettings(): Promise<void> {
    try {
      await UsageStatsModule.openUsageAccessSettings();
    } catch (error) {
      console.error('Error opening usage settings:', error);
    }
  }

  static async getInstalledApps(): Promise<any[]> {
    try {
      return await UsageStatsModule.getInstalledMonitoredApps();
    } catch (error) {
      console.error('Error getting installed apps:', error);
      return [];
    }
  }

  static async getUsageSince(startTimeMs: number): Promise<any[]> {
    try {
      return await UsageStatsModule.getUsageSince(startTimeMs);
    } catch (error) {
      console.error('Error getting usage data:', error);
      return [];
    }
  }

  static async getTodayUsage(): Promise<any[]> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return this.getUsageSince(startOfDay.getTime());
  }
}