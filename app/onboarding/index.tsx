import { router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton, SecondaryButton } from '../../components/Buttons';
import { Card } from '../../components/Card';
import { Toggle } from '../../components/Toggle';
import { TrialService } from '../../services/TrialService';
import { UsageService } from '../../services/UsageService';
import { database } from '../../services/database';

const RECOMMENDED_APPS = [
  { packageName: 'com.google.android.youtube', appName: 'YouTube', monitored: true },
  { packageName: 'com.instagram.android', appName: 'Instagram', monitored: true },
  { packageName: 'com.whatsapp', appName: 'WhatsApp', monitored: true },
  { packageName: 'com.facebook.katana', appName: 'Facebook', monitored: true },
  { packageName: 'com.ss.android.ugc.tiktok', appName: 'TikTok', monitored: true },
];

export default function OnboardingScreen() {
  const [currentStep, setCurrentStep] = useState(0);
  const [monitoredApps, setMonitoredApps] = useState(RECOMMENDED_APPS);
  const [hasUsageAccess, setHasUsageAccess] = useState(false);

  const checkUsageAccess = async () => {
    const hasAccess = await UsageService.isUsageAccessGranted();
    setHasUsageAccess(hasAccess);
    return hasAccess;
  };

  const openUsageSettings = async () => {
    await UsageService.openUsageAccessSettings();
    // Check again after a delay
    setTimeout(async () => {
      const hasAccess = await checkUsageAccess();
      if (hasAccess) {
        setCurrentStep(2);
      }
    }, 1000);
  };

  const toggleAppMonitoring = (packageName: string) => {
    setMonitoredApps(prev => 
      prev.map(app => 
        app.packageName === packageName 
          ? { ...app, monitored: !app.monitored }
          : app
      )
    );
  };

  const finishOnboarding = async () => {
    try {
      // Save monitored apps
      for (const app of monitoredApps) {
        await database.setMeta(`app_monitored_${app.packageName}`, app.monitored.toString());
      }

      // Start trial
      await TrialService.startTrial();

      // Mark onboarding as complete
      await database.setMeta('onboarding_completed', 'true');

      // Navigate to main app
      router.replace('/');
    } catch (error) {
      console.error('Error finishing onboarding:', error);
      Alert.alert('Error', 'Failed to complete setup. Please try again.');
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <View className="flex-1 justify-center">
            <View className="items-center mb-lg">
              <Text className="text-4xl mb-md">🧠</Text>
              <Text className="text-2xl font-bold text-text mb-sm">Welcome to Brainrot</Text>
              <Text className="text-base text-muted text-center leading-6">
                Brainrot helps you see how apps affect your focus. We keep data on your device. 
                No servers. No judgement.
              </Text>
            </View>
            <PrimaryButton 
              title="Get Started" 
              onPress={() => setCurrentStep(1)}
            />
          </View>
        );

      case 1:
        return (
          <View className="flex-1">
            <View className="flex-1 justify-center">
              <View className="items-center mb-lg">
                <Text className="text-4xl mb-md">📊</Text>
                <Text className="text-2xl font-bold text-text mb-sm">Allow Usage Access</Text>
                <Text className="text-base text-muted text-center leading-6 mb-lg">
                  Brainrot needs Usage Access to see which apps you use and for how long. 
                  This data stays on your device. Tap &apos;Open settings&apos; and enable Brainrot.
                </Text>
                {hasUsageAccess && (
                  <View className="bg-green-50 p-sm rounded-lg border border-green-200 mb-md">
                    <Text className="text-green-800 text-center">✅ Usage access granted!</Text>
                  </View>
                )}
              </View>
              <PrimaryButton 
                title="Open Settings" 
                onPress={openUsageSettings}
                className="mb-sm"
              />
              {hasUsageAccess && (
                <SecondaryButton 
                  title="Continue" 
                  onPress={() => setCurrentStep(2)}
                />
              )}
            </View>
          </View>
        );

      case 2:
        return (
          <View className="flex-1">
            <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
              <View className="items-center mb-lg">
                <Text className="text-4xl mb-md">🎯</Text>
                <Text className="text-2xl font-bold text-text mb-sm">Select Apps to Monitor</Text>
                <Text className="text-base text-muted text-center leading-6">
                  We recommend monitoring these apps for most users. You can change this later.
                </Text>
              </View>

              <Card>
                <Text className="text-lg font-semibold text-text mb-md">Recommended Apps</Text>
                {monitoredApps.map((app) => (
                  <View key={app.packageName} className="flex-row items-center justify-between py-sm">
                    <Text className="text-base text-text flex-1">{app.appName}</Text>
                    <Toggle
                      value={app.monitored}
                      onValueChange={() => toggleAppMonitoring(app.packageName)}
                    />
                  </View>
                ))}
              </Card>
            </ScrollView>

            <View className="p-md">
              <PrimaryButton 
                title="Start 7-day Trial" 
                onPress={finishOnboarding}
              />
            </View>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-1 px-md py-lg">
        {/* Progress indicator */}
        <View className="flex-row mb-lg">
          {[0, 1, 2].map((step) => (
            <View
              key={step}
              className={`flex-1 h-1 rounded-full mx-xs ${
                step <= currentStep ? 'bg-accent' : 'bg-gray-200'
              }`}
            />
          ))}
        </View>

        {renderStep()}
      </View>
    </SafeAreaView>
  );
}