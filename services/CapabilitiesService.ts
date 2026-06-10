import * as Notifications from "expo-notifications";

import {
  buildPermissionTelemetry,
  type PermissionTrigger,
} from "@/services/TelemetryEvents";
import { NotificationService } from "./NotificationService";
import { TelemetryService } from "./TelemetryService";
import { UnifiedUsageService } from "./UnifiedUsageService";
import { database } from "./database";

const LAST_PERMISSION_HELPER_OPENED_AT_KEY = "permission_helper_last_opened_at";
const LAST_PERMISSION_HELPER_CONTEXT_KEY = "permission_helper_last_context";

export class CapabilitiesService {
  private static async markPermissionHelperOpened(trigger: PermissionTrigger): Promise<void> {
    await Promise.all([
      database.setMeta(LAST_PERMISSION_HELPER_OPENED_AT_KEY, Date.now().toString()),
      database.setMeta(LAST_PERMISSION_HELPER_CONTEXT_KEY, trigger),
    ]);
  }

  static async getPermissionHelperExposure(): Promise<{
    lastOpenedAt: number;
    context: string | null;
  }> {
    const [lastOpenedAtRaw, context] = await Promise.all([
      database.getMeta(LAST_PERMISSION_HELPER_OPENED_AT_KEY),
      database.getMeta(LAST_PERMISSION_HELPER_CONTEXT_KEY),
    ]);
    return {
      lastOpenedAt: parseInt(lastOpenedAtRaw || "0", 10) || 0,
      context,
    };
  }

  static async recordPermissionHelperExposure(
    trigger: PermissionTrigger = "settings"
  ): Promise<void> {
    await this.markPermissionHelperOpened(trigger);
  }

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
    await this.markPermissionHelperOpened(trigger);
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
    await this.markPermissionHelperOpened(trigger);
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

    await this.markPermissionHelperOpened(trigger);
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
    await this.markPermissionHelperOpened(trigger);
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
    await this.markPermissionHelperOpened(trigger);
    return UnifiedUsageService.openManufacturerSettings();
  }

  static async requestBatteryOptimizationExemption(
    trigger: PermissionTrigger = "settings"
  ): Promise<boolean> {
    TelemetryService.track("accessibility_helper_opened", buildPermissionTelemetry(trigger));
    await this.markPermissionHelperOpened(trigger);
    return UnifiedUsageService.requestBatteryOptimizationExemption();
  }
}
