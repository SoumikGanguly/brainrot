import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton, SecondaryButton } from '../../components/Buttons';
import { Card } from '../../components/Card';
import { Header } from '../../components/Header';
// import { Slider } from '../../components/Slider';

import AppSelectionBottomSheet from '@/components/AppSelectionBottomSheet';
import { database } from '../../services/database';
import { NotificationService } from '../../services/NotificationService';
import { PurchaseService } from '../../services/PurchaseService';
import { TrialService } from '../../services/TrialService';
import { UsageService } from '../../services/UsageService';

import { UsageMonitoringService } from '@/services/UsageMonitoringService';
import type { AppSelectionItem } from '../../types';

interface MonitoredApp {
  packageName: string;
  appName: string;
  isRecommended: boolean;
  isMonitored: boolean;
}

interface AvailableApp {
  packageName: string;
  appName: string;
  isRecommended: boolean;
  category?: string;
}

interface SettingsState {
  // Monitored Apps
  monitoredApps: MonitoredApp[];
  availableApps: AvailableApp[];
  
  // Notifications
  notificationsEnabled: boolean;
  notificationIntensity: number; // 1=Mild, 2=Normal, 3=Harsh, 4=Critical
  notificationsSnoozeUntil: number;
  
  // Background Monitoring
  backgroundChecksEnabled: boolean;
  realtimeMonitoringEnabled: boolean;
  
  // Privacy
  analyticsEnabled: boolean;
  
  // Trial/Purchase
  trialInfo: { isActive: boolean; daysRemaining: number; expired: boolean };
  isPremium: boolean;
}

