import * as Notifications from 'expo-notifications';
import { NotificationService } from './NotificationService';
import { TelemetryService } from './TelemetryService';
import { UnifiedUsageService } from './UnifiedUsageService';

export class CapabilitiesService {
  static async hasUsageAccess(): Promise<boolean> {
    return UnifiedUsageService.isUsageAccessGranted();
  }

  static async ensureUsageAccess(): Promise<boolean> {
    if (await this.hasUsageAccess()) {
      TelemetryService.capture('permission_grant_success', {
        permission: 'usage_access',
        source: 'already_granted',
      });
      return true;
    }

    TelemetryService.capture('permission_grant_failure', {
      permission: 'usage_access',
      source: 'redirect_to_settings',
    });
    await UnifiedUsageService.openUsageAccessSettings();
    return false;
  }

  static async hasNotificationPermission(): Promise<boolean> {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  }

  static async ensureNotificationPermission(): Promise<boolean> {
    if (await this.hasNotificationPermission()) {
      TelemetryService.capture('permission_grant_success', {
        permission: 'notifications',
        source: 'already_granted',
      });
      return true;
    }

    const granted = await NotificationService.requestPermission();
    TelemetryService.capture(granted ? 'permission_grant_success' : 'permission_grant_failure', {
      permission: 'notifications',
      source: 'permission_prompt',
    });
    return granted;
  }

  static async hasOverlayPermission(): Promise<boolean> {
    return UnifiedUsageService.hasOverlayPermission();
  }

  static async ensureOverlayPermission(): Promise<boolean> {
    if (await this.hasOverlayPermission()) {
      TelemetryService.capture('permission_grant_success', {
        permission: 'overlay',
        source: 'already_granted',
      });
      return true;
    }

    TelemetryService.capture('permission_grant_failure', {
      permission: 'overlay',
      source: 'redirect_to_settings',
    });
    await UnifiedUsageService.requestOverlayPermission();
    return false;
  }

  static async hasAccessibilityPermission(): Promise<boolean> {
    return UnifiedUsageService.hasAccessibilityPermission();
  }

  static async ensureAccessibilityPermission(): Promise<boolean> {
    if (await this.hasAccessibilityPermission()) {
      TelemetryService.capture('permission_grant_success', {
        permission: 'accessibility',
        source: 'already_granted',
      });
      return true;
    }

    TelemetryService.capture('permission_grant_failure', {
      permission: 'accessibility',
      source: 'redirect_to_settings',
    });
    await UnifiedUsageService.openAccessibilitySettings();
    return false;
  }

  static async getBackgroundReliabilityGuidance(): Promise<{
    needsManufacturerGuidance: boolean;
    title?: string;
    instructions?: string;
    canOpenDirectly?: boolean;
  }> {
    const manufacturerInfo = await UnifiedUsageService.getManufacturerInfo();
    if (manufacturerInfo?.needsSpecialPermission) {
      return {
        needsManufacturerGuidance: true,
        title: manufacturerInfo.title,
        instructions: manufacturerInfo.instructions,
        canOpenDirectly: manufacturerInfo.canOpenDirectly,
      };
    }

    return { needsManufacturerGuidance: false };
  }

  static async openBackgroundReliabilitySettings(): Promise<boolean> {
    return UnifiedUsageService.openManufacturerSettings();
  }
}
