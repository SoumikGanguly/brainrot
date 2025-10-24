import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton, SecondaryButton } from '../../components/Buttons';
import { Card } from '../../components/Card';
import { Header } from '../../components/Header';

import AppSelectionBottomSheet from '@/components/AppSelectionBottomSheet';
import { database } from '../../services/database';
import { NotificationService } from '../../services/NotificationService';
import { PurchaseService } from '../../services/PurchaseService';
import { TrialService } from '../../services/TrialService';
// import { UsageService } from '../../services/UsageService';

import { UnifiedUsageService } from '@/services/UnifiedUsageService';

import { AppBlockingService, BlockingMode } from '@/services/AppBlockingService';
import { UsageMonitoringService } from '@/services/UsageMonitoringService';
import * as Sentry from '@sentry/react-native';
import type { AppSelectionItem } from '../../types';

interface MonitoredApp {
  packageName: string;
  appName: string;
  isRecommended: boolean;
  isMonitored: boolean;
  isBlocked: boolean;
  blockTimeLimit?: number;
}

interface AvailableApp {
  packageName: string;
  appName: string;
  isRecommended: boolean;
  category?: string;
  isCurrentlyMonitored?: boolean;
}

interface SettingsState {
  // Monitored Apps
  monitoredApps: MonitoredApp[];
  availableApps: AvailableApp[];

  // Add this line:
  monitoringEnabled: boolean;

  appBlockingEnabled: boolean;
  blockingMode: 'soft' | 'hard';
  blockBypassLimit: number;
  blockScheduleEnabled: boolean;
  blockScheduleStart: string;
  blockScheduleEnd: string;
  
