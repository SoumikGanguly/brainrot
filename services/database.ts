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

interface UsageAggregateRow {
  date: string;
  totalScreenTime: number;
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

  constructor() {
    this.db = SQLite.openDatabaseSync('brainrot.db');
    this.initDatabase();
  }

  private initDatabase() {
    // Daily usage tracking
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

    // App settings
    this.db.execSync(`
      CREATE TABLE IF NOT EXISTS app_settings (
        packageName TEXT PRIMARY KEY,
        appName TEXT NOT NULL,
        monitored BOOLEAN DEFAULT 1,
        dailyLimitMs INTEGER DEFAULT 7200000
      )
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
      CREATE TABLE IF NOT EXISTS daily_summary (
        date TEXT PRIMARY KEY,
        totalScreenTime INTEGER NOT NULL,
        brainScore INTEGER NOT NULL,
        appsJson TEXT NOT NULL -- JSON string of apps array [{packageName, appName, totalTimeMs}, ...]
      )
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
        
        console.log('Found duplicates to clean:', duplicates);
        
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

  async saveDailyUsage(date: string, usageData: UsageData[]): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.db.withTransactionSync(() => {
          usageData.forEach(data => {
            this.db.runSync(
              `INSERT OR REPLACE INTO daily_usage 
               (date, packageName, appName, totalMs) VALUES (?, ?, ?, ?)`,
              [date, data.packageName, data.appName, data.totalTimeMs]
            );
          });
        });
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  async getDailyUsage(date: string): Promise<UsageData[]> {
    return new Promise((resolve, reject) => {
      try {
        const result = this.db.getAllSync(
          `SELECT * FROM daily_usage WHERE date = ? ORDER BY totalMs DESC`,
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
        reject(error);
      }
    });
  }

  async getHistoricalData(days: number = 30): Promise<DailyUsage[]> {
    return new Promise((resolve) => {
      try {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = startDate.toISOString().split('T')[0];

        // 1) Get all summary rows in the range (if any)
        const summaries = this.db.getAllSync(
          `SELECT date, totalScreenTime, brainScore, appsJson FROM daily_summary WHERE date >= ? ORDER BY date DESC`,
          [startDateStr]
        ) as DailySummaryRow[] || [];

        const summariesMap: Record<string, DailyUsage> = {};
        summaries.forEach((r) => {
          summariesMap[r.date] = {
            date: r.date,
            totalScreenTime: r.totalScreenTime || 0,
            brainScore: r.brainScore || this.calculateBrainScore(r.totalScreenTime || 0),
            apps: JSON.parse(r.appsJson || '[]')
          };
        });

        // 2) Get aggregated daily_usage rows to know which dates exist, and totals if no summary
        const usageRows = this.db.getAllSync(
          `SELECT date, SUM(totalMs) as totalScreenTime FROM daily_usage WHERE date >= ? GROUP BY date ORDER BY date DESC`,
          [startDateStr]
        ) as UsageAggregateRow[] || [];

        const results: DailyUsage[] = [];

        // For each date present in usageRows, prefer summary if exists else compute from daily_usage (filtered to monitored apps)
        usageRows.forEach((row) => {
          const date = row.date;
          if (summariesMap[date]) {
            results.push(summariesMap[date]);
            return;
          }

          // No summary — compute monitored-only fallback
          try {
            // Load raw usage for this date
            const raw = this.db.getAllSync(
              `SELECT packageName, appName, totalMs FROM daily_usage WHERE date = ? ORDER BY totalMs DESC`,
              [date]
            ) as RawUsageRow[] || [];

            // Determine monitored apps from app_settings table (preferred) or meta
            // First try app_settings where monitored = 1
            const monitoredRows = this.db.getAllSync(`SELECT packageName FROM app_settings WHERE monitored = 1`) as MonitoredAppRow[] || [];
            let monitoredSet = new Set<string>(monitoredRows.map((m) => m.packageName));

            // If no app_settings entries, fallback to meta('monitored_apps')
            if (monitoredSet.size === 0) {
              try {
                const metaRow = this.db.getFirstSync(`SELECT value FROM meta WHERE key = ?`, ['monitored_apps']) as MetaRow | null;
                if (metaRow && metaRow.value) {
                  const parsed = JSON.parse(metaRow.value);
                  if (Array.isArray(parsed)) {
                    monitoredSet = new Set(parsed);
                  }
                }
              } catch {
                // Ignore JSON parse errors
              }
            }

            // Exclude the app itself
            monitoredSet.delete('com.soumikganguly.brainrot');

            // Filter raw to monitoredSet
            const filteredApps: UsageData[] = raw
              .filter((r) => monitoredSet.has(r.packageName))
              .map((r) => ({
                packageName: r.packageName,
                appName: r.appName,
                totalTimeMs: r.totalMs,
                date: date // Add the missing date property
              }));

            const total = filteredApps.reduce((s, a) => s + (a.totalTimeMs || 0), 0);
            const score = this.calculateBrainScore(total);

            results.push({
              date,
              totalScreenTime: total,
              brainScore: score,
              apps: filteredApps
            });
          } catch {
            // fallback to aggregated total if computing fails
            const total = row.totalScreenTime || 0;
            results.push({
              date,
              totalScreenTime: total,
              brainScore: this.calculateBrainScore(total),
              apps: []
            });
          }
        });

        // Sort by date descending
        results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        resolve(results);
      } catch {
        console.error('Error fetching historical data (enhanced)');
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
        reject(error);
      }
    });
  }

  async getAppSettings(): Promise<AppSettings[]> {
    return new Promise((resolve, reject) => {
      try {
        const result = this.db.getAllSync(
          `SELECT * FROM app_settings ORDER BY appName`
        ) as AppSettingsRow[];
        
        const settings: AppSettings[] = result.map((row) => ({
          packageName: row.packageName,
          appName: row.appName,
          monitored: Boolean(row.monitored),
          dailyLimitMs: row.dailyLimitMs
        }));
        
        resolve(settings);
      } catch (error) {
        reject(error);
      }
    });
  }

  async updateAppSettings(settings: AppSettings): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.db.runSync(
          `INSERT OR REPLACE INTO app_settings 
           (packageName, appName, monitored, dailyLimitMs) VALUES (?, ?, ?, ?)`,
          [settings.packageName, settings.appName, settings.monitored ? 1 : 0, settings.dailyLimitMs]
        );
        resolve();
      } catch (error) {
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
        reject(error);
      }
    });
  }

  async saveDailySummary(date: string, summary: DailyUsage): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const appsJson = JSON.stringify(summary.apps || []);
        this.db.runSync(
          `INSERT OR REPLACE INTO daily_summary (date, totalScreenTime, brainScore, appsJson) VALUES (?, ?, ?, ?)`,
          [date, summary.totalScreenTime, summary.brainScore, appsJson]
        );
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  // Get monitored-only daily summary (if exists)
  async getDailySummary(date: string): Promise<DailyUsage | null> {
    return new Promise((resolve, reject) => {
      try {
        const row = this.db.getFirstSync(
          `SELECT date, totalScreenTime, brainScore, appsJson FROM daily_summary WHERE date = ?`,
          [date]
        ) as DailySummaryRow | null;
        
        if (!row) return resolve(null);

        const apps = JSON.parse(row.appsJson || '[]');
        resolve({
          date: row.date,
          totalScreenTime: row.totalScreenTime || 0,
          brainScore: row.brainScore || this.calculateBrainScore(row.totalScreenTime || 0),
          apps
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  // Backfill summaries from existing daily_usage and current monitored apps
  async backfillSummaries(days = 90): Promise<void> {
    return new Promise(async (resolve) => {
      try {
        // Get distinct dates in recent range
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = startDate.toISOString().split('T')[0];

        const dates = this.db.getAllSync(
          `SELECT DISTINCT date FROM daily_usage WHERE date >= ? ORDER BY date ASC`,
          [startDateStr]
        ) as { date: string }[] || [];

        for (const d of dates) {
          const dateStr = d.date;
          // Skip if summary already exists
          const exists = this.db.getFirstSync(`SELECT 1 FROM daily_summary WHERE date = ?`, [dateStr]);
          if (exists) continue;

          // Get raw usage for the date
          const raw = this.db.getAllSync(`SELECT packageName, appName, totalMs FROM daily_usage WHERE date = ?`, [dateStr]) as RawUsageRow[] || [];

          // Get monitored apps (app_settings -> monitored=1) or meta
          const monitoredRows = this.db.getAllSync(`SELECT packageName FROM app_settings WHERE monitored = 1`) as MonitoredAppRow[] || [];
          let monitoredSet = new Set<string>(monitoredRows.map((m) => m.packageName));
          
          if (monitoredSet.size === 0) {
            const metaRow = this.db.getFirstSync(`SELECT value FROM meta WHERE key = ?`, ['monitored_apps']) as MetaRow | null;
            if (metaRow && metaRow.value) {
              try {
                const parsed = JSON.parse(metaRow.value);
                if (Array.isArray(parsed)) monitoredSet = new Set(parsed);
              } catch {
                // Ignore JSON parse errors
              }
            }
          }
          monitoredSet.delete('com.soumikganguly.brainrot');

          const filteredApps: UsageData[] = raw
            .filter((r) => monitoredSet.has(r.packageName))
            .map((r) => ({
              packageName: r.packageName,
              appName: r.appName,
              totalTimeMs: r.totalMs,
              date: dateStr // Add the missing date property
            }));

          const total = filteredApps.reduce((s, a) => s + (a.totalTimeMs || 0), 0);
          const score = this.calculateBrainScore(total);
          const summary: DailyUsage = {
            date: dateStr,
            totalScreenTime: total,
            brainScore: score,
            apps: filteredApps
          };

          // Save summary
          const appsJson = JSON.stringify(summary.apps || []);
          this.db.runSync(
            `INSERT OR REPLACE INTO daily_summary (date, totalScreenTime, brainScore, appsJson) VALUES (?, ?, ?, ?)`,
            [dateStr, summary.totalScreenTime, summary.brainScore, appsJson]
          );
        }

        resolve();
      } catch {
        console.error('Error during backfillSummaries');
        resolve();
      }
    });
  }

  // Helper method to close database connection if needed
  close(): void {
    this.db.closeSync();
  }
}

export const database = new DatabaseService();