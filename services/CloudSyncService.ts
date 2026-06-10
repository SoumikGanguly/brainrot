import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';

import { firestore } from './firebase';
import { PurchaseService } from './PurchaseService';
import {
  database,
  type AppSettings,
  type AppSession,
  type BlockEvent,
  type DailyUsage,
} from './database';

type UserSettingsSnapshot = {
  analyticsEnabled: boolean;
  monitoringEnabled: boolean;
  backgroundChecksEnabled: boolean;
  realtimeMonitoringEnabled: boolean;
  notificationsEnabled: boolean;
  notificationIntensity: number;
  notificationsSnoozeUntil: number | null;
  appBlockingEnabled: boolean;
  blockingMode: 'soft' | 'hard';
  blockBypassLimit: number;
  softBlockIntervalMinutes: number;
  blockScheduleEnabled: boolean;
  blockScheduleStart: string;
  blockScheduleEnd: string;
  trialStartTime: number | null;
  isPremium: boolean;
};

const SYNC_LOOKBACK_DAYS = 90;

export class CloudSyncService {
  static async syncAuthenticatedUser(user: User): Promise<void> {
    try {
      const userRef = doc(firestore, 'users', user.uid);
      const existingUserDoc = await getDoc(userRef);

      const localSnapshot = await this.getLocalSnapshot();
      const hasMeaningfulLocalState =
        localSnapshot.monitoredApps.some((app) => app.monitored) ||
        localSnapshot.blockedApps.length > 0 ||
        localSnapshot.dailySummaries.length > 0 ||
        localSnapshot.appSessions.length > 0 ||
        localSnapshot.blockEvents.length > 0;

      if (!existingUserDoc.exists()) {
        await this.uploadSnapshot(user, localSnapshot, true);
      } else if (!hasMeaningfulLocalState) {
        await this.restoreSnapshot(user);
      } else {
        await this.uploadSnapshot(user, localSnapshot, false);
      }

      await database.setMeta('cloud_last_sync_at', Date.now().toString());
      await database.setMeta('cloud_last_sync_uid', user.uid);
    } catch (error) {
      console.warn('Cloud sync failed:', error);
    }
  }

  private static async getLocalSnapshot() {
    const [monitoredApps, dailySummaries, historyEvents, blockedAppsMeta, settings, isPremium] = await Promise.all([
      database.getAppSettings(),
      database.getHistoricalData(SYNC_LOOKBACK_DAYS),
      this.getLocalHistoryEvents(SYNC_LOOKBACK_DAYS),
      database.getMeta('blocked_apps'),
      this.getSettingsSnapshot(),
      PurchaseService.isPremium(),
    ]);

    return {
      monitoredApps,
      blockedApps: this.parseStringArray(blockedAppsMeta),
      dailySummaries,
      appSessions: historyEvents.appSessions,
      blockEvents: historyEvents.blockEvents,
      settings: {
        ...settings,
        isPremium,
      },
    };
  }

