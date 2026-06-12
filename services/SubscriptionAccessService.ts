import type { PostHogEventProperties } from "@posthog/core";

import { AppBlockingService } from "./AppBlockingService";
import { InsightMemoryService } from "./InsightMemoryService";
import { NotificationService } from "./NotificationService";
import { PurchaseService } from "./PurchaseService";
import { TelemetryService } from "./TelemetryService";
import { TrialService, type TrialInfo } from "./TrialService";
import { UnifiedUsageService } from "./UnifiedUsageService";
import { database, type DailyUsage } from "./database";

export type SubscriptionStatus = "trial" | "active" | "expired";
export type ExpiredFlowState = "intro" | "declined" | "returning";
export type AccessReconcileReason =
	| "app_startup"
	| "app_resume"
	| "onboarding_completed"
	| "auth_state_changed"
	| "auth_sync_completed"
	| "customer_info_updated"
	| "dev_override"
	| "manual_restore";

export type FrozenAccessSnapshot = {
	capturedAt: number;
	snapshotDate: string | null;
	brainScore: number;
	brainState: string;
	insightHeadline: string;
	insightSubtext: string;
	progress: {
		windowDays: number;
		startBrainScore: number;
		endBrainScore: number;
		appName: string;
		startOpenCount: number;
		endOpenCount: number;
		distractionDeltaPercent: number;
	};
};

export type SubscriptionAccessState = {
	subscriptionStatus: SubscriptionStatus;
	isPremium: boolean;
	trialInfo: TrialInfo;
	expiredFlowState: ExpiredFlowState;
	hasDeclinedExpiredPaywall: boolean;
	frozenSnapshot: FrozenAccessSnapshot | null;
};

const SUBSCRIPTION_STATUS_KEY = "subscription_status";
const EXPIRED_FLOW_STATE_KEY = "expired_flow_state";
const FROZEN_ACCESS_SNAPSHOT_KEY = "frozen_access_snapshot";
const SUBSCRIPTION_ACCESS_UPDATED_AT_KEY = "subscription_access_updated_at";
const SUBSCRIPTION_ACCESS_PROTECTION_KEY = "subscription_access_protection_enabled";
const DEV_ACCESS_OVERRIDE_KEY = "subscription_dev_override_state";

const EXPIRED_NOTIFICATION_TITLE = "Brainrot trial has ended";
const EXPIRED_NOTIFICATION_BODY = "Open Brainrot to keep your momentum going.";

type AccessListener = (state: SubscriptionAccessState) => void;

function buildFallbackTrialInfo(): TrialInfo {
	return {
		isActive: false,
		daysRemaining: 0,
		expired: false,
		startedAt: null,
	};
}

function clampPercent(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.round(value);
}

function parseFrozenSnapshot(
	raw: string | null,
): FrozenAccessSnapshot | null {
	if (!raw) {
		return null;
	}

	try {
		const parsed = JSON.parse(raw) as FrozenAccessSnapshot;
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			typeof parsed.brainScore !== "number" ||
			typeof parsed.brainState !== "string"
		) {
			return null;
		}
		return parsed;
	} catch (error) {
		console.warn("Failed to parse frozen access snapshot:", error);
		return null;
	}
}

export class SubscriptionAccessService {
	private static listeners = new Set<AccessListener>();
	private static cachedState: SubscriptionAccessState | null = null;
	private static reconcilePromise: Promise<SubscriptionAccessState> | null = null;
	private static purchaseListenerBound = false;

	static subscribe(listener: AccessListener): () => void {
		this.listeners.add(listener);
		if (this.cachedState) {
			listener(this.cachedState);
		}

		return () => {
			this.listeners.delete(listener);
		};
	}

