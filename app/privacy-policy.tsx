import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function PrivacyPolicyScreen() {
  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScrollView className="flex-1 px-md py-lg" showsVerticalScrollIndicator={false}>
        <Text className="mb-md font-heading-bold text-section text-text">Privacy Policy</Text>
        <Text className="mb-md font-body text-body text-text">
          Brainrot stores monitored apps, usage summaries, blocking settings, and daily score data on your device.
        </Text>
        <Text className="mb-md font-body text-body text-text">
          Brainrot sends crash and error diagnostics to Sentry so app failures can be investigated and fixed. This crash reporting is part of the app&apos;s reliability tooling and is not turned off by the Product Analytics setting.
        </Text>
        <Text className="mb-md font-body text-body text-text">
          If Product Analytics is enabled, Brainrot also sends product analytics events to PostHog. These analytics include screen views and selected product actions such as onboarding completion, monitored-app selection counts, blocking changes, notification preference changes, permission grant outcomes, and purchase/paywall interactions.
        </Text>
        <Text className="mb-md font-body text-body text-text">
          PostHog analytics are enabled by default, and the app stores a stable anonymous install identifier so analytics can stay consistent across launches before account sign-in exists. PostHog exception forwarding is disabled, and PostHog session replay is not enabled in the app.
        </Text>
        <Text className="mb-md font-body text-body text-text">
          If you choose Google sign-in, Brainrot authenticates your account through Firebase Auth and stores a cloud backup in Firestore. That backup includes your account profile basics, selected product settings, monitored app configuration, blocked app configuration, and up to 90 days of daily summary history.
        </Text>
        <Text className="mb-md font-body text-body text-text">
          On the first successful sign-in, the app uploads the current local device state so it can be restored later. Brainrot does not upload raw per-app daily usage rows or notification history as part of this first cloud backup flow.
        </Text>
        <Text className="mb-md font-body text-body text-text">
          Permissions such as Usage Access, Accessibility, notifications, and overlay access are used only for the feature you turn on in settings.
        </Text>
        <View className="rounded-xl bg-card p-md">
          <Text className="font-body text-secondary text-muted">
            Turning Product Analytics off in Settings disables future PostHog analytics collection from the app runtime. Sentry crash reporting remains on so the app can continue reporting crashes and severe runtime failures.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
