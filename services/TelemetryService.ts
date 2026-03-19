import * as Sentry from '@sentry/react-native';
import type { PostHogEventProperties } from '@posthog/core';
import PostHog from 'posthog-react-native';
import { database } from './database';

const telemetryConfig: Sentry.ReactNativeOptions = {
  dsn: 'https://9b34110d63c83e3c44cf92f42fd015fa@o4507884823445504.ingest.de.sentry.io/4510183511818320',
  sendDefaultPii: false,
  enableLogs: false,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1,
  integrations: [Sentry.mobileReplayIntegration(), Sentry.feedbackIntegration()],
};

const posthogApiKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
const posthogHost = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

export class TelemetryService {
  private static initialized = false;
  private static enabled = true;
  private static posthogClient: PostHog | null = null;

  static async initialize(): Promise<void> {
    const analyticsEnabled = (await database.getMeta('analytics_enabled')) !== 'false';
    this.enabled = analyticsEnabled;

    if (!this.initialized) {
      Sentry.init({
        ...telemetryConfig,
        enabled: analyticsEnabled,
      });
      this.initialized = true;
    } else if (!analyticsEnabled) {
      await Sentry.close();
    } else {
      Sentry.init({
        ...telemetryConfig,
        enabled: true,
      });
    }

    await this.ensurePostHogClient();
    await this.syncPostHogOptState();
  }

  static async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    await database.setMeta('analytics_enabled', enabled.toString());

    if (enabled) {
      Sentry.init({
        ...telemetryConfig,
        enabled: true,
      });
      this.initialized = true;
    } else {
      await Sentry.close();
    }

    await this.ensurePostHogClient();
    await this.syncPostHogOptState();
  }

  static isEnabled(): boolean {
    return this.enabled;
  }

  static capture(event: string, properties?: PostHogEventProperties): void {
    if (!this.enabled || !this.posthogClient) {
      return;
    }

    this.posthogClient.capture(event, properties);
  }

  static async screen(name: string, properties?: PostHogEventProperties): Promise<void> {
    if (!this.enabled || !this.posthogClient) {
      return;
    }

    await this.posthogClient.screen(name, properties);
  }

  static identify(distinctId: string, properties?: PostHogEventProperties): void {
    if (!this.enabled || !this.posthogClient) {
      return;
    }

    this.posthogClient.identify(distinctId, properties);
  }

  static reset(): void {
    this.posthogClient?.reset();
  }

  static captureException(error: Error | unknown, properties?: PostHogEventProperties): void {
    if (this.enabled) {
      Sentry.captureException(error);
      this.posthogClient?.captureException(error, properties);
    }
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
      persistence: 'file',
      personProfiles: 'identified_only',
    });

    await this.posthogClient.ready();
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