	static async getCachedState(): Promise<SubscriptionAccessState> {
		if (this.cachedState) {
			return this.cachedState;
		}

		const [subscriptionStatus, expiredFlowState, frozenSnapshotRaw, trialInfo] =
			await Promise.all([
				database.getMeta(SUBSCRIPTION_STATUS_KEY),
				database.getMeta(EXPIRED_FLOW_STATE_KEY),
				database.getMeta(FROZEN_ACCESS_SNAPSHOT_KEY),
				TrialService.getTrialInfo().catch(() => buildFallbackTrialInfo()),
			]);

		const nextState: SubscriptionAccessState = {
			subscriptionStatus:
				subscriptionStatus === "active" || subscriptionStatus === "expired"
					? subscriptionStatus
					: "trial",
			isPremium: subscriptionStatus === "active",
			trialInfo,
			expiredFlowState:
				expiredFlowState === "declined" || expiredFlowState === "returning"
					? expiredFlowState
					: "intro",
			hasDeclinedExpiredPaywall:
				expiredFlowState === "declined" || expiredFlowState === "returning",
			frozenSnapshot: parseFrozenSnapshot(frozenSnapshotRaw),
		};
		this.cachedState = nextState;
		return nextState;
	}

	static async reconcileAccess(
		reason: AccessReconcileReason,
	): Promise<SubscriptionAccessState> {
		this.ensurePurchaseListener();
		if (this.reconcilePromise) {
			return this.reconcilePromise;
		}

		this.reconcilePromise = this.performReconcile(reason).finally(() => {
			this.reconcilePromise = null;
		});
		return this.reconcilePromise;
	}

	static async setExpiredFlowState(
		flowState: ExpiredFlowState,
	): Promise<SubscriptionAccessState> {
		await database.setMeta(EXPIRED_FLOW_STATE_KEY, flowState);
		const current = await this.getCachedState();
		const nextState = {
			...current,
			expiredFlowState: flowState,
			hasDeclinedExpiredPaywall:
				flowState === "declined" || flowState === "returning",
		};
		this.cacheAndEmit(nextState);
		return nextState;
	}

	static async setDevOverrideState(
		override:
			| "trial"
			| "active"
			| "expired_intro"
			| "expired_declined"
			| "expired_returning"
			| null,
	): Promise<SubscriptionAccessState> {
		if (!__DEV__) {
			return this.getCachedState();
		}

		await database.setMeta(DEV_ACCESS_OVERRIDE_KEY, override || "");
		if (override === "active") {
			await PurchaseService.setDevPremiumStatus(true);
		} else {
			await PurchaseService.setDevPremiumStatus(false);
		}
		return this.reconcileAccess("dev_override");
	}

	static async restorePurchasesAndReconcile(): Promise<SubscriptionAccessState> {
		await PurchaseService.restorePurchases();
		return this.reconcileAccess("manual_restore");
	}

	static async markHelpShapeTapped(): Promise<void> {
		const current = await this.getCachedState();
		TelemetryService.track("expired_paywall_cta_clicked", {
			screen: current.expiredFlowState === "declined" ? "declined" : "returning",
			cta: "help_shape_brainrot",
			subscription_status: current.subscriptionStatus,
		});
	}

