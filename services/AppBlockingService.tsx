import { Alert, AppState, AppStateStatus } from 'react-native';
import { calculateBrainScore, getBrainScoreStatus, getScoreLabel } from '../utils/brainScore';
import { database } from './database';
import { UsageMonitoringService } from './UsageMonitoringService';
// import { UsageService } from './UsageService';

import { UnifiedUsageService } from './UnifiedUsageService';

export type BlockingMode = 'soft' | 'hard';

interface BlockedApp {
  packageName: string;
  appName: string;
  blockMode: BlockingMode;
  timeLimit?: number; // minutes
  bypassCount: number;
  lastBypassTime?: number;
}

export class AppBlockingService {
  private static instance: AppBlockingService;
  private isInitialized = false;
  private blockedApps: Map<string, BlockedApp> = new Map();
  private checkInterval?: ReturnType<typeof setInterval>;
  private currentForegroundApp?: string;
  private blockingEnabled = false;
  private blockingMode: BlockingMode = 'soft';
  private bypassLimit = 3;
  private lastCheckTime = 0;
  private alertShowing = false;
  private floatingWindowMonitorInterval?: ReturnType<typeof setInterval>;
  private currentFloatingAppPackage?: string;
  private lastBlockedApp?: string;
  private blockCooldown: Map<string, number> = new Map(); // Prevent spam

  static getInstance(): AppBlockingService {
    if (!this.instance) {
      this.instance = new AppBlockingService();
    }
    return this.instance;
  }

