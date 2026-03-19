import * as Notifications from 'expo-notifications';
import { NotificationService } from './NotificationService';
import { UnifiedUsageService } from './UnifiedUsageService';

export class CapabilitiesService {
  static async hasUsageAccess(): Promise<boolean> {
    return UnifiedUsageService.isUsageAccessGranted();
  }

  static async ensureUsageAccess(): Promise<boolean> {
    if (await this.hasUsageAccess()) {
      return true;
    }

    await UnifiedUsageService.openUsageAccessSettings();
    return false;
  }

  static async hasNotificationPermission(): Promise<boolean> {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  }

  static async ensureNotificationPermission(): Promise<boolean> {
    if (await this.hasNotificationPermission()) {
      return true;
    }

    return NotificationService.requestPermission();
  }

  static async hasOverlayPermission(): Promise<boolean> {
    return UnifiedUsageService.hasOverlayPermission();
  }

  static async ensureOverlayPermission(): Promise<boolean> {
    if (await this.hasOverlayPermission()) {
      return true;
    }

    await UnifiedUsageService.requestOverlayPermission();
    return false;
  }

  static async hasAccessibilityPermission(): Promise<boolean> {
    return UnifiedUsageService.hasAccessibilityPermission();
  }

  static async ensureAccessibilityPermission(): Promise<boolean> {
    if (await this.hasAccessibilityPermission()) {
      return true;
    }

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
