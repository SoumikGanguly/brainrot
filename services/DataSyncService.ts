import { BrainScoreService } from './BrainScore';
import { HistoricalDataService } from './HistoricalDataService';
import { UsageService } from './UsageService';
import { database, UsageData as DatabaseUsageData } from './database';

// Define the type from UsageService (without date)
interface NativeUsageData {
  packageName: string;
  appName: string;
  totalTimeMs: number;
  lastTimeUsed: number;
}

export class DataSyncService {
  private static instance: DataSyncService;
  
  static getInstance(): DataSyncService {
    if (!this.instance) {
      this.instance = new DataSyncService();
    }
    return this.instance;
  }
  
  async syncUsageData(): Promise<void> {
    try {
      const rawUsage = await UsageService.getTodayUsage();
      const deduped = this.deduplicateUsage(rawUsage);
      const today = new Date().toISOString().split('T')[0];
      const dbFormatted: DatabaseUsageData[] = deduped.map(app => ({
        packageName: app.packageName,
        appName: app.appName,
        totalTimeMs: app.totalTimeMs,
        date: today
      }));

      await database.saveDailyUsage(today, dbFormatted);

      await HistoricalDataService.getInstance().rebuildSummaryForDate(today, { force: true });
      BrainScoreService.getInstance().invalidateCache(today);

      console.log(`Synced ${dbFormatted.length} total app entries for ${today}`);
    } catch (error) {
      console.error('Error syncing usage data:', error);
    }
  }
  
  private deduplicateUsage(usage: NativeUsageData[]): NativeUsageData[] {
    const map = new Map<string, NativeUsageData>();
    
    for (const app of usage) {
      const existing = map.get(app.packageName);
      if (!existing || app.totalTimeMs > existing.totalTimeMs) {
        map.set(app.packageName, app);
      }
    }
    
    return Array.from(map.values());
  }
}