  private constructor() {
    AppState.addEventListener('change', this.handleAppStateChange);
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      console.log('Initializing AppBlockingService...');

      await this.loadBlockingSettings();
      await this.loadBlockedApps();

      if (this.blockingEnabled) {
        this.startMonitoring();
      }

      this.isInitialized = true;
      console.log('AppBlockingService initialized with', this.blockedApps.size, 'blocked apps');

    } catch (error) {
      console.error('Error initializing AppBlockingService:', error);
    }
  }

  private async loadBlockingSettings(): Promise<void> {
    try {
      const enabled = await database.getMeta('app_blocking_enabled');
      this.blockingEnabled = enabled === 'true';

      const mode = await database.getMeta('blocking_mode');
      this.blockingMode = (mode === 'hard' ? 'hard' : 'soft') as BlockingMode;

      const bypassLimit = await database.getMeta('block_bypass_limit');
      this.bypassLimit = bypassLimit ? parseInt(bypassLimit) : 3;

      console.log(`Blocking settings: enabled=${this.blockingEnabled}, mode=${this.blockingMode}, bypassLimit=${this.bypassLimit}`);
    } catch (error) {
      console.error('Error loading blocking settings:', error);
    }
  }

  private async loadBlockedApps(): Promise<void> {
    try {
      const blockedAppsData = await database.getMeta('blocked_apps');
      if (!blockedAppsData) {
        console.log('No blocked apps found in database');
        return;
      }

      const blockedPackages = JSON.parse(blockedAppsData) as string[];
      console.log('Loading blocked packages:', blockedPackages);
      
      this.blockedApps.clear();
      
      for (const packageName of blockedPackages) {
        const appName = UnifiedUsageService.getAppDisplayName(packageName);
        
        const today = new Date().toISOString().split('T')[0];
        const bypassKey = `bypass_${packageName}_${today}`;
        const bypassCountStr = await database.getMeta(bypassKey);
        const bypassCount = bypassCountStr ? parseInt(bypassCountStr) : 0;

        this.blockedApps.set(packageName, {
          packageName,
          appName,
          blockMode: this.blockingMode,
          bypassCount,
        });

        console.log(`Loaded blocked app: ${appName} (${packageName}) - bypasses: ${bypassCount}`);
      }

      console.log(`Total blocked apps loaded: ${this.blockedApps.size}`);
    } catch (error) {
      console.error('Error loading blocked apps:', error);
    }
  }

  private handleAppStateChange = async (nextAppState: AppStateStatus) => {
    if (nextAppState === 'active') {
      if (this.blockingEnabled && !this.checkInterval) {
        await this.loadBlockingSettings();
        await this.loadBlockedApps();
        this.startMonitoring();
      }
      if (this.blockingEnabled) {
        setTimeout(() => this.checkCurrentApp(), 1000);
      }
    }
  };

  private startMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkCurrentApp();

    // Check every 2 seconds
    this.checkInterval = setInterval(() => {
      this.checkCurrentApp();
    }, 2000);

    console.log('App blocking monitoring started - checking every 2 seconds');
  }

  private async checkCurrentApp(): Promise<void> {
    try {
      const now = Date.now();
      if (now - this.lastCheckTime < 1500) return;
      this.lastCheckTime = now;

      if (this.alertShowing) return;
      if (!this.blockingEnabled) return;

      const recentUsage = await UnifiedUsageService.getUsageSince(Date.now() - 5000);
      
      if (!recentUsage || recentUsage.length === 0) {
        return;
      }

      const currentApp = recentUsage.sort((a, b) => 
        (b.lastTimeUsed || 0) - (a.lastTimeUsed || 0)
      )[0];

      if (currentApp.packageName === 'com.soumikganguly.brainrot') return;

      console.log(`Current foreground app: ${currentApp.appName} (${currentApp.packageName})`);

      if (this.blockedApps.has(currentApp.packageName)) {
        console.log(`🚫 Blocked app detected: ${currentApp.appName}`);
        
        // Check cooldown to avoid spam
        const cooldownTime = this.blockCooldown.get(currentApp.packageName) || 0;
        if (now - cooldownTime < 30000) { // 30 second cooldown
          console.log('In cooldown period, skipping block');
          return;
        }
        
        if (this.currentForegroundApp !== currentApp.packageName) {
          this.currentForegroundApp = currentApp.packageName;
          await this.handleBlockedAppDetected(currentApp.packageName, currentApp.appName);
          
          // Set cooldown
          this.blockCooldown.set(currentApp.packageName, now);
        }
      } else {
        if (this.currentForegroundApp && this.blockedApps.has(this.currentForegroundApp)) {
          this.currentForegroundApp = undefined;
        }
      }

    } catch (error) {
      console.error('Error checking current app:', error);
    }
  }

  private async handleBlockedAppDetected(packageName: string, appName: string): Promise<void> {
    const blockedApp = this.blockedApps.get(packageName);
    if (!blockedApp) return;

    console.log(`🛑 Handling blocked app: ${appName}, mode: ${this.blockingMode}, bypasses: ${blockedApp.bypassCount}/${this.bypassLimit}`);

    // Check overlay permission first
    const hasOverlay = await UnifiedUsageService.hasOverlayPermission();
    if (!hasOverlay) {
      console.error('❌ No overlay permission - cannot show blocking UI');
      Alert.alert(
        'Permission Required',
        'Display over other apps permission is required for blocking features.',
        [{ text: 'OK' }]
      );
      return;
    }

    const inSchedule = await this.isInBlockedSchedule();
    const canBypass = blockedApp.bypassCount < this.bypassLimit;

    // Check time limit
    const todayUsage = await this.getTodayUsageForApp(packageName);
    
    if (blockedApp.timeLimit) {
      const usageMinutes = todayUsage / (1000 * 60);
      if (usageMinutes < blockedApp.timeLimit) {
        console.log(`App within time limit: ${usageMinutes}/${blockedApp.timeLimit} minutes`);
        return;
      }
    }

    const brainScore = await this.calculateBrainScore(todayUsage);
    const scoreStatus = getBrainScoreStatus(brainScore);
    
    console.log(`Brain score for ${appName}: ${brainScore} - ${scoreStatus.level}`);

    // HARD BLOCK: Show full-screen overlay
    if (this.blockingMode === 'hard' || inSchedule) {
      try {
        console.log('🔴 Showing HARD BLOCK overlay');
        await UnifiedUsageService.showBlockingOverlay(packageName, appName, 'hard');
        
        // Also show system alert for extra emphasis
        setTimeout(() => {
          this.showHardBlockAlert(appName, canBypass, brainScore);
        }, 500);
      } catch (error) {
        console.error('❌ Error showing hard block overlay:', error);
        // Fallback to alert only
        this.showHardBlockAlert(appName, canBypass, brainScore);
      }
    } 
    // SOFT BLOCK: Show floating window + gentle alert
    else {
      try {
        console.log('🟡 Showing SOFT BLOCK with floating score');
        
        // Start floating score window
        const started = await UnifiedUsageService.startFloatingScore(appName, brainScore, todayUsage);
        
        if (started) {
          console.log(`✅ Started floating window for ${appName} with score ${brainScore}`);
          
          // Monitor when user leaves the app
          this.startFloatingWindowMonitor(packageName);
          
          // Show gentle alert
          this.showSoftBlockAlert(appName, canBypass, brainScore, scoreStatus);
        } else {
          console.error('❌ Failed to start floating window');
          // Fallback to just alert
          this.showSoftBlockAlert(appName, canBypass, brainScore, scoreStatus);
        }
        
      } catch (error) {
        console.error('❌ Error showing soft block:', error);
        this.showSoftBlockAlert(appName, canBypass, brainScore, scoreStatus);
      }
    }
  }

  private async calculateBrainScore(usageMs: number): Promise<number> {
    const allowedTimeStr = await database.getMeta('daily_allowed_time_ms');
    const allowedMs = allowedTimeStr ? parseInt(allowedTimeStr) : undefined;
    return calculateBrainScore(usageMs, allowedMs);
  }

  private startFloatingWindowMonitor(packageName: string): void {
    this.stopFloatingWindowMonitor();
    
    this.currentFloatingAppPackage = packageName;
    
    this.floatingWindowMonitorInterval = setInterval(async () => {
      try {
        const currentApp = await this.getCurrentForegroundApp();
        
        if (currentApp !== packageName) {
          console.log(`User left ${packageName}, closing floating window`);
          await this.closeFloatingWindow();
          this.stopFloatingWindowMonitor();
        }
      } catch (error) {
        console.error('Error monitoring floating window:', error);
      }
    }, 3000);
    
    console.log(`Started floating window monitor for ${packageName}`);
  }

  private stopFloatingWindowMonitor(): void {
    if (this.floatingWindowMonitorInterval) {
      clearInterval(this.floatingWindowMonitorInterval);
      this.floatingWindowMonitorInterval = undefined;
      this.currentFloatingAppPackage = undefined;
    }
  }

  private async closeFloatingWindow(): Promise<void> {
    try {
      await UnifiedUsageService.stopFloatingScore();
      console.log('Floating window closed');
    } catch (error) {
      console.error('Error closing floating window:', error);
    }
  }

  private async getCurrentForegroundApp(): Promise<string | null> {
    try {
      const recentUsage = await UnifiedUsageService.getUsageSince(Date.now() - 3000);
      
      if (!recentUsage || recentUsage.length === 0) {
        return null;
      }

      const currentApp = recentUsage.sort((a, b) => 
        (b.lastTimeUsed || 0) - (a.lastTimeUsed || 0)
      )[0];

      return currentApp.packageName;
    } catch (error) {
      console.error('Error getting current foreground app:', error);
      return null;
    }
  }

  private async getTodayUsageForApp(packageName: string): Promise<number> {
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      return await UnifiedUsageService.getAppUsage(packageName, startOfDay.getTime());
    } catch (error) {
      console.error('Error getting today usage for app:', error);
      return 0;
    }
  }

  private async isInBlockedSchedule(): Promise<boolean> {
    try {
      const scheduleEnabled = await database.getMeta('block_schedule_enabled');
      if (scheduleEnabled !== 'true') return false;

      const startTime = await database.getMeta('block_schedule_start') || '22:00';
      const endTime = await database.getMeta('block_schedule_end') || '06:00';

      const now = new Date();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

      if (startTime > endTime) {
        return currentTime >= startTime || currentTime <= endTime;
      } else {
        return currentTime >= startTime && currentTime <= endTime;
      }
    } catch (error) {
      console.error('Error checking blocked schedule:', error);
      return false;
    }
  }

  private formatUsageTime(ms: number): string {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  private showSoftBlockAlert(
    appName: string, 
    allowBypass: boolean, 
    brainScore: number,
    scoreStatus: ReturnType<typeof getBrainScoreStatus>
  ): void {
    if (this.alertShowing) return;
    this.alertShowing = true;

    const scoreLabel = getScoreLabel(brainScore);
    const todayUsage = this.getTodayUsageForAppSync(this.currentForegroundApp!);
    const usageTime = this.formatUsageTime(todayUsage);

    const message = `⚠️ ${appName} is currently soft-blocked.\n\n🧠 Brain Score: ${brainScore}/100 (${scoreLabel})\n⏱️ Usage today: ${usageTime}\n\n${scoreStatus.text}\n\nConsider taking a break or switching to a different activity.`;

    const buttons: any[] = [
      {
        text: 'OK, I\'ll take a break',
        onPress: () => {
          this.alertShowing = false;
          this.closeCurrentApp();
        },
        style: 'cancel'
      }
    ];

    if (allowBypass) {
      buttons.push({
        text: 'Continue anyway',
        onPress: () => {
          this.alertShowing = false;
          this.handleBypass(this.currentForegroundApp!);
        },
        style: 'destructive'
      });
    }

    Alert.alert(
      '🧠 Time for a Break',
      message,
      buttons,
      { 
        cancelable: false,
        onDismiss: () => { this.alertShowing = false; }
      }
    );
  }

  private showHardBlockAlert(
    appName: string, 
    allowBypass: boolean,
    brainScore: number
  ): void {
    if (this.alertShowing) return;
    this.alertShowing = true;

    const scoreLabel = getScoreLabel(brainScore);
    const scoreStatus = getBrainScoreStatus(brainScore);

    const message = `🚫 ${appName} is BLOCKED.\n\n🧠 Brain Score: ${brainScore}/100 (${scoreLabel})\n\n${scoreStatus.text}\n\nThis app is currently restricted to protect your mental health and productivity.`;

    const buttons: any[] = [
      {
        text: 'Close App',
        onPress: () => {
          this.alertShowing = false;
          this.closeCurrentApp();
        },
        style: 'cancel'
      }
    ];

    if (allowBypass && this.bypassLimit > 0) {
      const blockedApp = this.blockedApps.get(this.currentForegroundApp!);
      const remaining = this.bypassLimit - (blockedApp?.bypassCount || 0);
      buttons.push({
        text: `Emergency Bypass (${remaining} left)`,
        onPress: () => {
          this.alertShowing = false;
          this.handleBypass(this.currentForegroundApp!);
        },
        style: 'destructive'
      });
    }

    Alert.alert(
      '🛑 APP BLOCKED',
      message,
      buttons,
      { 
        cancelable: false,
        onDismiss: () => { this.alertShowing = false; }
      }
    );
  }

  private getTodayUsageForAppSync(packageName: string): number {
    return 0; // Placeholder
  }

  private closeCurrentApp = (): void => {
    console.log('User chose to close blocked app');
    
    this.closeFloatingWindow();
    this.stopFloatingWindowMonitor();
    
    const monitoringService = UsageMonitoringService.getInstance();
    monitoringService.triggerManualCheck();
  };

  private async handleBypass(packageName: string): Promise<void> {
    try {
      const blockedApp = this.blockedApps.get(packageName);
      if (!blockedApp) return;

      blockedApp.bypassCount += 1;
      blockedApp.lastBypassTime = Date.now();

      const today = new Date().toISOString().split('T')[0];
      const bypassKey = `bypass_${packageName}_${today}`;
      await database.setMeta(bypassKey, blockedApp.bypassCount.toString());

      await database.saveNotificationHistory(packageName, 'bypass', today);

      console.log(`Bypass granted for ${blockedApp.appName}. Count: ${blockedApp.bypassCount}/${this.bypassLimit}`);

      const todayUsage = await this.getTodayUsageForApp(packageName);
      const brainScore = await this.calculateBrainScore(todayUsage);
      const scoreStatus = getBrainScoreStatus(brainScore);

      const remaining = this.bypassLimit - blockedApp.bypassCount;
      if (remaining > 0) {
        setTimeout(() => {
          Alert.alert(
            'Bypass Granted',
            `🧠 Current Brain Score: ${brainScore}/100\n${scoreStatus.text}\n\nYou have ${remaining} bypass${remaining > 1 ? 'es' : ''} remaining for today.\n\nConsider this a reminder to use ${blockedApp.appName} mindfully.`,
            [{ text: 'OK' }]
          );
        }, 500);
      } else {
        setTimeout(() => {
          Alert.alert(
            '⚠️ Last Bypass Used',
            `🧠 Current Brain Score: ${brainScore}/100\n${scoreStatus.text}\n\nThis was your last bypass for ${blockedApp.appName} today.\n\nNo more bypasses available until tomorrow.`,
            [{ text: 'OK' }]
          );
        }, 500);
      }

      await this.closeFloatingWindow();
      this.stopFloatingWindowMonitor();

      setTimeout(() => {
        this.currentForegroundApp = undefined;
      }, 5 * 60 * 1000);

    } catch (error) {
      console.error('Error handling bypass:', error);
    }
  }

  async setBlockingMode(mode: BlockingMode): Promise<void> {
    this.blockingMode = mode;
    
    for (const app of this.blockedApps.values()) {
      app.blockMode = mode;
    }
    
    console.log(`Blocking mode set to: ${mode}`);
  }

  async blockApp(packageName: string): Promise<void> {
    try {
      const appName = UnifiedUsageService.getAppDisplayName(packageName);
      
      this.blockedApps.set(packageName, {
        packageName,
        appName,
        blockMode: this.blockingMode,
        bypassCount: 0,
      });

      const blockedPackages = Array.from(this.blockedApps.keys());
      await database.setMeta('blocked_apps', JSON.stringify(blockedPackages));

      console.log(`Blocked app: ${appName} (${packageName})`);
      
      if (this.blockingEnabled && !this.checkInterval) {
        this.startMonitoring();
      }
    } catch (error) {
      console.error('Error blocking app:', error);
    }
  }

  async unblockApp(packageName: string): Promise<void> {
    try {
      const blockedApp = this.blockedApps.get(packageName);
      if (blockedApp) {
        this.blockedApps.delete(packageName);

        const blockedPackages = Array.from(this.blockedApps.keys());
        await database.setMeta('blocked_apps', JSON.stringify(blockedPackages));

        console.log(`Unblocked app: ${blockedApp.appName}`);
      }
    } catch (error) {
      console.error('Error unblocking app:', error);
    }
  }

  async resetDailyLimits(): Promise<void> {
    console.log('Resetting daily app blocking limits...');
    
    for (const blockedApp of this.blockedApps.values()) {
      blockedApp.bypassCount = 0;
      blockedApp.lastBypassTime = undefined;
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    for (const packageName of this.blockedApps.keys()) {
      const bypassKey = `bypass_${packageName}_${yesterdayStr}`;
      try {
        await database.setMeta(bypassKey, '0');
      } catch {
        // Ignore errors
      }
    }

    // Clear cooldowns
    this.blockCooldown.clear();

    console.log('Daily blocking limits reset completed');
  }

  async forceCheckCurrentApp(): Promise<void> {
    if (!this.blockingEnabled) return;
    await this.checkCurrentApp();
  }

  getBlockingStatus(): {
    enabled: boolean;
    blockedAppsCount: number;
    blockedApps: string[];
    currentApp?: string;
    monitoring: boolean;
    bypassLimit: number;
    mode: BlockingMode;
    floatingWindowActive: boolean;
  } {
    return {
      enabled: this.blockingEnabled,
      blockedAppsCount: this.blockedApps.size,
      blockedApps: Array.from(this.blockedApps.keys()),
      currentApp: this.currentForegroundApp,
      monitoring: !!this.checkInterval,
      bypassLimit: this.bypassLimit,
      mode: this.blockingMode,
      floatingWindowActive: !!this.floatingWindowMonitorInterval,
    };
  }

  async cleanup(): Promise<void> {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }

    this.stopFloatingWindowMonitor();
    await this.closeFloatingWindow();

    this.blockedApps.clear();
    this.blockCooldown.clear();
    this.blockingEnabled = false;
    this.isInitialized = false;
    this.alertShowing = false;

    console.log('AppBlockingService cleanup completed');
  }
}