import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  AppState,
  Image,
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AppSelectionBottomSheet from '@/components/AppSelectionBottomSheet';
import { Card } from '@/components/Card';
import { Header } from '@/components/Header';
import {
  AppBlockingService,
  type ProtectedApp,
  type ProtectionMode,
} from '@/services/AppBlockingService';
import { CapabilitiesService } from '@/services/CapabilitiesService';
import { UnifiedUsageService } from '@/services/UnifiedUsageService';
import { UsageService } from '@/services/UsageService';
import { database } from '@/services/database';
import type { AppSelectionItem } from '@/types';
import { formatTime } from '@/utils/time';

type PermissionState = { usage: boolean; overlay: boolean; accessibility: boolean };
type ViewApp = ProtectedApp & {
  usageTodayMs: number;
  opensToday: number;
};

const focusHero = require('../../assets/expressions/disappointed.png');
const LOCK_MODE_PROMPT_SEEN_KEY = 'focus_lock_mode_prompt_seen';

type LockModePromptState =
  | { source: 'focus_session' }
  | { source: 'locked_mode'; app: ViewApp }
  | null;

const MODE_META: Record<
  ProtectionMode,
  {
    label: string;
    icon: keyof typeof MaterialIcons.glyphMap;
    chipClass: string;
    textClass: string;
    description: string;
  }
> = {
  monitor: {
    label: 'Monitor',
    icon: 'shield',
    chipClass: 'border-[#D8E3FF] bg-[#F3F7FF]',
    textClass: 'text-[#3563E9]',
    description: 'Track usage and impact your brain score.',
  },
  limit: {
    label: 'Limit',
    icon: 'hourglass-top',
    chipClass: 'border-[#FBD7B5] bg-[#FFF5EB]',
    textClass: 'text-[#F97316]',
    description: 'Show the reflection screen on app open and every 15 minutes.',
  },
  locked: {
    label: 'Locked',
    icon: 'lock',
    chipClass: 'border-[#F5C6CC] bg-[#FFF2F4]',
    textClass: 'text-[#EF4444]',
    description: 'Block the app completely with 2 passes for emergencies.',
  },
  ignore: {
    label: 'Ignore',
    icon: 'visibility-off',
    chipClass: 'border-[#E5E7EB] bg-[#F8FAFC]',
    textClass: 'text-[#64748B]',
    description: 'Remove this app from your protected list.',
  },
};

