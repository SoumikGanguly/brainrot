import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
	Alert,
	Animated,
	AppState,
	AppStateStatus,
	Dimensions,
	Image,
	ScrollView,
	Text,
	TouchableOpacity,
	View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Card } from "../../components/Card";
import { database, type DailyUsage } from "../../services/database";

import { AppBlockingService } from "@/services/AppBlockingService";
import { CapabilitiesService } from "@/services/CapabilitiesService";
import { DailyResetService } from "@/services/DailyResetService";
import { DailyInsightsService, type DailyInsights } from "@/services/DailyInsightsService";
import { DataSyncService } from "@/services/DataSyncService";
import { HistoricalDataService } from "@/services/HistoricalDataService";
import { NotificationService } from "@/services/NotificationService";
import { PurchaseService } from "@/services/PurchaseService";
import { TelemetryService } from "@/services/TelemetryService";
import { TrialService } from "@/services/TrialService";
import {
	UnifiedUsageService,
	type ManufacturerPermissionInfo,
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

type InsightCardContent = {
	title: string;
	subtext: string;
	icon: keyof typeof Ionicons.glyphMap;
};

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

function formatTimeOfDay(isoTimestamp: string): string {
	return new Date(isoTimestamp).toLocaleTimeString([], {
		hour: "numeric",
		minute: "2-digit",
	});
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

function getDayProgressMinutes(): number {
	const now = new Date();
	return Math.max(1, now.getHours() * 60 + now.getMinutes());
}

function buildInsightCard(
	todayInsights: DailyInsights | null,
	yesterdaySummary: DailyUsage | null,
): InsightCardContent {
	const summary = todayInsights?.summary;
	const replayEntries = todayInsights?.replayEntries ?? [];
	const totalOpens = summary?.totalMonitoredOpens ?? replayEntries.length;
	const wastedTimeMs = todayInsights?.wastedTimeMs ?? summary?.totalDistractingMs ?? 0;
	const beforeLunchEntries = replayEntries.filter(
		(entry) =>
			entry.moment === "Early morning" ||
			entry.moment === "Morning" ||
			entry.moment === "Mid day" ||
			entry.moment === "Before lunch",
	);
	const beforeBedEntries = replayEntries.filter((entry) => entry.moment === "Before bed");
	const todayScore = summary?.focusScore ?? summary?.brainScore ?? 0;
	const yesterdayScore = yesterdaySummary?.focusScore ?? yesterdaySummary?.brainScore ?? 0;
	const yesterdayOpens = yesterdaySummary?.totalMonitoredOpens ?? 0;
	const opensImprovement = yesterdayOpens - totalOpens;
	const improvedMeaningfully =
		yesterdaySummary !== null &&
		opensImprovement >= 10 &&
		todayScore >= yesterdayScore &&
		totalOpens > 0;

	if (improvedMeaningfully) {
		return {
			title: "You improved.",
			subtext: `${opensImprovement} fewer app opens than yesterday.`,
			icon: "hourglass-outline",
		};
	}

	if (beforeLunchEntries.length >= 3) {
		const packageCounts = new Map<string, { appName: string; count: number }>();
		for (const entry of beforeLunchEntries) {
			const existing = packageCounts.get(entry.packageName);
			packageCounts.set(entry.packageName, {
				appName: entry.appName,
				count: (existing?.count || 0) + 1,
			});
		}

		const topBeforeLunch = Array.from(packageCounts.values()).sort(
			(a, b) => b.count - a.count,
		)[0];

		if (topBeforeLunch) {
			const beforeNoonShare = totalOpens > 0 ? Math.round((beforeLunchEntries.length / totalOpens) * 100) : 0;
			return {
				title: `You opened ${topBeforeLunch.appName}\n${topBeforeLunch.count} times before lunch.`,
				subtext: `${beforeNoonShare}% of today's distractions\nhappened before noon.`,
				icon: "hourglass-outline",
			};
		}
	}

	if (beforeBedEntries.length >= 2) {
		const beforeBedCounts = new Map<string, { appName: string; count: number }>();
		for (const entry of beforeBedEntries) {
			const existing = beforeBedCounts.get(entry.packageName);
			beforeBedCounts.set(entry.packageName, {
				appName: entry.appName,
				count: (existing?.count || 0) + 1,
			});
		}

		const topBeforeBed = Array.from(beforeBedCounts.values()).sort(
			(a, b) => b.count - a.count,
		)[0];

		if (topBeforeBed) {
			const share = Math.round((topBeforeBed.count / beforeBedEntries.length) * 100);
			return {
				title: "Most distractions happened\nbefore bed.",
				subtext: `${topBeforeBed.appName} accounted for\n${share}% of them.`,
				icon: "hourglass-outline",
			};
		}
	}

	const longestSession = replayEntries.reduce<DailyInsights["replayEntries"][number] | null>(
		(longest, entry) => {
			if (!longest || entry.durationMs > longest.durationMs) {
				return entry;
			}
			return longest;
		},
		null,
	);

	if (longestSession && longestSession.durationMs >= 15 * 60 * 1000) {
		return {
			title: `Your longest distraction\nlasted ${formatTime(longestSession.durationMs)}.`,
			subtext: `It started at ${formatTimeOfDay(longestSession.startedAt)}.`,
			icon: "hourglass-outline",
		};
	}

	if (wastedTimeMs >= 20 * 60 * 1000) {
		const gymWorkouts = Math.max(1, Math.round(wastedTimeMs / (35 * 60 * 1000)));
		return {
			title: `You lost ${formatTime(wastedTimeMs)} today.`,
			subtext: `That's enough time for\n${gymWorkouts} gym workouts this week.`,
			icon: "hourglass-outline",
		};
	}

	if (totalOpens > 0) {
		const cadenceMinutes = Math.max(1, Math.round(getDayProgressMinutes() / totalOpens));
		return {
			title: `You checked your phone\n${totalOpens} times today.`,
			subtext: `About once every ${cadenceMinutes} minutes.`,
			icon: "hourglass-outline",
		};
	}

	return {
		title: "Today's insight",
		subtext: "Your replay builds as you go.\nCome back after a few sessions.",
		icon: "hourglass-outline",
	};
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
	const [hasUsagePermission, setHasUsagePermission] = useState(false);
	const [manufacturerInfo, setManufacturerInfo] =
		useState<ManufacturerPermissionInfo | null>(null);
	const pendingPermissionCheck = useRef(false);
	const appStateRef = useRef<AppStateStatus>(AppState.currentState);
	const paywallLoggedRef = useRef<"trial" | "expired" | null>(null);

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

				const historicalService = HistoricalDataService.getInstance();
				const lastBackfill = await database.getMeta("last_backfill_date");
				const today = formatLocalDate(new Date());
				if (lastBackfill !== today) {
					await historicalService.backfillHistoricalData(90);
					await database.setMeta("last_backfill_date", today);
				}

				DailyResetService.getInstance().initialize();

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
				isInitialized = true;
			} catch (error) {
				console.error("Failed to initialize services:", error);
			}
		};

		const loadManufacturerInfo = async () => {
			try {
				const info = await UnifiedUsageService.getManufacturerInfo();
				if (info?.needsSpecialPermission) {
					setManufacturerInfo(info);
				}
			} catch (error) {
				console.warn("Failed to load manufacturer info:", error);
			}
		};

		void initializeAllServices();
		void loadManufacturerInfo();

		const handleAppStateChange = async (nextAppState: AppStateStatus) => {
			if (
				appStateRef.current.match(/inactive|background/) &&
				nextAppState === "active"
			) {
				if (pendingPermissionCheck.current) {
					pendingPermissionCheck.current = false;
					setTimeout(() => {
						void loadHomeData();
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

	async function loadHomeData() {
		try {
			setLoading(true);

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
				}),
				DailyInsightsService.getInstance().getDailyInsights(yesterday, {
					forceSummaryRefresh: true,
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
		} catch (error) {
			console.log(`Critical error: ${String(error)}`);
		} finally {
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

	const openTodayReplay = () => {
		router.push("/replay?day=today" as never);
	};

	const scoreColor = getScoreColor(brainScore);
	const insightCard = useMemo(
		() => buildInsightCard(todayInsights, yesterdaySummary),
		[todayInsights, yesterdaySummary],
	);
	const floatTranslateY = heroFloat.interpolate({
		inputRange: [0, 1],
		outputRange: [-6, 10],
	});
	const heroMinHeight = Math.round(screenHeight * 0.68);

	if (loading) {
		return (
			<SafeAreaView className="flex-1 bg-[#FCFBFF]">
				<View className="flex-1 items-center justify-center p-4">
					<Text className="font-body text-body text-muted">Loading...</Text>
				</View>
			</SafeAreaView>
		);
	}

	return (
		<SafeAreaView className="flex-1 bg-[#FCFBFF]">
			<ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
				<View
					className="overflow-hidden px-6 pb-6 pt-4"
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

					<View className="flex-1 items-center justify-center pt-6">
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

					<View className="-mt-24 items-center pb-2">
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

				<TouchableOpacity
					activeOpacity={0.92}
					onPress={openTodayReplay}
					className="mx-md mb-md"
				>
					<Card className="border border-[#E7DFFD] bg-[#F5F1FF] px-5 py-5">
						<View className="flex-row items-start">
							<View className="flex-1 pr-4">
								<Text className="font-heading-semibold text-secondary text-[#7C6AA6]">
									Today's Insight
								</Text>
								<Text className="mt-3 font-heading-bold text-section leading-8 text-slate-900">
									{insightCard.title}
								</Text>
								<Text className="mt-3 font-body text-body leading-6 text-slate-600">
									{insightCard.subtext}
								</Text>
							</View>
							<View className="mt-1 h-12 w-12 items-center justify-center rounded-2xl bg-white/85">
								<Ionicons
									name={insightCard.icon}
									size={22}
									color="#5D3DF0"
								/>
							</View>
						</View>
					</Card>
				</TouchableOpacity>

				{!hasUsagePermission && (
					<Card className="mx-md mb-md border border-yellow-200 bg-yellow-50">
						<View className="flex-row items-start">
							<Ionicons
								name="warning"
								size={22}
								color="#D97706"
								style={{ marginRight: 12, marginTop: 2 }}
							/>
							<View className="flex-1">
								<Text className="mb-1 font-heading-semibold text-card-title text-yellow-800">
									Usage Access Required
								</Text>
								<Text className="mb-3 font-body text-secondary text-yellow-700">
									Grant usage access permission so Brainrot can track your score
									and build your replay.
								</Text>
								<TouchableOpacity
									onPress={async () => {
										try {
											pendingPermissionCheck.current = true;
											await UnifiedUsageService.openUsageAccessSettings();
										} catch (error) {
											console.error("Failed to open settings:", error);
											pendingPermissionCheck.current = false;
										}
									}}
									className="self-start rounded-lg bg-yellow-600 px-4 py-2"
								>
									<Text className="font-heading-semibold text-secondary text-white">
										Grant Permission
									</Text>
								</TouchableOpacity>

								{manufacturerInfo?.needsSpecialPermission && (
									<View className="mt-3 rounded-lg border border-yellow-200 bg-yellow-100 p-3">
										<Text className="mb-1 font-heading-semibold text-secondary text-yellow-900">
											{manufacturerInfo.title}
										</Text>
										<Text className="mb-2 font-body text-secondary text-yellow-800">
											{manufacturerInfo.instructions}
										</Text>
										{manufacturerInfo.canOpenDirectly && (
											<TouchableOpacity
												onPress={async () => {
													try {
														await UnifiedUsageService.openManufacturerSettings();
													} catch (oemError) {
														console.warn(
															"Failed to open OEM settings:",
															oemError,
														);
													}
												}}
												className="self-start rounded-lg bg-yellow-700 px-3 py-2"
											>
												<Text className="font-heading-semibold text-secondary text-white">
													Open OEM Settings
												</Text>
											</TouchableOpacity>
										)}
									</View>
								)}
							</View>
						</View>
					</Card>
				)}

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