  private static async getSettingsSnapshot(): Promise<UserSettingsSnapshot> {
    const [
      analyticsEnabled,
      monitoringEnabled,
      backgroundChecksEnabled,
      realtimeMonitoringEnabled,
      notificationsEnabled,
      notificationIntensity,
      notificationsSnoozeUntil,
      appBlockingEnabled,
      blockingMode,
      blockBypassLimit,
      softBlockIntervalMinutes,
      blockScheduleEnabled,
      blockScheduleStart,
      blockScheduleEnd,
      trialStartTime,
    ] = await Promise.all([
      database.getMeta('analytics_enabled'),
      database.getMeta('monitoring_enabled'),
      database.getMeta('background_checks_enabled'),
      database.getMeta('realtime_monitoring_enabled'),
      database.getMeta('notifications_enabled'),
      database.getMeta('notification_intensity'),
      database.getMeta('notifications_snooze_until'),
      database.getMeta('app_blocking_enabled'),
      database.getMeta('blocking_mode'),
      database.getMeta('block_bypass_limit'),
      database.getMeta('soft_block_interval_minutes'),
      database.getMeta('block_schedule_enabled'),
      database.getMeta('block_schedule_start'),
      database.getMeta('block_schedule_end'),
      this.getTrialStartTime(),
    ]);

    return {
      analyticsEnabled: analyticsEnabled !== 'false',
      monitoringEnabled: monitoringEnabled === 'true',
      backgroundChecksEnabled: backgroundChecksEnabled !== 'false',
      realtimeMonitoringEnabled: realtimeMonitoringEnabled === 'true',
      notificationsEnabled: notificationsEnabled === 'true',
      notificationIntensity: this.parseNumber(notificationIntensity, 2),
      notificationsSnoozeUntil: this.parseNullableNumber(notificationsSnoozeUntil),
      appBlockingEnabled: appBlockingEnabled === 'true',
      blockingMode: blockingMode === 'hard' ? 'hard' : 'soft',
      blockBypassLimit: this.parseNumber(blockBypassLimit, 3),
      softBlockIntervalMinutes: this.parseNumber(softBlockIntervalMinutes, 15),
      blockScheduleEnabled: blockScheduleEnabled === 'true',
      blockScheduleStart: blockScheduleStart || '22:00',
      blockScheduleEnd: blockScheduleEnd || '06:00',
      trialStartTime: trialStartTime,
      isPremium: false,
    };
  }

