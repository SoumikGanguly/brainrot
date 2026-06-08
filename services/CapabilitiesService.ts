import * as Notifications from "expo-notifications";

import {
  buildPermissionTelemetry,
  type PermissionTrigger,
} from "@/services/TelemetryEvents";
import { NotificationService } from "./NotificationService";
import { TelemetryService } from "./TelemetryService";
import { UnifiedUsageService } from "./UnifiedUsageService";

export class CapabilitiesService {
  static async hasUsageAccess(): Promise<boolean> {
    return UnifiedUsageService.isUsageAccessGranted();
  }

  static async ensureUsageAccess(trigger: PermissionTrigger = "settings"): Promise<boolean> {
    if (await this.hasUsageAccess()) {
      TelemetryService.track("usage_access_granted", {
        screen_name: trigger,
        permission_result: "granted",
      });
      return true;
    }

    TelemetryService.track("usage_access_prompt_shown", {
      screen_name: trigger,
    });
    await UnifiedUsageService.openUsageAccessSettings();
    return false;
  }

  static async hasNotificationPermission(): Promise<boolean> {
    const { status } = await Notifications.getPermissionsAsync();
    return status === "granted";
  }

  static async ensureNotificationPermission(
    trigger: PermissionTrigger = "settings"
  ): Promise<boolean> {
    if (await this.hasNotificationPermission()) {
      TelemetryService.track("notification_permission_granted", buildPermissionTelemetry(trigger));
      return true;
    }

    const granted = await NotificationService.requestPermission();
    if (granted) {
      TelemetryService.track("notification_permission_granted", buildPermissionTelemetry(trigger));
    }
    return granted;
  }

  static async hasOverlayPermission(): Promise<boolean> {
    return UnifiedUsageService.hasOverlayPermission();
  }

  static async ensureOverlayPermission(
    trigger: PermissionTrigger = "settings"
  ): Promise<boolean> {
    if (await this.hasOverlayPermission()) {
      TelemetryService.track("overlay_permission_granted", buildPermissionTelemetry(trigger));
      return true;
    }

    await UnifiedUsageService.requestOverlayPermission();
    return false;
  }

  static async hasAccessibilityPermission(): Promise<boolean> {
    return UnifiedUsageService.hasAccessibilityPermission();
  }

  static async ensureAccessibilityPermission(
    trigger: PermissionTrigger = "settings"
  ): Promise<boolean> {
    if (await this.hasAccessibilityPermission()) {
      TelemetryService.track("accessibility_granted", buildPermissionTelemetry(trigger));
      return true;
    }

    TelemetryService.track("accessibility_prompt_shown", buildPermissionTelemetry(trigger));
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

  static async openBackgroundReliabilitySettings(trigger: PermissionTrigger = "settings"): Promise<boolean> {
    TelemetryService.track("accessibility_helper_opened", buildPermissionTelemetry(trigger));
    return UnifiedUsageService.openManufacturerSettings();
  }
}
