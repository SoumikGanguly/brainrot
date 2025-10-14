import { calculateBrainScore } from '../utils/brainScore';
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
      // 1. Fetch raw usage from native
      const rawUsage = await UsageService.getTodayUsage();
      
      // 2. Get monitored apps list
      const monitoredMeta = await database.getMeta('monitored_apps');
      const monitoredPackages: string[] = monitoredMeta ? JSON.parse(monitoredMeta) : [];
      
      // 3. Process and deduplicate
      const deduped = this.deduplicateUsage(rawUsage);
      
      // 4. Get today's date
      const today = new Date().toISOString().split('T')[0];
      
      // 5. Convert to database format (add date property)
      const dbFormatted: DatabaseUsageData[] = deduped.map(app => ({
        packageName: app.packageName,
        appName: app.appName,
        totalTimeMs: app.totalTimeMs,
        date: today
      }));
      
      // 6. Save raw data (for calendar/backups)
      await database.saveDailyUsage(today, dbFormatted);
      
      // 7. Compute monitored-only summary
      const monitoredOnly = dbFormatted.filter(app => 
        monitoredPackages.includes(app.packageName) && 
        app.packageName !== 'com.soumikganguly.brainrot'
      );
      
      const totalMs = monitoredOnly.reduce((sum, app) => sum + app.totalTimeMs, 0);
      const score = calculateBrainScore(totalMs);
      
      // 8. Save summary
      await database.saveDailySummary(today, {
        date: today,
        totalScreenTime: totalMs,
        brainScore: score,
        apps: monitoredOnly
      });
      
      console.log(`Synced: ${dbFormatted.length} total, ${monitoredOnly.length} monitored`);
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