  private static async uploadSnapshot(
    user: User,
    snapshot: Awaited<ReturnType<typeof this.getLocalSnapshot>>,
    isFirstSync: boolean
  ): Promise<void> {
    const userRef = doc(firestore, 'users', user.uid);
    const now = serverTimestamp();
    const appVersion = Constants.expoConfig?.version || Constants.nativeAppVersion || 'unknown';

    await setDoc(
      userRef,
      {
        uid: user.uid,
        email: user.email || null,
        displayName: user.displayName || null,
        photoURL: user.photoURL || null,
        provider: 'google',
        updatedAt: now,
        lastSeenAt: now,
        lastSignInAt: now,
        platform: Platform.OS,
        appVersion,
        lastSyncAt: now,
        premiumSource: snapshot.settings.isPremium ? (__DEV__ ? 'development_stub' : 'pending_revenuecat') : null,
        entitlementLastCheckedAt: Date.now(),
        ...(isFirstSync ? { createdAt: now } : {}),
        ...snapshot.settings,
      },
      { merge: true }
    );

    await setDoc(
      doc(firestore, 'users', user.uid, 'settings', 'monitoredApps'),
      { updatedAt: now },
      { merge: true }
    );
    await setDoc(
      doc(firestore, 'users', user.uid, 'settings', 'blockedApps'),
      { updatedAt: now },
      { merge: true }
    );
    await setDoc(
      doc(firestore, 'users', user.uid, 'history', 'dailySummaries'),
      { updatedAt: now },
      { merge: true }
    );
    await setDoc(
      doc(firestore, 'users', user.uid, 'history', 'appSessions'),
      { updatedAt: now },
      { merge: true }
    );
    await setDoc(
      doc(firestore, 'users', user.uid, 'history', 'blockEvents'),
      { updatedAt: now },
      { merge: true }
    );

    const [existingMonitoredApps, existingBlockedApps, existingAppSessions, existingBlockEvents] = await Promise.all([
      getDocs(collection(firestore, 'users', user.uid, 'settings', 'monitoredApps', 'items')),
      getDocs(collection(firestore, 'users', user.uid, 'settings', 'blockedApps', 'items')),
      getDocs(collection(firestore, 'users', user.uid, 'history', 'appSessions', 'items')),
      getDocs(collection(firestore, 'users', user.uid, 'history', 'blockEvents', 'items')),
    ]);

    const batch = writeBatch(firestore);
    const monitoredAppsCollection = collection(
      firestore,
      'users',
      user.uid,
      'settings',
      'monitoredApps',
      'items'
    );
    const blockedAppsCollection = collection(
      firestore,
      'users',
      user.uid,
      'settings',
      'blockedApps',
      'items'
    );
    const summariesCollection = collection(
      firestore,
      'users',
      user.uid,
      'history',
      'dailySummaries',
      'items'
    );
    const sessionsCollection = collection(
      firestore,
      'users',
      user.uid,
      'history',
      'appSessions',
      'items'
    );
    const blockEventsCollection = collection(
      firestore,
      'users',
      user.uid,
      'history',
      'blockEvents',
      'items'
    );

    snapshot.monitoredApps.forEach((app) => {
      batch.set(doc(monitoredAppsCollection, app.packageName), {
        packageName: app.packageName,
        appName: app.appName,
        monitored: app.monitored,
        dailyLimitMs: app.dailyLimitMs,
        protectionMode: app.protectionMode ?? null,
        updatedAt: now,
      });
    });

    snapshot.blockedApps.forEach((packageName) => {
      const matchedApp = snapshot.monitoredApps.find((app) => app.packageName === packageName);
      batch.set(doc(blockedAppsCollection, packageName), {
        packageName,
        appName: matchedApp?.appName || packageName,
        updatedAt: now,
      });
    });

    const localMonitoredPackages = new Set(snapshot.monitoredApps.map((app) => app.packageName));
    existingMonitoredApps.docs.forEach((entry) => {
      if (!localMonitoredPackages.has(entry.id)) {
        batch.delete(entry.ref);
      }
    });

    const localBlockedPackages = new Set(snapshot.blockedApps);
    existingBlockedApps.docs.forEach((entry) => {
      if (!localBlockedPackages.has(entry.id)) {
        batch.delete(entry.ref);
      }
    });

    snapshot.dailySummaries.forEach((summary) => {
      batch.set(doc(summariesCollection, summary.date), {
        date: summary.date,
        brainScore: summary.brainScore,
        totalScreenTime: summary.totalScreenTime,
        signalsJson: JSON.stringify(summary.insightSignals || null),
        appsJson: JSON.stringify(summary.apps || []),
        updatedAt: now,
      });
    });

    snapshot.appSessions.forEach((session) => {
      batch.set(doc(sessionsCollection, this.getAppSessionDocId(session)), {
        date: session.date,
        packageName: session.packageName,
        appName: session.appName,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        durationMs: session.durationMs,
        source: session.source,
        wasMonitored: session.wasMonitored,
        updatedAt: now,
      });
    });

    snapshot.blockEvents.forEach((event) => {
      batch.set(doc(blockEventsCollection, this.getBlockEventDocId(event)), {
        date: event.date,
        packageName: event.packageName,
        appName: event.appName,
        triggeredAt: event.triggeredAt,
        blockType: event.blockType,
        limitMs: event.limitMs ?? null,
        usageAtTriggerMs: event.usageAtTriggerMs ?? null,
        action: event.action,
        protectionContext: event.protectionContext ?? null,
        resolvedAt: event.resolvedAt ?? null,
        source: event.source ?? 'native_overlay',
        updatedAt: now,
      });
    });

    const localSessionIds = new Set(snapshot.appSessions.map((session) => this.getAppSessionDocId(session)));
    existingAppSessions.docs.forEach((entry) => {
      if (!localSessionIds.has(entry.id)) {
        batch.delete(entry.ref);
      }
    });

    const localBlockEventIds = new Set(snapshot.blockEvents.map((event) => this.getBlockEventDocId(event)));
    existingBlockEvents.docs.forEach((entry) => {
      if (!localBlockEventIds.has(entry.id)) {
        batch.delete(entry.ref);
      }
    });

    await batch.commit();
  }

