import { TelemetryService } from './TelemetryService';
import {
  UnifiedUsageService,
  type MonitoringDiagnostics,
} from './UnifiedUsageService';
import { database } from './database';

const DAILY_SAMPLE_KEY = 'monitoring_diagnostics_sampled_on';

export class MonitoringDiagnosticsService {
  static async getDiagnostics(): Promise<MonitoringDiagnostics | null> {
    return UnifiedUsageService.getMonitoringDiagnostics();
  }

  static async sampleDailyTelemetry(): Promise<void> {
    if (!TelemetryService.isEnabled()) {
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    if ((await database.getMeta(DAILY_SAMPLE_KEY)) === today) {
      return;
    }

    const diagnostics = await this.getDiagnostics();
    if (!diagnostics) {
      return;
    }

    TelemetryService.capture('monitoring_diagnostics_sampled', {
      usage_access_granted: diagnostics.usageAccessGranted,
      overlay_permission_granted: diagnostics.overlayPermissionGranted,
      accessibility_granted: diagnostics.accessibilityGranted,
      monitoring_enabled: diagnostics.monitoringEnabled,
      background_checks_enabled: diagnostics.backgroundChecksEnabled,
      realtime_monitoring_enabled: diagnostics.realtimeMonitoringEnabled,
      realtime_loop_running: diagnostics.realtimeLoopRunning,
      pending_block_events: diagnostics.pendingBlockEvents,
      usage_query_count: diagnostics.usageQueryCount,
      event_query_count: diagnostics.eventQueryCount,
      foreground_query_count: diagnostics.foregroundQueryCount,
      battery_percent: diagnostics.batteryPercent,
      battery_charging: diagnostics.batteryCharging,
      last_blocking_failure_reason: diagnostics.lastBlockingFailureReason || null,
    });
    await database.setMeta(DAILY_SAMPLE_KEY, today);
  }
}