export default function FocusScreen() {
  const [availableApps, setAvailableApps] = useState<AppSelectionItem[]>([]);
  const [protectedApps, setProtectedApps] = useState<ViewApp[]>([]);
  const [permissions, setPermissions] = useState<PermissionState>({
    usage: false,
    overlay: false,
    accessibility: false,
  });
  const [loading, setLoading] = useState(true);
  const [showAppSelection, setShowAppSelection] = useState(false);
  const [modePickerApp, setModePickerApp] = useState<ViewApp | null>(null);
  const [focusSessionActive, setFocusSessionActive] = useState(false);
  const [lockModePrompt, setLockModePrompt] = useState<LockModePromptState>(null);

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
      const blockingService = AppBlockingService.getInstance();
      await blockingService.initialize();

      const [
        installedApps,
        protectedList,
        usage,
        overlay,
        accessibility,
        todayUsage,
        todaySessions,
        focusActive,
      ] = await Promise.all([
        UnifiedUsageService.getInstalledApps(),
        blockingService.getProtectedApps(),
        CapabilitiesService.hasUsageAccess(),
        CapabilitiesService.hasOverlayPermission(),
        CapabilitiesService.hasAccessibilityPermission(),
        UnifiedUsageService.getTodayUsage(),
        UsageService.getTodaySessions(),
        blockingService.isFocusSessionActive(),
      ]);

      const usageMap = new Map(todayUsage.map((app) => [app.packageName, app.totalTimeMs]));
      const opensMap = new Map<string, number>();
      for (const session of todaySessions) {
        opensMap.set(session.packageName, (opensMap.get(session.packageName) || 0) + 1);
      }

      const protectedPackages = new Set(protectedList.map((app) => app.packageName));
      setAvailableApps(
        installedApps.map(
          (app): AppSelectionItem => ({
            packageName: app.packageName,
            appName: app.appName,
            isRecommended: !!(app as { isRecommended?: boolean }).isRecommended,
            isCurrentlyMonitored: protectedPackages.has(app.packageName),
            isSelected: false,
          })
        )
      );

      setProtectedApps(
        protectedList
          .map((app) => ({
            ...app,
            usageTodayMs: usageMap.get(app.packageName) || 0,
            opensToday: opensMap.get(app.packageName) || 0,
          }))
          .sort((a, b) => a.appName.localeCompare(b.appName))
      );
      setPermissions({ usage, overlay, accessibility });
      setFocusSessionActive(focusActive);
    } finally {
      if (showLoader) {
        setLoading(false);
      }
    }
  };

  const handleModeChange = async (app: ViewApp, mode: ProtectionMode) => {
    if (mode === 'locked') {
      const hasSeenPrompt = (await database.getMeta(LOCK_MODE_PROMPT_SEEN_KEY)) === 'true';
      if (!hasSeenPrompt) {
        setModePickerApp(null);
        setLockModePrompt({ source: 'locked_mode', app });
        return;
      }
      await applyLockedMode(app);
      return;
    }

    if (mode === 'limit' && !permissions.accessibility && !permissions.overlay) {
      const granted = await CapabilitiesService.ensureOverlayPermission();
      if (!granted) {
        await refresh();
        return;
      }
    }

    await AppBlockingService.getInstance().setProtectionMode(app.packageName, app.appName, mode);
    setModePickerApp(null);
    await refresh();
  };

  const triggerLightHaptic = async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (error) {
      console.warn('Haptics unavailable:', error);
    }
  };

  const applyLockedMode = async (app: ViewApp) => {
    if (!permissions.accessibility) {
      const granted = await CapabilitiesService.ensureAccessibilityPermission();
      if (!granted) {
        await refresh();
        return;
      }
    }

    await AppBlockingService.getInstance().setProtectionMode(app.packageName, app.appName, 'locked');
    setModePickerApp(null);
    await refresh();
  };

  const startFocusSession = async () => {
    const service = AppBlockingService.getInstance();
    if (focusSessionActive) {
      await service.endFocusSession();
      await refresh();
      return;
    }

    if (!permissions.usage) {
      const granted = await CapabilitiesService.ensureUsageAccess();
      if (!granted) {
        await refresh();
        return;
      }
    }

    if (!permissions.accessibility) {
      const granted = await CapabilitiesService.ensureAccessibilityPermission();
      if (!granted) {
        await refresh();
        return;
      }
    }

    const started = await service.startFocusSession();
    if (started) {
      await refresh();
    }
  };

  const handleFocusSessionPress = async () => {
    await triggerLightHaptic();

    if (!focusSessionActive) {
      const hasSeenPrompt = (await database.getMeta(LOCK_MODE_PROMPT_SEEN_KEY)) === 'true';
      if (!hasSeenPrompt) {
        setLockModePrompt({ source: 'focus_session' });
        return;
      }
    }

    await startFocusSession();
  };

  const continueLockModePrompt = async () => {
    const prompt = lockModePrompt;
    if (!prompt) {
      return;
    }

    await database.setMeta(LOCK_MODE_PROMPT_SEEN_KEY, 'true');
    setLockModePrompt(null);

    if (prompt.source === 'focus_session') {
      await startFocusSession();
      return;
    }

    await applyLockedMode(prompt.app);
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-bg">
        <View className="flex-1 items-center justify-center">
          <Text className="font-body text-body text-muted">Loading focus...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <Header title="Focus" />

        <View className="px-md pb-sm">
          <Text className="font-body text-body text-muted">
            Choose how Brainrot protects you from distractions.
          </Text>
        </View>

        <Card className="mx-md mb-md overflow-hidden border border-[#E8DFFF] bg-[#F7F3FF] px-md py-lg">
          <View className="flex-row items-center">
            <View className="flex-1 pr-md">
              <Text className="font-heading-bold text-section text-accent">
                Focus Session
              </Text>
              <Text className="mt-sm font-body text-body text-slate-600">
                Lock all protected apps and stay in the zone.
              </Text>
              <TouchableOpacity
                onPress={handleFocusSessionPress}
                className="mt-md self-start rounded-2xl bg-accent px-5 py-3"
              >
                <View className="flex-row items-center">
                  <Ionicons
                    name={focusSessionActive ? 'stop-circle-outline' : 'timer-outline'}
                    size={18}
                    color="#FFFFFF"
                  />
                  <Text className="ml-2 font-heading-semibold text-card-title text-white">
                    {focusSessionActive ? 'End Focus Session' : 'Start Focus Session'}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
            <Image
              source={focusHero}
              resizeMode="contain"
              style={{ width: 182, height: 182 }}
            />
          </View>
          {!permissions.accessibility ? (
            <View className="mt-md rounded-2xl bg-white/80 px-4 py-3">
              <Text className="font-body text-secondary text-slate-600">
                Locked protection and Focus Sessions need Accessibility enabled.
              </Text>
            </View>
          ) : null}
        </Card>

        <Card className="mx-md mb-md">
          <View className="mb-md flex-row items-center justify-between">
            <View className="flex-1 pr-sm">
              <Text className="font-heading-bold text-section text-text">
                Protected Apps
              </Text>
              <Text className="mt-1 font-body text-secondary text-muted">
                Choose the protection level for each app.
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setShowAppSelection(true)}
              className="flex-row items-center rounded-full border border-[#D9D1FF] bg-white px-4 py-2"
            >
              <Ionicons name="add-circle-outline" size={18} color="#5B4CF0" />
              <Text className="ml-2 font-heading-semibold text-secondary text-accent">
                Add App
              </Text>
            </TouchableOpacity>
          </View>

          {protectedApps.length === 0 ? (
            <View className="rounded-2xl bg-surface px-4 py-6">
              <Text className="text-center font-body text-body text-muted">
                No protected apps yet. Add one to start monitoring your focus.
              </Text>
            </View>
          ) : (
            protectedApps.map((app) => {
              const modeMeta = MODE_META[app.protectionMode];
              return (
                <View
                  key={app.packageName}
                  className="border-b border-gray-100 py-md last:border-b-0"
                >
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1 pr-sm">
                      <Text className="font-heading-semibold text-card-title text-text">
                        {app.appName}
                      </Text>
                      <Text className="mt-1 font-body text-secondary text-muted">
                        {formatTime(app.usageTodayMs)} today
                        {`  •  `}
                        {app.opensToday} opens
                      </Text>
                    </View>
                    <View className="ml-sm flex-row items-center">
                      <TouchableOpacity
                        onPress={() => setModePickerApp(app)}
                        className={`flex-row items-center rounded-full border px-4 py-2 ${modeMeta.chipClass}`}
                      >
                        <MaterialIcons
                          name={modeMeta.icon}
                          size={18}
                          color={getModeColor(app.protectionMode)}
                        />
                        <Text
                          className={`mx-2 font-heading-semibold text-secondary ${modeMeta.textClass}`}
                        >
                          {focusSessionActive && app.protectionMode !== 'ignore'
                            ? 'Locked'
                            : modeMeta.label}
                        </Text>
                        <Ionicons
                          name="chevron-down"
                          size={16}
                          color={getModeColor(app.protectionMode)}
                        />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </Card>

      </ScrollView>

      <Modal
        visible={modePickerApp !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setModePickerApp(null)}
      >
        <View className="flex-1 justify-end bg-black/35 px-md pb-md">
          <TouchableOpacity className="flex-1" activeOpacity={1} onPress={() => setModePickerApp(null)} />
          <View className="rounded-[28px] bg-white p-md">
            <View className="mb-md flex-row items-center justify-between">
              <View className="flex-1 pr-sm">
                <Text className="font-heading-bold text-section text-text">
                  Protection Level
                </Text>
                <Text className="mt-1 font-body text-secondary text-muted">
                  {modePickerApp?.appName}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setModePickerApp(null)}
                className="rounded-full bg-slate-100 p-2"
              >
                <Ionicons name="close" size={18} color="#475569" />
              </TouchableOpacity>
            </View>

            {(Object.keys(MODE_META) as ProtectionMode[]).map((mode) => {
              const meta = MODE_META[mode];
              const isActive = modePickerApp?.protectionMode === mode;
              return (
                <TouchableOpacity
                  key={mode}
                  onPress={() => modePickerApp && void handleModeChange(modePickerApp, mode)}
                  className={`mb-sm flex-row items-center rounded-2xl border px-4 py-4 ${isActive ? meta.chipClass : 'border-gray-200 bg-white'}`}
                >
                  <MaterialIcons
                    name={meta.icon}
                    size={20}
                    color={getModeColor(mode)}
                  />
                  <View className="ml-3 flex-1">
                    <Text className={`font-heading-semibold text-card-title ${meta.textClass}`}>
                      {meta.label}
                    </Text>
                    <Text className="mt-1 font-body text-secondary text-muted">
                      {meta.description}
                    </Text>
                  </View>
                  {isActive ? (
                    <Ionicons name="checkmark-circle" size={20} color={getModeColor(mode)} />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Modal>

      <AppSelectionBottomSheet
        key={showAppSelection ? 'open' : 'closed'}
        isOpen={showAppSelection}
        onClose={() => setShowAppSelection(false)}
        onSave={(selectedPackages) =>
          AppBlockingService.getInstance()
            .addProtectedApps(
              selectedPackages.map((packageName) => ({
                packageName,
                appName:
                  availableApps.find((app) => app.packageName === packageName)?.appName ||
                  UnifiedUsageService.getAppDisplayName(packageName),
              }))
            )
            .then(() => {
              setShowAppSelection(false);
              void refresh();
            })
        }
        availableApps={availableApps}
        currentlyMonitored={protectedApps.map((app) => app.packageName)}
      />

      <Modal
        visible={lockModePrompt !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setLockModePrompt(null)}
      >
        <View className="flex-1 justify-end bg-black/35 px-md pb-md">
          <TouchableOpacity
            className="flex-1"
            activeOpacity={1}
            onPress={() => setLockModePrompt(null)}
          />
          <View className="rounded-[28px] bg-white p-md">
            <Text className="font-heading-bold text-section text-text">
              Enable Lock Mode
            </Text>
            <Text className="mt-3 font-body text-body text-slate-600">
              This allows Brainrot to lock all your distractions until you finish off your task.
            </Text>

            <View className="mt-5 rounded-2xl bg-violet-50 px-4 py-4">
              <Text className="font-heading-semibold text-card-title text-accent">
                Without it you won't get
              </Text>
              {[
                'blocking',
                'your focus will keep on breaking',
                'your brain score will deteriorate more',
              ].map((item) => (
                <View key={item} className="mt-3 flex-row items-center">
                  <Ionicons name="close" size={16} color="#EF4444" />
                  <Text className="ml-3 font-body text-body text-slate-700">
                    {item}
                  </Text>
                </View>
              ))}
            </View>

            <TouchableOpacity
              onPress={() => void continueLockModePrompt()}
              className="mt-md flex-row items-center justify-center rounded-2xl bg-accent px-4 py-4"
            >
              <Text className="font-heading-semibold text-card-title text-white">
                Enable Lock Mode
              </Text>
              <Ionicons
                name="arrow-forward"
                size={18}
                color="#FFFFFF"
                style={{ marginLeft: 10 }}
              />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function getModeColor(mode: ProtectionMode): string {
  switch (mode) {
    case 'monitor':
      return '#3563E9';
    case 'limit':
      return '#F97316';
    case 'locked':
      return '#EF4444';
    case 'ignore':
      return '#64748B';
  }
}
