import * as Sentry from "@sentry/react-native";
import type { PostHogEventProperties } from "@posthog/core";
import PostHog from "posthog-react-native";

import type { TelemetryEventMap, TelemetryEventName } from "@/services/TelemetryEvents";
import { database } from "./database";

const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
const telemetryConfig: Sentry.ReactNativeOptions = {
  dsn: sentryDsn,
  sendDefaultPii: false,
  enableLogs: false,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  integrations: [Sentry.feedbackIntegration()],
};

const posthogApiKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
const posthogHost = process.env.EXPO_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

export class TelemetryService {
  private static initialized = false;
  private static sentryPrimed = false;
  private static enabled = true;
  private static posthogClient: PostHog | null = null;
  private static anonymousId: string | null = null;
  private static debugEvents: Array<{
    event: string;
    properties?: PostHogEventProperties;
    capturedAt: number;
  }> = [];

  static prime(): void {
    if (this.sentryPrimed || !sentryDsn) {
      return;
    }

    Sentry.init({
      ...telemetryConfig,
      enabled: true,
    });
    this.sentryPrimed = true;
  }

  static async initialize(): Promise<void> {
    this.prime();

    const analyticsEnabled = (await database.getMeta("analytics_enabled")) !== "false";
    this.enabled = analyticsEnabled;

    if (!this.initialized) {
      this.initialized = true;
    }

    const anonymousId = await this.getAnonymousId();
    this.setSentryUserContext(anonymousId);
    await this.ensurePostHogClient();
    this.identify(anonymousId, {
      identity_type: "anonymous_install",
    });
    await this.syncPostHogOptState();
  }

  static async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    await database.setMeta("analytics_enabled", enabled.toString());
    await this.ensurePostHogClient();
    await this.syncPostHogOptState();
  }

  static isEnabled(): boolean {
    return this.enabled;
  }

  static capture(event: string, properties?: PostHogEventProperties): void {
    this.recordDebugEvent(event, properties);
    if (!this.enabled || !this.posthogClient) {
      return;
    }

    this.posthogClient.capture(event, properties);
  }

  static track<EventName extends TelemetryEventName>(
    event: EventName,
    properties: TelemetryEventMap[EventName]
  ): void {
    this.capture(event, properties as PostHogEventProperties);
  }

  static async trackOnce<EventName extends TelemetryEventName>(
    metaKey: string,
    event: EventName,
    properties: TelemetryEventMap[EventName]
  ): Promise<boolean> {
    const existing = await database.getMeta(metaKey);
    if (existing === "true") {
      return false;
    }

    this.track(event, properties);
    await database.setMeta(metaKey, "true");
    return true;
  }

  static async screen(name: string, properties?: PostHogEventProperties): Promise<void> {
    this.recordDebugEvent(`screen:${name}`, properties);
    if (!this.enabled || !this.posthogClient) {
      return;
    }

    await this.posthogClient.screen(name, properties);
  }

  static identify(distinctId: string, properties?: PostHogEventProperties): void {
    this.recordDebugEvent('identify', {
      distinct_id_preview: distinctId.slice(0, 12),
      ...properties,
    });
    if (!this.enabled || !this.posthogClient) {
      return;
    }

    this.posthogClient.identify(distinctId, properties);
  }

  static identifyAuthenticatedUser(userId: string, properties?: PostHogEventProperties): void {
    if (sentryDsn) {
      Sentry.setUser({ id: userId });
    }

    this.identify(userId, {
      identity_type: "authenticated_user",
      ...properties,
    });
  }

  static async resetToAnonymous(): Promise<void> {
    const anonymousId = await this.getAnonymousId();

    if (this.posthogClient) {
      this.posthogClient.reset();
    }

    this.setSentryUserContext(anonymousId);

    if (this.enabled && this.posthogClient) {
      this.posthogClient.identify(anonymousId, {
        identity_type: "anonymous_install",
      });
    }

    await this.syncPostHogOptState();
  }

  static reset(): void {
    void this.resetToAnonymous();
  }

  static captureException(error: Error | unknown, properties?: PostHogEventProperties): void {
    this.recordDebugEvent('exception_captured', properties);
    if (!sentryDsn) {
      return;
    }

    Sentry.withScope((scope) => {
      if (properties) {
        scope.setContext("error_metadata", this.sanitizeProperties(properties));
      }
      Sentry.captureException(error);
    });
  }

  static getDebugEvents(): Array<{
    event: string;
    properties?: PostHogEventProperties;
    capturedAt: number;
  }> {
    return [...this.debugEvents];
  }

  private static async ensurePostHogClient(): Promise<void> {
    if (this.posthogClient || !posthogApiKey) {
      return;
    }

    this.posthogClient = new PostHog(posthogApiKey, {
      host: posthogHost,
      defaultOptIn: false,
      captureAppLifecycleEvents: true,
      disableRemoteConfig: true,
      disableSurveys: true,
      preloadFeatureFlags: false,
      sendFeatureFlagEvent: false,
      persistence: "file",
      personProfiles: "identified_only",
    });

    await this.posthogClient.ready();
  }

  private static recordDebugEvent(event: string, properties?: PostHogEventProperties): void {
    this.debugEvents = [
      {
        event,
        properties,
        capturedAt: Date.now(),
      },
      ...this.debugEvents,
    ].slice(0, 40);
  }

  private static async getAnonymousId(): Promise<string> {
    if (this.anonymousId) {
      return this.anonymousId;
    }

    const existing = await database.getMeta("telemetry_anonymous_id");
    if (existing) {
      this.anonymousId = existing;
      return existing;
    }

    const created = `anon_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    await database.setMeta("telemetry_anonymous_id", created);
    this.anonymousId = created;
    return created;
  }

  private static setSentryUserContext(anonymousId: string): void {
    if (!sentryDsn) {
      return;
    }

    Sentry.setUser({
      id: anonymousId,
    });
  }

  private static sanitizeProperties(properties: PostHogEventProperties): Record<string, string> {
    const entries = Object.entries(properties).map(([key, value]) => [key, String(value)]);
    return Object.fromEntries(entries);
  }

  private static async syncPostHogOptState(): Promise<void> {
    if (!this.posthogClient) {
      return;
    }

    if (this.enabled) {
      await this.posthogClient.optIn();
      return;
    }

    await this.posthogClient.optOut();
  }
}
