import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { NotificationType } from '@/services/TelemetryEvents';
import { BrainScoreService } from './BrainScore';
import { database } from './database';
import { TelemetryService } from './TelemetryService';
import { formatTime } from '../utils/time';

export class NotificationService {
  private static initialized = false;
  private static readonly DAILY_REPLAY_NOTIFICATION_KEY = 'scheduled_daily_replay_notification_id';
  private static readonly WEEKLY_REVIEW_NOTIFICATION_KEY = 'scheduled_weekly_review_notification_id';
  private static readonly DEFAULT_NOTIFICATION_ROUTE = '/(tabs)/replay';

  static async initialize(): Promise<void> {
    try {
      if (this.initialized) {
        await this.ensureDefaultSchedules();
        return;
      }

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('brainrot_alerts', {
          name: 'Brainrot Alerts',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#4F46E5',
        });

        await Notifications.setNotificationChannelAsync('brainrot_summaries', {
          name: 'Brainrot Summaries',
          importance: Notifications.AndroidImportance.DEFAULT,
          vibrationPattern: [0, 200, 150, 200],
          lightColor: '#5B4CF0',
        });
      }

      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldSetBadge: true,
          shouldPlaySound: true,
        }),
      });

      this.initialized = true;
      await this.ensureDefaultSchedules();
    } catch (error) {
      console.error('Error initializing notifications:', error);
    }
  }

  static async hasPermission(): Promise<boolean> {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  }

  static async requestPermission(): Promise<boolean> {
    await this.initialize();
    const { status } = await Notifications.requestPermissionsAsync();
    if (status === 'granted') {
      await this.ensureDefaultSchedules();
    }
    return status === 'granted';
  }

  static async ensureDefaultSchedules(): Promise<void> {
    try {
      const notificationsEnabled = await database.getMeta('notifications_enabled');
      if (notificationsEnabled === 'false') {
        await this.cancelStoredNotification(this.DAILY_REPLAY_NOTIFICATION_KEY);
        await this.cancelStoredNotification(this.WEEKLY_REVIEW_NOTIFICATION_KEY);
        return;
      }

      if (!(await this.hasPermission())) {
        return;
      }

      await this.scheduleDailyReplayNotification();
      await this.scheduleWeeklyReviewNotification();
    } catch (error) {
      console.error('Error ensuring default schedules:', error);
    }
  }

  private static async scheduleDailyReplayNotification(): Promise<void> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = this.formatLocalDate(yesterday);
    const replayContent = await this.buildDailyReplayContent(dateStr);
    const triggerDate = this.getNextDailyTime(8, 0);

    await this.replaceScheduledNotification(this.DAILY_REPLAY_NOTIFICATION_KEY, {
      content: {
        title: replayContent.title,
        body: replayContent.body,
        sound: true,
        data: {
          route: this.DEFAULT_NOTIFICATION_ROUTE,
          replayDay: 'yesterday',
          source: 'daily_replay',
          notification_type: 'morning_insight',
          app_name: replayContent.topAppName,
          brain_score: replayContent.brainScore,
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: triggerDate,
      },
    }, 'morning_insight');
  }

  private static async scheduleWeeklyReviewNotification(): Promise<void> {
    const reviewContent = await this.buildWeeklyReviewContent();
    const triggerDate = this.getNextWeeklyTime(0, 20, 0);

    await this.replaceScheduledNotification(this.WEEKLY_REVIEW_NOTIFICATION_KEY, {
      content: {
        title: reviewContent.title,
        body: reviewContent.body,
        sound: true,
        data: {
          route: '/(tabs)/calendar',
          source: 'weekly_review',
          notification_type: 'weekly_report',
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: triggerDate,
      },
    }, 'weekly_report');
  }

  private static async buildDailyReplayContent(dateStr: string): Promise<{ title: string; body: string; topAppName?: string; brainScore?: number }> {
    try {
      const result = await BrainScoreService.getInstance().getBrainScoreForDate(dateStr);
      const topApp = result.apps[0];

      if (!topApp || topApp.totalTimeMs <= 0) {
        return {
          title: 'Yesterday stayed mostly clean.',
          body: 'See your Brainrot Replay.',
          brainScore: result.score,
        };
      }

      return {
        title: `Yesterday you lost ${formatTime(topApp.totalTimeMs)} to ${topApp.appName}.`,
        body: 'See your Brainrot Replay.',
        topAppName: topApp.appName,
        brainScore: result.score,
      };
    } catch (error) {
      console.warn('Error building daily replay notification:', error);
      return {
        title: 'See how yesterday went.',
        body: 'Open your Brainrot Replay.',
      };
    }
  }

  private static async buildWeeklyReviewContent(): Promise<{ title: string; body: string }> {
    try {
      const today = new Date();
      const currentWeekDates = this.getTrailingDates(today, 7);
      const previousWeekAnchor = new Date(today);
      previousWeekAnchor.setDate(previousWeekAnchor.getDate() - 7);
      const previousWeekDates = this.getTrailingDates(previousWeekAnchor, 7);

      const [currentTotalMs, previousTotalMs] = await Promise.all([
        this.getTotalUsageForDates(currentWeekDates),
        this.getTotalUsageForDates(previousWeekDates),
      ]);

      const deltaMs = currentTotalMs - previousTotalMs;
      const improved = deltaMs < 0;
      const percent = previousTotalMs > 0
        ? Math.round((Math.abs(deltaMs) / previousTotalMs) * 100)
        : 0;

      return {
        title: `Your focus ${improved ? 'improved' : 'worsened'} ${percent}% this week`,
        body: improved
          ? 'Nice work. Open Progress to see the full trend.'
          : 'Open Progress to see where the extra screen time came from.',
      };
    } catch (error) {
      console.warn('Error building weekly review notification:', error);
      return {
        title: 'Your weekly focus report is ready',
        body: 'Open Progress to review this week.',
      };
    }
  }

  private static async getTotalUsageForDates(dateStrings: string[]): Promise<number> {
    const summaries = await Promise.all(dateStrings.map((date) => database.getDailySummary(date)));
    return summaries.reduce((sum, entry) => sum + (entry?.totalScreenTime || 0), 0);
  }

  private static getTrailingDates(endDate: Date, days: number): string[] {
    const dates: string[] = [];
    for (let offset = days - 1; offset >= 0; offset--) {
      const date = new Date(endDate);
      date.setDate(endDate.getDate() - offset);
      dates.push(this.formatLocalDate(date));
    }
    return dates;
  }

  private static getNextDailyTime(hour: number, minute: number): Date {
    const next = new Date();
    next.setHours(hour, minute, 0, 0);
    if (next.getTime() <= Date.now()) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  private static getNextWeeklyTime(dayOfWeek: number, hour: number, minute: number): Date {
    const next = new Date();
    next.setHours(hour, minute, 0, 0);
    const daysUntil = (dayOfWeek - next.getDay() + 7) % 7;
    next.setDate(next.getDate() + daysUntil);
    if (next.getTime() <= Date.now()) {
      next.setDate(next.getDate() + 7);
    }
    return next;
  }

  private static async replaceScheduledNotification(
    metaKey: string,
    request: Notifications.NotificationRequestInput,
    notificationType: NotificationType
  ): Promise<void> {
    await this.cancelStoredNotification(metaKey);
    const id = await Notifications.scheduleNotificationAsync(request);
    await database.setMeta(metaKey, id);
    const data = request.content.data as
      | { insight_type?: string; app_name?: string; brain_score?: number }
      | undefined;
    TelemetryService.track('notification_sent', {
      notification_type: notificationType,
      insight_type: data?.insight_type,
      app_name: data?.app_name,
      brain_score: data?.brain_score,
    });
  }

  private static async cancelStoredNotification(metaKey: string): Promise<void> {
    const existingId = await database.getMeta(metaKey);
    if (existingId) {
      try {
        await Notifications.cancelScheduledNotificationAsync(existingId);
      } catch (error) {
        console.warn(`Failed to cancel scheduled notification ${metaKey}:`, error);
      }
    }
  }

  private static formatLocalDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
