import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, type AlertButton, AppState, Modal, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AppSelectionBottomSheet from '@/components/AppSelectionBottomSheet';
import { Card } from '@/components/Card';
import { Header } from '@/components/Header';
import { AppBlockingService, type BlockingMode } from '@/services/AppBlockingService';
import { CapabilitiesService } from '@/services/CapabilitiesService';
import { MonitoredAppsService } from '@/services/MonitoredAppsService';
import { NotificationService } from '@/services/NotificationService';
import { TelemetryService } from '@/services/TelemetryService';
import { UnifiedUsageService } from '@/services/UnifiedUsageService';
import { database } from '@/services/database';
import type { AppSelectionItem } from '@/types';

type PermissionState = { usage: boolean; overlay: boolean; accessibility: boolean };
type TimeEditor = { visible: boolean; target: 'start' | 'end'; value: string };
type ViewApp = { packageName: string; appName: string; isRecommended: boolean; isCurrentlyMonitored: boolean; isBlocked?: boolean };

export default function SettingsScreen() {
  const [apps, setApps] = useState<ViewApp[]>([]);
  const [permissions, setPermissions] = useState<PermissionState>({ usage: false, overlay: false, accessibility: false });
  const [state, setState] = useState({
    monitoringEnabled: false,
    backgroundChecksEnabled: true,
    realtimeMonitoringEnabled: false,
    appBlockingEnabled: false,
    blockingMode: 'soft' as BlockingMode,
    blockBypassLimit: 3,
    blockScheduleEnabled: false,
    blockScheduleStart: '22:00',
    blockScheduleEnd: '06:00',
    notificationsEnabled: false,
    notificationIntensity: 2,
    notificationsSnoozeUntil: 0,
    analyticsEnabled: true,
  });
  const [loading, setLoading] = useState(true);
  const [showAppSelection, setShowAppSelection] = useState(false);
  const [timeEditor, setTimeEditor] = useState<TimeEditor>({ visible: false, target: 'start', value: '22:00' });

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') {
        void refresh();
      }
    });
    return () => subscription.remove();
  }, []);

  const refresh = async () => {
    setLoading(true);
    try {
      const [installedApps, monitoredPackages, blockedPackages, usage, overlay, accessibility] = await Promise.all([
        UnifiedUsageService.getInstalledApps(),
        database.getMonitoredPackages(),
        database.getMeta('blocked_apps'),
        CapabilitiesService.hasUsageAccess(),
        CapabilitiesService.hasOverlayPermission(),
        CapabilitiesService.hasAccessibilityPermission(),
      ]);

      setApps(
        installedApps
          .map((app) => ({
            packageName: app.packageName,
            appName: app.appName,
            isRecommended: !!(app as { isRecommended?: boolean }).isRecommended,
            isCurrentlyMonitored: monitoredPackages.includes(app.packageName),
            isBlocked: JSON.parse(blockedPackages || '[]').includes(app.packageName),
          }))
          .sort((a, b) => a.appName.localeCompare(b.appName))
      );
      setPermissions({ usage, overlay, accessibility });
      setState({
        monitoringEnabled: (await database.getMeta('monitoring_enabled')) === 'true',
        backgroundChecksEnabled: (await database.getMeta('background_checks_enabled')) !== 'false',
        realtimeMonitoringEnabled: (await database.getMeta('realtime_monitoring_enabled')) === 'true',
        appBlockingEnabled: (await database.getMeta('app_blocking_enabled')) === 'true',
        blockingMode: ((await database.getMeta('blocking_mode')) || 'soft') as BlockingMode,
        blockBypassLimit: parseInt((await database.getMeta('block_bypass_limit')) || '3', 10),
        blockScheduleEnabled: (await database.getMeta('block_schedule_enabled')) === 'true',
        blockScheduleStart: (await database.getMeta('block_schedule_start')) || '22:00',
        blockScheduleEnd: (await database.getMeta('block_schedule_end')) || '06:00',
        notificationsEnabled: (await database.getMeta('notifications_enabled')) === 'true',
        notificationIntensity: parseInt((await database.getMeta('notification_intensity')) || '2', 10),
        notificationsSnoozeUntil: parseInt((await database.getMeta('notifications_snooze_until')) || '0', 10),
        analyticsEnabled: (await database.getMeta('analytics_enabled')) !== 'false',
      });
    } finally {
      setLoading(false);
    }
  };

  const guardedUsageToggle = async (work: () => Promise<void>) => {
    const granted = await CapabilitiesService.ensureUsageAccess();
    if (!granted) {
      Alert.alert('Usage Access Required', 'This feature stays off until Usage Access is enabled.');
      await refresh();
      return;
    }
    await work();
  };

  const maybeShowBackgroundGuidance = async () => {
    const guidance = await CapabilitiesService.getBackgroundReliabilityGuidance();
    if (!guidance.needsManufacturerGuidance) {
      return;
    }

    const buttons: AlertButton[] = [{ text: 'OK' }];
    if (guidance.canOpenDirectly) {
      buttons.unshift({
        text: 'Open OEM Settings',
        onPress: () => {
          void CapabilitiesService.openBackgroundReliabilitySettings();
        },
      });
    }

    Alert.alert(
      guidance.title || 'Background Reliability',
      guidance.instructions || 'Your phone may require extra battery optimization changes for reliable background checks.',
      buttons
    );
  };

  const updateMonitoringToggle = async (key: 'monitoring_enabled' | 'background_checks_enabled' | 'realtime_monitoring_enabled', value: boolean) => {
    if (value) {
      await guardedUsageToggle(async () => {
        await database.setMeta(key, 'true');
        if (key !== 'monitoring_enabled') {
          await database.setMeta('monitoring_enabled', 'true');
        }
        const service = UnifiedUsageService.getInstance();
        await service.startMonitoring();
        await service.applyMonitoringSettings();
        if (key !== 'monitoring_enabled') {
          await maybeShowBackgroundGuidance();
        }
      });
    } else {
      await database.setMeta(key, 'false');
      if (key === 'monitoring_enabled') {
        await UnifiedUsageService.getInstance().stopMonitoring();
      } else {
        await UnifiedUsageService.getInstance().applyMonitoringSettings();
      }
    }
    await refresh();
  };

  const updateNotifications = async (value: boolean) => {
    if (value) {
      const granted = await CapabilitiesService.ensureNotificationPermission();
      if (!granted) {
        Alert.alert('Notifications Not Enabled', 'Notifications stay off until permission is granted.');
        return;
      }
      await NotificationService.initialize();
    }
    await database.setMeta('notifications_enabled', value.toString());
    await refresh();
  };

  const updateBlockingEnabled = async (value: boolean) => {
    if (value && state.blockingMode === 'hard') {
      const granted = await CapabilitiesService.ensureAccessibilityPermission();
      if (!granted) {
        Alert.alert('Accessibility Required', 'Hard block requires Accessibility.');
        await refresh();
        return;
      }
    }
    if (value && state.blockingMode === 'soft' && !permissions.accessibility) {
      const hasOverlay = await CapabilitiesService.ensureOverlayPermission();
      if (!hasOverlay) {
        Alert.alert('Overlay Required', 'Soft block fallback needs Display over other apps.');
        await refresh();
        return;
      }
    }
    await AppBlockingService.getInstance().setBlockingEnabled(value);
    await refresh();
  };

  const updateBlockingMode = async (mode: BlockingMode) => {
    if (mode === 'hard') {
      const granted = await CapabilitiesService.ensureAccessibilityPermission();
      if (!granted) {
        Alert.alert('Accessibility Required', 'Hard block only works when Accessibility is enabled.');
        await refresh();
        return;
      }
    }
    await AppBlockingService.getInstance().setBlockingMode(mode);
    await refresh();
  };

  const toggleBlockedApp = async (packageName: string, blocked: boolean) => {
    const service = AppBlockingService.getInstance();
    if (blocked) await service.blockApp(packageName);
    else await service.unblockApp(packageName);
    await refresh();
  };

  const saveTimeEditor = async () => {
    if (!/^\d{2}:\d{2}$/.test(timeEditor.value)) {
      Alert.alert('Invalid Time', 'Use HH:MM in 24-hour format.');
      return;
    }
    const nextStart = timeEditor.target === 'start' ? timeEditor.value : state.blockScheduleStart;
    const nextEnd = timeEditor.target === 'end' ? timeEditor.value : state.blockScheduleEnd;
    await AppBlockingService.getInstance().updateSchedule(state.blockScheduleEnabled, nextStart, nextEnd);
    setTimeEditor((current) => ({ ...current, visible: false }));
    await refresh();
  };

  if (loading) {
    return <SafeAreaView className="flex-1 bg-bg"><View className="flex-1 items-center justify-center"><Text className="text-base text-muted">Loading settings...</Text></View></SafeAreaView>;
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <Header title="Settings" />

        <Card className="mx-md mb-md">
          <Text className="text-lg font-semibold text-text mb-sm">Permissions</Text>
          <PermissionRow label="Usage Access" granted={permissions.usage} onPress={() => CapabilitiesService.ensureUsageAccess().then(() => void refresh())} />
          <PermissionRow label="Accessibility" granted={permissions.accessibility} onPress={() => CapabilitiesService.ensureAccessibilityPermission().then(() => void refresh())} />
          <PermissionRow label="Display Over Other Apps" granted={permissions.overlay} onPress={() => CapabilitiesService.ensureOverlayPermission().then(() => void refresh())} />
        </Card>

        <Card className="mx-md mb-md">
          <Text className="text-lg font-semibold text-text mb-sm">Monitoring</Text>
          <ToggleRow label="Enable Monitoring" value={state.monitoringEnabled} onValueChange={(value) => updateMonitoringToggle('monitoring_enabled', value)} />
          <ToggleRow label="Background Checks" value={state.backgroundChecksEnabled} onValueChange={(value) => updateMonitoringToggle('background_checks_enabled', value)} />
          <ToggleRow label="Real-time Monitoring" value={state.realtimeMonitoringEnabled} onValueChange={(value) => updateMonitoringToggle('realtime_monitoring_enabled', value)} />
          <Text className="mt-sm text-sm text-muted">Background reliability may require battery optimization exemptions on some devices.</Text>
        </Card>

        <Card className="mx-md mb-md">
          <Text className="text-lg font-semibold text-text mb-sm">App Blocking</Text>
          <Text className="text-sm text-muted mb-md">Hard block requires Accessibility. Floating score requires Display over other apps.</Text>
          <ToggleRow label="Enable App Blocking" value={state.appBlockingEnabled} onValueChange={updateBlockingEnabled} />
          <View className="py-sm border-b border-gray-100">
            <Text className="text-base font-medium text-text mb-sm">Blocking Mode</Text>
            <View className="flex-row">
              <ModeButton label="Soft" active={state.blockingMode === 'soft'} onPress={() => updateBlockingMode('soft')} />
              <ModeButton label="Hard" active={state.blockingMode === 'hard'} onPress={() => updateBlockingMode('hard')} danger />
            </View>
          </View>
          <View className="py-sm border-b border-gray-100">
            <Text className="text-base font-medium text-text mb-sm">Daily Bypass Limit</Text>
            <View className="flex-row">
              {[0, 1, 3, 5].map((limit) => (
                <TouchableOpacity
                  key={limit}
                  onPress={() => AppBlockingService.getInstance().setBypassLimit(limit).then(() => void refresh())}
                  className={`mr-sm rounded-full px-4 py-2 ${state.blockBypassLimit === limit ? 'bg-accent' : 'bg-surface border border-gray-200'}`}
                >
                  <Text className={state.blockBypassLimit === limit ? 'text-white' : 'text-text'}>{limit === 0 ? 'None' : limit.toString()}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View className="py-sm">
            <View className="flex-row items-center justify-between mb-sm">
              <Text className="text-base font-medium text-text">Schedule Blocking</Text>
              <Switch value={state.blockScheduleEnabled} onValueChange={(value) => AppBlockingService.getInstance().updateSchedule(value, state.blockScheduleStart, state.blockScheduleEnd).then(() => void refresh())} trackColor={{ false: '#E5E7EB', true: '#4F46E5' }} thumbColor={state.blockScheduleEnabled ? '#FFFFFF' : '#9CA3AF'} />
            </View>
            {state.blockScheduleEnabled && (
              <View className="flex-row">
                <ScheduleButton label="Block From" value={state.blockScheduleStart} onPress={() => setTimeEditor({ visible: true, target: 'start', value: state.blockScheduleStart })} />
                <ScheduleButton label="Block Until" value={state.blockScheduleEnd} onPress={() => setTimeEditor({ visible: true, target: 'end', value: state.blockScheduleEnd })} />
              </View>
            )}
          </View>
        </Card>

        <Card className="mx-md mb-md">
          <Text className="text-lg font-semibold text-text mb-sm">Monitored Apps</Text>
          {apps.filter((app) => app.isCurrentlyMonitored).map((app) => (
            <View key={app.packageName} className="py-sm border-b border-gray-100 last:border-b-0">
              <View className="flex-row items-center justify-between">
                <View className="flex-1 pr-sm">
                  <Text className="text-base font-medium text-text">{app.appName}</Text>
                  <Text className="text-xs text-muted mt-1">{app.packageName}</Text>
                </View>
                <TouchableOpacity onPress={() => MonitoredAppsService.getInstance().setAppMonitoring(app.packageName, app.appName, false).then(() => void refresh())}>
                  <Ionicons name="remove-circle" size={24} color="#EF4444" />
                </TouchableOpacity>
              </View>
              {state.appBlockingEnabled && (
                <TouchableOpacity onPress={() => toggleBlockedApp(app.packageName, !app.isBlocked)} className="mt-3 rounded-full border border-gray-200 px-4 py-1.5 self-end">
                  <Text className="text-sm font-medium text-text">{app.isBlocked ? 'Unblock' : 'Block'}</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
          <TouchableOpacity onPress={() => setShowAppSelection(true)} className="mt-sm flex-row items-center justify-center border-t border-gray-200 py-md">
            <Ionicons name="add-circle-outline" size={20} color="#4F46E5" />
            <Text className="ml-2 text-base text-accent">Add More Apps</Text>
          </TouchableOpacity>
        </Card>

        <Card className="mx-md mb-md">
          <Text className="text-lg font-semibold text-text mb-sm">Notifications</Text>
          <ToggleRow label="Enable Notifications" value={state.notificationsEnabled} onValueChange={updateNotifications} />
          <View className="py-sm border-b border-gray-100">
            <Text className="text-base font-medium text-text mb-sm">Intensity</Text>
            <View className="flex-row">
              {[1, 2, 3, 4].map((level) => (
                <TouchableOpacity key={level} onPress={() => database.setMeta('notification_intensity', level.toString()).then(() => void refresh())} className={`mr-sm flex-1 rounded-lg border p-2 ${state.notificationIntensity === level ? 'bg-accent/10 border-accent' : 'bg-surface border-gray-200'}`}>
                  <Text className={`text-center text-xs font-medium ${state.notificationIntensity === level ? 'text-accent' : 'text-text'}`}>{level}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View className="py-sm">
            <Text className="text-base font-medium text-text mb-sm">Snooze</Text>
            <View className="flex-row">
              {[1, 4, 24].map((hours) => (
                <TouchableOpacity key={hours} onPress={() => database.setMeta('notifications_snooze_until', (Date.now() + hours * 60 * 60 * 1000).toString()).then(() => void refresh())} className="mr-sm flex-1 rounded-lg border border-gray-200 bg-surface p-sm items-center">
                  <Text className="text-sm font-medium text-text">{hours === 24 ? '24 Hours' : `${hours} Hour${hours > 1 ? 's' : ''}`}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </Card>

        <Card className="mx-md mb-md">
          <Text className="text-lg font-semibold text-text mb-sm">Privacy</Text>
          <ToggleRow label="Diagnostics" value={state.analyticsEnabled} onValueChange={(value) => TelemetryService.setEnabled(value).then(() => void refresh())} />
          <TouchableOpacity onPress={() => router.push('/privacy-policy' as never)} className="py-sm border-b border-gray-100">
            <LinkRow label="Privacy Policy" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/terms' as never)} className="py-sm">
            <LinkRow label="Terms of Service" />
          </TouchableOpacity>
        </Card>
      </ScrollView>

      <Modal visible={timeEditor.visible} transparent animationType="fade" onRequestClose={() => setTimeEditor((current) => ({ ...current, visible: false }))}>
        <View className="flex-1 items-center justify-center bg-black/40 px-md">
          <View className="w-full rounded-2xl bg-white p-md">
            <Text className="text-lg font-semibold text-text mb-sm">Set {timeEditor.target === 'start' ? 'start' : 'end'} time</Text>
            <TextInput value={timeEditor.value} onChangeText={(value) => setTimeEditor((current) => ({ ...current, value }))} className="rounded-lg border border-gray-200 bg-surface px-4 py-3 text-base text-text mb-md" placeholder="22:00" placeholderTextColor="#9CA3AF" />
            <View className="flex-row justify-end">
              <TouchableOpacity onPress={() => setTimeEditor((current) => ({ ...current, visible: false }))} className="rounded-lg px-4 py-2"><Text className="text-base text-muted">Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={saveTimeEditor} className="ml-sm rounded-lg bg-accent px-4 py-2"><Text className="text-base font-medium text-white">Save</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <AppSelectionBottomSheet
        key={showAppSelection ? 'open' : 'closed'}
        isOpen={showAppSelection}
        onClose={() => setShowAppSelection(false)}
        onSave={(selectedPackages) =>
          MonitoredAppsService.getInstance()
            .addMonitoredApps(
              selectedPackages.map((packageName) => ({
                packageName,
                appName: UnifiedUsageService.getAppDisplayName(packageName),
              }))
            )
            .then(() => {
              setShowAppSelection(false);
              void refresh();
            })
        }
        availableApps={apps.map((app): AppSelectionItem => ({
          packageName: app.packageName,
          appName: app.appName,
          isRecommended: app.isRecommended,
          isCurrentlyMonitored: app.isCurrentlyMonitored,
          isSelected: false,
        }))}
        currentlyMonitored={apps.filter((app) => app.isCurrentlyMonitored).map((app) => app.packageName)}
      />
    </SafeAreaView>
  );
}

function PermissionRow({ label, granted, onPress }: { label: string; granted: boolean; onPress: () => void }) {
  return <View className="py-sm border-b border-gray-100 last:border-b-0"><View className="flex-row items-center justify-between"><Text className="text-base font-medium text-text">{label}</Text>{granted ? <Ionicons name="checkmark-circle" size={24} color="#10B981" /> : <TouchableOpacity onPress={onPress} className="rounded-lg bg-accent px-4 py-2"><Text className="text-sm font-medium text-white">Grant</Text></TouchableOpacity>}</View></View>;
}

function ToggleRow({ label, value, onValueChange }: { label: string; value: boolean; onValueChange: (value: boolean) => void }) {
  return <View className="py-sm border-b border-gray-100 last:border-b-0"><View className="flex-row items-center justify-between"><Text className="text-base font-medium text-text">{label}</Text><Switch value={value} onValueChange={onValueChange} trackColor={{ false: '#E5E7EB', true: '#4F46E5' }} thumbColor={value ? '#FFFFFF' : '#9CA3AF'} /></View></View>;
}

function ModeButton({ label, active, onPress, danger = false }: { label: string; active: boolean; onPress: () => void; danger?: boolean }) {
  return <TouchableOpacity onPress={onPress} className={`flex-1 rounded-lg border p-3 ${active ? (danger ? 'bg-danger/10 border-danger' : 'bg-accent/10 border-accent') : 'bg-surface border-gray-200'} ${danger ? 'ml-sm' : ''}`}><Text className={`text-center text-sm font-medium ${active ? (danger ? 'text-danger' : 'text-accent') : 'text-text'}`}>{label}</Text></TouchableOpacity>;
}

function ScheduleButton({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return <TouchableOpacity onPress={onPress} className="flex-1 rounded-lg border border-gray-200 bg-surface p-3 mr-sm"><Text className="text-xs text-muted mb-1">{label}</Text><Text className="text-base text-text text-center">{value}</Text></TouchableOpacity>;
}

function LinkRow({ label }: { label: string }) {
  return <View className="flex-row items-center justify-between"><Text className="text-base text-text">{label}</Text><Ionicons name="chevron-forward" size={20} color="#6B7280" /></View>;
}
