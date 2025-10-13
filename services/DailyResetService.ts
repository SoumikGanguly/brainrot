import { AppBlockingService } from './AppBlockingService';
import { HistoricalDataService } from './HistoricalDataService';
import { UsageMonitoringService } from './UsageMonitoringService';
import { UsageService } from './UsageService';
import { database } from './database';

export class DailyResetService {
  private static instance: DailyResetService;
  private resetTimer?: ReturnType<typeof setTimeout>;
  private isInitialized = false;

  static getInstance(): DailyResetService {
    if (!this.instance) {
      this.instance = new DailyResetService();
    }
    return this.instance;
  }

  initialize(): void {
    if (this.isInitialized) {
      console.log('DailyResetService already initialized');
      return;
    }

    console.log('Initializing DailyResetService...');
    
    // Check if we missed a reset (app was closed overnight)
    this.checkMissedReset();
    
    // Schedule the next reset
    this.scheduleNextReset();
    
    this.isInitialized = true;
    console.log('DailyResetService initialized');
  }

  private async checkMissedReset(): Promise<void> {
    try {
      const lastResetStr = await database.getMeta('last_daily_reset');
      if (!lastResetStr) {
        console.log('No previous reset found, this might be first run');
        return;
      }

      const lastReset = new Date(lastResetStr);
      const now = new Date();
      
      // Check if the last reset was yesterday or earlier
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const lastResetDate = new Date(lastReset.getFullYear(), lastReset.getMonth(), lastReset.getDate());
      
      if (lastResetDate < today) {
        console.log('Detected missed daily reset, performing now...');
        await this.performDailyReset();
      }
    } catch (error) {
      console.error('Error checking for missed reset:', error);
    }
  }

  private scheduleNextReset(): void {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0); // Midnight

    const msUntilMidnight = tomorrow.getTime() - now.getTime();