  private static async restoreSnapshot(user: User): Promise<void> {
    const userRef = doc(firestore, 'users', user.uid);
    const [
      userDoc,
      monitoredAppsSnapshot,
      blockedAppsSnapshot,
      dailySummariesSnapshot,
      appSessionsSnapshot,
      blockEventsSnapshot,
    ] = await Promise.all([
      getDoc(userRef),
      getDocs(collection(firestore, 'users', user.uid, 'settings', 'monitoredApps', 'items')),
      getDocs(collection(firestore, 'users', user.uid, 'settings', 'blockedApps', 'items')),
      getDocs(collection(firestore, 'users', user.uid, 'history', 'dailySummaries', 'items')),
      getDocs(collection(firestore, 'users', user.uid, 'history', 'appSessions', 'items')),
      getDocs(collection(firestore, 'users', user.uid, 'history', 'blockEvents', 'items')),
    ]);

    if (!userDoc.exists()) {
      return;
    }

    const data = userDoc.data();
    await this.restoreMetaFromCloud(data);

    const monitoredApps = monitoredAppsSnapshot.docs.map((entry) => entry.data() as AppSettings);
    for (const app of monitoredApps) {
      await database.updateAppSettings({
        packageName: app.packageName,
        appName: app.appName,
        monitored: Boolean(app.monitored),
        dailyLimitMs: app.dailyLimitMs,
        protectionMode:
          (app.protectionMode as AppSettings['protectionMode']) ?? null,
      });
    }

    const monitoredPackages = monitoredApps
      .filter((app) => Boolean(app.monitored))
      .map((app) => app.packageName);
    await database.setMeta('monitored_apps', JSON.stringify(monitoredPackages));

    const blockedApps = blockedAppsSnapshot.docs.map((entry) => {
      const blocked = entry.data() as { packageName: string };
      return blocked.packageName;
    });
    await database.setMeta('blocked_apps', JSON.stringify(blockedApps));

    for (const entry of dailySummariesSnapshot.docs) {
      const summary = entry.data() as {
        date: string;
        brainScore: number;
        totalScreenTime: number;
        signalsJson?: string;
        appsJson: string;
      };
      const parsedApps = this.parseDailyApps(summary.appsJson, summary.date);
      await database.saveDailySummary(summary.date, {
        date: summary.date,
        brainScore: summary.brainScore,
        totalScreenTime: summary.totalScreenTime,
        apps: parsedApps,
        insightSignals: this.parseInsightSignals(summary.signalsJson),
      });
    }

    const restoredSessions = appSessionsSnapshot.docs.map((entry) => {
      const session = entry.data() as Omit<AppSession, 'id'>;
      return {
        date: session.date,
        packageName: session.packageName,
        appName: session.appName,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        durationMs: this.parseNumber(session.durationMs, 0),
        source: session.source || 'usage_events',
        wasMonitored: Boolean(session.wasMonitored),
      } satisfies AppSession;
    });
    await database.saveAppSessions(restoredSessions);

    const restoredBlockEvents = blockEventsSnapshot.docs.map((entry) => {
      const event = entry.data() as Omit<BlockEvent, 'id'>;
      return {
        date: event.date,
        packageName: event.packageName,
        appName: event.appName,
        triggeredAt: event.triggeredAt,
        blockType: event.blockType,
        limitMs: event.limitMs != null ? this.parseNumber(event.limitMs, 0) : null,
        usageAtTriggerMs:
          event.usageAtTriggerMs != null ? this.parseNumber(event.usageAtTriggerMs, 0) : null,
        action: event.action,
        protectionContext: event.protectionContext ?? null,
        resolvedAt: event.resolvedAt ?? null,
        source: event.source || 'native_overlay',
      } satisfies BlockEvent;
    });
    await database.saveBlockEvents(restoredBlockEvents);
  }

