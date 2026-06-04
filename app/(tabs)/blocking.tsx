import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Alert, type AlertButton, AppState, Modal, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AppSelectionBottomSheet from '@/components/AppSelectionBottomSheet';
import { Card } from '@/components/Card';
import { Header } from '@/components/Header';
import { Slider } from '@/components/Slider';
import { AppBlockingService, type BlockingMode } from '@/services/AppBlockingService';
import { CapabilitiesService } from '@/services/CapabilitiesService';
import { MonitoredAppsService } from '@/services/MonitoredAppsService';
import { UnifiedUsageService } from '@/services/UnifiedUsageService';
import { database } from '@/services/database';
import type { AppSelectionItem } from '@/types';

type PermissionState = { usage: boolean; overlay: boolean; accessibility: boolean };
type TimeEditor = { visible: boolean; target: 'start' | 'end'; value: string };
type ViewApp = { packageName: string; appName: string; isRecommended: boolean; isCurrentlyMonitored: boolean; isBlocked?: boolean };

export default function BlockingScreen() {
  const [apps, setApps] = useState<ViewApp[]>([]);
  const [permissions, setPermissions] = useState<PermissionState>({ usage: false, overlay: false, accessibility: false });
  const [state, setState] = useState({
    appBlockingEnabled: false,
    blockingMode: 'soft' as BlockingMode,
    blockBypassLimit: 3,
    softBlockIntervalMinutes: 15,
    blockScheduleEnabled: false,
    blockScheduleStart: '22:00',
    blockScheduleEnd: '06:00',
  });
  const [loading, setLoading] = useState(true);
  const [showAppSelection, setShowAppSelection] = useState(false);
  const [timeEditor, setTimeEditor] = useState<TimeEditor>({ visible: false, target: 'start', value: '22:00' });

  useEffect(() => {
    void refresh({ showLoader: true });
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') {
        void refresh();
      }
    });
    return () => subscription.remove();
  }, []);

  const refresh = async ({ showLoader = false }: { showLoader?: boolean } = {}) => {
    if (showLoader) {
      setLoading(true);
    }
    try {
      const [installedApps, monitoredPackages, blockedPackages, usage, overlay, accessibility] = await Promise.all([
        UnifiedUsageService.getInstalledApps(),
        database.getMonitoredPackages(),
        database.getMeta('blocked_apps'),
        CapabilitiesService.hasUsageAccess(),
        CapabilitiesService.hasOverlayPermission(),
        CapabilitiesService.hasAccessibilityPermission(),
      ]);

      const blockedList = JSON.parse(blockedPackages || '[]') as string[];

      setApps(
        installedApps
          .map((app) => ({
            packageName: app.packageName,
            appName: app.appName,
            isRecommended: !!(app as { isRecommended?: boolean }).isRecommended,
            isCurrentlyMonitored: monitoredPackages.includes(app.packageName),
            isBlocked: blockedList.includes(app.packageName),
          }))
          .sort((a, b) => a.appName.localeCompare(b.appName))
      );
      setPermissions({ usage, overlay, accessibility });
      setState({
        appBlockingEnabled: (await database.getMeta('app_blocking_enabled')) === 'true',
        blockingMode: ((await database.getMeta('blocking_mode')) || 'soft') as BlockingMode,
        blockBypassLimit: parseInt((await database.getMeta('block_bypass_limit')) || '3', 10),
        softBlockIntervalMinutes: parseInt((await database.getMeta('soft_block_interval_minutes')) || '15', 10),
        blockScheduleEnabled: (await database.getMeta('block_schedule_enabled')) === 'true',
        blockScheduleStart: (await database.getMeta('block_schedule_start')) || '22:00',
        blockScheduleEnd: (await database.getMeta('block_schedule_end')) || '06:00',
      });
    } finally {
      if (showLoader) {
        setLoading(false);
      }
    }
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

  const updateBlockingEnabled = async (value: boolean) => {
    if (value && !permissions.usage) {
      const granted = await CapabilitiesService.ensureUsageAccess();
      if (!granted) {
        Alert.alert('Usage Access Required', 'Blocking depends on usage monitoring, so Usage Access has to be enabled first.');
        await refresh();
        return;
      }
    }

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
    if (value) {
      await maybeShowBackgroundGuidance();
    }
    setState((current) => ({ ...current, appBlockingEnabled: value }));
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
    if (mode === 'soft' && !permissions.accessibility && !permissions.overlay) {
      const hasOverlay = await CapabilitiesService.ensureOverlayPermission();
      if (!hasOverlay) {
        Alert.alert('Overlay Required', 'Soft block fallback needs Display over other apps.');
        await refresh();
        return;
      }
    }
    setState((current) => ({ ...current, blockingMode: mode }));
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
    setState((current) => ({
      ...current,
      blockScheduleStart: nextStart,
      blockScheduleEnd: nextEnd,
    }));
    await refresh();
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-bg">
        <View className="flex-1 items-center justify-center">
          <Text className="font-body text-body text-muted">Loading blocking...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const monitoredApps = apps.filter((app) => app.isCurrentlyMonitored);

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <Header title="Blocking" />

        <Card className="mx-md mb-md">
          <Text className="mb-sm font-heading-bold text-section text-text">Monitored Apps</Text>
          <Text className="mb-md font-body text-secondary text-muted">
            Choose the distracting apps that affect your score, and decide which of them should be actively blocked.
          </Text>
          {monitoredApps.length === 0 ? (
            <View className="py-md">
              <Text className="font-body text-body text-muted text-center">No monitored apps yet.</Text>
            </View>
          ) : (
            monitoredApps.map((app) => (
              <View key={app.packageName} className="py-sm border-b border-gray-100 last:border-b-0">
                <View className="flex-row items-center justify-between">
                  <View className="flex-1 pr-sm">
                    <Text className="font-heading-semibold text-card-title text-text">{app.appName}</Text>
                    <Text className="mt-1 font-body text-secondary text-muted">{app.packageName}</Text>
                  </View>
                  <TouchableOpacity onPress={() => MonitoredAppsService.getInstance().setAppMonitoring(app.packageName, app.appName, false).then(() => void refresh())}>
                    <Ionicons name="remove-circle" size={24} color="#EF4444" />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  onPress={() => toggleBlockedApp(app.packageName, !app.isBlocked)}
                  className={`mt-3 rounded-full border px-4 py-1.5 self-end ${app.isBlocked ? 'border-accent bg-accent/10' : 'border-gray-200'}`}
                >
                  <Text className={`font-heading-semibold text-secondary ${app.isBlocked ? 'text-accent' : 'text-text'}`}>
                    {app.isBlocked ? 'Blocked' : 'Allow Through'}
                  </Text>
                </TouchableOpacity>
              </View>
            ))
          )}
          <TouchableOpacity onPress={() => setShowAppSelection(true)} className="mt-sm flex-row items-center justify-center border-t border-gray-200 py-md">
            <Ionicons name="add-circle-outline" size={20} color="#5B4CF0" />
            <Text className="ml-2 font-heading-semibold text-card-title text-accent">Add More Apps</Text>
          </TouchableOpacity>
        </Card>

        <Card className="mx-md mb-md">
          <Text className="mb-sm font-heading-bold text-section text-text">Interventions</Text>
          <Text className="mb-md font-body text-secondary text-muted">
            Configure how aggressively Brainrot steps in once monitored apps start hurting your day.
          </Text>
          <ToggleRow label="Enable App Blocking" value={state.appBlockingEnabled} onValueChange={updateBlockingEnabled} />
          <View className="py-sm border-b border-gray-100">
            <Text className="mb-sm font-heading-semibold text-card-title text-text">Blocking Mode</Text>
            <View className="flex-row">
              <ModeButton label="Soft Blocking" active={state.blockingMode === 'soft'} onPress={() => updateBlockingMode('soft')} />
              <ModeButton label="Hard Blocking" active={state.blockingMode === 'hard'} onPress={() => updateBlockingMode('hard')} danger />
            </View>
          </View>
          {state.blockingMode === 'soft' && (
            <View className="py-sm border-b border-gray-100">
              <Text className="mb-sm font-heading-semibold text-card-title text-text">Pause Screen Interval</Text>
              <Text className="mb-sm font-body text-secondary text-muted">
                Show the pause screen when the app opens, then again every {state.softBlockIntervalMinutes} minutes while you keep using it.
              </Text>
              <View className="items-center">
                <View style={{ width: 280 }}>
                  <Slider
                    value={state.softBlockIntervalMinutes}
                    minimumValue={15}
                    maximumValue={60}
                    step={15}
                    onValueChange={(value) => {
                      void AppBlockingService.getInstance().setSoftBlockIntervalMinutes(value).then(() => void refresh());
                    }}
                  />
                  <View className="mt-sm flex-row justify-between px-2">
                    {[15, 30, 45, 60].map((minutes) => (
                      <Text key={minutes} className={`font-body text-secondary ${state.softBlockIntervalMinutes === minutes ? 'text-accent' : 'text-muted'}`}>
                        {minutes}m
                      </Text>
                    ))}
                  </View>
                </View>
              </View>
            </View>
          )}
          {state.blockingMode === 'hard' && (
            <View className="py-sm border-b border-gray-100">
              <Text className="mb-sm font-heading-semibold text-card-title text-text">Emergency Passes Per Day</Text>
              <View className="flex-row">
                {[0, 1, 3, 5].map((limit) => (
                  <TouchableOpacity
                    key={limit}
                    onPress={() => AppBlockingService.getInstance().setBypassLimit(limit).then(() => void refresh())}
                    className={`mr-sm rounded-full px-4 py-2 ${state.blockBypassLimit === limit ? 'bg-accent' : 'bg-surface border border-gray-200'}`}
                  >
                    <Text className={`font-heading-semibold text-secondary ${state.blockBypassLimit === limit ? 'text-white' : 'text-text'}`}>{limit === 0 ? 'None' : limit.toString()}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
          <View className="py-sm">
            <View className="flex-row items-center justify-between mb-sm">
              <Text className="font-heading-semibold text-card-title text-text">Schedule Lock Mode</Text>
              <Switch
                value={state.blockScheduleEnabled}
                onValueChange={(value) => AppBlockingService.getInstance().updateSchedule(value, state.blockScheduleStart, state.blockScheduleEnd).then(() => void refresh())}
                trackColor={{ false: '#E5E7EB', true: '#5D3DF0' }}
                thumbColor={state.blockScheduleEnabled ? '#FFFFFF' : '#9CA3AF'}
              />
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
          <Text className="mb-sm font-heading-bold text-section text-text">Blocking Readiness</Text>
          <PermissionRow label="Usage Access" granted={permissions.usage} onPress={() => CapabilitiesService.ensureUsageAccess().then(() => void refresh())} />
          <PermissionRow label="Accessibility" granted={permissions.accessibility} onPress={() => CapabilitiesService.ensureAccessibilityPermission().then(() => void refresh())} />
          <PermissionRow label="Display Over Other Apps" granted={permissions.overlay} onPress={() => CapabilitiesService.ensureOverlayPermission().then(() => void refresh())} />
          <Text className="mt-sm font-body text-secondary text-muted">
            Lock Mode needs Accessibility so Android can force the blocked app into the background instantly. Pause Screen can fall back to overlay when Accessibility is unavailable.
          </Text>
        </Card>
      </ScrollView>

      <Modal visible={timeEditor.visible} transparent animationType="fade" onRequestClose={() => setTimeEditor((current) => ({ ...current, visible: false }))}>
        <View className="flex-1 items-center justify-center bg-black/40 px-md">
          <View className="w-full rounded-2xl bg-card p-md">
            <Text className="mb-sm font-heading-bold text-section text-text">Set {timeEditor.target === 'start' ? 'start' : 'end'} time</Text>
            <TextInput value={timeEditor.value} onChangeText={(value) => setTimeEditor((current) => ({ ...current, value }))} className="mb-md rounded-lg border border-gray-200 bg-surface px-4 py-3 font-body text-body text-text" placeholder="22:00" placeholderTextColor="#64748B" />
            <View className="flex-row justify-end">
              <TouchableOpacity onPress={() => setTimeEditor((current) => ({ ...current, visible: false }))} className="rounded-lg px-4 py-2">
                <Text className="font-body text-body text-muted">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveTimeEditor} className="ml-sm rounded-lg bg-accent px-4 py-2">
                <Text className="font-heading-semibold text-card-title text-white">Save</Text>
              </TouchableOpacity>
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
        currentlyMonitored={monitoredApps.map((app) => app.packageName)}
      />
    </SafeAreaView>
  );
}

function PermissionRow({ label, granted, onPress }: { label: string; granted: boolean; onPress: () => void }) {
  return <View className="py-sm border-b border-gray-100 last:border-b-0"><View className="flex-row items-center justify-between"><Text className="font-heading-semibold text-card-title text-text">{label}</Text>{granted ? <Ionicons name="checkmark-circle" size={24} color="#10B981" /> : <TouchableOpacity onPress={onPress} className="rounded-lg bg-accent px-4 py-2"><Text className="font-heading-semibold text-secondary text-white">Grant</Text></TouchableOpacity>}</View></View>;
}

function ToggleRow({ label, value, onValueChange }: { label: string; value: boolean; onValueChange: (value: boolean) => void }) {
  return <View className="py-sm border-b border-gray-100 last:border-b-0"><View className="flex-row items-center justify-between"><Text className="font-heading-semibold text-card-title text-text">{label}</Text><Switch value={value} onValueChange={onValueChange} trackColor={{ false: '#E5E7EB', true: '#5D3DF0' }} thumbColor={value ? '#FFFFFF' : '#9CA3AF'} /></View></View>;
}

function ModeButton({ label, active, onPress, danger = false }: { label: string; active: boolean; onPress: () => void; danger?: boolean }) {
  return <TouchableOpacity onPress={onPress} className={`flex-1 rounded-lg border p-3 ${active ? (danger ? 'bg-danger/10 border-danger' : 'bg-accent/10 border-accent') : 'bg-surface border-gray-200'} ${danger ? 'ml-sm' : ''}`}><Text className={`text-center font-heading-semibold text-secondary ${active ? (danger ? 'text-danger' : 'text-accent') : 'text-text'}`}>{label}</Text></TouchableOpacity>;
}

function ScheduleButton({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return <TouchableOpacity onPress={onPress} className="flex-1 rounded-lg border border-gray-200 bg-surface p-3 mr-sm"><Text className="mb-1 font-body text-secondary text-muted">{label}</Text><Text className="font-body text-body text-text text-center">{value}</Text></TouchableOpacity>;
}
