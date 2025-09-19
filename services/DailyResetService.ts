import { UsageMonitoringService } from './UsageMonitoringService';
import { database } from './database';

export class DailyResetService {
  private static instance: DailyResetService;
  private resetTimer?: ReturnType<typeof setTimeout>;

  static getInstance(): DailyResetService {
    if (!this.instance) {
      this.instance = new DailyResetService();
    }
    return this.instance;
  }

  initialize(): void {
    this.scheduleNextReset();
  }

  private scheduleNextReset(): void {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0); // Midnight

    const msUntilMidnight = tomorrow.getTime() - now.getTime();

    this.resetTimer = setTimeout(() => {
      this.performDailyReset();
      this.scheduleNextReset(); // Schedule next reset
    }, msUntilMidnight);

    console.log(`Next daily reset scheduled in ${Math.round(msUntilMidnight / (1000 * 60))} minutes`);
  }

  private async performDailyReset(): Promise<void> {
    try {
      console.log('Performing daily reset...');
      
      // Reset monitoring service tracking
      const monitoringService = UsageMonitoringService.getInstance();
      await monitoringService.resetDailyTracking();
      
      // Store last reset date
      await database.setMeta('last_daily_reset', new Date().toISOString());
      
      console.log('Daily reset completed');
    } catch (error) {
      console.error('Error during daily reset:', error);
    }
  }

  cleanup(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = undefined;
    }
  }
}
