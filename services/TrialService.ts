import { database } from './database';

export class TrialService {
  private static readonly TRIAL_DURATION_DAYS = 7;

  static async startTrial(): Promise<void> {
    const startTime = Date.now();
    await database.setMeta('trial_start_time', startTime.toString());
  }

  static async getTrialInfo(): Promise<{
    isActive: boolean;
    daysRemaining: number;
    expired: boolean;
  }> {
    try {
      const trialStartStr = await database.getMeta('trial_start_time');
      
      if (!trialStartStr) {
        return { isActive: false, daysRemaining: 0, expired: false };
      }

      const trialStart = parseInt(trialStartStr);
      const now = Date.now();
      const daysPassed = Math.floor((now - trialStart) / (1000 * 60 * 60 * 24));
      const daysRemaining = Math.max(0, this.TRIAL_DURATION_DAYS - daysPassed);
      const expired = daysPassed >= this.TRIAL_DURATION_DAYS;

      return {
        isActive: true,
        daysRemaining,
        expired
      };
    } catch (error) {
      console.error('Error getting trial info:', error);
      return { isActive: false, daysRemaining: 0, expired: false };
    }
  }

  static async isTrialActive(): Promise<boolean> {
    const info = await this.getTrialInfo();
    return info.isActive && !info.expired;
  }
}