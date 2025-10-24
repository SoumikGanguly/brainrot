import * as SQLite from 'expo-sqlite';
import { calculateBrainScore as utilCalculateBrainScore } from '../utils/brainScore';

// Types
export interface UsageData {
  packageName: string;
  appName: string;
  totalTimeMs: number;
  date: string;
}

export interface DailyUsage {
  date: string;
  totalScreenTime: number;
  brainScore: number;
  apps: UsageData[];
}

export interface NotificationSettings {
  enabled: boolean;
  intensity: 'mild' | 'normal' | 'harsh';
  snoozed: boolean;
  snoozeUntil?: number;
}

export interface AppSettings {
  packageName: string;
  appName: string;
  monitored: boolean;
  dailyLimitMs: number;
}

export interface TrialInfo {
  isActive: boolean;
  startDate: number;
  daysRemaining: number;
  expired: boolean;
}

export interface PurchaseInfo {
  isPremium: boolean;
  productId?: string;
  purchaseDate?: number;
}

// Database row interfaces for type safety
interface DailyUsageRow {
  packageName: string;
  appName: string;
  totalMs: number;
  date: string;
}

interface MetaRow {
  value: string;
}

interface DailySummaryRow {
  date: string;
  totalScreenTime: number;
  brainScore: number;
  appsJson: string;
}

interface AppSettingsRow {
  packageName: string;
  appName: string;
  monitored: number;
  dailyLimitMs: number;
}

interface MonitoredAppRow {
  packageName: string;
}

interface RawUsageRow {
  packageName: string;
  appName: string;
  totalMs: number;
}

export class DatabaseService {
  private db: SQLite.SQLiteDatabase;
  private monitoredPackagesCache: { packages: string[]; timestamp: number } | null = null;
  private readonly MONITORED_CACHE_VALIDITY_MS = 300000; // 5 minutes

  constructor() {
    this.db = SQLite.openDatabaseSync('brainrot.db');
    this.initDatabase();
  }

