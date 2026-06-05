import { AppBlockingService } from './AppBlockingService';

import { database } from './database';

import { UnifiedUsageService } from './UnifiedUsageService';

/**
 * Coordinates between monitoring and blocking services
 * This ensures that when monitoring detects app usage, blocking is also triggered
 */
export class ServiceCoordinator {
  private static instance: ServiceCoordinator;
  private isInitialized = false;
  private lastAppCheckTime: Map<string, number> = new Map();

  static getInstance(): ServiceCoordinator {
    if (!this.instance) {
      this.instance = new ServiceCoordinator();
    }
    return this.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    console.log('Initializing ServiceCoordinator...');

    // Set up the connection between monitoring and blocking
    await this.setupServiceConnections();

    this.isInitialized = true;
    console.log('ServiceCoordinator initialized');
  }

  private async setupServiceConnections(): Promise<void> {
    // Get both service instances
    const unifiedService = UnifiedUsageService.getInstance();

    // Extend the monitoring service's check to also trigger blocking checks
    const originalCheck = unifiedService.checkSpecificAppUsage.bind(unifiedService);

    // Override the checkSpecificAppUsage method to add blocking logic
    unifiedService.checkSpecificAppUsage = async (packageName: string) => {
      // First, run the original monitoring check (for notifications)
      await originalCheck(packageName);

      // Then, check if this app should be blocked
      await this.checkIfAppShouldBeBlocked(packageName);
    };
  }

  private async checkIfAppShouldBeBlocked(packageName: string): Promise<void> {
    try {
      // Don't check too frequently for the same app
      const lastCheck = this.lastAppCheckTime.get(packageName) || 0;
      const now = Date.now();
      if (now - lastCheck < 5000) return; // 5 second cooldown per app

      this.lastAppCheckTime.set(packageName, now);

      const blockingService = AppBlockingService.getInstance();
      await blockingService.initialize();
      const protectedApps = await blockingService.getProtectedApps();
      const protectedApp = protectedApps.find((app) => app.packageName === packageName);
      if (!protectedApp || protectedApp.protectionMode === 'monitor' || protectedApp.protectionMode === 'ignore') {
        return;
      }

      console.log(`Coordinator: Detected protected app ${packageName}, triggering focus check`);
      await blockingService.evaluateForegroundApp(packageName, protectedApp.appName);

    } catch (error) {
      console.error('Error in checkIfAppShouldBeBlocked:', error);
    }
  }

  /**
   * Called when monitored apps list changes
   */
  async onMonitoredAppsChanged(): Promise<void> {
    console.log('Monitored apps changed, refreshing services...');

    const unifiedService = UnifiedUsageService.getInstance();
    await unifiedService.refreshMonitoredApps();

    // Also refresh blocking service in case any monitored apps are blocked
    const blockingService = AppBlockingService.getInstance();
    await blockingService.initialize();
  }

  /**
   * Called when blocked apps list changes
   */
  async onBlockedAppsChanged(): Promise<void> {
    console.log('Blocked apps changed, refreshing blocking service...');

    const blockingService = AppBlockingService.getInstance();
    await blockingService.initialize();
  }

  /**
   * Manual trigger for testing
   */
  async triggerManualCheck(packageName?: string): Promise<void> {
    console.log('Manual check triggered from coordinator');

    // Trigger unified monitoring check
    const unifiedService = UnifiedUsageService.getInstance();

    if (packageName) {
      await unifiedService.checkSpecificAppUsage(packageName);
    } else {
      await unifiedService.triggerManualCheck();
    }

    // Also trigger blocking check
    const blockingService = AppBlockingService.getInstance();
    await blockingService.initialize();
  }
}
