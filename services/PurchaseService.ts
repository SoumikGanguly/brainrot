import { Platform } from "react-native";
import Purchases, {
	LOG_LEVEL,
	type CustomerInfo,
	type CustomerInfoUpdateListener,
} from "react-native-purchases";

import { AuthService } from "./AuthService";
import { database } from "./database";
import { TelemetryService } from "./TelemetryService";

const DEV_PREMIUM_STATUS_KEY = "dev_premium_status";
const REVENUECAT_APP_USER_ID_KEY = "revenuecat_app_user_id";

function hasActiveEntitlement(customerInfo: CustomerInfo | null | undefined): boolean {
	if (!customerInfo) {
		return false;
	}

	return Object.keys(customerInfo.entitlements.active).length > 0;
}

class PurchaseServiceClass {
	private configured = false;
	private customerInfoListeners = new Set<CustomerInfoUpdateListener>();

	async isPremium(): Promise<boolean> {
		if (__DEV__) {
			const devPremium = await database.getMeta(DEV_PREMIUM_STATUS_KEY);
			return devPremium === "true";
		}

		try {
			const customerInfo = await this.getCustomerInfo();
			return hasActiveEntitlement(customerInfo);
		} catch (error) {
			console.error("Error checking premium status:", error);
			return false;
		}
	}

	async purchaseLifetime(): Promise<boolean> {
		TelemetryService.capture("purchase_started", {
			purchase_type: "lifetime",
			environment: __DEV__ ? "development" : "production",
		});

		// Purchase buttons stay inert until RevenueCat checkout is wired.
		TelemetryService.capture("purchase_completed", {
			purchase_type: "lifetime",
			success: false,
			environment: __DEV__ ? "development" : "production",
		});
		return false;
	}

	async restorePurchases(): Promise<boolean> {
		if (__DEV__) {
			const hasDevPurchase = await database.getMeta(DEV_PREMIUM_STATUS_KEY);
			const restored = hasDevPurchase === "true";
			TelemetryService.track("subscription_restore_result", {
				success: restored,
				has_active_entitlement: restored,
				subscription_status: restored ? "active" : "trial",
			});
			return restored;
		}

		try {
			await this.initializePurchases();
			if (!(await this.isRevenueCatAvailable())) {
				TelemetryService.track("subscription_restore_result", {
					success: false,
					has_active_entitlement: false,
				});
				return false;
			}

			const customerInfo = await Purchases.restorePurchases();
			const restored = hasActiveEntitlement(customerInfo);
			TelemetryService.track("subscription_restore_result", {
				success: true,
				has_active_entitlement: restored,
				subscription_status: restored ? "active" : "trial",
			});
			return restored;
		} catch (error) {
			console.error("Error restoring purchases:", error);
			TelemetryService.track("subscription_restore_result", {
				success: false,
				has_active_entitlement: false,
			});
			return false;
		}
	}

	async initializePurchases(): Promise<void> {
		if (__DEV__) {
			return;
		}

		const apiKey =
			Platform.OS === "android"
				? process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY
				: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
		if (!apiKey) {
			return;
		}

		const appUserID = await this.getOrCreateRevenueCatAppUserId();

		try {
			if (!(await Purchases.isConfigured())) {
				await Purchases.setLogLevel(
					__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.INFO,
				);
				Purchases.configure({
					apiKey,
					appUserID,
				});
				Purchases.addCustomerInfoUpdateListener(this.handleCustomerInfoUpdated);
				this.configured = true;
				return;
			}

			const currentAppUserID = await Purchases.getAppUserID();
			if (currentAppUserID !== appUserID) {
				await Purchases.logIn(appUserID);
			}
			if (!this.configured) {
				Purchases.addCustomerInfoUpdateListener(this.handleCustomerInfoUpdated);
				this.configured = true;
			}
		} catch (error) {
			console.error("Error initializing purchases:", error);
		}
	}

	async getCustomerInfo(): Promise<CustomerInfo | null> {
		if (__DEV__) {
			return null;
		}

		await this.initializePurchases();
		if (!(await this.isRevenueCatAvailable())) {
			return null;
		}

		try {
			return await Purchases.getCustomerInfo();
		} catch (error) {
			console.error("Error fetching customer info:", error);
			return null;
		}
	}

	addCustomerInfoUpdateListener(listener: CustomerInfoUpdateListener): () => void {
		this.customerInfoListeners.add(listener);
		return () => {
			this.customerInfoListeners.delete(listener);
		};
	}

	async setDevPremiumStatus(enabled: boolean): Promise<void> {
		await database.setMeta(DEV_PREMIUM_STATUS_KEY, enabled ? "true" : "false");
	}

	private async isRevenueCatAvailable(): Promise<boolean> {
		const apiKey =
			Platform.OS === "android"
				? process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY
				: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
		if (!apiKey) {
			return false;
		}

		try {
			return await Purchases.isConfigured();
		} catch {
			return false;
		}
	}

	private async getOrCreateRevenueCatAppUserId(): Promise<string> {
		const signedInUser = AuthService.getCurrentUser();
		if (signedInUser?.uid) {
			return signedInUser.uid;
		}

		const existing = await database.getMeta(REVENUECAT_APP_USER_ID_KEY);
		if (existing) {
			return existing;
		}

		const created = `rc_anon_${Date.now()}_${Math.random()
			.toString(36)
			.slice(2, 10)}`;
		await database.setMeta(REVENUECAT_APP_USER_ID_KEY, created);
		return created;
	}

	private handleCustomerInfoUpdated = (customerInfo: CustomerInfo) => {
		this.customerInfoListeners.forEach((listener) => listener(customerInfo));
	};
}

export const PurchaseService = new PurchaseServiceClass();
