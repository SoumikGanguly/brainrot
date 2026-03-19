import React from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function TermsScreen() {
  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScrollView className="flex-1 px-md py-lg" showsVerticalScrollIndicator={false}>
        <Text className="text-2xl font-bold text-text mb-md">Terms of Service</Text>
        <Text className="text-base text-muted mb-md">
          Brainrot provides digital-wellness tools on a best-effort basis. Android enforcement behavior can vary by device, permissions, and OEM battery rules.
        </Text>
        <Text className="text-base text-muted mb-md">
          Hard blocking on Android depends on Accessibility access and should be treated as strong best-effort enforcement rather than an absolute lockout.
        </Text>
        <Text className="text-base text-muted">
          You are responsible for reviewing and managing the permissions you grant to the app in Android settings.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

