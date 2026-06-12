import { database } from "./database";
import { TelemetryService } from "./TelemetryService";
import type { ExpiredFlowState } from "./SubscriptionAccessService";

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export class AppOpenTelemetryService {
  private static readonly APP_OPEN_COUNT_PREFIX = "app_open_count_";
  private static readonly LAST_APP_OPEN_AT_KEY = "last_app_open_at";

  static async trackAppOpen(
    subscriptionStatus?: "trial" | "active" | "expired",
    expiredFlowState?: ExpiredFlowState
  ): Promise<void> {
    const now = new Date();
    const localDate = formatLocalDate(now);
    const metaKey = `${this.APP_OPEN_COUNT_PREFIX}${localDate}`;
    const [currentCountRaw, lastAppOpenAtRaw] = await Promise.all([
      database.getMeta(metaKey),
      database.getMeta(this.LAST_APP_OPEN_AT_KEY),
    ]);
    const currentCount = parseInt(currentCountRaw || "0", 10);
    const openCountForDay = Number.isFinite(currentCount) ? currentCount + 1 : 1;
    const lastAppOpenAt = parseInt(lastAppOpenAtRaw || "0", 10);
    const gapMs =
      Number.isFinite(lastAppOpenAt) && lastAppOpenAt > 0
        ? now.getTime() - lastAppOpenAt
        : 0;

    await Promise.all([
      database.setMeta(metaKey, String(openCountForDay)),
      database.setMeta(this.LAST_APP_OPEN_AT_KEY, now.getTime().toString()),
    ]);
    TelemetryService.track("app_opened", {
      local_date: localDate,
      open_count_for_day: openCountForDay,
      open_hour_local: now.getHours(),
      subscription_status: subscriptionStatus,
      hours_since_last_open:
        gapMs > 0 ? Number((gapMs / (60 * 60 * 1000)).toFixed(1)) : undefined,
      days_since_last_open:
        gapMs > 0 ? Math.floor(gapMs / (24 * 60 * 60 * 1000)) : undefined,
    });

    if (subscriptionStatus === "expired") {
      TelemetryService.track("expired_app_opened", {
        local_date: localDate,
        open_count_for_day: openCountForDay,
        open_hour_local: now.getHours(),
        screen: expiredFlowState === "declined" ? "returning" : expiredFlowState || "intro",
        hours_since_last_open:
          gapMs > 0 ? Number((gapMs / (60 * 60 * 1000)).toFixed(1)) : undefined,
        days_since_last_open:
          gapMs > 0 ? Math.floor(gapMs / (24 * 60 * 60 * 1000)) : undefined,
      });
    }
  }
}
