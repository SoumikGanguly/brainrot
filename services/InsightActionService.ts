import type { Href } from 'expo-router';

import { CapabilitiesService } from './CapabilitiesService';
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
    _source: ProtectionSource = 'insight_cta'
  ): Promise<InsightActionResult> {
    const actionKey = this.getActionKey(action);

    switch (action.type) {
      case 'start_focus_session': {
        await InsightMemoryService.recordAction(actionKey);
        router.push('/blocking');
        return { status: 'navigated', actionKey };
      }

      case 'set_app_mode_limit': {
        await InsightMemoryService.recordAction(actionKey);
        router.push('/blocking');
        return { status: 'navigated', actionKey };
      }

      case 'set_app_mode_locked': {
        await InsightMemoryService.recordAction(actionKey);
        router.push('/blocking');
        return { status: 'navigated', actionKey };
      }

      case 'open_replay_at_time_window': {
        router.push({
          pathname: '/replay',
          params: { moment: action.moment },
        });
        return { status: 'navigated', actionKey };
      }

      case 'open_focus_screen': {
        await InsightMemoryService.recordAction(actionKey);
        router.push('/blocking');
        return { status: 'navigated', actionKey };
      }

      case 'open_permissions_accessibility': {
        await CapabilitiesService.ensureAccessibilityPermission('insight_cta');
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