export default function Settings() {
  const [settings, setSettings] = useState<SettingsState>({
    monitoredApps: [],
    availableApps: [],
    notificationsEnabled: true,
    notificationIntensity: 2,
    notificationsSnoozeUntil: 0,
    backgroundChecksEnabled: true,
    realtimeMonitoringEnabled: false,
    analyticsEnabled: true,
    trialInfo: { isActive: false, daysRemaining: 0, expired: false },
    isPremium: false,
  });
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [showAppSelection, setShowAppSelection] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
    setLoading(true);

    const installedApps = await UsageService.getInstalledApps(); // native list including isRecommended
    // Build availableApps from installedApps
    const availableApps: AvailableApp[] = (installedApps || []).filter(a => a && a.packageName && a.appName).map(a => ({
      packageName: a.packageName,
      appName: a.appName,
      isRecommended: !!(a as any).isRecommended,
      category: (a as any).category || undefined,
    }));

    // Read saved monitored app list
    const monitoredAppsData = await database.getMeta('monitored_apps');
    let monitoredPackages: string[] = [];

    if (monitoredAppsData) {
      // Use the user's saved monitored set
      monitoredPackages = Array.isArray(JSON.parse(monitoredAppsData))
        ? JSON.parse(monitoredAppsData)
        : [];
    } else {
      // First run: default to only recommended/social apps
      monitoredPackages = availableApps
        .filter(app => app.isRecommended) // only recommended apps
        .map(app => app.packageName);

      // Persist default monitored list so subsequent loads keep the same behavior
      await database.setMeta('monitored_apps', JSON.stringify(monitoredPackages));
    }

    // Build monitoredApps list for UI (recommended first)
    const monitoredApps: MonitoredApp[] = availableApps
      .filter(app => monitoredPackages.includes(app.packageName))
      .map(app => ({
        packageName: app.packageName,
        appName: app.appName,
        isRecommended: app.isRecommended,
        isMonitored: true,
      }));

      // Load simple metas
      const notificationsEnabled = (await database.getMeta('notifications_enabled')) !== 'false';
      const notificationIntensity = parseInt(await database.getMeta('notification_intensity') || '2', 10);
      const notificationsSnoozeUntil = parseInt(await database.getMeta('notifications_snooze_until') || '0', 10);

      const backgroundChecksEnabled = (await database.getMeta('background_checks_enabled')) !== 'false';
      const realtimeMonitoringEnabled = (await database.getMeta('realtime_monitoring_enabled')) === 'true';
      const analyticsEnabled = (await database.getMeta('analytics_enabled')) !== 'false';

      // Trial/purchase with safe error narrowing
      let trialInfo = { isActive: false, daysRemaining: 0, expired: false };
      let isPremium = false;

      try {
        const ti = await TrialService.getTrialInfo();
        if (ti && typeof ti === 'object') trialInfo = ti;
      } catch (err) {
        // err is unknown — cast or test
        console.log('TrialService not available in dev mode:', (err as any)?.message ?? err);
        if (__DEV__) trialInfo = { isActive: true, daysRemaining: 7, expired: false };
      }

      try {
        const premium = await PurchaseService.isPremium();
        isPremium = !!premium;
      } catch (err) {
        console.log('PurchaseService not available in dev mode:', (err as any)?.message ?? err);
        if (__DEV__) isPremium = false;
      }

      // Finally set state (we have availableApps variable in scope)
      // Build non-monitored available list is simply availableApps (all apps)
      setSettings(prev => ({
        ...prev,
        monitoredApps,
        availableApps,
        notificationsEnabled,
        notificationIntensity,
        notificationsSnoozeUntil,
        backgroundChecksEnabled,
        realtimeMonitoringEnabled,
        analyticsEnabled,
        trialInfo,
        isPremium,
      }));

      console.log('installedApps raw ->', installedApps?.length, installedApps?.slice?.(0, 10));
      console.log('availableApps ->', availableApps.length, availableApps.slice(0,10));
      console.log('monitoredPackages (from meta) ->', monitoredPackages.length, monitoredPackages);
      console.log('settings.monitoredApps ->', monitoredApps.length, monitoredApps.slice(0,10));

    } catch (err) {
      console.error('Error loading settings:', err);
      setSettings(prev => ({
        ...prev,
        monitoredApps: [],
        availableApps: [],
      }));
    } finally {
      setLoading(false);
    }
  };


  const updateMonitoredApp = async (packageName: string, isMonitored: boolean) => {
    if (!packageName) {
      console.error('updateMonitoredApp: packageName is required');
      return;
    }

    const updatedApps = settings.monitoredApps
      .filter(app => app && app.packageName) // Ensure valid apps
      .map(app =>
        app.packageName === packageName ? { ...app, isMonitored } : app
      );
    
    const monitoredPackages = updatedApps
      .filter(app => app && app.isMonitored && app.packageName)
      .map(app => app.packageName);
    
    try {
      await database.setMeta('monitored_apps', JSON.stringify(monitoredPackages));
      setSettings(prev => ({ ...prev, monitoredApps: updatedApps }));

      const monitoringService = UsageMonitoringService.getInstance();
      await monitoringService.refreshMonitoredApps();
    } catch (error) {
      console.error('Error updating monitored apps:', error);
    }
  };

  const handleAddApps = async (selectedPackages: string[]) => {
    try {
      // Get current monitored packages
      const monitoredAppsData = await database.getMeta('monitored_apps');
      const currentMonitored = monitoredAppsData ? JSON.parse(monitoredAppsData) : [];
      
      // Add new packages
      const updatedMonitored = [...new Set([...currentMonitored, ...selectedPackages])];
      
      // Save to database
      await database.setMeta('monitored_apps', JSON.stringify(updatedMonitored));
      
      // Update local state
      const updatedApps = settings.availableApps
        .filter(app => updatedMonitored.includes(app.packageName))
        .map(app => ({
          packageName: app.packageName,
          appName: app.appName,
          isRecommended: app.isRecommended,
          isMonitored: true,
        }));

      setSettings(prev => ({
        ...prev,
        monitoredApps: [...prev.monitoredApps, ...updatedApps.filter(app => 
          !prev.monitoredApps.some(existing => existing.packageName === app.packageName)
        )]
      }));

      const monitoringService = UsageMonitoringService.getInstance();
      await monitoringService.refreshMonitoredApps();

      Alert.alert(
        'Apps Added',
        `Successfully added ${selectedPackages.length} app${selectedPackages.length > 1 ? 's' : ''} to monitoring.`
      );
    } catch (error) {
      console.error('Error adding apps:', error);
      Alert.alert('Error', 'Failed to add apps. Please try again.');
    }
  };

  
  const handleRemoveMonitoredApp = async (packageName: string) => {
    Alert.alert(
      'Remove App',
      'Are you sure you want to stop monitoring this app?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => updateMonitoredApp(packageName, false)
        }
      ]
    );
  };

  const updateNotificationSettings = async (key: string, value: any) => {
    await database.setMeta(key, value.toString());
    setSettings(prev => ({ ...prev, [key.replace('_', '')] : value }));
  };

  const snoozeNotifications = async (hours: number) => {
    const snoozeUntil = Date.now() + (hours * 60 * 60 * 1000);
    await database.setMeta('notifications_snooze_until', snoozeUntil.toString());
    setSettings(prev => ({ ...prev, notificationsSnoozeUntil: snoozeUntil }));
    
    Alert.alert('Notifications Snoozed', `Notifications will be paused for ${hours} hour${hours > 1 ? 's' : ''}.`);
  };

  const updateMonitoringSettings = async (key: string, value: boolean) => {
    await database.setMeta(key, value.toString());
    
    const monitoringService = UsageMonitoringService.getInstance();
    
    // Handle background monitoring toggle
    if (key === 'background_checks_enabled') {
      if (value) {
        console.log('Starting background checks');
        await monitoringService.startMonitoring();
      } else {
        console.log('Stopping background checks');
        await monitoringService.stopMonitoring();
      }
      setSettings(prev => ({ ...prev, backgroundChecksEnabled: value }));
    }
    
    // Handle realtime monitoring toggle
    if (key === 'realtime_monitoring_enabled') {
      if (value) {
        Alert.alert(
          'Real-time Monitoring',
          'This will show a persistent notification and may increase battery usage. Continue?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Enable',
              onPress: async () => {
                console.log('Starting realtime monitoring');
                await monitoringService.startMonitoring();
                setSettings(prev => ({ ...prev, realtimeMonitoringEnabled: true }));
              }
            }
          ]
        );
      } else {
        console.log('Stopping realtime monitoring');
        await monitoringService.stopMonitoring();
        setSettings(prev => ({ ...prev, realtimeMonitoringEnabled: false }));
      }
    }
  };

  {console.log('settings.availableApps', settings.availableApps)}

  const handlePurchase = async () => {
    if (purchasing) return;
    
    try {
      setPurchasing(true);
      
      // Handle dev mode
      if (__DEV__) {
        Alert.alert('Dev Mode', 'Purchase simulation - would normally integrate with RevenueCat');
        setTimeout(() => {
          setSettings(prev => ({ ...prev, isPremium: true }));
          Alert.alert('Purchase Successful', 'Welcome to Brainrot Premium! (Dev Mode)');
          setPurchasing(false);
        }, 2000);
        return;
      }

      const success = await PurchaseService.purchaseLifetime();
      
      if (success) {
        setSettings(prev => ({ ...prev, isPremium: true }));
        Alert.alert('Purchase Successful', 'Welcome to Brainrot Premium!');
      } else {
        Alert.alert('Purchase Failed', 'Please try again later.');
      }
    } catch (error) {
      console.error('Purchase error:', error);
      if (__DEV__) {
        Alert.alert('Dev Mode Error', 'RevenueCat not available in development');
      } else {
        Alert.alert('Purchase Error', 'Something went wrong. Please try again.');
      }
    } finally {
      if (!__DEV__) {
        setPurchasing(false);
      }
    }
  };

  const handleRestore = async () => {
    try {
      // Handle dev mode
      if (__DEV__) {
        Alert.alert('Dev Mode', 'Restore simulation - would normally check RevenueCat');
        return;
      }

      const restored = await PurchaseService.restorePurchases();
      
      if (restored) {
        setSettings(prev => ({ ...prev, isPremium: true }));
        Alert.alert('Restore Successful', 'Your premium features have been restored!');
      } else {
        Alert.alert('No Purchases Found', 'No previous purchases found for this account.');
      }
    } catch (error) {
      console.error('Restore error:', error);
      if (__DEV__) {
        Alert.alert('Dev Mode Error', 'RevenueCat not available in development');
      } else {
        Alert.alert('Restore Failed', 'Unable to restore purchases. Please try again.');
      }
    }
  };

  const getIntensityLabel = (intensity: number) => {
    switch (intensity) {
      case 1: return 'Mild';
      case 2: return 'Normal';
      case 3: return 'Harsh';
      case 4: return 'Critical';
      default: return 'Normal';
    }
  };

  const isNotificationsSnoozed = () => {
    return Date.now() < settings.notificationsSnoozeUntil;
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-bg">
        <View className="flex-1 justify-center items-center">
          <Text className="text-base text-muted">Loading settings...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <Header title="Settings" />

        {/* Trial/Purchase Banner */}
        {!settings.isPremium && (
          <Card className="mx-md mb-md bg-accent/10 border-accent/20">
            <View className="items-center">
              {settings.trialInfo.isActive && !settings.trialInfo.expired ? (
                <>
                  <Text className="text-base text-accent font-semibold mb-sm">
                    Trial Active • {settings.trialInfo.daysRemaining} days left
                    {__DEV__ && <Text className="text-xs"> (Dev Mode)</Text>}
                  </Text>
                  <Text className="text-sm text-muted mb-md text-center">
                    Unlock all features permanently
                  </Text>
                </>
              ) : (
                <>
                  <Text className="text-base text-danger font-semibold mb-sm">
                    {settings.trialInfo.expired ? 'Trial Expired' : 'Premium Features Locked'}
                    {__DEV__ && <Text className="text-xs"> (Dev Mode)</Text>}
                  </Text>
                  <Text className="text-sm text-muted mb-md text-center">
                    Remove all limitations and unlock premium features
                  </Text>
                </>
              )}
              
              <View className="flex-row space-x-sm w-full">
                <PrimaryButton
                  title={purchasing ? "Processing..." : "Buy ₹149 / $2.99"}
                  onPress={handlePurchase}
                  className="flex-1"
                  disabled={purchasing}
                />
                <SecondaryButton
                  title="Restore"
                  onPress={handleRestore}
                  className="px-lg"
                />
              </View>
            </View>
          </Card>
        )}

        {settings.isPremium && (
          <Card className="mx-md mb-md bg-success/10 border-success/20">
            <View className="flex-row items-center justify-center">
              <Ionicons name="checkmark-circle" size={24} color="#059669" className="mr-sm" />
              <Text className="text-base text-success font-semibold">
                Premium Active{__DEV__ && <Text className="text-xs"> (Dev Mode)</Text>}
              </Text>
            </View>
          </Card>
        )}

        {/* Monitored Apps */}
        <Card className="mx-md mb-md">
          <Text className="text-lg font-semibold text-text mb-sm">Monitored Apps</Text>
          <Text className="text-sm text-muted mb-md">
            Select which apps to monitor for usage tracking and notifications
          </Text>
          
          {/* Recommended Apps First */}
          {settings.monitoredApps?.filter(app => app?.isRecommended).map((app) => {
            if (!app || !app.packageName || !app.appName) return null;
            
            return (
              <View key={app.packageName} className="flex-row items-center justify-between py-sm border-b border-gray-100">
                <View className="flex-1">
                  <View className="flex-row items-center">
                    <Text className="text-base font-medium text-text mr-xs">{app.appName}</Text>
                    <View className="px-xs py-0.5 bg-accent/20 rounded">
                      <Text className="text-xs text-accent font-medium">Recommended</Text>
                    </View>
                  </View>
                  <Text className="text-sm text-muted">{app.packageName}</Text>
                </View>
                <Switch
                  value={app.isMonitored}
                  onValueChange={(value) => updateMonitoredApp(app.packageName, value)}
                  trackColor={{ false: '#E5E7EB', true: '#4F46E5' }}
                  thumbColor={app.isMonitored ? '#FFFFFF' : '#9CA3AF'}
                />
              </View>
            );
          })}

          {/* Other Apps */}
          {settings.monitoredApps.filter(app => !app.isRecommended).length > 0 && (
            <Text className="text-sm font-medium text-muted mt-md mb-sm">Other Monitored Apps</Text>
          )}
          
          {settings.monitoredApps.filter(app => !app.isRecommended).map((app) => (
            <View key={app.packageName} className="flex-row items-center justify-between py-sm border-b border-gray-100 last:border-b-0">
              <View className="flex-1">
                <Text className="text-base font-medium text-text">{app.appName}</Text>
                <Text className="text-sm text-muted">{app.packageName}</Text>
              </View>
              <TouchableOpacity
                onPress={() => handleRemoveMonitoredApp(app.packageName)}
                className="p-xs"
              >
                <Ionicons name="remove-circle" size={24} color="#EF4444" />
              </TouchableOpacity>
            </View>
          ))}

          <TouchableOpacity 
            className="flex-row items-center justify-center py-md mt-sm border-t border-gray-200"
            onPress={() => setShowAppSelection(true)}
          >
            <Ionicons name="add" size={20} color="#4F46E5" className="mr-xs" />
            <Text className="text-base text-accent">Add More Apps</Text>
          </TouchableOpacity>
        </Card>

        {/* Notifications */}
        <Card className="mx-md mb-md">
          <Text className="text-lg font-semibold text-text mb-sm">Notifications</Text>
          
          {/* Enable/Disable Toggle */}
          <View className="flex-row items-center justify-between py-sm mb-md">
            <View className="flex-1">
              <Text className="text-base font-medium text-text">Enable Notifications</Text>
              <Text className="text-sm text-muted">Receive usage alerts and brain health reminders</Text>
            </View>
            <Switch
              value={settings.notificationsEnabled}
              onValueChange={(value) => updateNotificationSettings('notifications_enabled', value)}
              trackColor={{ false: '#E5E7EB', true: '#4F46E5' }}
              thumbColor={settings.notificationsEnabled ? '#FFFFFF' : '#9CA3AF'}
            />
          </View>

          {settings.notificationsEnabled && (
            <>
              {/* Intensity Slider */}
              <View className="mb-md">
                <View className="flex-row items-center justify-between mb-sm">
                  <Text className="text-base font-medium text-text">Notification Intensity</Text>
                  <Text className="text-sm text-accent font-medium">
                    {getIntensityLabel(settings.notificationIntensity)}
                  </Text>
                </View>
                <Text className="text-sm text-muted mb-sm">
                  Higher intensity = more direct and frequent reminders
                </Text>
                {/* <Slider
                  minimumValue={1}
                  maximumValue={4}
                  step={1}
                  value={settings.notificationIntensity}
                  onValueChange={(value) => updateNotificationSettings('notification_intensity', value)}
                /> */}
                <View className="flex-row justify-between">
                  <Text className="text-xs text-muted">Mild</Text>
                  <Text className="text-xs text-muted">Critical</Text>
                </View>
              </View>

              {/* Snooze Section */}
              <View className="pt-md border-t border-gray-200">
                <Text className="text-base font-medium text-text mb-sm">Quick Snooze</Text>
                {isNotificationsSnoozed() ? (
                  <View className="bg-warning/10 p-sm rounded-lg mb-sm">
                    <Text className="text-sm text-warning">
                      Notifications snoozed until {new Date(settings.notificationsSnoozeUntil).toLocaleTimeString()}
                    </Text>
                  </View>
                ) : null}
                
                <View className="flex-row space-x-sm">
                  <TouchableOpacity 
                    className="flex-1 bg-surface p-sm rounded-lg items-center"
                    onPress={() => snoozeNotifications(1)}
                  >
                    <Text className="text-sm font-medium text-text">1 Hour</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    className="flex-1 bg-surface p-sm rounded-lg items-center"
                    onPress={() => snoozeNotifications(4)}
                  >
                    <Text className="text-sm font-medium text-text">4 Hours</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    className="flex-1 bg-surface p-sm rounded-lg items-center"
                    onPress={() => snoozeNotifications(24)}
                  >
                    <Text className="text-sm font-medium text-text">24 Hours</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}
        </Card>

        {/* Background Monitoring */}
        <Card className="mx-md mb-md">
          <Text className="text-lg font-semibold text-text mb-sm">Background Monitoring</Text>
          
          {/* Background Checks Toggle */}
          <View className="py-sm mb-md">
            <View className="flex-row items-center justify-between mb-xs">
              <Text className="text-base font-medium text-text">Background Checks</Text>
              <Switch
                value={settings.backgroundChecksEnabled}
                onValueChange={(value) => updateMonitoringSettings('background_checks_enabled', value)}
                trackColor={{ false: '#E5E7EB', true: '#4F46E5' }}
                thumbColor={settings.backgroundChecksEnabled ? '#FFFFFF' : '#9CA3AF'}
              />
            </View>
            <Text className="text-sm text-muted">
              Check usage every ~15 minutes (recommended for most users)
            </Text>
          </View>

          {/* Real-time Monitoring Toggle */}
          <View className="py-sm border-t border-gray-200">
            <View className="flex-row items-center justify-between mb-xs">
              <Text className="text-base font-medium text-text">Real-time Monitoring</Text>
              <Switch
                value={settings.realtimeMonitoringEnabled}
                onValueChange={(value) => updateMonitoringSettings('realtime_monitoring_enabled', value)}
                trackColor={{ false: '#E5E7EB', true: '#4F46E5' }}
                thumbColor={settings.realtimeMonitoringEnabled ? '#FFFFFF' : '#9CA3AF'}
              />
            </View>
            <Text className="text-sm text-muted">
              Continuous monitoring with persistent notification. May increase battery usage.
            </Text>
            {settings.realtimeMonitoringEnabled && (
              <View className="bg-warning/10 p-sm rounded-lg mt-sm">
                <Text className="text-sm text-warning">
                  ⚡ This feature may impact battery life. You&apos;ll see a persistent notification.
                </Text>
              </View>
            )}
          </View>
        </Card>

        {/* Privacy */}
        <Card className="mx-md mb-md">
          <Text className="text-lg font-semibold text-text mb-sm">Privacy</Text>
          
          <View className="flex-row items-center justify-between py-sm">
            <View className="flex-1">
              <Text className="text-base font-medium text-text">Analytics</Text>
              <Text className="text-sm text-muted">
                Share anonymous usage data to help improve the app
              </Text>
            </View>
            <Switch
              value={settings.analyticsEnabled}
              onValueChange={async (value) => {
                await database.setMeta('analytics_enabled', value.toString());
                setSettings(prev => ({ ...prev, analyticsEnabled: value }));
              }}
              trackColor={{ false: '#E5E7EB', true: '#4F46E5' }}
              thumbColor={settings.analyticsEnabled ? '#FFFFFF' : '#9CA3AF'}
            />
          </View>
        </Card>

        {/* About */}
        <Card className="mx-md mb-md">
          <Text className="text-lg font-semibold text-text mb-sm">About</Text>
          
          <TouchableOpacity className="py-sm border-b border-gray-100">
            <View className="flex-row items-center justify-between">
              <Text className="text-base text-text">Privacy Policy</Text>
              <Ionicons name="chevron-forward" size={20} color="#6B7280" />
            </View>
          </TouchableOpacity>
          
          <TouchableOpacity className="py-sm border-b border-gray-100">
            <View className="flex-row items-center justify-between">
              <Text className="text-base text-text">Terms of Service</Text>
              <Ionicons name="chevron-forward" size={20} color="#6B7280" />
            </View>
          </TouchableOpacity>
          
          <View className="py-sm">
            <View className="flex-row items-center justify-between">
              <Text className="text-base text-text">App Version</Text>
              <Text className="text-sm text-muted">1.0.0</Text>
            </View>
          </View>
        </Card>

        {/* Debug/Developer Options (only in development) */}
        {__DEV__ && (
          <Card className="mx-md mb-md bg-gray-50">
            <Text className="text-lg font-semibold text-text mb-sm">Developer Options</Text>
            
            <TouchableOpacity 
              className="py-sm border-b border-gray-200"
              onPress={async () => {
                await database.setMeta('trial_start_time', '');
                Alert.alert('Debug', 'Trial reset');
                loadSettings();
              }}
            >
              <Text className="text-base text-text">Reset Trial</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              className="py-sm"
              onPress={async () => {
                const monitoringService = UsageMonitoringService.getInstance();
                const status = monitoringService.getMonitoringStatus();
                Alert.alert('Monitoring Status', 
                  `Monitoring: ${status.isMonitoring}\n` +
                  `Tracked Apps: ${status.trackedApps}\n` +
                  `Background: ${status.backgroundEnabled}\n` +
                  `Realtime: ${status.realtimeEnabled}`
                );
              }}
            >
              <Text className="text-base text-text">Check Monitoring Status</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              className="py-sm border-b border-gray-200"
              onPress={() => {
                setSettings(prev => ({ ...prev, isPremium: !prev.isPremium }));
                Alert.alert('Debug', `Premium ${!settings.isPremium ? 'enabled' : 'disabled'}`);
              }}
            >
              <Text className="text-base text-text">Toggle Premium Status</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              className="py-sm"
              onPress={async () => {
                try {
                  if (NotificationService?.scheduleUsageAlert) {
                    await NotificationService.scheduleUsageAlert('TestApp', '2h 30m', 'normal');
                    Alert.alert('Debug', 'Test notification sent');
                  } else {
                    Alert.alert('Debug', 'NotificationService not available or scheduleUsageAlert method missing');
                  }
                } catch (error) {
                  Alert.alert('Debug', `Notification error: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
              }}
            >
              <Text className="text-base text-text">Test Notification</Text>
            </TouchableOpacity>
          </Card>
        )}
      </ScrollView>
      <AppSelectionBottomSheet
        isOpen={showAppSelection}
        onClose={() => setShowAppSelection(false)}
        onSave={handleAddApps}
        availableApps={settings.availableApps.map((app): AppSelectionItem => ({
          packageName: app.packageName,
          appName: app.appName,
          isRecommended: app.isRecommended,
          category: app.category,
          // mark currently monitored apps; modal will filter them out on init
          isCurrentlyMonitored: settings.monitoredApps.some(m => m.packageName === app.packageName),
          // default selection state; false is fine
          isSelected: false,
        }))}
        currentlyMonitored={settings.monitoredApps.map(m => m.packageName)}
      />
    </SafeAreaView>
  );
}