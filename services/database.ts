import * as SQLite from 'expo-sqlite';

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
        );
        
        const usage: UsageData[] = result.map((row: any) => ({
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
    return new Promise((resolve, reject) => {
      try {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = startDate.toISOString().split('T')[0];

        const result = this.db.getAllSync(
          `SELECT date, SUM(totalMs) as totalScreenTime,
           COUNT(DISTINCT packageName) as appCount
           FROM daily_usage 
           WHERE date >= ? 
           GROUP BY date 
           ORDER BY date DESC`,
          [startDateStr]
        );

        const dailyData: DailyUsage[] = result.map((row: any) => ({
          date: row.date,
          totalScreenTime: row.totalScreenTime,
          brainScore: this.calculateBrainScore(row.totalScreenTime),
          apps: [] // Will be populated separately if needed
        }));

        resolve(dailyData);
      } catch (error) {
        reject(error);
      }
    });
  }

  private calculateBrainScore(totalUsageMs: number): number {
    const allowedMs = 8 * 60 * 60 * 1000; // 8 hours default
    const score = Math.max(0, 100 - (totalUsageMs / allowedMs) * 100);
    return Math.round(score);
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
        );
        
        resolve(result ? (result as any).value : null);
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
        );
        
        const settings: AppSettings[] = result.map((row: any) => ({
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

  // Helper method to close database connection if needed
  close(): void {
    this.db.closeSync();
  }
}

export const database = new DatabaseService();