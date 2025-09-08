export interface UsageData {
  packageName: string;
  appName: string;
  totalTimeMs: number;
  date: string;
}

export interface DailyUsage {
  date: string;
  totalScreenTime: number;
  brainScore: number;
  apps: UsageData[];
}

export interface NotificationSettings {
  enabled: boolean;
  intensity: 'mild' | 'normal' | 'harsh';
  snoozed: boolean;
  snoozeUntil?: number;
}

export interface AppSettings {
  packageName: string;
  appName: string;
  monitored: boolean;
  dailyLimitMs: number;
}

export interface TrialInfo {
  isActive: boolean;
  startDate: number;
  daysRemaining: number;
  expired: boolean;
}

export interface PurchaseInfo {
  isPremium: boolean;
  productId?: string;
  purchaseDate?: number;
}