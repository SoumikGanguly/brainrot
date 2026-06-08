import type { Href } from 'expo-router';

import { AppBlockingService } from './AppBlockingService';
import { CapabilitiesService } from './CapabilitiesService';
import { InsightInvalidationService } from './InsightInvalidationService';
import { InsightMemoryService } from './InsightMemoryService';
import type { InsightAction } from './InsightTypes';
import type { ProtectionSource } from './TelemetryEvents';

type RouterLike = {
  push: (href: Href) => void;
};

export type InsightActionResult =
  | { status: 'applied'; actionKey: string }
  | { status: 'needs_permission'; actionKey: string; permission: 'usage' | 'overlay' | 'accessibility' }
  | { status: 'navigated'; actionKey: string }
  | { status: 'no_op'; actionKey: string };

export class InsightActionService {
  static async execute(
    action: InsightAction,
    router: RouterLike,
    source: ProtectionSource = 'insight_cta'
  ): Promise<InsightActionResult> {
    const actionKey = this.getActionKey(action);
    const blockingService = AppBlockingService.getInstance();

    switch (action.type) {
      case 'start_focus_session': {
        if (await blockingService.isFocusSessionActive()) {
          router.push('/blocking');
          return { status: 'navigated', actionKey };
        }

        const hasUsage = await CapabilitiesService.hasUsageAccess();
        if (!hasUsage) {
          await CapabilitiesService.ensureUsageAccess('insight_cta');
          InsightInvalidationService.emit({
            type: 'permissions_changed',
            source: 'insight_action',
          });
          return { status: 'needs_permission', actionKey, permission: 'usage' };
        }

        const hasAccessibility = await CapabilitiesService.hasAccessibilityPermission();
        if (!hasAccessibility) {
          await CapabilitiesService.ensureAccessibilityPermission('insight_cta');
          InsightInvalidationService.emit({
            type: 'permissions_changed',
            source: 'insight_action',
          });
          return { status: 'needs_permission', actionKey, permission: 'accessibility' };
        }

        const started = await blockingService.startFocusSession();
        if (!started) {
          return { status: 'no_op', actionKey };
        }

        await InsightMemoryService.recordAction(actionKey);
        InsightInvalidationService.emit({
          type: 'focus_session_changed',
          source: 'insight_action',
        });
        InsightInvalidationService.emit({
          type: 'insight_action_applied',
          source: 'insight_action',
          actionKey,
        });
        return { status: 'applied', actionKey };
      }

      case 'set_app_mode_limit': {
        const protectedApps = await blockingService.getProtectedApps();
        const existing = protectedApps.find((app) => app.packageName === action.packageName);
        if (existing?.protectionMode === 'limit') {
          router.push('/blocking');
          return { status: 'navigated', actionKey };
        }

        const hasOverlay = await CapabilitiesService.hasOverlayPermission();
        const hasAccessibility = await CapabilitiesService.hasAccessibilityPermission();
        if (!hasOverlay && !hasAccessibility) {
          await CapabilitiesService.ensureOverlayPermission('insight_cta');
          InsightInvalidationService.emit({
            type: 'permissions_changed',
            source: 'insight_action',
          });
          return { status: 'needs_permission', actionKey, permission: 'overlay' };
        }

        await blockingService.setProtectionMode(
          action.packageName,
          action.appName,
          'limit',
          source
        );
        await InsightMemoryService.recordAction(actionKey);
        InsightInvalidationService.emit({
          type: 'protected_apps_changed',
          source: 'insight_action',
          packageName: action.packageName,
        });
        InsightInvalidationService.emit({
          type: 'insight_action_applied',
          source: 'insight_action',
          actionKey,
        });
        return { status: 'applied', actionKey };
      }

      case 'set_app_mode_locked': {
        const protectedApps = await blockingService.getProtectedApps();
        const existing = protectedApps.find((app) => app.packageName === action.packageName);
        if (existing?.protectionMode === 'locked') {
          router.push('/blocking');
          return { status: 'navigated', actionKey };
        }

        const hasAccessibility = await CapabilitiesService.hasAccessibilityPermission();
        if (!hasAccessibility) {
          await CapabilitiesService.ensureAccessibilityPermission('insight_cta');
          InsightInvalidationService.emit({
            type: 'permissions_changed',
            source: 'insight_action',
          });
          return { status: 'needs_permission', actionKey, permission: 'accessibility' };
        }

        await blockingService.setProtectionMode(
          action.packageName,
          action.appName,
          'locked',
          source
        );
        await InsightMemoryService.recordAction(actionKey);
        InsightInvalidationService.emit({
          type: 'protected_apps_changed',
          source: 'insight_action',
          packageName: action.packageName,
        });
        InsightInvalidationService.emit({
          type: 'insight_action_applied',
          source: 'insight_action',
          actionKey,
        });
        return { status: 'applied', actionKey };
      }

      case 'open_replay_at_time_window': {
        router.push({
          pathname: '/replay',
          params: { moment: action.moment },
        });
        return { status: 'navigated', actionKey };
      }

      case 'open_focus_screen': {
        router.push('/blocking');
        return { status: 'navigated', actionKey };
      }

      case 'open_permissions_accessibility': {
        await CapabilitiesService.ensureAccessibilityPermission('insight_cta');
        InsightInvalidationService.emit({
          type: 'permissions_changed',
          source: 'insight_action',
        });
        return { status: 'needs_permission', actionKey, permission: 'accessibility' };
      }
    }
  }

  static getActionKey(action: InsightAction): string {
    switch (action.type) {
      case 'start_focus_session':
        return 'start_focus_session';
      case 'set_app_mode_limit':
        return `set_app_mode_limit:${action.packageName}`;
      case 'set_app_mode_locked':
        return `set_app_mode_locked:${action.packageName}`;
      case 'open_replay_at_time_window':
        return `open_replay_at_time_window:${action.moment}`;
      case 'open_focus_screen':
        return 'open_focus_screen';
      case 'open_permissions_accessibility':
        return 'open_permissions_accessibility';
    }
  }
}
