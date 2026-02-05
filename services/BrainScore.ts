import { calculateBrainScore } from '../utils/brainScore';
import { database } from './database';
import { UnifiedUsageService } from './UnifiedUsageService';

interface BrainScoreResult {
  totalUsageMs: number;
  score: number;
  apps: {
    packageName: string;
    appName: string;
    totalTimeMs: number;
  }[];
}

export class BrainScoreService {
  private static instance: BrainScoreService;
  private static readonly SELF_PACKAGE = 'com.soumikganguly.brainrot';
  
  // In-memory cache
  private cache = new Map<string, { data: BrainScoreResult; timestamp: number }>();
  private cacheValidityMs = 60000; // 1 minute
  
  // Monitored packages cache
  private monitoredPackagesCache: { packages: string[]; timestamp: number } | null = null;
  private monitoredCacheValidityMs = 300000; // 5 minutes
  
  static getInstance(): BrainScoreService {
    if (!this.instance) {
      this.instance = new BrainScoreService();
    }
    return this.instance;
  }
  
  /**
   * SINGLE METHOD to compute brain score for a specific date
   * Always uses the same logic: read from daily_summary if exists,
   * otherwise compute from daily_usage
   */
  async getBrainScoreForDate(dateStr: string): Promise<BrainScoreResult> {
    // Check cache first
    const cached = this.cache.get(dateStr);
    if (cached && Date.now() - cached.timestamp < this.cacheValidityMs) {
      return cached.data;
    }
    
    // 1. Try to get pre-computed summary
    const summary = await database.getDailySummary(dateStr);
    if (summary) {
      const result = {
        totalUsageMs: summary.totalScreenTime,
        score: summary.brainScore,
        apps: summary.apps
      };
      this.cache.set(dateStr, { data: result, timestamp: Date.now() });
      return result;
    }
    
    // 2. Compute from raw usage
    const result = await this.computeFromRawUsage(dateStr);
    this.cache.set(dateStr, { data: result, timestamp: Date.now() });
    return result;
  }
  
  /**
   * Get today's brain score (most common use case)
   */
  async getTodayScore(): Promise<BrainScoreResult> {
    const today = new Date().toISOString().split('T')[0];
    return this.getBrainScoreForDate(today);
  }
  
  /**
   * Invalidate cache for a specific date (call after saving new data)
   */
  invalidateCache(dateStr?: string): void {
    if (dateStr) {
      this.cache.delete(dateStr);
    } else {
      this.cache.clear();
    }
  }
  
  /**
   * Internal: compute from daily_usage table
   * ALWAYS uses the same filtering logic
   * Falls back to native UsageStats if database is empty for recent dates
   */
  private async computeFromRawUsage(dateStr: string): Promise<BrainScoreResult> {
    // Get raw usage from database
    let rawUsage = await database.getDailyUsage(dateStr);
    
    // If database is empty for this date, try fetching from native Android UsageStats
    // Only works for recent dates (Android keeps ~7-14 days of data)
    if (rawUsage.length === 0) {
      const nativeUsage = await this.tryFetchFromNative(dateStr);
      if (nativeUsage.length > 0) {
        rawUsage = nativeUsage;
        
        // Save to database for future use
        try {
          await database.saveDailyUsage(dateStr, rawUsage.map(app => ({
            ...app,
            date: dateStr
          })));
          console.log(`Saved ${rawUsage.length} apps from native to database for ${dateStr}`);
        } catch (saveError) {
          console.warn('Failed to save native data to database:', saveError);
        }
      }
    }
    
    // Get monitored apps (try app_settings first, then meta)
    const monitoredPackages = await this.getMonitoredPackages();
    
    // Create Set for O(1) lookup
    const monitoredSet = new Set(monitoredPackages);
    monitoredSet.delete(BrainScoreService.SELF_PACKAGE);
    
    let filtered;
    
    // If no monitored apps configured, use all apps (excluding self)
    // This handles the case where onboarding wasn't completed or monitored_apps not set
    if (monitoredSet.size === 0) {
      console.warn('No monitored apps configured, using all apps for brain score calculation');
      filtered = rawUsage.filter(app => app.packageName !== BrainScoreService.SELF_PACKAGE);
    } else {
      // Filter: monitored only, exclude self
      filtered = rawUsage.filter(app => monitoredSet.has(app.packageName));
    }
    
    // Deduplicate (in case of DB issues)
    const deduped = this.deduplicateApps(filtered);
    
    // Sum and score
    const totalUsageMs = deduped.reduce((sum, app) => sum + app.totalTimeMs, 0);
    const score = calculateBrainScore(totalUsageMs);
    
    return {
      totalUsageMs,
      score,
      apps: deduped.sort((a, b) => b.totalTimeMs - a.totalTimeMs)
    };
  }
  
  /**
   * Try to fetch usage data from native Android UsageStats
   * Only works for TODAY - Android's UsageStats API returns cumulative data
   * from startTime to now, so we can't reliably get data for past dates.
   */
  private async tryFetchFromNative(dateStr: string): Promise<{
    packageName: string;
    appName: string;
    totalTimeMs: number;
  }[]> {
    try {
      // Only works for today - past dates would return incorrect cumulative data
      const today = new Date().toISOString().split('T')[0];
      if (dateStr !== today) {
        return [];
      }
      
      // Check if native module is available
      if (!UnifiedUsageService.isNativeModuleAvailable()) {
        return [];
      }
      
      // Check permission
      const hasPermission = await UnifiedUsageService.isUsageAccessGranted();
      if (!hasPermission) {
        return [];
      }
      
      console.log(`Attempting native fallback for today (${dateStr})...`);
      const nativeUsage = await UnifiedUsageService.getUsageForDate(dateStr);
      
      if (nativeUsage.length > 0) {
        console.log(`Native fallback returned ${nativeUsage.length} apps for today`);
      }
      
      return nativeUsage.map(app => ({
        packageName: app.packageName,
        appName: app.appName,
        totalTimeMs: app.totalTimeMs
      }));
    } catch (error) {
      console.warn(`Native fallback failed for ${dateStr}:`, error);
      return [];
    }
  }
  
  /**
   * Get monitored packages - consistent lookup order
   */
  private async getMonitoredPackages(): Promise<string[]> {
    // Try app_settings first
    try {
      const settings = await database.getAppSettings();
      const monitored = settings
        .filter(s => s.monitored)
        .map(s => s.packageName);
      
      if (monitored.length > 0) {
        return monitored;
      }
    } catch (error) {
      console.warn('Failed to load from app_settings:', error);
    }
    
    // Fallback to meta
    try {
      const meta = await database.getMeta('monitored_apps');
      return meta ? JSON.parse(meta) : [];
    } catch (error) {
      console.warn('Failed to load from meta:', error);
      return [];
    }
  }
  
  /**
   * Deduplicate apps (keep highest usage)
   */
  private deduplicateApps(apps: {
    packageName: string;
    appName: string;
    totalTimeMs: number;
  }[]): typeof apps {
    const map = new Map<string, typeof apps[0]>();
    
    for (const app of apps) {
      const existing = map.get(app.packageName);
      if (!existing || app.totalTimeMs > existing.totalTimeMs) {
        map.set(app.packageName, app);
      }
    }
    
    return Array.from(map.values());
  }
}