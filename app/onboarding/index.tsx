import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton, SecondaryButton } from '../../components/Buttons';
import { Card } from '../../components/Card';
import { Toggle } from '../../components/Toggle';
import { TrialService } from '../../services/TrialService';
import { UnifiedUsageService } from '../../services/UnifiedUsageService';
import { UsageService } from '../../services/UsageService';
import { database } from '../../services/database';

// Default recommended apps - these will be pre-selected
const RECOMMENDED_PACKAGES = new Set([
  'com.google.android.youtube',
  'com.instagram.android',
  'com.whatsapp',
  'com.facebook.katana',
  'com.ss.android.ugc.tiktok',
  'com.zhiliaoapp.musically',
  'com.twitter.android',
  'com.snapchat.android',
  'com.reddit.frontpage',
  'com.discord',
  'com.netflix.mediaclient',
]);

interface AppItem {
  packageName: string;
  appName: string;
  monitored: boolean;
  isRecommended: boolean;
}

export default function OnboardingScreen() {
  const [currentStep, setCurrentStep] = useState(0);
  const [monitoredApps, setMonitoredApps] = useState<AppItem[]>([]);
  const [hasUsageAccess, setHasUsageAccess] = useState(false);
  const [loadingApps, setLoadingApps] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAllApps, setShowAllApps] = useState(false);

  const checkUsageAccess = async () => {
    const hasAccess = await UsageService.isUsageAccessGranted();
    setHasUsageAccess(hasAccess);
    return hasAccess;
  };

  // Load all installed apps when we reach step 2
  useEffect(() => {
    if (currentStep === 2 && monitoredApps.length === 0) {
      loadInstalledApps();
    }
  }, [currentStep]);

  const loadInstalledApps = async () => {
    setLoadingApps(true);
    try {
      // Get all installed apps from native module
      const installedApps = await UnifiedUsageService.getAllInstalledApps();
      
      // Map to our format with monitored state (pre-select recommended apps)
      const appsWithState: AppItem[] = installedApps.map(app => ({
        packageName: app.packageName,
        appName: app.appName,
        monitored: RECOMMENDED_PACKAGES.has(app.packageName),
        isRecommended: app.isRecommended || RECOMMENDED_PACKAGES.has(app.packageName)
      }));
      
      // Sort: recommended first, then alphabetically
      appsWithState.sort((a, b) => {
        if (a.isRecommended && !b.isRecommended) return -1;
        if (!a.isRecommended && b.isRecommended) return 1;
        return a.appName.localeCompare(b.appName);
      });
      
      setMonitoredApps(appsWithState);
    } catch (error) {
      console.error('Error loading installed apps:', error);
      // Fallback to recommended apps only
      const fallbackApps: AppItem[] = Array.from(RECOMMENDED_PACKAGES).map(pkg => ({
        packageName: pkg,
        appName: UnifiedUsageService.getAppDisplayName(pkg),
        monitored: true,
        isRecommended: true
      }));
      setMonitoredApps(fallbackApps);
    } finally {
      setLoadingApps(false);
    }
  };

  const openUsageSettings = async () => {
    await UsageService.openUsageAccessSettings();
    // Check again after a delay - will re-check multiple times in case user takes time
    const checkInterval = setInterval(async () => {
      const hasAccess = await checkUsageAccess();
      if (hasAccess) {
        clearInterval(checkInterval);
        setCurrentStep(2);
      }
    }, 1000);
    
    // Stop checking after 30 seconds
    setTimeout(() => {
      clearInterval(checkInterval);
    }, 30000);
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
      // Get list of monitored package names
      const monitoredPackageNames = monitoredApps
        .filter(app => app.monitored)
        .map(app => app.packageName);

      // Save monitored apps as JSON array (this is what services expect)
      await database.setMeta('monitored_apps', JSON.stringify(monitoredPackageNames));

      // Sync monitored apps to native SharedPreferences for background services
      await UnifiedUsageService.syncMonitoredAppsToNative(monitoredPackageNames);

      // Also save individual app settings for backward compatibility
      for (const app of monitoredApps) {
        await database.setMeta(`app_monitored_${app.packageName}`, app.monitored.toString());
        
        // Save to app_settings table as well
        await database.updateAppSettings({
          packageName: app.packageName,
          appName: app.appName,
          monitored: app.monitored,
          dailyLimitMs: 2 * 60 * 60 * 1000 // 2 hours default
        });
      }

      // Start trial
      await TrialService.startTrial();

      // Enable monitoring by default
      await database.setMeta('monitoring_enabled', 'true');
      await database.setMeta('notifications_enabled', 'true');

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
        // Filter apps based on search and show all toggle
        const filteredApps = monitoredApps.filter(app => {
          const matchesSearch = !searchQuery.trim() || 
            app.appName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            app.packageName.toLowerCase().includes(searchQuery.toLowerCase());
          
          if (!showAllApps) {
            return matchesSearch && app.isRecommended;
          }
          return matchesSearch;
        });
        
        const selectedCount = monitoredApps.filter(app => app.monitored).length;
        
        return (
          <View className="flex-1">
            <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
              <View className="items-center mb-lg">
                <Text className="text-4xl mb-md">🎯</Text>
                <Text className="text-2xl font-bold text-text mb-sm">Select Apps to Monitor</Text>
                <Text className="text-base text-muted text-center leading-6">
                  Choose which apps to track for brain health scoring. Recommended apps are pre-selected.
                </Text>
              </View>

              {loadingApps ? (
                <Card>
                  <View className="items-center py-lg">
                    <ActivityIndicator size="large" color="#4F46E5" />
                    <Text className="text-base text-muted mt-md">Loading installed apps...</Text>
                  </View>
                </Card>
              ) : (
                <Card>
                  {/* Search and filter controls */}
                  <View className="mb-md">
                    <TextInput
                      placeholder="Search apps..."
                      placeholderTextColor="#9CA3AF"
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      className="bg-gray-100 px-4 py-3 rounded-lg text-base text-text mb-sm"
                    />
                    
                    <View className="flex-row items-center justify-between">
                      <TouchableOpacity 
                        onPress={() => setShowAllApps(!showAllApps)}
                        className="flex-row items-center"
                      >
                        <View className={`w-5 h-5 rounded border-2 mr-2 items-center justify-center ${showAllApps ? 'bg-accent border-accent' : 'border-gray-300'}`}>
                          {showAllApps && <Text className="text-white text-xs">✓</Text>}
                        </View>
                        <Text className="text-base text-text">Show all apps</Text>
                      </TouchableOpacity>
                      
                      <Text className="text-sm text-muted">{selectedCount} selected</Text>
                    </View>
                  </View>
                  
                  {/* Apps list */}
                  <Text className="text-lg font-semibold text-text mb-md">
                    {showAllApps ? 'All Apps' : 'Recommended Apps'}
                  </Text>
                  
                  {filteredApps.length === 0 ? (
                    <View className="py-lg items-center">
                      <Text className="text-base text-muted">
                        {searchQuery ? 'No apps match your search' : 'No apps found'}
                      </Text>
                    </View>
                  ) : (
                    filteredApps.map((app) => (
                      <View key={app.packageName} className="flex-row items-center justify-between py-sm border-b border-gray-100 last:border-b-0">
                        <View className="flex-1 mr-3">
                          <View className="flex-row items-center">
                            <Text className="text-base text-text font-medium">{app.appName}</Text>
                            {app.isRecommended && (
                              <View className="ml-2 px-2 py-0.5 bg-indigo-100 rounded">
                                <Text className="text-xs text-indigo-700 font-medium">Recommended</Text>
                              </View>
                            )}
                          </View>
                          <Text className="text-xs text-muted mt-0.5" numberOfLines={1}>
                            {app.packageName}
                          </Text>
                        </View>
                        <Toggle
                          value={app.monitored}
                          onValueChange={() => toggleAppMonitoring(app.packageName)}
                        />
                      </View>
                    ))
                  )}
                  
                  {!showAllApps && monitoredApps.filter(a => !a.isRecommended).length > 0 && (
                    <TouchableOpacity 
                      onPress={() => setShowAllApps(true)}
                      className="mt-md py-sm"
                    >
                      <Text className="text-accent text-center font-medium">
                        + Show {monitoredApps.filter(a => !a.isRecommended).length} more apps
                      </Text>
                    </TouchableOpacity>
                  )}
                </Card>
              )}
            </ScrollView>

            <View className="p-md">
              <PrimaryButton 
                title={`Start 7-day Trial (${selectedCount} apps)`}
                onPress={finishOnboarding}
                disabled={selectedCount === 0}
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