	private static async performReconcile(
		reason: AccessReconcileReason,
	): Promise<SubscriptionAccessState> {
		const previousState = await this.getCachedState();
		const trialInfo = await TrialService.getTrialInfo().catch(() =>
			buildFallbackTrialInfo(),
		);

		let nextStatus: SubscriptionStatus = "trial";
		let isPremium = false;
		let expiredFlowState: ExpiredFlowState = previousState.expiredFlowState;
		let frozenSnapshot = previousState.frozenSnapshot;

		const devOverride =
			__DEV__ ? await database.getMeta(DEV_ACCESS_OVERRIDE_KEY) : null;
		if (__DEV__ && devOverride) {
			if (devOverride === "active") {
				nextStatus = "active";
				isPremium = true;
				expiredFlowState = "intro";
			} else if (devOverride === "trial") {
				nextStatus = "trial";
				expiredFlowState = "intro";
			} else if (devOverride === "expired_declined") {
				nextStatus = "expired";
				expiredFlowState = "declined";
			} else if (devOverride === "expired_returning") {
				nextStatus = "expired";
				expiredFlowState = "returning";
			} else {
				nextStatus = "expired";
				expiredFlowState = "intro";
			}
		} else {
			await PurchaseService.initializePurchases();
			isPremium = await PurchaseService.isPremium();
			if (isPremium) {
				nextStatus = "active";
				expiredFlowState = "intro";
			} else if (trialInfo.isActive && !trialInfo.expired) {
				nextStatus = "trial";
				expiredFlowState = "intro";
			} else {
				nextStatus = "expired";
				if (expiredFlowState !== "declined" && expiredFlowState !== "returning") {
					expiredFlowState = "intro";
				}
				if (
					expiredFlowState === "declined" &&
					(reason === "app_startup" ||
						reason === "app_resume" ||
						reason === "auth_state_changed" ||
						reason === "auth_sync_completed" ||
						reason === "manual_restore" ||
						reason === "customer_info_updated")
				) {
					expiredFlowState = "returning";
				}
			}
		}

		if (nextStatus === "expired") {
			if (
				previousState.subscriptionStatus !== "expired" ||
				!previousState.frozenSnapshot
			) {
				frozenSnapshot = await this.buildFrozenAccessSnapshot();
			}
		} else {
			frozenSnapshot = null;
		}

		const nextState: SubscriptionAccessState = {
			subscriptionStatus: nextStatus,
			isPremium,
			trialInfo,
			expiredFlowState,
			hasDeclinedExpiredPaywall:
				expiredFlowState === "declined" || expiredFlowState === "returning",
			frozenSnapshot,
		};

		await this.persistState(nextState);
		await this.applyRuntimeBehavior(nextState);
		this.cacheAndEmit(nextState);
		this.trackAccessTelemetry(previousState, nextState, reason);

		return nextState;
	}

	private static async buildFrozenAccessSnapshot(): Promise<FrozenAccessSnapshot> {
		const [historicalSummaries, insightMemory, onboardingAppName] = await Promise.all([
			database.getHistoricalData(30).catch(() => [] as DailyUsage[]),
			InsightMemoryService.load().catch(() => ({
				shownByDate: {},
				acted: [],
				persistedByDate: {},
			})),
			database.getMeta("onboarding_selected_app_name"),
		]);

		const sortedSummaries = [...historicalSummaries].sort((a, b) =>
			a.date.localeCompare(b.date),
		);
		const latestSummaries = sortedSummaries.slice(-14);
		const firstSummary = latestSummaries[0] ?? sortedSummaries[0] ?? null;
		const latestSummary =
			latestSummaries[latestSummaries.length - 1] ??
			sortedSummaries[sortedSummaries.length - 1] ??
			null;

		const persistedEntries = Object.values(insightMemory.persistedByDate).sort((a, b) =>
			b.date.localeCompare(a.date),
		);
		const latestInsight = persistedEntries[0]?.rankedInsights?.[0];

		const startBrainScore =
			firstSummary?.focusScore ?? firstSummary?.brainScore ?? 0;
		const endBrainScore =
			latestSummary?.focusScore ?? latestSummary?.brainScore ?? 0;
		const appName =
			latestSummary?.insightSignals?.topAppName ||
			latestSummary?.topAppName ||
			onboardingAppName ||
			"App";
		const startOpenCount =
			firstSummary?.insightSignals?.topAppOpenCount ??
			firstSummary?.totalMonitoredOpens ??
			0;
		const endOpenCount =
			latestSummary?.insightSignals?.topAppOpenCount ??
			latestSummary?.totalMonitoredOpens ??
			0;

		const startDistractingMs =
			firstSummary?.totalDistractingMs ?? firstSummary?.totalScreenTime ?? 0;
		const endDistractingMs =
			latestSummary?.totalDistractingMs ?? latestSummary?.totalScreenTime ?? 0;
		const distractionDeltaPercent =
			startDistractingMs > 0
				? clampPercent(
						((startDistractingMs - endDistractingMs) / startDistractingMs) * 100,
				  )
				: 0;
		const latestScore =
			latestSummary?.focusScore ?? latestSummary?.brainScore ?? 0;
		const brainState =
			latestSummary?.brainHealthStatus ||
			(latestScore >= 60 ? "Healthy" : "Foggy");

		return {
			capturedAt: Date.now(),
			snapshotDate: latestSummary?.date ?? null,
			brainScore: endBrainScore,
			brainState,
			insightHeadline:
				latestInsight?.headline || "Your Last Insight",
			insightSubtext:
				latestInsight?.subtext ||
				"Your strongest attention pattern is ready to unlock again.",
			progress: {
				windowDays: Math.max(1, latestSummaries.length),
				startBrainScore,
				endBrainScore,
				appName,
				startOpenCount,
				endOpenCount,
				distractionDeltaPercent,
			},
		};
	}