  // Notifications
  notificationsEnabled: boolean;
  notificationIntensity: number;
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
    monitoringEnabled: false,
    notificationsEnabled: true,
    notificationIntensity: 2,
    notificationsSnoozeUntil: 0,
    backgroundChecksEnabled: true,
    realtimeMonitoringEnabled: false,
    analyticsEnabled: true,
    trialInfo: { isActive: false, daysRemaining: 0, expired: false },
    isPremium: false,
    appBlockingEnabled: false,
    blockingMode: 'soft',
    blockBypassLimit: 3,
    blockScheduleEnabled: false,
    blockScheduleStart: '22:00',
    blockScheduleEnd: '06:00',
  });
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [showAppSelection, setShowAppSelection] = useState(false);
  const [modalKey, setModalKey] = useState(0);
  const [hasOverlayPermission, setHasOverlayPermission] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);

      // Get installed apps
      const installedApps = await UnifiedUsageService.getInstalledApps();
      
      // Build available apps list
      const availableApps: AvailableApp[] = (installedApps || [])
        .filter(a => a && a.packageName && a.appName)
        .map(a => ({
          packageName: a.packageName,
          appName: a.appName,
          isRecommended: !!(a as any).isRecommended,
          category: (a as any).category || undefined,
        }));

      // Load app blocking settings first
      const appBlockingEnabled = (await database.getMeta('app_blocking_enabled')) === 'true';
      const blockingMode = (await database.getMeta('blocking_mode') || 'soft') as BlockingMode;
      const blockBypassLimit = parseInt(await database.getMeta('block_bypass_limit') || '3', 10);
      const blockScheduleEnabled = (await database.getMeta('block_schedule_enabled')) === 'true';
      const blockScheduleStart = await database.getMeta('block_schedule_start') || '22:00';
      const blockScheduleEnd = await database.getMeta('block_schedule_end') || '06:00';

      // Load blocked apps
      const blockedAppsData = await database.getMeta('blocked_apps');
      const blockedPackages = blockedAppsData ? JSON.parse(blockedAppsData) : [];

      // Read saved monitored app list
      const monitoredAppsData = await database.getMeta('monitored_apps');
      let monitoredPackages: string[] = [];

      if (monitoredAppsData) {
        monitoredPackages = Array.isArray(JSON.parse(monitoredAppsData))
          ? JSON.parse(monitoredAppsData)
          : [];
      } else {
        // First run: default to recommended apps
        monitoredPackages = availableApps
          .filter(app => app.isRecommended)
          .map(app => app.packageName);

        await database.setMeta('monitored_apps', JSON.stringify(monitoredPackages));
      }

      // Build monitored apps list with blocking status
      const monitoredApps: MonitoredApp[] = availableApps
        .filter(app => monitoredPackages.includes(app.packageName))
        .map(app => ({
          packageName: app.packageName,
          appName: app.appName,
          isRecommended: app.isRecommended,
          isMonitored: true,
          isBlocked: blockedPackages.includes(app.packageName),
        }))
        .sort((a, b) => {
          // Sort: recommended first, then alphabetical
          if (a.isRecommended !== b.isRecommended) {
            return a.isRecommended ? -1 : 1;
          }
          return a.appName.localeCompare(b.appName);
        });

      // Load notification settings
      const notificationsEnabled = (await database.getMeta('notifications_enabled')) !== 'false';
      const notificationIntensity = parseInt(await database.getMeta('notification_intensity') || '2', 10);
      const notificationsSnoozeUntil = parseInt(await database.getMeta('notifications_snooze_until') || '0', 10);

      // Load monitoring settings
      const backgroundChecksEnabled = (await database.getMeta('background_checks_enabled')) !== 'false';
      const realtimeMonitoringEnabled = (await database.getMeta('realtime_monitoring_enabled')) === 'true';
      const analyticsEnabled = (await database.getMeta('analytics_enabled')) !== 'false';

      // Trial/purchase info
      let trialInfo = { isActive: false, daysRemaining: 0, expired: false };
      let isPremium = false;

      try {
        const ti = await TrialService.getTrialInfo();
        if (ti && typeof ti === 'object') trialInfo = ti;
      } catch (err) {
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

      // Check monitoring status
      const monitoringEnabled = (await database.getMeta('monitoring_enabled')) === 'true';
      if (monitoringEnabled && (backgroundChecksEnabled || realtimeMonitoringEnabled)) {
        try {
          const status = UsageMonitoringService.getInstance().getMonitoringStatus();
          if (!status.isMonitoring) {
            console.log('Restarting monitoring based on saved settings');
            await UnifiedUsageService.startComprehensiveMonitoring();
          }
        } catch (error) {
          console.log('Could not restart monitoring:', error);
        }
      }

      // Update available apps to mark currently monitored
      const availableAppsWithStatus = availableApps.map(app => ({
        ...app,
        isCurrentlyMonitored: monitoredPackages.includes(app.packageName)
      }));

      setSettings({
        monitoredApps,
        monitoringEnabled,
        availableApps: availableAppsWithStatus,
        notificationsEnabled,
        notificationIntensity,
        notificationsSnoozeUntil,
        backgroundChecksEnabled,
        realtimeMonitoringEnabled,
        analyticsEnabled,
        trialInfo,
        isPremium,
        appBlockingEnabled,
        blockingMode,
        blockBypassLimit,
        blockScheduleEnabled,
        blockScheduleStart,
        blockScheduleEnd,
      });

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

  useEffect(() => {
    checkOverlayPermission();
  }, []);
  
  const checkOverlayPermission = async () => {
    const hasPermission = await UnifiedUsageService.hasOverlayPermission();
    setHasOverlayPermission(hasPermission);
  };
  
  const requestOverlayPermission = async () => {
    try {
      await UnifiedUsageService.requestOverlayPermission();
      
      // Check again after a delay
      setTimeout(async () => {
        await checkOverlayPermission();
      }, 2000);
    } catch (error) {
      Alert.alert('Error', 'Failed to request overlay permission');
    }
  };

  const updateMonitoredApp = async (packageName: string, isMonitored: boolean) => {
    if (!packageName) {
      console.error('updateMonitoredApp: packageName is required');
      return;
    }

    try {
      let updatedMonitoredApps: MonitoredApp[];
      
      if (isMonitored) {
        // Adding back to monitored
        const appToAdd = settings.availableApps.find(app => app.packageName === packageName);
        if (!appToAdd) return;
        
        updatedMonitoredApps = [...settings.monitoredApps, {
          packageName: appToAdd.packageName,
          appName: appToAdd.appName,
          isRecommended: appToAdd.isRecommended,
          isMonitored: true,
          isBlocked: false,
        }];
      } else {
        // Removing from monitored
        updatedMonitoredApps = settings.monitoredApps.filter(app => app.packageName !== packageName);
        
        // Also remove from blocked apps if it was blocked
        const blockedAppsData = await database.getMeta('blocked_apps');
        const blockedPackages = blockedAppsData ? JSON.parse(blockedAppsData) : [];
        const updatedBlockedPackages = blockedPackages.filter((pkg: string) => pkg !== packageName);
        await database.setMeta('blocked_apps', JSON.stringify(updatedBlockedPackages));
        
        // Notify blocking service
        const blockingService = AppBlockingService.getInstance();
        await blockingService.unblockApp(packageName);
      }
      
      // Save updated monitored list
      const monitoredPackages = updatedMonitoredApps.map(app => app.packageName);
      await database.setMeta('monitored_apps', JSON.stringify(monitoredPackages));
      
      // Update state
      setSettings(prev => ({
        ...prev,
        monitoredApps: updatedMonitoredApps.sort((a, b) => {
          if (a.isRecommended !== b.isRecommended) {
            return a.isRecommended ? -1 : 1;
          }
          return a.appName.localeCompare(b.appName);
        }),
        availableApps: prev.availableApps.map(app => 
          app.packageName === packageName 
            ? { ...app, isCurrentlyMonitored: isMonitored }
            : app
        )
      }));
      
      // Refresh monitoring service
      const monitoringService = UsageMonitoringService.getInstance();
      await monitoringService.refreshMonitoredApps();
      
    } catch (error) {
      console.error('Error updating monitored apps:', error);
      Alert.alert('Error', 'Failed to update monitored apps. Please try again.');
    }
  };

  const toggleAppBlocking = async (packageName: string, isBlocked: boolean) => {
    try {
      // Update local state
      const updatedApps = settings.monitoredApps.map(app =>
        app.packageName === packageName ? { ...app, isBlocked } : app
      );
      
      // Save blocked apps list to database
      const blockedPackages = updatedApps
        .filter(app => app.isBlocked)
        .map(app => app.packageName);
      
      await database.setMeta('blocked_apps', JSON.stringify(blockedPackages));
      
      setSettings(prev => ({ ...prev, monitoredApps: updatedApps }));
      
      // Notify the blocking service
      const blockingService = AppBlockingService.getInstance();
      if (isBlocked) {
        await blockingService.blockApp(packageName);
      } else {
        await blockingService.unblockApp(packageName);
      }
      
    } catch (error) {
      console.error('Error toggling app blocking:', error);
      Alert.alert('Error', 'Failed to update app blocking. Please try again.');
    }
  };

  const updateBlockingSettings = async (key: string, value: any) => {
    try {
      await database.setMeta(key, value.toString());
      
      if (key === 'app_blocking_enabled') {
        setSettings(prev => ({ ...prev, appBlockingEnabled: value }));
        
        const blockingService = AppBlockingService.getInstance();
        if (value) {
          await blockingService.initialize();
        } else {
          await blockingService.cleanup();
        }
      } else if (key === 'blocking_mode') {
        setSettings(prev => ({ ...prev, blockingMode: value }));
        const blockingService = AppBlockingService.getInstance();
        await blockingService.setBlockingMode(value);
      } else if (key === 'block_bypass_limit') {
        setSettings(prev => ({ ...prev, blockBypassLimit: value }));
      } else if (key === 'block_schedule_enabled') {
        setSettings(prev => ({ ...prev, blockScheduleEnabled: value }));
      } else if (key === 'block_schedule_start') {
        setSettings(prev => ({ ...prev, blockScheduleStart: value }));
      } else if (key === 'block_schedule_end') {
        setSettings(prev => ({ ...prev, blockScheduleEnd: value }));
      }
      
    } catch (error) {
      console.error('Error updating blocking settings:', error);
    }
  };

  const showTimePicker = (type: 'start' | 'end') => {
    Alert.prompt(
      `Set ${type === 'start' ? 'Start' : 'End'} Time`,
      'Enter time in HH:MM format (24-hour)',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Set',
          onPress: (time) => {
            if (time && /^\d{2}:\d{2}$/.test(time)) {
              const key = type === 'start' ? 'block_schedule_start' : 'block_schedule_end';
              updateBlockingSettings(key, time);
            }
          }
        }
      ],
      'plain-text',
      settings[type === 'start' ? 'blockScheduleStart' : 'blockScheduleEnd']
    );
  };

  const handleAddApps = async (selectedPackages: string[]) => {
    try {
      const monitoredAppsData = await database.getMeta('monitored_apps');
      const currentMonitored = monitoredAppsData ? JSON.parse(monitoredAppsData) : [];
      const updatedMonitored = [...new Set([...currentMonitored, ...selectedPackages])];
      await database.setMeta('monitored_apps', JSON.stringify(updatedMonitored));
      
      // Create new monitored apps from available apps
      const newMonitoredApps = settings.availableApps
        .filter(app => selectedPackages.includes(app.packageName))
        .map(app => ({
          packageName: app.packageName,
          appName: app.appName,
          isRecommended: app.isRecommended,
          isMonitored: true,
          isBlocked: false,
        }));

      // Merge with existing monitored apps
      const allMonitoredApps = [...settings.monitoredApps];
      newMonitoredApps.forEach(newApp => {
        if (!allMonitoredApps.some(app => app.packageName === newApp.packageName)) {
          allMonitoredApps.push(newApp);
        }
      });

      setSettings(prev => ({
        ...prev,
        monitoredApps: allMonitoredApps.sort((a, b) => {
          if (a.isRecommended !== b.isRecommended) {
            return a.isRecommended ? -1 : 1;
          }
          return a.appName.localeCompare(b.appName);
        }),
        availableApps: prev.availableApps.map(app => 
          selectedPackages.includes(app.packageName) 
            ? { ...app, isCurrentlyMonitored: true }
            : app
        )
      }));

      // Refresh monitoring service
      const monitoringService = UsageMonitoringService.getInstance();
      await monitoringService.refreshMonitoredApps();

      setModalKey(prev => prev + 1);

      // Alert.alert(
      //   'Apps Added',
      //   `Successfully added ${selectedPackages.length} app${selectedPackages.length > 1 ? 's' : ''} to monitoring.`
      // );
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
    
    if (key === 'notifications_enabled') {
      setSettings(prev => ({ ...prev, notificationsEnabled: value }));
    } else if (key === 'notification_intensity') {
      setSettings(prev => ({ ...prev, notificationIntensity: value }));
    }
  };

  const snoozeNotifications = async (hours: number) => {
    const snoozeUntil = Date.now() + (hours * 60 * 60 * 1000);
    await database.setMeta('notifications_snooze_until', snoozeUntil.toString());
    setSettings(prev => ({ ...prev, notificationsSnoozeUntil: snoozeUntil }));
    
    Alert.alert('Notifications Snoozed', `Notifications will be paused for ${hours} hour${hours > 1 ? 's' : ''}.`);
  };

  const updateMonitoringSettings = async (key: string, value: any) => {
    try {
      await database.setMeta(key, value.toString());
      
      setSettings(prev => ({
        ...prev,
        [key === 'monitoring_enabled' ? 'monitoringEnabled' : 
        key === 'background_checks' ? 'backgroundChecksEnabled' :
        key === 'realtime_monitoring' ? 'realtimeMonitoringEnabled' : key]: value
      }));

      // Use the instance for basic monitoring
      const unifiedService = UnifiedUsageService.getInstance();
      
      if (key === 'monitoring_enabled') {
        if (value) {
          await unifiedService.startMonitoring();
        } else {
          await unifiedService.stopMonitoring();
        }
      }
      
      // Use static methods for comprehensive monitoring
      if (key === 'background_checks') {
        if (value && settings.monitoringEnabled) {
          await UnifiedUsageService.startComprehensiveMonitoring();
        } else if (!value) {
          await UnifiedUsageService.stopComprehensiveMonitoring();
        }
      }
      
      if (key === 'realtime_monitoring') {
        if (value && settings.monitoringEnabled) {
          await UnifiedUsageService.startComprehensiveMonitoring();
        } else if (!value) {
          await UnifiedUsageService.stopComprehensiveMonitoring();
        }
      }

    } catch (err) { // Use 'err' instead of 'error'
      console.error('Error updating monitoring settings:', err);
      Alert.alert('Error', 'Failed to update monitoring settings');
    }
  };

  const handlePurchase = async () => {
    if (purchasing) return;
    
    try {
      setPurchasing(true);
      
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

        {/* Monitored Apps Section */}
        <Card className="mx-md mb-md">
          <Text className="text-lg font-semibold text-text mb-sm">Monitored Apps</Text>
          <Text className="text-sm text-muted mb-md">
            Select which apps to monitor for usage tracking and notifications
          </Text>
          
          {/* List all monitored apps */}
          {settings.monitoredApps?.map((app) => {
            if (!app || !app.packageName || !app.appName) return null;
            
            return (
              <View key={app.packageName} className="py-sm border-b border-gray-100 last:border-b-0">
                {/* App info row */}
                <View className="flex-row items-center justify-between">
                  <View className="flex-1">
                    <View className="flex-row items-center">
                      <Text className="text-base font-medium text-text mr-xs">{app.appName}</Text>
                      {app.isRecommended && (
                        <View className="px-xs py-0.5 bg-accent/20 rounded">
                          <Text className="text-xs text-accent font-medium">Social</Text>
                        </View>
                      )}
                    </View>
                    <Text className="text-xs text-muted mt-0.5">{app.packageName}</Text>
                  </View>
                  
                  {/* Remove button for non-recommended apps */}
                  {!app.isRecommended ? (
                    <TouchableOpacity
                      onPress={() => handleRemoveMonitoredApp(app.packageName)}
                      className="p-xs"
                    >
                      <Ionicons name="remove-circle" size={24} color="#EF4444" />
                    </TouchableOpacity>
                  ) : (
                    <Switch
                      value={app.isMonitored}
                      onValueChange={(value) => updateMonitoredApp(app.packageName, value)}
                      trackColor={{ false: '#E5E7EB', true: '#4F46E5' }}
                      thumbColor={app.isMonitored ? '#FFFFFF' : '#9CA3AF'}
                    />
                  )}
                </View>
                
                {/* Blocking controls - show if app blocking is enabled */}
                {settings.appBlockingEnabled && app.isMonitored && (
                  <View className="flex-row items-center justify-between mt-3 pl-2">
                    <View className="flex-row items-center flex-1">
                      <Ionicons 
                        name={app.isBlocked ? "lock-closed" : "lock-open-outline"} 
                        size={18} 
                        color={app.isBlocked ? "#EF4444" : "#6B7280"} 
                      />
                      <Text className="text-sm text-muted ml-2">
                        {app.isBlocked ? 'Blocked' : 'Not blocked'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => toggleAppBlocking(app.packageName, !app.isBlocked)}
                      className={`px-4 py-1.5 rounded-full border ${
                        app.isBlocked 
                          ? 'bg-red-50 border-red-200' 
                          : 'bg-green-50 border-green-200'
                      }`}
                    >
                      <Text className={`text-sm font-medium ${
                        app.isBlocked ? 'text-red-600' : 'text-green-600'
                      }`}>
                        {app.isBlocked ? 'Unblock' : 'Block'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })}

          {/* Add more apps button */}
          <TouchableOpacity 
            className="flex-row items-center justify-center py-md mt-sm border-t border-gray-200"
            onPress={() => setShowAppSelection(true)}
          >
            <Ionicons name="add-circle-outline" size={20} color="#4F46E5" className="mr-xs" />
            <Text className="text-base text-accent">Add More Apps</Text>
          </TouchableOpacity>
        </Card>

        {/* App Blocking Settings */}
        <Card className="mx-md mb-md">
          <Text className="text-lg font-semibold text-text mb-sm">App Blocking</Text>
          <Text className="text-sm text-muted mb-md">
            Block access to monitored apps after time limits or during scheduled periods
          </Text>
          
          {/* Enable App Blocking Toggle */}
          <View className="flex-row items-center justify-between py-sm mb-md">
            <View className="flex-1">
              <Text className="text-base font-medium text-text">Enable App Blocking</Text>
              <Text className="text-sm text-muted">
                Restrict access to monitored apps based on usage limits
              </Text>
            </View>
            <Switch
              value={settings.appBlockingEnabled}
              onValueChange={(value) => updateBlockingSettings('app_blocking_enabled', value)}
              trackColor={{ false: '#E5E7EB', true: '#4F46E5' }}
              thumbColor={settings.appBlockingEnabled ? '#FFFFFF' : '#9CA3AF'}
            />
          </View>

          {settings.appBlockingEnabled && (
            <>
              <Card className="mx-md mb-md">
                <Text className="text-lg font-semibold text-text mb-sm">Display Permissions</Text>
                
                <View className="flex-row items-center justify-between py-sm">
                  <View className="flex-1">
                    <Text className="text-base font-medium text-text">Display Over Apps</Text>
                    <Text className="text-sm text-muted">
                      Required for floating score and blocking overlays
                    </Text>
                  </View>
                  {hasOverlayPermission ? (
                    <Ionicons name="checkmark-circle" size={24} color="#10B981" />
                  ) : (
                    <TouchableOpacity
                      onPress={requestOverlayPermission}
                      className="px-4 py-2 bg-accent rounded-lg"
                    >
                      <Text className="text-white text-sm font-medium">Grant</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </Card>
            
              {/* Blocking Mode Selection */}
              <View className="mb-md">
                <Text className="text-base font-medium text-text mb-sm">Blocking Mode</Text>
                <View className="flex-row space-x-sm">
                  <TouchableOpacity
                    onPress={() => updateBlockingSettings('blocking_mode', 'soft')}
                    className={`flex-1 p-3 rounded-lg border ${
                      settings.blockingMode === 'soft' 
                        ? 'bg-accent/10 border-accent' 
                        : 'bg-surface border-gray-200'
                    }`}
                  >
                    <Text className={`text-sm font-medium text-center ${
                      settings.blockingMode === 'soft' ? 'text-accent' : 'text-text'
                    }`}>
                      Soft Block
                    </Text>
                    <Text className="text-xs text-muted text-center mt-1">
                      Warning overlay
                    </Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    onPress={() => updateBlockingSettings('blocking_mode', 'hard')}
                    className={`flex-1 p-3 rounded-lg border ${
                      settings.blockingMode === 'hard' 
                        ? 'bg-danger/10 border-danger' 
                        : 'bg-surface border-gray-200'
                    }`}
                  >
                    <Text className={`text-sm font-medium text-center ${
                      settings.blockingMode === 'hard' ? 'text-danger' : 'text-text'
                    }`}>
                      Hard Block
                    </Text>
                    <Text className="text-xs text-muted text-center mt-1">
                      Full prevention
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Daily Bypass Limit */}
              <View className="mb-md">
                <Text className="text-base font-medium text-text mb-sm">
                  Daily Bypass Limit: {settings.blockBypassLimit}
                </Text>
                <Text className="text-sm text-muted mb-sm">
                  Number of times user can override blocking per day
                </Text>
                <View className="flex-row space-x-sm">
                  {[0, 1, 3, 5, 10].map(limit => (
                    <TouchableOpacity
                      key={limit}
                      onPress={() => updateBlockingSettings('block_bypass_limit', limit)}
                      className={`px-4 py-2 rounded-full ${
                        settings.blockBypassLimit === limit
                          ? 'bg-accent text-white'
                          : 'bg-surface border border-gray-200'
                      }`}
                    >
                      <Text className={`text-sm font-medium ${
                        settings.blockBypassLimit === limit ? 'text-white' : 'text-text'
                      }`}>
                        {limit === 0 ? 'None' : limit.toString()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Schedule Blocking */}
              <View className="pt-md border-t border-gray-200">
                <View className="flex-row items-center justify-between mb-sm">
                  <Text className="text-base font-medium text-text">Schedule Blocking</Text>
                  <Switch
                    value={settings.blockScheduleEnabled}
                    onValueChange={(value) => updateBlockingSettings('block_schedule_enabled', value)}
                    trackColor={{ false: '#E5E7EB', true: '#4F46E5' }}
                    thumbColor={settings.blockScheduleEnabled ? '#FFFFFF' : '#9CA3AF'}
                  />
                </View>
                
                {settings.blockScheduleEnabled && (
                  <View className="flex-row space-x-md">
                    <View className="flex-1">
                      <Text className="text-sm text-muted mb-xs">Block From</Text>
                      <TouchableOpacity 
                        className="bg-surface p-3 rounded-lg border border-gray-200"
                        onPress={() => showTimePicker('start')}
                      >
                        <Text className="text-base text-text text-center">{settings.blockScheduleStart}</Text>
                      </TouchableOpacity>
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm text-muted mb-xs">Block Until</Text>
                      <TouchableOpacity 
                        className="bg-surface p-3 rounded-lg border border-gray-200"
                        onPress={() => showTimePicker('end')}
                      >
                        <Text className="text-base text-text text-center">{settings.blockScheduleEnd}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            </>
          )}
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
              {/* Intensity Selection */}
              <View className="mb-md">
                <Text className="text-base font-medium text-text mb-sm">
                  Notification Intensity: {getIntensityLabel(settings.notificationIntensity)}
                </Text>
                <Text className="text-sm text-muted mb-sm">
                  Higher intensity = more direct and frequent reminders
                </Text>
                <View className="flex-row space-x-sm">
                  {[1, 2, 3, 4].map(intensity => (
                    <TouchableOpacity
                      key={intensity}
                      onPress={() => updateNotificationSettings('notification_intensity', intensity)}
                      className={`flex-1 p-2 rounded-lg border ${
                        settings.notificationIntensity === intensity
                          ? 'bg-accent/10 border-accent'
                          : 'bg-surface border-gray-200'
                      }`}
                    >
                      <Text className={`text-xs font-medium text-center ${
                        settings.notificationIntensity === intensity ? 'text-accent' : 'text-text'
                      }`}>
                        {getIntensityLabel(intensity)}
                      </Text>
                    </TouchableOpacity>
                  ))}
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
                    className="flex-1 bg-surface p-sm rounded-lg items-center border border-gray-200"
                    onPress={() => snoozeNotifications(1)}
                  >
                    <Text className="text-sm font-medium text-text">1 Hour</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    className="flex-1 bg-surface p-sm rounded-lg items-center border border-gray-200"
                    onPress={() => snoozeNotifications(4)}
                  >
                    <Text className="text-sm font-medium text-text">4 Hours</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    className="flex-1 bg-surface p-sm rounded-lg items-center border border-gray-200"
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

            <TouchableOpacity onPress={ () => { Sentry.captureException(Error, {
              level: 'error',
              tags: {
                section: 'home_screen',
                action: 'load_data'
              }
            }); }}>
              <Text className="text-base text-text">Test Sentry</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={async () => {
              const hasPermission = await UnifiedUsageService.hasOverlayPermission();
              Alert.alert(
                'Overlay Permission Status',
                `Has Permission: ${hasPermission ? '✅ YES' : '❌ NO'}\n\n` +
                `${hasPermission ? 'Permission granted' : 'GRANT PERMISSION REQUIRED'}`
              );
              
              if (!hasPermission) {
                await UnifiedUsageService.requestOverlayPermission();
              }
            }}>
              <Text>Check Overlay Permission</Text>
            </TouchableOpacity>
            
            <TouchableOpacity onPress={() => {
              const blockingService = AppBlockingService.getInstance();
              const status = blockingService.getBlockingStatus();
              
              Alert.alert(
                'Blocking Service Status',
                `Enabled: ${status.enabled ? '✅' : '❌'}\n` +
                `Mode: ${status.mode}\n` +
                `Monitoring: ${status.monitoring ? '✅' : '❌'}\n` +
                `Blocked Apps: ${status.blockedAppsCount}\n` +
                `Current App: ${status.currentApp || 'None'}\n` +
                `Floating Active: ${status.floatingWindowActive ? '✅' : '❌'}\n` +
                `Bypass Limit: ${status.bypassLimit}`
              );
            }}>
              <Text>Check Blocking Status</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={async () => {
              try {
                console.log('🧪 Testing floating window...');
                
                // Check permission first
                const hasPermission = await UnifiedUsageService.hasOverlayPermission();
                if (!hasPermission) {
                  Alert.alert('Error', 'No overlay permission. Grant it first.');
                  return;
                }
                
                // Try to start floating window
                const started = await UnifiedUsageService.startFloatingScore(
                  'Test App',
                  75, // test score
                  1800000 // 30 minutes
                );
                
                Alert.alert(
                  'Floating Window Test',
                  started ? '✅ Window started successfully!' : '❌ Failed to start window'
                );
                
                // Auto-close after 10 seconds
                if (started) {
                  setTimeout(async () => {
                    await UnifiedUsageService.stopFloatingScore();
                    Alert.alert('Test Complete', 'Window closed');
                  }, 10000);
                }
                
              } catch (error) {
                Alert.alert('Error', `Test failed: ${error}`);
              }
            }}>
              <Text>Test Floating Window</Text>
            </TouchableOpacity>

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
              onPress={async () => {
                const hasPermission = await UnifiedUsageService.hasOverlayPermission();
                Alert.alert('Overlay Permission', `Has permission: ${hasPermission}`);
              }}
              className="mt-2 p-1 bg-blue-200 rounded"
            >
              <Text className="text-xs text-center">Check Overlay Permission</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              onPress={async () => {
                const started = await UnifiedUsageService.startFloatingScore('Instagram', 75, 1800000);
                Alert.alert('Test', `Floating score started: ${started}`);
              }}
              className="mt-2 p-1 bg-green-200 rounded"
            >
              <Text className="text-xs text-center">Test Floating Score</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              className="py-sm border-b border-gray-200"
              onPress={async () => {
                const monitoringService = UsageMonitoringService.getInstance();
                const status = monitoringService.getMonitoringStatus();
                const isActive = await database.getMeta('monitoring_enabled');
                
                Alert.alert('Monitoring Status', 
                  `Monitoring: ${status.isMonitoring}\n` +
                  `Tracked Apps: ${status.trackedApps}\n` +
                  `Background: ${status.backgroundEnabled}\n` +
                  `Realtime: ${status.realtimeEnabled}\n` +
                  `Service Active: ${isActive === 'true'}\n` +
                  `Native Available: ${UnifiedUsageService.isNativeModuleAvailable()}`
                );
              }}
            >
              <Text className="text-base text-text">Check Monitoring Status</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              className="py-sm border-b border-gray-200"
              onPress={async () => {
                try {
                  const monitoringService = UsageMonitoringService.getInstance();
                  await monitoringService.triggerManualCheck();
                  Alert.alert('Debug', 'Manual monitoring check triggered');
                } catch (error) {
                  Alert.alert('Debug', `Manual check failed: ${error}`);
                }
              }}
            >
              <Text className="text-base text-text">Trigger Manual Check</Text>
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
                    Alert.alert('Debug', 'NotificationService not available');
                  }
                } catch (error) {
                  Alert.alert('Debug', `Notification error: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
              }}
            >
              <Text className="text-base text-text">Test Notification</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              onPress={async () => {
                const blockingService = AppBlockingService.getInstance();
                const status = blockingService.getBlockingStatus();
                Alert.alert('Blocking Status', JSON.stringify(status, null, 2));
              }}
              className="py-sm"
            >
              <Text className="text-base text-text">Check Blocking Status</Text>
            </TouchableOpacity>
          </Card>
        )}
        
        {/* Bottom padding */}
        <View className="h-20" />
      </ScrollView>

      {/* App Selection Bottom Sheet */}
      <AppSelectionBottomSheet
        key={modalKey}
        isOpen={showAppSelection}
        onClose={() => setShowAppSelection(false)}
        onSave={handleAddApps}
        availableApps={settings.availableApps.map((app): AppSelectionItem => ({
          packageName: app.packageName,
          appName: app.appName,
          isRecommended: app.isRecommended,
          category: app.category,
          isCurrentlyMonitored: app.isCurrentlyMonitored || false,
          isSelected: false,
        }))}
        currentlyMonitored={settings.monitoredApps.map(m => m.packageName)}
      />
    </SafeAreaView>
  );
}