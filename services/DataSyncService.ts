import { BrainScoreService } from './BrainScore';
import { HistoricalDataService } from './HistoricalDataService';
import { UsageService } from './UsageService';
import { TelemetryService } from './TelemetryService';
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
        this.trackBlockTelemetry(blockEventRows);
      }

      await HistoricalDataService.getInstance().rebuildSummaryForDate(today, { force: true });
      const summary = await database.getDailySummary(today);
      await UsageService.syncDailySummaryToNative(summary);
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

  private trackBlockTelemetry(events: BlockEvent[]): void {
    const today = new Date().toISOString().split('T')[0];
    const bypassCounts = new Map<string, number>();

    for (const event of events) {
      const messageType = event.blockType === 'hard_block' ? 'hard' : 'soft';
      const pauseProps = {
        app_name: event.appName,
        daily_usage_ms: event.usageAtTriggerMs ?? undefined,
        limit_strength: event.limitMs != null ? String(Math.round(event.limitMs / 60000)) : undefined,
        message_type: messageType,
      } as const;

      if (event.action === 'blocked') {
        if (messageType === 'hard') {
          TelemetryService.track('lock_screen_shown', pauseProps);
        } else {
          TelemetryService.track('pause_screen_shown', pauseProps);
        }
        continue;
      }

      if (event.action === 'cooldown_started') {
        TelemetryService.track('pause_screen_countdown_completed', pauseProps);
        TelemetryService.track('pause_screen_continue_clicked', pauseProps);
        continue;
      }

      if (event.action === 'abandoned') {
        TelemetryService.track('pause_screen_exit_clicked', pauseProps);
        continue;
      }

      if (event.action === 'bypassed') {
        const nextCount = (bypassCounts.get(event.packageName) || 0) + 1;
        bypassCounts.set(event.packageName, nextCount);
        TelemetryService.track('emergency_pass_used', {
          app_name: event.appName,
          pass_count_remaining: Math.max(0, 2 - nextCount),
        });
        if (nextCount >= 2 && event.date === today) {
          TelemetryService.track('emergency_passes_exhausted', {
            app_name: event.appName,
            pass_count_remaining: 0,
          });
        }
      }
    }
  }
}
