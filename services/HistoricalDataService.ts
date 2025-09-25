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

  // Save today's monitored summary at end of day
  async saveTodaySummary(): Promise<void> {
    try {
      const today = new Date().toISOString().split('T')[0];
      console.log(`Saving daily summary for ${today}`);
      
      // Check if summary already exists
      const existingSummary = await database.getDailySummary(today);
      if (existingSummary) {
        console.log('Daily summary already exists for', today);
        return;
      }

      // Get monitored apps from app_settings first, then fallback to meta
      let monitoredPackages: string[] = [];
      
      try {
        const appSettings = await database.getAppSettings();
        const monitoredFromSettings = appSettings
          .filter(setting => setting.monitored)
          .map(setting => setting.packageName);
        
        if (monitoredFromSettings.length > 0) {
          monitoredPackages = monitoredFromSettings;
          console.log(`Using ${monitoredPackages.length} monitored apps from app_settings`);
        }
      } catch  {
        console.log('Could not load from app_settings, trying meta');
      }
      
      // Fallback to meta if app_settings is empty
      if (monitoredPackages.length === 0) {
        try {
          const monitoredMeta = await database.getMeta('monitored_apps');
          monitoredPackages = monitoredMeta ? JSON.parse(monitoredMeta) : [];
          console.log(`Using ${monitoredPackages.length} monitored apps from meta`);
        } catch  {
          console.log('Could not load monitored apps from meta either');
        }
      }
      
      if (monitoredPackages.length === 0) {
        console.log('No monitored apps found, skipping summary save');
        return;
      }

      // Get today's raw usage data
      const todayRawUsage = await database.getDailyUsage(today);
      console.log(`Found ${todayRawUsage.length} raw usage entries for ${today}`);
      
      // Filter to monitored apps only and exclude the app itself
      const monitoredSet = new Set(monitoredPackages);
      monitoredSet.delete('com.soumikganguly.brainrot');
      
      const monitoredUsage = todayRawUsage.filter(app => 
        monitoredSet.has(app.packageName)
      );

      console.log(`Filtered to ${monitoredUsage.length} monitored app entries`);

      const totalScreenTime = monitoredUsage.reduce((sum, app) => sum + app.totalTimeMs, 0);
      const brainScore = calculateBrainScore(totalScreenTime);

      const summary = {
        date: today,
        totalScreenTime,
        brainScore,
        apps: monitoredUsage.map(app => ({
          packageName: app.packageName,
          appName: app.appName,
          totalTimeMs: app.totalTimeMs,
          date: today // Fix: Ensure date is set correctly
        }))
      };

      await database.saveDailySummary(today, summary);
      console.log(`Saved daily summary for ${today}: ${Math.round(totalScreenTime/60000)}min, score ${brainScore}`);
      
    } catch (error) {
      console.error('Error saving daily summary:', error);
    }
  }

  // Backfill missing historical summaries
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
        // Check if summary exists
        const existingSummary = await database.getDailySummary(dateStr);
        if (existingSummary) {
          summariesSkipped++;
          continue;
        }

        // Get raw data for this date
        const rawUsage = await database.getDailyUsage(dateStr);
        if (rawUsage.length === 0) {
          console.log(`No raw usage data for ${dateStr}, skipping`);
          continue;
        }

        // Get monitored apps (current list - limitation of backfill)
        let monitoredPackages: string[] = [];
        
        // Try app_settings first
        try {
          const appSettings = await database.getAppSettings();
          const monitoredFromSettings = appSettings
            .filter(setting => setting.monitored)
            .map(setting => setting.packageName);
          
          if (monitoredFromSettings.length > 0) {
            monitoredPackages = monitoredFromSettings;
          }
        } catch  {
          console.log(`Could not load app_settings for ${dateStr}`);
        }
        
        // Fallback to meta
        if (monitoredPackages.length === 0) {
          try {
            const monitoredMeta = await database.getMeta('monitored_apps');
            monitoredPackages = monitoredMeta ? JSON.parse(monitoredMeta) : [];
          } catch  {
            console.log(`Could not load meta for ${dateStr}`);
          }
        }
        
        if (monitoredPackages.length === 0) {
          console.log(`No monitored apps found for ${dateStr}, skipping`);
          continue;
        }

        const monitoredSet = new Set(monitoredPackages);
        monitoredSet.delete('com.soumikganguly.brainrot');

        const monitoredUsage = rawUsage.filter(app => 
          monitoredSet.has(app.packageName)
        );

        if (monitoredUsage.length === 0) {
          console.log(`No monitored app usage for ${dateStr}, skipping`);
          continue;
        }

        const totalScreenTime = monitoredUsage.reduce((sum, app) => sum + app.totalTimeMs, 0);
        const brainScore = calculateBrainScore(totalScreenTime);

        const summary = {
          date: dateStr,
          totalScreenTime,
          brainScore,
          apps: monitoredUsage.map(app => ({
            packageName: app.packageName,
            appName: app.appName,
            totalTimeMs: app.totalTimeMs,
            date: dateStr // Fix: Use the correct date for each entry
          }))
        };

        await database.saveDailySummary(dateStr, summary);
        summariesCreated++;
        console.log(`Backfilled summary for ${dateStr} - ${Math.round(totalScreenTime/60000)}min, score ${brainScore}`);
        
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
      console.log(`Force refreshing summary for ${dateStr}`);
      
      // Delete existing summary if it exists
      await database.setMeta(`daily_summary_${dateStr}`, ''); // Clear it
      
      // Get current date for reference
      const currentDateStr = new Date().toISOString().split('T')[0];
      
      if (dateStr === currentDateStr) {
        // For today, use the standard save method
        await this.saveTodaySummary();
      } else {
        // For past dates, use backfill logic for that specific date
        const rawUsage = await database.getDailyUsage(dateStr);
        
        if (rawUsage.length === 0) {
          console.log(`No raw usage data for ${dateStr}`);
          return false;
        }

        // Get current monitored apps
        let monitoredPackages: string[] = [];
        
        try {
          const appSettings = await database.getAppSettings();
          const monitoredFromSettings = appSettings
            .filter(setting => setting.monitored)
            .map(setting => setting.packageName);
          
          if (monitoredFromSettings.length > 0) {
            monitoredPackages = monitoredFromSettings;
          }
        } catch {
          const monitoredMeta = await database.getMeta('monitored_apps');
          monitoredPackages = monitoredMeta ? JSON.parse(monitoredMeta) : [];
        }

        const monitoredSet = new Set(monitoredPackages);
        monitoredSet.delete('com.soumikganguly.brainrot');

        const monitoredUsage = rawUsage.filter(app => 
          monitoredSet.has(app.packageName)
        );

        const totalScreenTime = monitoredUsage.reduce((sum, app) => sum + app.totalTimeMs, 0);
        const brainScore = calculateBrainScore(totalScreenTime);

        const summary = {
          date: dateStr,
          totalScreenTime,
          brainScore,
          apps: monitoredUsage.map(app => ({
            packageName: app.packageName,
            appName: app.appName,
            totalTimeMs: app.totalTimeMs,
            date: dateStr
          }))
        };

        await database.saveDailySummary(dateStr, summary);
      }
      
      console.log(`Successfully refreshed summary for ${dateStr}`);
      return true;
      
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