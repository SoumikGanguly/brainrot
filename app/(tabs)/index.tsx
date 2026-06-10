/* eslint-disable react-hooks/immutability, react-hooks/refs, react/no-unescaped-entities */
import { useFocusEffect, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
	Alert,
	Animated,
	AppState,
	AppStateStatus,
	Dimensions,
	Image,
	InteractionManager,
	ScrollView,
	Text,
	TouchableOpacity,
	View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import ActionInsightCard from "@/components/ActionInsightCard";
import PermissionCoachBottomSheet from "@/components/PermissionCoachBottomSheet";
import SkeletonBlock from "@/components/SkeletonBlock";
import { Card } from "../../components/Card";
import { database, type DailyUsage } from "../../services/database";

import { AppBlockingService } from "@/services/AppBlockingService";
import { DailyResetService } from "@/services/DailyResetService";
import { DailyInsightsService, type DailyInsights } from "@/services/DailyInsightsService";
import { DataSyncService } from "@/services/DataSyncService";
import { HistoryRefreshCoordinator } from "@/services/HistoryRefreshCoordinator";
import { InsightActionService } from "@/services/InsightActionService";
import { InsightInvalidationService } from "@/services/InsightInvalidationService";
import { NotificationService } from "@/services/NotificationService";
import { LoginNudgeService, type LoginNudge } from "@/services/LoginNudgeService";
import {
	PermissionHealthService,
	type PermissionNudge,
} from "@/services/PermissionHealthService";
import { MonitoringDiagnosticsService } from "@/services/MonitoringDiagnosticsService";
import { PurchaseService } from "@/services/PurchaseService";
import { TelemetryService } from "@/services/TelemetryService";
import { TrialService } from "@/services/TrialService";
import {
	UnifiedUsageService,
} from "@/services/UnifiedUsageService";
import {
	getBrainStateLabel,
	getBrainStateLevel,
	getScoreColor,
} from "@/utils/brainScore";
import { formatTime } from "@/utils/time";

const heroExpressions = {
	happy: require("../../assets/expressions/happy.png"),
	healthy: require("../../assets/expressions/healthy.png"),
	confused: require("../../assets/expressions/confused.png"),
	exhausted: require("../../assets/expressions/exhausted.png"),
} as const;

function formatLocalDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function getDateShiftedBy(days: number): string {
	const date = new Date();
	date.setDate(date.getDate() + days);
	return formatLocalDate(date);
}

function getExpressionSource(score: number) {
	const level = getBrainStateLevel(score);
	if (level === "focused") {
		return heroExpressions.happy;
	}
	if (level === "healthy") {
		return heroExpressions.healthy;
	}
	if (level === "foggy") {
		return heroExpressions.confused;
	}
	return heroExpressions.exhausted;
}

export default function HomeScreen() {
	const router = useRouter();
	const screenHeight = Dimensions.get("window").height;
	const heroFloat = useRef(new Animated.Value(0)).current;
	const [brainScore, setBrainScore] = useState(100);
	const [brainState, setBrainState] = useState(getBrainStateLabel(100));
	const [todayInsights, setTodayInsights] = useState<DailyInsights | null>(null);
	const [yesterdaySummary, setYesterdaySummary] = useState<DailyUsage | null>(null);
	const [trialInfo, setTrialInfo] = useState({
		isActive: false,
		daysRemaining: 0,
		expired: false,
	});
	const [loading, setLoading] = useState(true);
	const [hasUsagePermission, setHasUsagePermission] = useState<boolean | null>(null);
	const [homePermissionPrompt, setHomePermissionPrompt] =
		useState<PermissionNudge | null>(null);
	const [loginNudge, setLoginNudge] = useState<LoginNudge | null>(null);
	const pendingPermissionCheck = useRef(false);
	const appStateRef = useRef<AppStateStatus>(AppState.currentState);
	const paywallLoggedRef = useRef<"trial" | "expired" | null>(null);
	const homeRefreshInFlightRef = useRef(false);
	const backgroundHomeRefreshQueuedRef = useRef(false);
	const shownPermissionPromptRef = useRef<string | null>(null);

	useEffect(() => {
		Animated.loop(
			Animated.sequence([
				Animated.timing(heroFloat, {
					toValue: 1,
					duration: 2800,
					useNativeDriver: true,
				}),
				Animated.timing(heroFloat, {
					toValue: 0,
					duration: 2800,
					useNativeDriver: true,
				}),
			]),
		).start();
	}, [heroFloat]);

	useEffect(() => {
		let isInitialized = false;

		const initializeAllServices = async () => {
			if (isInitialized) return;

			try {
				const unifiedService = UnifiedUsageService.getInstance();
				await unifiedService.initialize();
				await NotificationService.ensureDefaultSchedules();

				const blockingService = AppBlockingService.getInstance();
				await blockingService.initialize();

				DailyResetService.getInstance().initialize();
				await MonitoringDiagnosticsService.sampleDailyTelemetry();

				isInitialized = true;
				thisQueueBackgroundInitialization();
			} catch (error) {
				console.error("Failed to initialize services:", error);
			}
		};

		const thisQueueBackgroundInitialization = () => {
			if (backgroundHomeRefreshQueuedRef.current) {
				return;
			}

			backgroundHomeRefreshQueuedRef.current = true;
			InteractionManager.runAfterInteractions(() => {
				void (async () => {
					try {
						const lastBackfill = await database.getMeta("last_backfill_date");
						const today = formatLocalDate(new Date());
						if (lastBackfill !== today) {
							await HistoryRefreshCoordinator.getInstance().requestRefresh({
								source: "home_cold_start",
								days: 90,
								prioritizeDates: [today],
								syncToday: true,
							});
							await database.setMeta("last_backfill_date", today);
						}

						try {
							const monitoredAppsData = await database.getMeta("monitored_apps");
							if (monitoredAppsData) {
								const monitoredPackages = JSON.parse(monitoredAppsData) as string[];
								await UnifiedUsageService.syncMonitoredAppsToNative(monitoredPackages);
							}
						} catch (syncError) {
							console.warn("Failed to sync monitored apps to native:", syncError);
						}

						await database.cleanupDuplicateEntries();
						await loadHomeData({ refreshInBackground: true, preferCached: true });
					} catch (error) {
						console.error("Background home initialization failed:", error);
					} finally {
						backgroundHomeRefreshQueuedRef.current = false;
					}
				})();
			});
		};

		void initializeAllServices();

		const handleAppStateChange = async (nextAppState: AppStateStatus) => {
			if (
				appStateRef.current.match(/inactive|background/) &&
				nextAppState === "active"
			) {
				if (pendingPermissionCheck.current) {
					pendingPermissionCheck.current = false;
					setTimeout(() => {
						void loadHomeData({ refreshInBackground: true });
					}, 500);
				}

				const monitoringService = UnifiedUsageService.getInstance();
				await monitoringService.startMonitoring();
				await NotificationService.ensureDefaultSchedules();

				const blockingService = AppBlockingService.getInstance();
				await blockingService.initialize();

				setTimeout(() => {
					monitoringService.triggerManualCheck();
				}, 1000);
			}

			appStateRef.current = nextAppState;
		};

		const subscription = AppState.addEventListener("change", handleAppStateChange);
		return () => {
			subscription?.remove();
		};
	}, []);

	useEffect(() => {
		const unsubscribe = InsightInvalidationService.subscribe(() => {
			void loadHomeData({ refreshInBackground: true, preferCached: true });
		});
		return unsubscribe;
	}, []);

	const checkNativeModuleAndPermissions = async () => {
		const isModuleAvailable = UnifiedUsageService.isNativeModuleAvailable();
		if (!isModuleAvailable) {
			return { hasModule: false, hasPermission: false };
		}

		try {
			let hasPermission = await UnifiedUsageService.isUsageAccessGranted();
			if (!hasPermission) {
				try {
					if (UnifiedUsageService.forceRefreshPermission) {
						hasPermission = await UnifiedUsageService.forceRefreshPermission();
					}
				} catch {
					// Ignore force-refresh failures and continue with current state.
				}
			}

			setHasUsagePermission(hasPermission);
			return { hasModule: true, hasPermission };
		} catch (error) {
			console.log(`Permission check failed: ${String(error)}`);
			return { hasModule: true, hasPermission: false };
		}
	};

	function buildCachedInsights(
		date: string,
		summary: DailyUsage | null,
		persisted: DailyInsights | null,
	): DailyInsights | null {
		if (!summary && !persisted) {
			return null;
		}

		const apps = summary?.apps || [];
		return {
			date,
			summary,
			sessions: persisted?.sessions || [],
			blockEvents: persisted?.blockEvents || [],
			replayEntries: persisted?.replayEntries || [],
			primaryInsight: persisted?.primaryInsight ?? null,
			replayInsightCards: persisted?.replayInsightCards || [],
			rankedInsights: persisted?.rankedInsights || [],
			wastedTimeMs:
				summary?.totalDistractingMs ??
				summary?.totalScreenTime ??
				persisted?.wastedTimeMs ??
				0,
			biggestTimeLeak:
				persisted?.biggestTimeLeak ??
				(apps[0]
					? {
							packageName: apps[0].packageName,
							appName: apps[0].appName,
							totalTimeMs: apps[0].totalTimeMs,
							percentage:
								(summary?.totalScreenTime ?? 0) > 0
									? Math.round((apps[0].totalTimeMs / (summary?.totalScreenTime ?? 1)) * 100)
									: 0,
					  }
					: null),
			integrity: {
				source: summary?.summarySource || persisted?.integrity.source || "missing",
				deltaMs: summary?.integrityDeltaMs ?? persisted?.integrity.deltaMs ?? 0,
				isConsistent:
					(summary?.integrityDeltaMs ?? persisted?.integrity.deltaMs ?? 0) <=
					2 * 60 * 1000,
			},
			insightLoadState: persisted?.insightLoadState || "missing",
		};
	}

	async function hydrateHomeFromCache() {
		const today = formatLocalDate(new Date());
		const yesterday = getDateShiftedBy(-1);
		const [todaySummary, yesterdaySummaryData, trial, cachedTodayInsights] = await Promise.all([
			database.getDailySummary(today),
			database.getDailySummary(yesterday),
			TrialService.getTrialInfo().catch(() => ({
				isActive: false,
				daysRemaining: 0,
				expired: false,
			})),
			DailyInsightsService.getInstance().getDailyInsights(today, {
				allowInsightRegeneration: false,
				preferPersistedInsights: true,
			}),
		]);

		setTodayInsights(
			buildCachedInsights(today, todaySummary ?? cachedTodayInsights.summary, cachedTodayInsights),
		);
		setYesterdaySummary(yesterdaySummaryData);
		const nextScore =
			todaySummary?.focusScore ??
			todaySummary?.brainScore ??
			cachedTodayInsights.summary?.focusScore ??
			cachedTodayInsights.summary?.brainScore ??
			100;
		setBrainScore(nextScore);
		setBrainState(getBrainStateLabel(nextScore));
		setTrialInfo(trial);
		setLoading(false);
		await refreshNudges();
	};

	async function refreshHomeDataInBackground() {
		if (homeRefreshInFlightRef.current) {
			return;
		}

		homeRefreshInFlightRef.current = true;

		try {
			const { hasModule, hasPermission } = await checkNativeModuleAndPermissions();
			if (hasModule && hasPermission) {
				try {
					await DataSyncService.getInstance().syncUsageData();
				} catch (error) {
					console.log(`Sync failed: ${error}`);
				}
			}

			const today = formatLocalDate(new Date());
			const yesterday = getDateShiftedBy(-1);
			const [todayResult, yesterdayResult, trial] = await Promise.all([
				DailyInsightsService.getInstance().getDailyInsights(today, {
					forceSummaryRefresh: true,
					allowInsightRegeneration: true,
					preferPersistedInsights: true,
				}),
				DailyInsightsService.getInstance().getDailyInsights(yesterday, {
					allowInsightRegeneration: false,
					preferPersistedInsights: true,
				}),
				TrialService.getTrialInfo().catch(() => ({
					isActive: false,
					daysRemaining: 0,
					expired: false,
				})),
			]);

			const nextScore =
				todayResult.summary?.focusScore ?? todayResult.summary?.brainScore ?? 0;
			setTodayInsights(todayResult);
			setYesterdaySummary(yesterdayResult.summary);
			setBrainScore(nextScore);
			setBrainState(getBrainStateLabel(nextScore));
			setTrialInfo(trial);
			await refreshNudges();
		} catch (error) {
			console.log(`Critical error: ${String(error)}`);
		} finally {
			homeRefreshInFlightRef.current = false;
		}
	}

	async function refreshNudges() {
		const [nextPermissionPrompt, nextLoginNudge] = await Promise.all([
			PermissionHealthService.getHomeBottomSheetNudge().catch(() => null),
			LoginNudgeService.getLoginNudge().catch(() => null),
		]);
		setHomePermissionPrompt(nextPermissionPrompt);
		setLoginNudge(nextLoginNudge?.shouldShow ? nextLoginNudge : null);
	}

	async function loadHomeData(
		options: { refreshInBackground?: boolean; preferCached?: boolean } = {},
	) {
		try {
			const { refreshInBackground = true, preferCached = true } = options;
			const { hasModule, hasPermission } = await checkNativeModuleAndPermissions();

			if (preferCached) {
				await hydrateHomeFromCache();
			}

			if (!refreshInBackground) {
				return;
			}

			InteractionManager.runAfterInteractions(() => {
				if (hasModule && hasPermission) {
					void refreshHomeDataInBackground();
					return;
				}

				void refreshHomeDataInBackground();
			});
		} catch (error) {
			console.log(`Critical error: ${String(error)}`);
			setLoading(false);
		}
	}

	useFocusEffect(
		React.useCallback(() => {
			void loadHomeData();
		}, []),
	);

	useEffect(() => {
		if (
			trialInfo.isActive &&
			!trialInfo.expired &&
			paywallLoggedRef.current !== "trial"
		) {
			TelemetryService.capture("paywall_shown", {
				state: "trial_active",
				days_remaining: trialInfo.daysRemaining,
			});
			paywallLoggedRef.current = "trial";
		} else if (trialInfo.expired && paywallLoggedRef.current !== "expired") {
			TelemetryService.capture("paywall_shown", {
				state: "trial_expired",
			});
			paywallLoggedRef.current = "expired";
		}
	}, [trialInfo]);

	const handlePurchasePress = async () => {
		const success = await PurchaseService.purchaseLifetime();
		if (!success) {
			Alert.alert(
				"Purchase Unavailable",
				"The purchase flow is not fully wired yet in this build.",
			);
			return;
		}

		Alert.alert(
			"Purchase Complete",
			"Premium unlock was recorded successfully.",
		);
	};

	const scoreColor = getScoreColor(brainScore);
	const primaryInsight = todayInsights?.primaryInsight ?? null;
	const floatTranslateY = heroFloat.interpolate({
		inputRange: [0, 1],
		outputRange: [-6, 10],
	});
	const heroMinHeight = Math.round(screenHeight * 0.58);

	useEffect(() => {
		if (loading) {
			return;
		}

		const monitoredAppCount = todayInsights?.summary?.apps?.length ?? 0;
		const hasAccessibility = AppBlockingService.getInstance().getFocusStatus().accessibilityEnabled;

		TelemetryService.track("home_viewed", {
			brain_score: brainScore,
			brain_status: brainState,
			monitored_app_count: monitoredAppCount,
			has_usage_access: hasUsagePermission === true,
			has_accessibility: hasAccessibility,
		});
		TelemetryService.track("brain_score_viewed", {
			brain_score: brainScore,
			brain_status: brainState,
			monitored_app_count: monitoredAppCount,
			has_usage_access: hasUsagePermission === true,
			has_accessibility: hasAccessibility,
		});

		if (yesterdaySummary?.totalScreenTime && yesterdaySummary.totalScreenTime > 0) {
			void TelemetryService.trackOnce("telemetry_first_full_day_data_ready", "first_full_day_data_ready", {
				brain_score: brainScore,
				brain_status: brainState,
			});
		}
	}, [brainScore, brainState, hasUsagePermission, loading, todayInsights?.summary?.apps?.length, yesterdaySummary?.totalScreenTime]);

	useEffect(() => {
		if (!primaryInsight) {
			return;
		}

		TelemetryService.track("insight_generated", {
			insight_type: primaryInsight.category,
			app_package: primaryInsight.relatedAppPackage || primaryInsight.subjectAppPackage || undefined,
			app_name: undefined,
			severity: primaryInsight.scoreBreakdown?.finalPriority >= 80 ? "high" : primaryInsight.scoreBreakdown?.finalPriority >= 50 ? "medium" : "low",
			recommended_action: primaryInsight.action.type,
			cta_type: primaryInsight.action.type,
		});

		void TelemetryService.trackOnce(
			"telemetry_first_insight_generated",
			"first_insight_generated",
			{
				insight_type: primaryInsight.category,
				app_package: primaryInsight.relatedAppPackage || primaryInsight.subjectAppPackage || undefined,
				app_name: undefined,
			},
		);

		void TelemetryService.trackOnce(
			"telemetry_first_insight_viewed",
			"first_insight_viewed",
			{
				insight_type: primaryInsight.category,
				app_package: primaryInsight.relatedAppPackage || primaryInsight.subjectAppPackage || undefined,
				app_name: undefined,
			},
		);
	}, [primaryInsight]);

	useEffect(() => {
		if (!homePermissionPrompt) {
			shownPermissionPromptRef.current = null;
			return;
		}

		if (shownPermissionPromptRef.current === homePermissionPrompt.id) {
			return;
		}

		shownPermissionPromptRef.current = homePermissionPrompt.id;
		void PermissionHealthService.recordHomeBottomSheetShown();
	}, [homePermissionPrompt]);

	if (loading) {
		return (
			<SafeAreaView className="flex-1 bg-[#FCFBFF]">
				<ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
					<HomeSkeleton heroMinHeight={heroMinHeight} />
				</ScrollView>
			</SafeAreaView>
		);
	}

	return (
		<SafeAreaView className="flex-1 bg-[#FCFBFF]">
			<PermissionCoachBottomSheet
				visible={homePermissionPrompt !== null}
				title={homePermissionPrompt?.title || "Keep Brainrot working"}
				body={homePermissionPrompt?.body || ""}
				helperText={homePermissionPrompt?.helperText || ""}
				primaryLabel={homePermissionPrompt?.ctaLabel || "Fix now"}
				secondaryLabel="Not now"
				onClose={() => setHomePermissionPrompt(null)}
				onPrimary={() => {
					if (!homePermissionPrompt) {
						return;
					}
					pendingPermissionCheck.current = true;
					setHomePermissionPrompt(null);
					void PermissionHealthService.runNudgeAction(homePermissionPrompt).finally(
						refreshNudges,
					);
				}}
				onSecondary={() => {
					if (!homePermissionPrompt) {
						return;
					}
					const prompt = homePermissionPrompt;
					setHomePermissionPrompt(null);
					void PermissionHealthService.dismissHomeBottomSheet(prompt.id).then(
						refreshNudges,
					);
				}}
				tone={homePermissionPrompt?.severity === "warning" ? "warning" : "accent"}
			/>
			<ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
				<View
					className="overflow-hidden px-6 pb-5 pt-2"
					style={{ minHeight: heroMinHeight }}
				>
					<View
						className="absolute -left-12 top-20 h-48 w-48 rounded-full bg-[#EEE7FF]"
					/>
					<View
						className="absolute -right-10 top-14 h-56 w-56 rounded-full bg-[#F3EDFF]"
					/>
					<View
						className="absolute left-10 top-1/2 h-32 w-32 rounded-full bg-[#F7F2FF]"
					/>

					<View className="flex-1 items-center justify-center pt-1">
						<Animated.View
							style={{
								transform: [{ translateY: floatTranslateY }],
							}}
						>
							<Image
								source={getExpressionSource(brainScore)}
								resizeMode="contain"
								style={{ width: 352, height: 352 }}
							/>
						</Animated.View>
					</View>

					<View className="-mt-36 items-center pb-1">
						<Text
							className="font-heading-bold text-[64px] leading-[72px]"
							style={{ color: scoreColor }}
						>
							{brainScore}
						</Text>
						<Text className="mt-2 font-heading-bold text-section text-slate-900">
							{brainState}
						</Text>
					</View>
				</View>

				{primaryInsight ? (
					<View className="mx-md">
						<ActionInsightCard
							insight={primaryInsight}
							label="Today's Insight"
							surface="home"
							onPress={() =>
								void (async () => {
									await InsightActionService.execute(primaryInsight.action, router, "insight_cta");
								})()
							}
						/>
					</View>
				) : (
					<Card className="mx-md mb-md border border-[#E7DFFD] bg-[#F5F1FF] px-5 py-5">
						<Text className="mb-3 font-heading-semibold text-secondary text-[#7C6AA6]">
							Today's Insight
						</Text>
						<Text className="font-heading-bold text-section leading-8 text-slate-900">
							Your replay is still building.
						</Text>
						<Text className="mt-3 font-body text-body leading-6 text-slate-600">
							Come back after a few more distraction sessions and Brainrot will
							show you the strongest pattern worth fixing.
						</Text>
					</Card>
				)}

				{loginNudge ? (
					<Card className="mx-md mb-md border border-[#D8E6FF] bg-[#F3F8FF]">
						<Text className="font-heading-semibold text-card-title text-text">
							{loginNudge.title}
						</Text>
						<Text className="mt-2 font-body text-secondary text-muted">
							{loginNudge.body}
						</Text>
						<View className="mt-4 flex-row">
							<TouchableOpacity
								onPress={() => router.push("/(tabs)/settings")}
								className="mr-2 rounded-xl bg-[#2563EB] px-4 py-2"
							>
								<Text className="font-heading-semibold text-secondary text-white">
									{loginNudge.ctaLabel}
								</Text>
							</TouchableOpacity>
							<TouchableOpacity
								onPress={() => void LoginNudgeService.dismiss().then(refreshNudges)}
								className="rounded-xl border border-slate-200 px-4 py-2"
							>
								<Text className="font-heading-semibold text-secondary text-muted">
									Not now
								</Text>
							</TouchableOpacity>
						</View>
					</Card>
				) : null}

				{trialInfo.isActive && !trialInfo.expired && (
					<Card className="mx-md mb-xl border border-[#E7DFFD] bg-[#F7F3FF]">
						<View className="items-center">
							<Text className="mb-sm text-base font-semibold text-[#5D3DF0]">
								7-day trial active — {trialInfo.daysRemaining} days left
							</Text>
							<Text className="mb-md text-center font-body text-secondary text-muted">
								Unlock permanently for ₹149 / $2.99
							</Text>
							<TouchableOpacity
								onPress={() => void handlePurchasePress()}
								className="w-full rounded-2xl bg-[#5D3DF0] px-4 py-4"
							>
								<Text className="text-center font-heading-semibold text-card-title text-white">
									Unlock ₹149
								</Text>
							</TouchableOpacity>
						</View>
					</Card>
				)}
			</ScrollView>
		</SafeAreaView>
	);
}

function HomeSkeleton({ heroMinHeight }: { heroMinHeight: number }) {
	return (
		<>
			<View
				className="overflow-hidden px-6 pb-5 pt-2"
				style={{ minHeight: heroMinHeight }}
			>
				<View className="absolute -left-12 top-20 h-48 w-48 rounded-full bg-[#EEE7FF]" />
				<View className="absolute -right-10 top-14 h-56 w-56 rounded-full bg-[#F3EDFF]" />
				<View className="absolute left-10 top-1/2 h-32 w-32 rounded-full bg-[#F7F2FF]" />

				<View className="flex-1 items-center justify-center pt-1">
					<SkeletonBlock
						className="rounded-[56px]"
						style={{ width: 304, height: 304 }}
					/>
				</View>

				<View className="-mt-28 items-center pb-1">
					<SkeletonBlock className="h-16 w-28 rounded-3xl" />
					<SkeletonBlock className="mt-3 h-6 w-32 rounded-xl" />
				</View>
			</View>

			<Card className="mx-md mb-md border border-[#E7DFFD] bg-white px-5 py-5">
				<SkeletonBlock className="h-5 w-32" />
				<SkeletonBlock className="mt-4 h-8 w-4/5" />
				<SkeletonBlock className="mt-3 h-4 w-full" />
				<SkeletonBlock className="mt-2 h-4 w-3/4" />
				<SkeletonBlock className="mt-4 h-11 w-40 rounded-2xl" />
			</Card>

			<Card className="mx-md mb-xl border border-[#E7DFFD] bg-white">
				<SkeletonBlock className="mx-auto h-5 w-44" />
				<SkeletonBlock className="mx-auto mt-4 h-4 w-32" />
				<SkeletonBlock className="mt-5 h-14 w-full rounded-2xl" />
			</Card>
		</>
	);
}
