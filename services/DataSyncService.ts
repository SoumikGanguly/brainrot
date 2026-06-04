import { BrainScoreService } from './BrainScore';
import { HistoricalDataService } from './HistoricalDataService';
import { UsageService } from './UsageService';
import {
  database,
  type AppSession,
  type BlockEvent,
  type UsageData as DatabaseUsageData,
} from './database';

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
      const sessions = await UsageService.getTodaySessions();
      const pendingBlockEvents = await UsageService.getPendingBlockEvents();
      const deduped = this.deduplicateUsage(rawUsage);
      const today = new Date().toISOString().split('T')[0];
      const dbFormatted: DatabaseUsageData[] = deduped.map(app => ({
        packageName: app.packageName,
        appName: app.appName,
        totalTimeMs: app.totalTimeMs,
        date: today
      }));
      const sessionRows: AppSession[] = sessions.map((session) => ({
        date: session.date || today,
        packageName: session.packageName,
        appName: session.appName,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        durationMs: Math.round(session.durationMs),
        source: session.source || 'usage_events',
        wasMonitored: Boolean(session.wasMonitored),
      }));
      const blockEventRows: BlockEvent[] = pendingBlockEvents.map((event) => ({
        date: event.date || today,
        packageName: event.packageName,
        appName: event.appName,
        triggeredAt: event.triggeredAt,
        blockType: event.blockType,
        limitMs: event.limitMs ?? null,
        usageAtTriggerMs: event.usageAtTriggerMs ?? null,
        action: event.action,
        resolvedAt: event.resolvedAt ?? null,
        source: event.source || 'native_overlay',
      }));

      await database.saveDailyUsage(today, dbFormatted);
      await database.saveAppSessions(sessionRows);
      await database.saveBlockEvents(blockEventRows);
      if (blockEventRows.length > 0) {
        await UsageService.clearPendingBlockEvents();
      }

      await HistoricalDataService.getInstance().rebuildSummaryForDate(today, { force: true });
      BrainScoreService.getInstance().invalidateCache(today);

      console.log(
        `Synced ${dbFormatted.length} usage entries, ${sessionRows.length} sessions, and ${blockEventRows.length} block events for ${today}`
      );
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