  private initDatabase() {
    // Daily usage tracking with UNIQUE constraint
    this.db.execSync(`
      CREATE TABLE IF NOT EXISTS daily_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        packageName TEXT NOT NULL,
        appName TEXT NOT NULL,
        totalMs INTEGER NOT NULL,
        UNIQUE(date, packageName)
      )
    `);
    
    // CREATE INDEXES for faster queries
    this.db.execSync(`
      CREATE INDEX IF NOT EXISTS idx_daily_usage_date 
      ON daily_usage(date)
    `);
    
    this.db.execSync(`
      CREATE INDEX IF NOT EXISTS idx_daily_usage_package 
      ON daily_usage(packageName)
    `);
    
    this.db.execSync(`
      CREATE INDEX IF NOT EXISTS idx_daily_usage_date_package 
      ON daily_usage(date, packageName)
    `);

    // App settings
    this.db.execSync(`
      CREATE TABLE IF NOT EXISTS app_settings (
        packageName TEXT PRIMARY KEY,
        appName TEXT NOT NULL,
        monitored BOOLEAN DEFAULT 1,
        dailyLimitMs INTEGER DEFAULT 7200000
      )
    `);
    
    // Index for monitored apps lookup (partial index for performance)
    this.db.execSync(`
      CREATE INDEX IF NOT EXISTS idx_app_settings_monitored 
      ON app_settings(monitored) WHERE monitored = 1
    `);

    // Meta data (trial, settings, etc.)
    this.db.execSync(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // Notification history
    this.db.execSync(`
      CREATE TABLE IF NOT EXISTS notification_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        packageName TEXT NOT NULL,
        level TEXT NOT NULL,
        sentAt INTEGER NOT NULL,
        date TEXT NOT NULL
      )
    `);
    
    this.db.execSync(`
      CREATE INDEX IF NOT EXISTS idx_notification_date 
      ON notification_history(date)
    `);

    // Daily summary table with index
    this.db.execSync(`
      CREATE TABLE IF NOT EXISTS daily_summary (
        date TEXT PRIMARY KEY,
        totalScreenTime INTEGER NOT NULL,
        brainScore INTEGER NOT NULL,
        appsJson TEXT NOT NULL
      )
    `);
    
    this.db.execSync(`
      CREATE INDEX IF NOT EXISTS idx_daily_summary_date 
      ON daily_summary(date DESC)
    `);
  }

  async cleanupDuplicateEntries(date?: string): Promise<void> {
    return new Promise((resolve) => {
      try {
        const whereClause = date ? `WHERE date = '${date}'` : '';
        
        // First, log what we're about to clean
        const duplicates = this.db.getAllSync(`
          SELECT packageName, COUNT(*) as count 
          FROM daily_usage 
          ${whereClause}
          GROUP BY packageName, date 
          HAVING COUNT(*) > 1
        `);
        
        if (duplicates && duplicates.length > 0) {
          console.log('Found duplicates to clean:', duplicates);
        }
        
        // Clean duplicates - keep the one with highest totalMs
        this.db.execSync(`
          DELETE FROM daily_usage 
          WHERE rowid NOT IN (
            SELECT rowid FROM (
              SELECT rowid, 
                    ROW_NUMBER() OVER (
                      PARTITION BY date, packageName 
                      ORDER BY totalMs DESC, rowid DESC
                    ) as rn
              FROM daily_usage
              ${whereClause}
            ) ranked 
            WHERE rn = 1
          )
        `);
        
        console.log('Database duplicates cleaned');
        resolve();
      } catch (error) {
        console.error('Error cleaning duplicates:', error);
        resolve();
      }
    });
  }

  // OPTIMIZED: Batch save with prepared statement
  async saveDailyUsage(date: string, usageData: UsageData[]): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        if (!usageData || usageData.length === 0) {
          resolve();
          return;
        }

        this.db.withTransactionSync(() => {
          const stmt = this.db.prepareSync(
            `INSERT OR REPLACE INTO daily_usage 
             (date, packageName, appName, totalMs) VALUES (?, ?, ?, ?)`
          );
          
          try {
            for (const data of usageData) {
              stmt.executeSync([date, data.packageName, data.appName, data.totalTimeMs]);
            }
          } finally {
            stmt.finalizeSync();
          }
        });
        
        console.log(`Saved ${usageData.length} usage entries for ${date}`);
        resolve();
      } catch (error) {
        console.error('Error saving daily usage:', error);
        reject(error);
      }
    });
  }

  async getDailyUsage(date: string): Promise<UsageData[]> {
    return new Promise((resolve, reject) => {
      try {
        const result = this.db.getAllSync(
          `SELECT packageName, appName, totalMs, date 
           FROM daily_usage 
           WHERE date = ? 
           ORDER BY totalMs DESC`,
          [date]
        ) as DailyUsageRow[];
        
        const usage: UsageData[] = result.map((row) => ({
          packageName: row.packageName,
          appName: row.appName,
          totalTimeMs: row.totalMs,
          date: row.date
        }));
        
        resolve(usage);
      } catch (error) {
        console.error('Error getting daily usage:', error);
        reject(error);
      }
    });
  }

  // SIMPLIFIED: getHistoricalData - DEPRECATED, use BrainScoreService instead
  // Kept for backward compatibility only
  async getHistoricalData(days: number = 30): Promise<DailyUsage[]> {
    return new Promise((resolve) => {
      try {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = startDate.toISOString().split('T')[0];

        // Get all summaries in the range (optimized with index)
        const summaries = this.db.getAllSync(
          `SELECT date, totalScreenTime, brainScore, appsJson 
           FROM daily_summary 
           WHERE date >= ? 
           ORDER BY date DESC`,
          [startDateStr]
        ) as DailySummaryRow[];

        const results: DailyUsage[] = summaries.map((row) => ({
          date: row.date,
          totalScreenTime: row.totalScreenTime || 0,
          brainScore: row.brainScore || this.calculateBrainScore(row.totalScreenTime || 0),
          apps: JSON.parse(row.appsJson || '[]')
        }));

        resolve(results);
      } catch (error) {
        console.error('Error fetching historical data:', error);
        resolve([]);
      }
    });
  }

  private calculateBrainScore(totalUsageMs: number): number {
    return utilCalculateBrainScore(totalUsageMs);
  }

  async setMeta(key: string, value: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.db.runSync(
          `INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`,
          [key, value]
        );
        resolve();
      } catch (error) {
        console.error('Error setting meta:', error);
        reject(error);
      }
    });
  }

  async getMeta(key: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      try {
        const result = this.db.getFirstSync(
          `SELECT value FROM meta WHERE key = ?`,
          [key]
        ) as MetaRow | null;
        
        resolve(result ? result.value : null);
      } catch (error) {
        console.error('Error getting meta:', error);
        reject(error);
      }
    });
  }

  // OPTIMIZED: Get app settings with index
  async getAppSettings(): Promise<AppSettings[]> {
    return new Promise((resolve, reject) => {
      try {
        const result = this.db.getAllSync(
          `SELECT packageName, appName, monitored, dailyLimitMs 
           FROM app_settings 
           ORDER BY appName`
        ) as AppSettingsRow[];
        
        const settings: AppSettings[] = result.map((row) => ({
          packageName: row.packageName,
          appName: row.appName,
          monitored: Boolean(row.monitored),
          dailyLimitMs: row.dailyLimitMs
        }));
        
        resolve(settings);
      } catch (error) {
        console.error('Error getting app settings:', error);
        reject(error);
      }
    });
  }

  // NEW: Optimized method to get ONLY monitored packages (uses partial index)
  async getMonitoredPackages(): Promise<string[]> {
    return new Promise(async (resolve, reject) => {
      try {
        // Check cache first
        if (this.monitoredPackagesCache && 
            Date.now() - this.monitoredPackagesCache.timestamp < this.MONITORED_CACHE_VALIDITY_MS) {
          resolve(this.monitoredPackagesCache.packages);
          return;
        }

        // Query using partial index (very fast)
        const result = this.db.getAllSync(
          `SELECT packageName FROM app_settings WHERE monitored = 1`
        ) as MonitoredAppRow[];
        
        let packages = result.map(r => r.packageName);

        // Fallback to meta if no app_settings
        if (packages.length === 0) {
          try {
            const meta = await this.getMeta('monitored_apps');
            packages = meta ? JSON.parse(meta) : [];
          } catch (error) {
            console.warn('Failed to parse monitored_apps meta:', error);
            packages = [];
          }
        }

        // Cache the result
        this.monitoredPackagesCache = {
          packages,
          timestamp: Date.now()
        };

        resolve(packages);
      } catch (error) {
        console.error('Error getting monitored packages:', error);
        reject(error);
      }
    });
  }

  // NEW: Clear monitored packages cache (call when settings change)
  clearMonitoredCache(): void {
    this.monitoredPackagesCache = null;
  }

  async updateAppSettings(settings: AppSettings): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.db.runSync(
          `INSERT OR REPLACE INTO app_settings 
           (packageName, appName, monitored, dailyLimitMs) VALUES (?, ?, ?, ?)`,
          [settings.packageName, settings.appName, settings.monitored ? 1 : 0, settings.dailyLimitMs]
        );
        
        // Clear cache when settings change
        this.clearMonitoredCache();
        
        resolve();
      } catch (error) {
        console.error('Error updating app settings:', error);
        reject(error);
      }
    });
  }

  async saveNotificationHistory(packageName: string, level: string, date: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.db.runSync(
          `INSERT INTO notification_history 
           (packageName, level, sentAt, date) VALUES (?, ?, ?, ?)`,
          [packageName, level, Date.now(), date]
        );
        resolve();
      } catch (error) {
        console.error('Error saving notification history:', error);
        reject(error);
      }
    });
  }

  async getNotificationHistory(date: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      try {
        const result = this.db.getAllSync(
          `SELECT * FROM notification_history WHERE date = ? ORDER BY sentAt DESC`,
          [date]
        );
        resolve(result);
      } catch (error) {
        console.error('Error getting notification history:', error);
        reject(error);
      }
    });
  }

  async saveDailySummary(date: string, summary: DailyUsage): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const appsJson = JSON.stringify(summary.apps || []);
        this.db.runSync(
          `INSERT OR REPLACE INTO daily_summary 
           (date, totalScreenTime, brainScore, appsJson) VALUES (?, ?, ?, ?)`,
          [date, summary.totalScreenTime, summary.brainScore, appsJson]
        );
        console.log(`Saved daily summary for ${date}: ${summary.brainScore} score`);
        resolve();
      } catch (error) {
        console.error('Error saving daily summary:', error);
        reject(error);
      }
    });
  }

  // Get monitored-only daily summary (if exists)
  async getDailySummary(date: string): Promise<DailyUsage | null> {
    return new Promise((resolve, reject) => {
      try {
        const row = this.db.getFirstSync(
          `SELECT date, totalScreenTime, brainScore, appsJson 
           FROM daily_summary 
           WHERE date = ?`,
          [date]
        ) as DailySummaryRow | null;
        
        if (!row) {
          resolve(null);
          return;
        }

        const apps = JSON.parse(row.appsJson || '[]');
        resolve({
          date: row.date,
          totalScreenTime: row.totalScreenTime || 0,
          brainScore: row.brainScore || this.calculateBrainScore(row.totalScreenTime || 0),
          apps
        });
      } catch (error) {
        console.error('Error getting daily summary:', error);
        reject(error);
      }
    });
  }

  // OPTIMIZED: Backfill summaries - should be called rarely
  async backfillSummaries(days = 90): Promise<void> {
    return new Promise(async (resolve) => {
      try {
        console.log(`Starting backfill for last ${days} days...`);
        
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = startDate.toISOString().split('T')[0];

        // Get dates that need backfilling (have usage but no summary)
        const datesToBackfill = this.db.getAllSync(
          `SELECT DISTINCT du.date 
           FROM daily_usage du
           LEFT JOIN daily_summary ds ON du.date = ds.date
           WHERE du.date >= ? AND ds.date IS NULL
           ORDER BY du.date ASC`,
          [startDateStr]
        ) as { date: string }[];

        console.log(`Found ${datesToBackfill.length} dates to backfill`);

        // Get monitored packages once
        const monitoredPackages = await this.getMonitoredPackages();
        const monitoredSet = new Set(monitoredPackages);
        monitoredSet.delete('com.soumikganguly.brainrot');

        let backfilled = 0;

        this.db.withTransactionSync(() => {
          const summaryStmt = this.db.prepareSync(
            `INSERT OR REPLACE INTO daily_summary 
             (date, totalScreenTime, brainScore, appsJson) VALUES (?, ?, ?, ?)`
          );

          try {
            for (const d of datesToBackfill) {
              const dateStr = d.date;

              // Get raw usage for the date
              const raw = this.db.getAllSync(
                `SELECT packageName, appName, totalMs 
                 FROM daily_usage 
                 WHERE date = ?`,
                [dateStr]
              ) as RawUsageRow[];

              // Filter to monitored apps
              const filteredApps: UsageData[] = raw
                .filter((r) => monitoredSet.has(r.packageName))
                .map((r) => ({
                  packageName: r.packageName,
                  appName: r.appName,
                  totalTimeMs: r.totalMs,
                  date: dateStr
                }));

              const total = filteredApps.reduce((s, a) => s + (a.totalTimeMs || 0), 0);
              const score = this.calculateBrainScore(total);
              const appsJson = JSON.stringify(filteredApps);

              summaryStmt.executeSync([dateStr, total, score, appsJson]);
              backfilled++;
            }
          } finally {
            summaryStmt.finalizeSync();
          }
        });

        console.log(`Backfill completed: ${backfilled} summaries created`);
        resolve();
      } catch (error) {
        console.error('Error during backfillSummaries:', error);
        resolve();
      }
    });
  }

  // NEW: Vacuum database to reclaim space and optimize (call occasionally)
  async vacuum(): Promise<void> {
    return new Promise((resolve) => {
      try {
        console.log('Vacuuming database...');
        this.db.execSync('VACUUM');
        console.log('Database vacuumed successfully');
        resolve();
      } catch (error) {
        console.error('Error vacuuming database:', error);
        resolve();
      }
    });
  }

  // NEW: Get database stats for debugging
  async getStats(): Promise<{
    dailyUsageCount: number;
    dailySummaryCount: number;
    appSettingsCount: number;
    notificationCount: number;
  }> {
    return new Promise((resolve) => {
      try {
        const dailyUsageCount = this.db.getFirstSync(
          `SELECT COUNT(*) as count FROM daily_usage`
        ) as { count: number };
        
        const dailySummaryCount = this.db.getFirstSync(
          `SELECT COUNT(*) as count FROM daily_summary`
        ) as { count: number };
        
        const appSettingsCount = this.db.getFirstSync(
          `SELECT COUNT(*) as count FROM app_settings`
        ) as { count: number };
        
        const notificationCount = this.db.getFirstSync(
          `SELECT COUNT(*) as count FROM notification_history`
        ) as { count: number };

        resolve({
          dailyUsageCount: dailyUsageCount?.count || 0,
          dailySummaryCount: dailySummaryCount?.count || 0,
          appSettingsCount: appSettingsCount?.count || 0,
          notificationCount: notificationCount?.count || 0
        });
      } catch (error) {
        console.error('Error getting database stats:', error);
        resolve({
          dailyUsageCount: 0,
          dailySummaryCount: 0,
          appSettingsCount: 0,
          notificationCount: 0
        });
      }
    });
  }

  // Helper method to close database connection if needed
  close(): void {
    this.db.closeSync();
  }
}

export const database = new DatabaseService();