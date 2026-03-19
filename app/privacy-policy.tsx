import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function PrivacyPolicyScreen() {
  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScrollView className="flex-1 px-md py-lg" showsVerticalScrollIndicator={false}>
        <Text className="text-2xl font-bold text-text mb-md">Privacy Policy</Text>
        <Text className="text-base text-muted mb-md">
          Brainrot stores monitored apps, usage summaries, blocking settings, and daily score data on your device.
        </Text>
        <Text className="text-base text-muted mb-md">
          If Diagnostics is enabled, the app may send crash reports and product analytics to configured providers such as Sentry and PostHog so problems can be investigated and app usage can be understood.
        </Text>
        <Text className="text-base text-muted mb-md">
          Permissions such as Usage Access, Accessibility, notifications, and overlay access are used only for the feature you turn on in settings.
        </Text>
        <View className="rounded-xl bg-surface p-md">
          <Text className="text-sm text-muted">
            Turning Diagnostics off in Settings disables future telemetry collection from the app runtime.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
