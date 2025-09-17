import { database } from './database';

interface TrialInfo {
  isActive: boolean;
  daysRemaining: number;
  expired: boolean;
}

class TrialServiceClass {
  private readonly TRIAL_DURATION_DAYS = 7;

  async getTrialInfo(): Promise<TrialInfo> {
    if (__DEV__) {
      // Mock trial data for development
      const devTrialStartTime = await database.getMeta('dev_trial_start_time');
      
      if (!devTrialStartTime) {
        // Start trial for the first time in dev mode
        const startTime = Date.now().toString();
        await database.setMeta('dev_trial_start_time', startTime);
        return {
          isActive: true,
          daysRemaining: this.TRIAL_DURATION_DAYS,
          expired: false
        };
      }

      const startTime = parseInt(devTrialStartTime);
      const now = Date.now();
      const daysPassed = Math.floor((now - startTime) / (1000 * 60 * 60 * 24));
      const daysRemaining = Math.max(0, this.TRIAL_DURATION_DAYS - daysPassed);
      const expired = daysRemaining === 0;

      return {
        isActive: !expired,
        daysRemaining,
        expired
      };
    }

    // Production implementation
    try {
      const trialStartTime = await database.getMeta('trial_start_time');
      
      if (!trialStartTime) {
        // No trial started yet
        return {
          isActive: false,
          daysRemaining: 0,
          expired: false
        };
      }

      const startTime = parseInt(trialStartTime);
      const now = Date.now();
      const daysPassed = Math.floor((now - startTime) / (1000 * 60 * 60 * 24));
      const daysRemaining = Math.max(0, this.TRIAL_DURATION_DAYS - daysPassed);
      const expired = daysRemaining === 0;

      return {
        isActive: !expired,
        daysRemaining,
        expired
      };
    } catch (error) {
      console.error('Error getting trial info:', error);
      return {
        isActive: false,
        daysRemaining: 0,
        expired: false
      };
    }
  }

  async startTrial(): Promise<boolean> {
    if (__DEV__) {
      const startTime = Date.now().toString();
      await database.setMeta('dev_trial_start_time', startTime);
      return true;
    }

    try {
      const existingTrialStartTime = await database.getMeta('trial_start_time');
      
      if (existingTrialStartTime) {
        // Trial already started
        return false;
      }

      const startTime = Date.now().toString();
      await database.setMeta('trial_start_time', startTime);
      return true;
    } catch (error) {
      console.error('Error starting trial:', error);
      return false;
    }
  }

  async resetTrial(): Promise<void> {
    if (__DEV__) {
      await database.setMeta('dev_trial_start_time', '');
      return;
    }

    try {
      await database.setMeta('trial_start_time', '');
    } catch (error) {
      console.error('Error resetting trial:', error);
    }
  }

  async hasTrialExpired(): Promise<boolean> {
    const trialInfo = await this.getTrialInfo();
    return trialInfo.expired;
  }

  async canAccessFeature(feature: string): Promise<boolean> {
    if (__DEV__) {
      // In dev mode, allow access to test features
      return true;
    }

    try {
      // Check if user has premium access first
      const { PurchaseService } = await import('./PurchaseService');
      const isPremium = await PurchaseService.isPremium();
      
      if (isPremium) {
        return true;
      }

      // Check trial status
      const trialInfo = await this.getTrialInfo();
      return trialInfo.isActive && !trialInfo.expired;
    } catch (error) {
      console.error('Error checking feature access:', error);
      return false;
    }
  }
}

export const TrialService = new TrialServiceClass();

// Optional: Create a unified service that handles both trial and purchase logic
class SubscriptionServiceClass {
  async canAccessPremiumFeatures(): Promise<boolean> {
    if (__DEV__) {
      // In dev, check our mock premium status or trial
      const devPremium = await database.getMeta('dev_premium_status');
      if (devPremium === 'true') {
        return true;
      }
      
      const trialInfo = await TrialService.getTrialInfo();
      return trialInfo.isActive && !trialInfo.expired;
    }

    try {
      // Check premium first
      const isPremium = await PurchaseService.isPremium();
      if (isPremium) {
        return true;
      }

      // Then check trial
      const trialInfo = await TrialService.getTrialInfo();
      return trialInfo.isActive && !trialInfo.expired;
    } catch (error) {
      console.error('Error checking premium feature access:', error);
      return false;
    }
  }

  async getSubscriptionStatus(): Promise<{
    isPremium: boolean;
    trialInfo: TrialInfo;
    canAccessPremiumFeatures: boolean;
  }> {
    try {
      const [isPremium, trialInfo] = await Promise.all([
        PurchaseService.isPremium(),
        TrialService.getTrialInfo()
      ]);

      const canAccessPremiumFeatures = isPremium || (trialInfo.isActive && !trialInfo.expired);

      return {
        isPremium,
        trialInfo,
        canAccessPremiumFeatures
      };
    } catch (error) {
      console.error('Error getting subscription status:', error);
      return {
        isPremium: false,
        trialInfo: { isActive: false, daysRemaining: 0, expired: false },
        canAccessPremiumFeatures: false
      };
    }
  }
}

export const SubscriptionService = new SubscriptionServiceClass();