  private static async getLocalHistoryEvents(days: number): Promise<{
    appSessions: AppSession[];
    blockEvents: BlockEvent[];
  }> {
    const dateStrings = Array.from({ length: days }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - index);
      return date.toISOString().split('T')[0];
    });

    const perDayData = await Promise.all(
      dateStrings.map(async (dateStr) => ({
        appSessions: await database.getAppSessionsForDate(dateStr),
        blockEvents: await database.getBlockEventsForDate(dateStr),
      }))
    );

    return {
      appSessions: perDayData.flatMap((entry) => entry.appSessions),
      blockEvents: perDayData.flatMap((entry) => entry.blockEvents),
    };
  }

  private static getAppSessionDocId(session: Pick<AppSession, 'packageName' | 'startedAt' | 'source'>): string {
    return this.encodeDocId([session.packageName, session.startedAt, session.source].join('__'));
  }

  private static getBlockEventDocId(
    event: Pick<BlockEvent, 'packageName' | 'triggeredAt' | 'action' | 'source'>
  ): string {
    return this.encodeDocId(
      [event.packageName, event.triggeredAt, event.action, event.source ?? 'native_overlay'].join('__')
    );
  }

  private static encodeDocId(value: string): string {
    return encodeURIComponent(value);
  }

  private static async restoreMetaFromCloud(data: Record<string, unknown>): Promise<void> {
    await Promise.all([
      database.setMeta('analytics_enabled', String(data.analyticsEnabled !== false)),
      database.setMeta('monitoring_enabled', String(Boolean(data.monitoringEnabled))),
      database.setMeta('background_checks_enabled', String(data.backgroundChecksEnabled !== false)),
      database.setMeta('realtime_monitoring_enabled', String(Boolean(data.realtimeMonitoringEnabled))),
      database.setMeta('notifications_enabled', String(Boolean(data.notificationsEnabled))),
      database.setMeta('notification_intensity', String(this.parseNumber(data.notificationIntensity, 2))),
      database.setMeta(
        'notifications_snooze_until',
        String(this.parseNullableNumber(data.notificationsSnoozeUntil) || 0)
      ),
      database.setMeta('app_blocking_enabled', String(Boolean(data.appBlockingEnabled))),
      database.setMeta('blocking_mode', data.blockingMode === 'hard' ? 'hard' : 'soft'),
      database.setMeta('block_bypass_limit', String(this.parseNumber(data.blockBypassLimit, 3))),
      database.setMeta(
        'soft_block_interval_minutes',
        String(this.parseNumber(data.softBlockIntervalMinutes, 15))
      ),
      database.setMeta('block_schedule_enabled', String(Boolean(data.blockScheduleEnabled))),
      database.setMeta('block_schedule_start', String(data.blockScheduleStart || '22:00')),
      database.setMeta('block_schedule_end', String(data.blockScheduleEnd || '06:00')),
      database.setMeta(
        __DEV__ ? 'dev_trial_start_time' : 'trial_start_time',
        data.trialStartTime ? String(data.trialStartTime) : ''
      ),
    ]);
  }

  private static async getTrialStartTime(): Promise<number | null> {
    const raw = await database.getMeta(__DEV__ ? 'dev_trial_start_time' : 'trial_start_time');
    return this.parseNullableNumber(raw);
  }

  private static parseNumber(value: unknown, fallback: number): number {
    const parsed = typeof value === 'number' ? value : parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private static parseNullableNumber(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private static parseStringArray(value: string | null): string[] {
    if (!value) {
      return [];
    }

    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }

  private static parseDailyApps(value: string, date: string): DailyUsage['apps'] {
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.map((app) => ({
        packageName: String(app.packageName || ''),
        appName: String(app.appName || app.packageName || 'Unknown App'),
        totalTimeMs: this.parseNumber(app.totalTimeMs, 0),
        date,
      }));
    } catch {
      return [];
    }
  }

  private static parseInsightSignals(value?: string): DailyUsage['insightSignals'] {
    if (!value) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
}
