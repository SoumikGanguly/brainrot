import { AuthService } from './AuthService';
import { database } from './database';

export interface LoginNudge {
  shouldShow: boolean;
  daysSinceInstall: number;
  title: string;
  body: string;
  ctaLabel: string;
}

const INSTALL_FIRST_SEEN_KEY = 'install_first_seen_at';
const LOGIN_NUDGE_DISMISSED_AT_KEY = 'login_nudge_dismissed_at';
const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_SHOW_DAY = 3;
const SNOOZE_DAYS = 7;

export class LoginNudgeService {
  static async getLoginNudge(): Promise<LoginNudge> {
    const installAt = await this.getInstallTimestamp();
    const dismissedAt = parseInt((await database.getMeta(LOGIN_NUDGE_DISMISSED_AT_KEY)) || '0', 10);
    const daysSinceInstall = Math.floor((Date.now() - installAt) / DAY_MS);
    const signedIn = Boolean(AuthService.getCurrentUser());
    const snoozed = dismissedAt > 0 && Date.now() - dismissedAt < SNOOZE_DAYS * DAY_MS;
    const shouldShow = !signedIn && !snoozed && daysSinceInstall >= FIRST_SHOW_DAY;

    return {
      shouldShow,
      daysSinceInstall,
      title: 'Back up Brainrot',
      body: 'Sign in so your protected apps, settings, and history can survive reinstalling or switching phones.',
      ctaLabel: 'Continue with Google',
    };
  }

  static async dismiss(): Promise<void> {
    await database.setMeta(LOGIN_NUDGE_DISMISSED_AT_KEY, Date.now().toString());
  }

  private static async getInstallTimestamp(): Promise<number> {
    const existing = await database.getMeta(INSTALL_FIRST_SEEN_KEY);
    if (existing) {
      return parseInt(existing, 10);
    }

    const onboardingCompletedAt = await database.getMeta('onboarding_completed_at');
    const timestamp = parseInt(onboardingCompletedAt || '', 10) || Date.now();
    await database.setMeta(INSTALL_FIRST_SEEN_KEY, timestamp.toString());
    return timestamp;
  }
}
