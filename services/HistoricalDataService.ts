import { calculateBrainScore } from '../utils/brainScore';
import { database } from './database';

export class HistoricalDataService {
  private static instance: HistoricalDataService;
  
  static getInstance(): HistoricalDataService {
    if (!this.instance) {
      this.instance = new HistoricalDataService();
    }
    return this.instance;
  }

  async rebuildSummaryForDate(
    dateStr: string,
    options: { force?: boolean } = {}
  ): Promise<boolean> {
    try {
      const { force = false } = options;
      console.log(`Rebuilding daily summary for ${dateStr}`);

      if (!force) {
        const existingSummary = await database.getDailySummary(dateStr);
        if (existingSummary) {
          return true;
        }
      }

      const monitoredPackages = await database.getMonitoredPackages();
      const rawUsage = await database.getDailyUsage(dateStr);

      if (rawUsage.length === 0) {
        console.log(`No raw usage data for ${dateStr}, skipping summary rebuild`);
        return false;
      }

      const monitoredSet = new Set(monitoredPackages);
      monitoredSet.delete('com.soumikganguly.brainrot');
      const monitoredUsage = (monitoredSet.size === 0
        ? rawUsage.filter(app => app.packageName !== 'com.soumikganguly.brainrot')
        : rawUsage.filter(app => monitoredSet.has(app.packageName))
      ).map(app => ({
        packageName: app.packageName,
        appName: app.appName,
        totalTimeMs: app.totalTimeMs,
        date: dateStr,
      }));
      const totalScreenTime = monitoredUsage.reduce((sum, app) => sum + app.totalTimeMs, 0);
      const brainScore = calculateBrainScore(totalScreenTime);

      const summary = {
        date: dateStr,
        totalScreenTime,
        brainScore,
        apps: monitoredUsage
      };

      await database.saveDailySummary(dateStr, summary);
      return true;
    } catch (error) {
      console.error(`Error rebuilding summary for ${dateStr}:`, error);
      return false;
    }
  }

  async saveTodaySummary(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    await this.rebuildSummaryForDate(today);
  }

  async backfillHistoricalData(days: number = 30): Promise<void> {
    console.log(`Starting backfill for last ${days} days...`);
    let summariesCreated = 0;
    let summariesSkipped = 0;
    let errors = 0;

    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      try {
        const existingSummary = await database.getDailySummary(dateStr);
        if (existingSummary) {
          summariesSkipped++;
          continue;
        }

        const rebuilt = await this.rebuildSummaryForDate(dateStr, { force: true });
        if (rebuilt) {
          summariesCreated++;
        }
      } catch (error) {
        console.error(`Error backfilling ${dateStr}:`, error);
        errors++;
      }
    }
    
    console.log(`Backfill completed: ${summariesCreated} created, ${summariesSkipped} skipped, ${errors} errors`);
  }

  // Method to force refresh a specific date's summary
  async refreshDailySummary(dateStr: string): Promise<boolean> {
    try {
      return await this.rebuildSummaryForDate(dateStr, { force: true });
    } catch (error) {
      console.error(`Error refreshing summary for ${dateStr}:`, error);
      return false;
    }
  }

  // Get summary stats for a date range
  async getSummaryStats(days: number = 7): Promise<{
    averageScreenTime: number;
    averageBrainScore: number;
    bestDay: { date: string; score: number };
    worstDay: { date: string; score: number };
    totalDays: number;
    improving: boolean;
  }> {
    try {
      const historicalData = await database.getHistoricalData(days);
      
      if (historicalData.length === 0) {
        return {
          averageScreenTime: 0,
          averageBrainScore: 100,
          bestDay: { date: '', score: 100 },
          worstDay: { date: '', score: 100 },
          totalDays: 0,
          improving: false
        };
      }

      const totalScreenTime = historicalData.reduce((sum, day) => sum + day.totalScreenTime, 0);
      const totalBrainScore = historicalData.reduce((sum, day) => sum + day.brainScore, 0);
      
      const averageScreenTime = totalScreenTime / historicalData.length;
      const averageBrainScore = totalBrainScore / historicalData.length;
      
      const bestDay = historicalData.reduce((best, current) => 
        current.brainScore > best.brainScore ? current : best
      );
      
      const worstDay = historicalData.reduce((worst, current) => 
        current.brainScore < worst.brainScore ? current : worst
      );
      
      // Check if improving (compare first half vs second half of period)
      const midpoint = Math.floor(historicalData.length / 2);
      const firstHalf = historicalData.slice(0, midpoint);
      const secondHalf = historicalData.slice(midpoint);
      
      const firstHalfAvgScore = firstHalf.reduce((sum, day) => sum + day.brainScore, 0) / firstHalf.length;
      const secondHalfAvgScore = secondHalf.reduce((sum, day) => sum + day.brainScore, 0) / secondHalf.length;
      
      const improving = secondHalfAvgScore > firstHalfAvgScore;
      
      return {
        averageScreenTime: Math.round(averageScreenTime),
        averageBrainScore: Math.round(averageBrainScore),
        bestDay: { date: bestDay.date, score: bestDay.brainScore },
        worstDay: { date: worstDay.date, score: worstDay.brainScore },
        totalDays: historicalData.length,
        improving
      };
      
    } catch (error) {
      console.error('Error getting summary stats:', error);
      return {
        averageScreenTime: 0,
        averageBrainScore: 100,
        bestDay: { date: '', score: 100 },
        worstDay: { date: '', score: 100 },
        totalDays: 0,
        improving: false
      };
    }
  }

  // Clean up old historical data beyond a certain number of days
  async cleanupOldData(keepDays: number = 365): Promise<void> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - keepDays);
      const cutoffDateStr = cutoffDate.toISOString().split('T')[0];
      
      console.log(`Cleaning up data older than ${cutoffDateStr}`);
      
      // This would need to be implemented in your database service
      // For now, just log what would be cleaned
      const oldData = await database.getHistoricalData(keepDays + 30);
      const oldEntries = oldData.filter(entry => entry.date < cutoffDateStr);
      
      console.log(`Found ${oldEntries.length} entries that could be cleaned up`);
      
      // Note: You'd implement actual cleanup in database service
      // database.deleteDataOlderThan(cutoffDateStr);
      
    } catch (error) {
      console.error('Error cleaning up old data:', error);
    }
  }
}
