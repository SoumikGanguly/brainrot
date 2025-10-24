import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { database } from './database';

export class NotificationService {
  private static notificationTemplates = {
    mild: [
      "Heads up — you've used {app} for {timeToday}. Consider a break.",
      "{app} used {timeToday} today. Maybe take 10 mins off?"
    ],
    normal: [
      "Your brain's fogging — {app} used {timeToday}. Maybe switch to something else?",
      "You've spent {timeToday} on {app} — try focusing on a task now."
    ],
    harsh: [
      "Stop. {app} is eating your day — {timeToday} so far. This is ruining your focus.",
      "Enough. {app} is rotting your brain — {timeToday} today. Unlock to remove reminders."
    ],
    critical: [
      "🚨 YOU'RE LETTING APPS ROT YOUR BRAIN. Unlock premium or stop using {app} NOW.",
      "FINAL WARNING: {app} usage = {timeToday}. Buy unlock or close the app."
    ]
  };

  static async initialize(): Promise<void> {
    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.warn('Notification permissions not granted');
        return;
      }

      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('brainrot_alerts', {
          name: 'Brainrot Alerts',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#4F46E5',
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

    } catch (error) {
      console.error('Error initializing notifications:', error);
    }
  }


  static async scheduleUsageAlert(
    appName: string,
    usageTime: string,
    intensity: 'mild' | 'normal' | 'harsh' | 'critical'
  ): Promise<void> {
    try {
      // Check if notifications are enabled
      const notificationsEnabled = await database.getMeta('notifications_enabled');
      if (notificationsEnabled === 'false') return;

      // Check cooldown
      const lastNotificationKey = `last_notification_${appName}_${intensity}`;
      const lastNotificationStr = await database.getMeta(lastNotificationKey);
      const lastNotification = lastNotificationStr ? parseInt(lastNotificationStr) : 0;
      const now = Date.now();
      
      // Cooldown periods (in milliseconds)
      const cooldowns = {
        mild: 24 * 60 * 60 * 1000, // 24 hours
        normal: 12 * 60 * 60 * 1000, // 12 hours
        harsh: 4 * 60 * 60 * 1000, // 4 hours
        critical: 2 * 60 * 60 * 1000 // 2 hours
      };

      if (now - lastNotification < cooldowns[intensity]) {
        return; // Still in cooldown
      }

      // Get random template
      const templates = this.notificationTemplates[intensity];
      const template = templates[Math.floor(Math.random() * templates.length)];
      const message = template
        .replace('{app}', appName)
        .replace('{timeToday}', usageTime);

      await Notifications.scheduleNotificationAsync({
        content: {
          title: intensity === 'critical' ? '🚨 BRAIN ALERT' : 'Brainrot Alert',
          body: message,
          priority: intensity === 'critical' ? 'high' : 'normal',
          sound: true,
        },
        trigger: null, // Show immediately
      });

      // Update last notification time
      await database.setMeta(lastNotificationKey, now.toString());

      // Log notification
      const today = new Date().toISOString().split('T')[0];
      await database.setMeta(`notification_${Date.now()}`, JSON.stringify({
        appName,
        intensity,
        message,
        sentAt: now,
        date: today
      }));

    } catch (error) {
      console.error('Error scheduling notification:', error);
    }
  }
}