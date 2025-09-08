import Purchases from 'react-native-purchases';

export class PurchaseService {
  private static readonly LIFETIME_PRODUCT_ID = 'brainrot_lifetime';

  static async initialize(): Promise<void> {
    try {
      // Configure RevenueCat
      Purchases.setDebugLogsEnabled(true);
      await Purchases.configure({
        apiKey: 'your_revenuecat_api_key_here',
      });
    } catch (error) {
      console.error('Error initializing purchases:', error);
    }
  }

  static async isPremium(): Promise<boolean> {
    try {
      const customerInfo = await Purchases.getCustomerInfo();
      return customerInfo.entitlements.active['premium'] !== undefined;
    } catch (error) {
      console.error('Error checking premium status:', error);
      return false;
    }
  }

  static async purchaseLifetime(): Promise<boolean> {
    try {
      const offerings = await Purchases.getOfferings();
      const lifetimeProduct = offerings.current?.availablePackages.find(
        pkg => pkg.product.identifier === this.LIFETIME_PRODUCT_ID
      );

      if (!lifetimeProduct) {
        throw new Error('Lifetime product not found');
      }

      const { customerInfo } = await Purchases.purchasePackage(lifetimeProduct);
      return customerInfo.entitlements.active['premium'] !== undefined;
    } catch (error) {
      console.error('Error purchasing lifetime:', error);
      return false;
    }
  }

  static async restorePurchases(): Promise<boolean> {
    try {
      const customerInfo = await Purchases.restorePurchases();
      return customerInfo.entitlements.active['premium'] !== undefined;
    } catch (error) {
      console.error('Error restoring purchases:', error);
      return false;
    }
  }
}