    // Clear any existing timer
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }

    this.resetTimer = setTimeout(() => {
      this.performDailyReset();
      this.scheduleNextReset(); // Schedule next reset
    }, msUntilMidnight);

    console.log(`Next daily reset scheduled in ${Math.round(msUntilMidnight / (1000 * 60))} minutes (at ${tomorrow.toLocaleTimeString()})`);
  }

  private async performDailyReset(): Promise<void> {
    try {
      console.log('=== PERFORMING DAILY RESET ===');
      const resetStartTime = Date.now();
      
      // Step 1: Save yesterday's summary before resetting
      console.log('Step 1: Saving yesterday\'s summary...');
      const historicalService = HistoricalDataService.getInstance();
      await historicalService.saveTodaySummary();
      
      // Step 2: Reset monitoring service tracking
      console.log('Step 2: Resetting monitoring service...');
      const monitoringService = UsageMonitoringService.getInstance();
      await monitoringService.resetDailyTracking();
      
      // Step 3: Reset native module daily tracking if available
      console.log('Step 3: Resetting native tracking...');
      try {
        await UsageService.resetDailyTracking();
      } catch (error) {
        console.log('Native daily reset not available or failed:', error);
      }
      
      // Step 4: Clean up old notification history (keep last 30 days)
      console.log('Step 4: Cleaning up old data...');
      await this.cleanupOldData();
      
      // Step 5: Refresh monitored apps in case settings changed
      console.log('Step 5: Refreshing monitored apps...');
      await monitoringService.refreshMonitoredApps();

      //Step 6: Reset app blocking limits
      console.log('Step 6: Resetting app blocking limits...');
      try {
        const blockingService = AppBlockingService.getInstance();
        await blockingService.resetDailyLimits();
      } catch (error) {
        console.log('App blocking reset failed:', error);
      }
      
      // Step 7: Store reset timestamp and stats
      const resetEndTime = Date.now();
      const resetDuration = resetEndTime - resetStartTime;
      
      await database.setMeta('last_daily_reset', new Date().toISOString());
      await database.setMeta('last_reset_duration_ms', resetDuration.toString());
      
      // Step 7: Increment reset counter for analytics
      const resetCountStr = await database.getMeta('daily_reset_count') || '0';
      const resetCount = parseInt(resetCountStr) + 1;
      await database.setMeta('daily_reset_count', resetCount.toString());
      
      console.log(`=== DAILY RESET COMPLETED in ${resetDuration}ms (Reset #${resetCount}) ===`);
      
      // Step 8: Trigger a fresh monitoring check after reset
      setTimeout(async () => {
        try {
          await monitoringService.triggerManualCheck();
          console.log('Post-reset monitoring check completed');
        } catch (error) {
          console.error('Error in post-reset monitoring check:', error);
        }
      }, 5000);
      
    } catch (error) {
      console.error('Error during daily reset:', error);
      
      // Store error info for debugging
      await database.setMeta('last_reset_error', JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }));
    }
  }

  private async cleanupOldData(): Promise<void> {
    try {
      // Clean up notification history older than 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const cutoffDate = thirtyDaysAgo.toISOString().split('T')[0];
      
      // Note: You'd need to implement this in your database service
      console.log(`Would clean notification history before ${cutoffDate}`);
      
      // Clean up any temporary metadata
      const tempKeys = [
        'temp_usage_check',
        'temp_monitoring_state',
        'temp_notification_queue'
      ];
      
      for (const key of tempKeys) {
        try {
          await database.setMeta(key, '');
        } catch {
          // Ignore errors cleaning temp data
        }
      }
      
      console.log('Old data cleanup completed');
      
    } catch (error) {
      console.error('Error cleaning up old data:', error);
    }
  }

  // Manual reset trigger (for testing or emergency use)
  async triggerManualReset(): Promise<void> {
    console.log('Manual daily reset triggered');
    await this.performDailyReset();
    
    // Reschedule the automatic reset
    this.scheduleNextReset();
  }

  // Get reset status for debugging
  getResetStatus(): {
    isInitialized: boolean;
    nextResetScheduled: boolean;
    nextResetTime?: Date;
    lastResetTime?: string;
    resetCount?: number;
  } {
    const status = {
      isInitialized: this.isInitialized,
      nextResetScheduled: !!this.resetTimer,
      nextResetTime: undefined as Date | undefined,
      lastResetTime: undefined as string | undefined,
      resetCount: undefined as number | undefined
    };
    
    if (this.resetTimer) {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      status.nextResetTime = tomorrow;
    }
    
    // These would be async calls, but for status we'll return sync
    // In a real implementation, you might want to make this method async
    database.getMeta('last_daily_reset').then(value => {
      status.lastResetTime = value || undefined;
    }).catch(() => {});
    
    database.getMeta('daily_reset_count').then(value => {
      status.resetCount = value ? parseInt(value) : undefined;
    }).catch(() => {});
    
    return status;
  }

  // Check if reset is due (for manual checking)
  async isResetDue(): Promise<boolean> {
    try {
      const lastResetStr = await database.getMeta('last_daily_reset');
      if (!lastResetStr) {
        return true; // No reset ever performed
      }

      const lastReset = new Date(lastResetStr);
      const now = new Date();
      
      // Check if last reset was before today
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const lastResetDate = new Date(lastReset.getFullYear(), lastReset.getMonth(), lastReset.getDate());
      
      return lastResetDate < today;
    } catch (error) {
      console.error('Error checking if reset is due:', error);
      return false;
    }
  }

  // Get time until next reset
  getTimeUntilNextReset(): { hours: number; minutes: number; seconds: number } | null {
    if (!this.resetTimer) {
      return null;
    }

    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const msUntilReset = tomorrow.getTime() - now.getTime();
    
    const hours = Math.floor(msUntilReset / (1000 * 60 * 60));
    const minutes = Math.floor((msUntilReset % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((msUntilReset % (1000 * 60)) / 1000);

    return { hours, minutes, seconds };
  }

  // Force cleanup and reinitialize
  async reinitialize(): Promise<void> {
    console.log('Reinitializing DailyResetService...');
    
    this.cleanup();
    this.isInitialized = false;
    
    // Small delay to ensure cleanup is complete
    setTimeout(() => {
      this.initialize();
    }, 1000);
  }

  cleanup(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = undefined;
    }
    this.isInitialized = false;
    console.log('DailyResetService cleanup completed');
  }
}