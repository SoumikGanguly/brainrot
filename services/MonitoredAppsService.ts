import { BrainScoreService } from './BrainScore';
import { HistoricalDataService } from './HistoricalDataService';
import { UnifiedUsageService } from './UnifiedUsageService';
import { database, type AppSettings } from './database';

export interface MonitoredAppConfig {
  packageName: string;
  appName: string;
  monitored: boolean;
  dailyLimitMs?: number;
}

export class MonitoredAppsService {
  private static instance: MonitoredAppsService;
  private static readonly DEFAULT_DAILY_LIMIT_MS = 2 * 60 * 60 * 1000;

  static getInstance(): MonitoredAppsService {
    if (!this.instance) {
      this.instance = new MonitoredAppsService();
    }
    return this.instance;
  }

  async getMonitoredPackages(): Promise<string[]> {
    return database.getMonitoredPackages();
  }

  async replaceMonitoredApps(apps: MonitoredAppConfig[]): Promise<string[]> {
    const existingSettings = await database.getAppSettings();
    const existingMap = new Map(existingSettings.map((setting) => [setting.packageName, setting]));
    const incomingMap = new Map(apps.map((app) => [app.packageName, app]));
    const nextMonitoredPackages = Array.from(
      new Set(
        apps
          .filter((app) => app.monitored)
          .map((app) => app.packageName)
      )
    );

    await database.setMeta('monitored_apps', JSON.stringify(nextMonitoredPackages));

    const allPackages = new Set([...existingMap.keys(), ...incomingMap.keys()]);
    for (const packageName of allPackages) {
      const incoming = incomingMap.get(packageName);
      const existing = existingMap.get(packageName);
      const monitored = incoming?.monitored ?? nextMonitoredPackages.includes(packageName);
      const appName =
        incoming?.appName ||
        existing?.appName ||
        UnifiedUsageService.getAppDisplayName(packageName);
      const dailyLimitMs =
        incoming?.dailyLimitMs ||
        existing?.dailyLimitMs ||
        MonitoredAppsService.DEFAULT_DAILY_LIMIT_MS;

      await database.updateAppSettings({
        packageName,
        appName,
        monitored,
        dailyLimitMs,
      });
      await database.setMeta(`app_monitored_${packageName}`, monitored.toString());
    }

    await UnifiedUsageService.syncMonitoredAppsToNative(nextMonitoredPackages);
    await UnifiedUsageService.getInstance().refreshMonitoredApps();
    await this.refreshDerivedData();

    return nextMonitoredPackages;
  }

  async setAppMonitoring(
    packageName: string,
    appName: string,
    monitored: boolean,
    dailyLimitMs?: number
  ): Promise<string[]> {
    const existingSettings = await database.getAppSettings();
    const nextSettings = new Map<string, AppSettings>(
      existingSettings.map((setting) => [setting.packageName, setting])
    );

    nextSettings.set(packageName, {
      packageName,
      appName,
      monitored,
      dailyLimitMs:
        dailyLimitMs ||
        nextSettings.get(packageName)?.dailyLimitMs ||
        MonitoredAppsService.DEFAULT_DAILY_LIMIT_MS,
    });

    return this.replaceMonitoredApps(
      Array.from(nextSettings.values()).map((setting) => ({
        packageName: setting.packageName,
        appName: setting.appName,
        monitored: setting.monitored,
        dailyLimitMs: setting.dailyLimitMs,
      }))
    );
  }

  async addMonitoredApps(
    apps: Array<Pick<MonitoredAppConfig, 'packageName' | 'appName'>>
  ): Promise<string[]> {
    const existingSettings = await database.getAppSettings();
    const nextSettings = new Map<string, AppSettings>(
      existingSettings.map((setting) => [setting.packageName, setting])
    );

    for (const app of apps) {
      nextSettings.set(app.packageName, {
        packageName: app.packageName,
        appName: app.appName,
        monitored: true,
        dailyLimitMs:
          nextSettings.get(app.packageName)?.dailyLimitMs ||
          MonitoredAppsService.DEFAULT_DAILY_LIMIT_MS,
      });
    }

    return this.replaceMonitoredApps(
      Array.from(nextSettings.values()).map((setting) => ({
        packageName: setting.packageName,
        appName: setting.appName,
        monitored: setting.monitored,
        dailyLimitMs: setting.dailyLimitMs,
      }))
    );
  }

  private async refreshDerivedData(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    BrainScoreService.getInstance().invalidateCache();
    await HistoricalDataService.getInstance().rebuildSummaryForDate(today, { force: true });
    await UnifiedUsageService.syncBlockingConfigToNative({
      monitoredApps: await database.getMonitoredPackages(),
      blockedApps: JSON.parse((await database.getMeta('blocked_apps')) || '[]'),
      blockingEnabled: (await database.getMeta('app_blocking_enabled')) === 'true',
      blockingMode: ((await database.getMeta('blocking_mode')) || 'soft') as 'soft' | 'hard',
      bypassLimit: parseInt((await database.getMeta('block_bypass_limit')) || '3', 10),
      scheduleEnabled: (await database.getMeta('block_schedule_enabled')) === 'true',
      scheduleStart: (await database.getMeta('block_schedule_start')) || '22:00',
      scheduleEnd: (await database.getMeta('block_schedule_end')) || '06:00',
    });
  }
}