	private static async persistState(
		state: SubscriptionAccessState,
	): Promise<void> {
		const writes: Promise<void>[] = [
			database.setMeta(SUBSCRIPTION_STATUS_KEY, state.subscriptionStatus),
			database.setMeta(
				EXPIRED_FLOW_STATE_KEY,
				state.subscriptionStatus === "expired" ? state.expiredFlowState : "intro",
			),
			database.setMeta(
				SUBSCRIPTION_ACCESS_PROTECTION_KEY,
				state.subscriptionStatus === "expired" ? "false" : "true",
			),
			database.setMeta(
				SUBSCRIPTION_ACCESS_UPDATED_AT_KEY,
				Date.now().toString(),
			),
		];

		if (state.frozenSnapshot) {
			writes.push(
				database.setMeta(
					FROZEN_ACCESS_SNAPSHOT_KEY,
					JSON.stringify(state.frozenSnapshot),
				),
			);
		} else {
			writes.push(database.setMeta(FROZEN_ACCESS_SNAPSHOT_KEY, ""));
		}

		await Promise.all(writes);
	}

	private static async applyRuntimeBehavior(
		state: SubscriptionAccessState,
	): Promise<void> {
		TelemetryService.setGlobalProperties({
			subscription_status: state.subscriptionStatus,
		} satisfies PostHogEventProperties);

		await UnifiedUsageService.syncSubscriptionStatusToNative({
			subscriptionStatus: state.subscriptionStatus,
			expiredNotificationTitle: EXPIRED_NOTIFICATION_TITLE,
			expiredNotificationBody: EXPIRED_NOTIFICATION_BODY,
		});
		await AppBlockingService.getInstance().setSubscriptionAccessEnabled(
			state.subscriptionStatus !== "expired",
		);
		await NotificationService.initialize();
		await UnifiedUsageService.getInstance().refreshMonitoringSettings();
	}

	private static ensurePurchaseListener(): void {
		if (this.purchaseListenerBound) {
			return;
		}

		PurchaseService.addCustomerInfoUpdateListener(() => {
			void this.reconcileAccess("customer_info_updated");
		});
		this.purchaseListenerBound = true;
	}

	private static cacheAndEmit(state: SubscriptionAccessState): void {
		this.cachedState = state;
		this.listeners.forEach((listener) => listener(state));
	}

	private static trackAccessTelemetry(
		previousState: SubscriptionAccessState,
		state: SubscriptionAccessState,
		reason: AccessReconcileReason,
	): void {
		TelemetryService.track("subscription_access_reconciled", {
			reason,
			subscription_status: state.subscriptionStatus,
			is_premium: state.isPremium,
			trial_days_remaining: state.trialInfo.daysRemaining,
			expired_flow_state:
				state.subscriptionStatus === "expired"
					? state.expiredFlowState
					: undefined,
		});

		if (
			state.subscriptionStatus === "expired" &&
			state.expiredFlowState === "returning" &&
			previousState.expiredFlowState !== "returning"
		) {
			TelemetryService.track("expired_paywall_reopened", {
				screen: "returning",
				subscription_status: "expired",
			});
		}

		if (
			state.subscriptionStatus === "active" &&
			previousState.subscriptionStatus !== "active"
		) {
			TelemetryService.track("subscription_entitlement_activated", {
				source:
					reason === "dev_override"
						? "dev_override"
						: reason === "manual_restore"
							? "restore"
							: "customer_info",
				subscription_status: "active",
			});
		}
	}
}
