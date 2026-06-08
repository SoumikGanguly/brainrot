import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  AppState,
  AppStateStatus,
  Image,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import ActionInsightCard from "@/components/ActionInsightCard";
import { CapabilitiesService } from "@/services/CapabilitiesService";
import { Card } from "../../components/Card";
import { Header } from "../../components/Header";
import SkeletonBlock from "@/components/SkeletonBlock";
import {
  DailyInsightsService,
  type DailyInsights,
  type ReplayEntry,
} from "../../services/DailyInsightsService";
import { InsightActionService } from "../../services/InsightActionService";
import { InsightInvalidationService } from "../../services/InsightInvalidationService";
import type { InsightCard } from "../../services/InsightTypes";
import { TelemetryService } from "../../services/TelemetryService";
import { type DailyUsage } from "../../services/database";
import { DataSyncService } from "../../services/DataSyncService";
import {
  UnifiedUsageService,
  type ManufacturerPermissionInfo,
} from "../../services/UnifiedUsageService";
import { getBrainStateLevel } from "../../utils/brainScore";
import { formatTime } from "../../utils/time";

const TIMELINE_MAX_HEIGHT = 430;
const replayMomentTheme = {
	"Early morning": {
		dot: "#F59E0B",
		pillBackground: "#FFF1D6",
		pillText: "#C66A00",
	},
	Morning: {
		dot: "#FBBF24",
		pillBackground: "#FFF7D6",
		pillText: "#B45309",
	},
	"Before lunch": {
		dot: "#9AD9FF",
		pillBackground: "#E7F6FF",
		pillText: "#3B82F6",
	},
	"Mid day": { dot: "#38BDF8", pillBackground: "#E0F2FE", pillText: "#0284C7" },
	Evening: { dot: "#F9A8D4", pillBackground: "#FDE7F3", pillText: "#DB2777" },
	"After bed": {
		dot: "#C084FC",
		pillBackground: "#F3E8FF",
		pillText: "#A21CAF",
	},
} as const;
const replayExpressions = {
	happy: require("../../assets/expressions/happy.png"),
	healthy: require("../../assets/expressions/healthy.png"),
	confused: require("../../assets/expressions/confused.png"),
	disappointed: require("../../assets/expressions/disappointed.png"),
	exhausted: require("../../assets/expressions/exhausted.png"),
} as const;

function formatLocalDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function getYesterdayDate(): string {
	const date = new Date();
	date.setDate(date.getDate() - 1);
	return formatLocalDate(date);
}

function getAppVisual(
	appName: string,
	packageName: string,
): { icon: keyof typeof Ionicons.glyphMap; bg: string; accent: string } {
	const key = `${appName} ${packageName}`.toLowerCase();
	if (key.includes("instagram")) {
		return { icon: "logo-instagram", bg: "#EC4899", accent: "#F472B6" };
	}
	if (key.includes("youtube")) {
		return { icon: "logo-youtube", bg: "#EF4444", accent: "#F87171" };
	}
	if (key.includes("reddit")) {
		return { icon: "logo-reddit", bg: "#F97316", accent: "#FB923C" };
	}
	if (key.includes("facebook")) {
		return { icon: "logo-facebook", bg: "#2563EB", accent: "#60A5FA" };
	}
	return { icon: "phone-portrait", bg: "#7C3AED", accent: "#A78BFA" };
}

function getBrainScoreText(summary: DailyUsage | null): number {
	return summary?.focusScore ?? summary?.brainScore ?? 0;
}

function getAppInitials(appName: string): string {
	const words = appName
		.split(/\s+/)
		.map((word) => word.trim())
		.filter(Boolean);

	if (words.length === 0) {
		return "AP";
	}

	if (words.length === 1) {
		return words[0].slice(0, 2).toUpperCase();
	}

	return `${words[0][0] || ""}${words[1][0] || ""}`.toUpperCase();
}

function getReplayMomentTheme(moment: ReplayEntry["moment"]) {
	return replayMomentTheme[moment];
}

function getBrainExpression(score: number | null | undefined) {
	if (typeof score !== "number") {
		return replayExpressions.confused;
	}

	const state = getBrainStateLevel(score);
	if (state === "focused") {
		return replayExpressions.happy;
	}
	if (state === "healthy") {
		return replayExpressions.healthy;
	}
	if (state === "foggy") {
		return replayExpressions.confused;
	}
	return replayExpressions.exhausted;
}

export default function ReplayScreen() {
	const router = useRouter();
	const params = useLocalSearchParams<{ moment?: string }>();
	const [loading, setLoading] = useState(true);
	const [hasUsagePermission, setHasUsagePermission] = useState<boolean | null>(null);
	const [manufacturerInfo, setManufacturerInfo] =
		useState<ManufacturerPermissionInfo | null>(null);
	const [summary, setSummary] = useState<DailyUsage | null>(null);
	const [replayEntries, setReplayEntries] = useState<ReplayEntry[]>([]);
	const [wastedTimeMs, setWastedTimeMs] = useState(0);
	const [biggestTimeLeak, setBiggestTimeLeak] = useState<{
		packageName: string;
		appName: string;
		totalTimeMs: number;
		percentage: number;
	} | null>(null);
	const [replayInsightCards, setReplayInsightCards] = useState<InsightCard[]>([]);
	const pendingPermissionCheck = useRef(false);
	const appStateRef = useRef<AppStateStatus>(AppState.currentState);

	const selectedDate = getYesterdayDate();

	useEffect(() => {
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

		void checkPermissionAndLoad(selectedDate);
		void loadManufacturerInfo();

		const subscription = AppState.addEventListener("change", (nextAppState) => {
			if (
				appStateRef.current.match(/inactive|background/) &&
				nextAppState === "active"
			) {
				if (pendingPermissionCheck.current) {
					pendingPermissionCheck.current = false;
					setTimeout(() => {
						void checkPermissionAndLoad(selectedDate);
					}, 500);
				} else {
					void loadReplayData(selectedDate);
				}
			}
			appStateRef.current = nextAppState;
		});

		return () => subscription.remove();
	}, [selectedDate]);

	useEffect(() => {
		const unsubscribe = InsightInvalidationService.subscribe(() => {
			void loadReplayData(selectedDate);
		});
		return unsubscribe;
	}, [selectedDate, params.moment]);

	async function checkPermissionAndLoad(date: string) {
		try {
			if (UnifiedUsageService.isNativeModuleAvailable()) {
				const granted = await UnifiedUsageService.isUsageAccessGranted();
				setHasUsagePermission(granted);
			}
		} catch (error) {
			console.error("Error checking replay permission:", error);
		}

		await loadReplayData(date);
	}

	async function loadReplayData(date: string) {
		try {
			setLoading(true);

			if (UnifiedUsageService.isNativeModuleAvailable()) {
				const granted = await UnifiedUsageService.isUsageAccessGranted();
				if (granted) {
					await DataSyncService.getInstance().syncUsageData();
				}
			}

			const insights =
				await DailyInsightsService.getInstance().getDailyInsights(date, {
					allowInsightRegeneration: false,
					preferPersistedInsights: true,
				});

			setSummary(insights.summary);
			setReplayEntries(thisMomentFilteredEntries(insights, params.moment));
			setWastedTimeMs(insights.wastedTimeMs);
			setBiggestTimeLeak(insights.biggestTimeLeak);
			setReplayInsightCards(insights.replayInsightCards);
			TelemetryService.track("replay_viewed", {
				date_type: date === getYesterdayDate() ? "yesterday" : "historical",
				total_distraction_ms: insights.wastedTimeMs,
				open_count: insights.summary?.totalMonitoredOpens ?? 0,
				top_app: insights.biggestTimeLeak?.appName,
				session_count: insights.replayEntries.length,
			});
		} catch (error) {
			console.error("Error loading replay data:", error);
			setSummary(null);
			setReplayEntries([]);
			setWastedTimeMs(0);
			setBiggestTimeLeak(null);
			setReplayInsightCards([]);
		} finally {
			setLoading(false);
		}
	}

	const emptyStateText = loading
		? "Rebuilding your distraction trail..."
		: "No monitored distraction sessions were recorded for this day.";
	const showInsightSkeletons =
		!loading &&
		replayInsightCards.length === 0 &&
		summary?.totalScreenTime &&
		summary.totalScreenTime > 0;

	useEffect(() => {
		if (replayInsightCards.length === 0) {
			return;
		}

		for (const insight of replayInsightCards) {
			TelemetryService.track("insight_generated", {
				insight_type: insight.category,
				app_package: insight.relatedAppPackage || insight.subjectAppPackage || undefined,
				app_name: undefined,
				severity: insight.scoreBreakdown?.finalPriority >= 80 ? "high" : insight.scoreBreakdown?.finalPriority >= 50 ? "medium" : "low",
				recommended_action: insight.action.type,
				cta_type: insight.action.type,
			});
		}
	}, [replayInsightCards]);

	return (
		<SafeAreaView className="flex-1 bg-bg">
			<ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
				<Header title="Replay" />

				{hasUsagePermission === false && (
					<Card className="mx-md mb-md border border-yellow-200 bg-yellow-50">
						<View className="flex-row items-start">
							<Ionicons
								name="warning"
								size={24}
								color="#D97706"
								style={{ marginRight: 12, marginTop: 2 }}
							/>
							<View className="flex-1">
								<Text className="mb-1 font-heading-semibold text-card-title text-yellow-800">
									Usage Access Required
								</Text>
								<Text className="mb-3 font-body text-secondary text-yellow-700">
									Replay needs usage access so it can rebuild your distraction
									timeline.
								</Text>
								<TouchableOpacity
									onPress={async () => {
										pendingPermissionCheck.current = true;
										await CapabilitiesService.ensureUsageAccess("replay");
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
													await CapabilitiesService.openBackgroundReliabilitySettings("replay");
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

				<Card className="mx-md mb-md">
					<Text className="text-center font-heading-semibold text-card-title text-text">
						Yesterday
					</Text>
					<Text className="mt-2 text-center font-body text-secondary text-muted">
						{new Date(selectedDate).toLocaleDateString("en-US", {
							weekday: "long",
							month: "long",
							day: "numeric",
							year: "numeric",
						})}
					</Text>
				</Card>

				{params.moment ? (
					<Card className="mx-md mb-md border border-[#E7DFFD] bg-[#F5F1FF] px-4 py-4">
						<Text className="font-heading-semibold text-card-title text-text">
							Showing {params.moment} replay
						</Text>
						<Text className="mt-2 font-body text-secondary text-muted">
							These are the distraction sessions from that time window.
						</Text>
					</Card>
				) : null}

				<Card className="mx-md mb-md">
					<Text className="mb-md font-heading-bold text-section text-text">
						Session Replay
					</Text>
					{replayEntries.length === 0 ? (
						<Text className="font-body text-body text-muted">
							{emptyStateText}
						</Text>
					) : (
						<ScrollView
							nestedScrollEnabled
							showsVerticalScrollIndicator={false}
							style={{ maxHeight: TIMELINE_MAX_HEIGHT }}
						>
							{replayEntries.map((entry, index) => {
								const visual = getAppVisual(entry.appName, entry.packageName);
								const momentTheme = getReplayMomentTheme(entry.moment);
								const startTime = new Date(entry.startedAt).toLocaleTimeString(
									[],
									{
										hour: "numeric",
										minute: "2-digit",
									},
								);

								return (
									<View
										key={`${entry.packageName}-${entry.startedAt}-${index}`}
										className="flex-row pb-md last:pb-0"
									>
										<View className="w-16 pt-3">
											<Text className="font-body-semibold text-secondary text-muted">
												{startTime}
											</Text>
										</View>

										<View className="mr-md items-center">
											<View
												className="mt-3 h-3 w-3 rounded-full"
												style={{ backgroundColor: momentTheme.dot }}
											/>
											{index < replayEntries.length - 1 ? (
												<View
													className="mt-1 w-0.5 flex-1"
													style={{ backgroundColor: `${momentTheme.dot}55` }}
												/>
											) : (
												<View className="w-0.5 flex-1" />
											)}
										</View>

										<View className="flex-1 rounded-3xl border border-slate-200 bg-card px-4 py-4">
											<View className="flex-row items-start justify-between">
												<View className="flex-row flex-1 items-center">
													<View
														className="mr-3 h-11 w-11 items-center justify-center rounded-2xl"
														style={{ backgroundColor: visual.bg }}
													>
														<Ionicons
															name={visual.icon}
															size={22}
															color="#FFFFFF"
														/>
													</View>
													<Text className="flex-1 font-heading-semibold text-card-title text-text">
														{entry.appName}
													</Text>
												</View>
												<Text
													className="ml-3 font-heading-bold text-card-title"
													style={{ color: visual.bg }}
												>
													+{formatTime(entry.durationMs)}
												</Text>
											</View>

											<View className="mt-3 flex-row justify-end">
												<View
													className="rounded-full px-3 py-1"
													style={{
														backgroundColor: momentTheme.pillBackground,
													}}
												>
													<Text
														className="font-body-semibold text-secondary"
														style={{ color: momentTheme.pillText }}
													>
														{entry.moment}
													</Text>
												</View>
											</View>
										</View>
									</View>
								);
							})}
						</ScrollView>
					)}
				</Card>

				{replayInsightCards.map((insight) => (
					<View key={insight.id} className="mx-md">
						<ActionInsightCard
							insight={insight}
							surface="replay"
							onPress={() =>
								void (async () => {
									await InsightActionService.execute(insight.action, router, "replay_cta");
								})()
							}
						/>
					</View>
				))}

				{showInsightSkeletons
					? Array.from({ length: 2 }).map((_, index) => (
							<Card
								key={`insight-skeleton-${index}`}
								className="mx-md mb-md border border-[#E7DFFD] bg-white px-5 py-5"
							>
								<SkeletonBlock className="h-5 w-32" />
								<SkeletonBlock className="mt-4 h-8 w-4/5" />
								<SkeletonBlock className="mt-3 h-4 w-full" />
								<SkeletonBlock className="mt-2 h-4 w-3/4" />
								<SkeletonBlock className="mt-4 h-11 w-36 rounded-2xl" />
							</Card>
					  ))
					: null}

				<View className="mx-md mb-xl flex-row">
					<Card className="mr-sm flex-1 px-5 py-5">
						<Text className="font-heading-bold text-card-title text-text">
							Biggest Time Leak
						</Text>
						{biggestTimeLeak ? (
							<View className="mt-3 min-h-[150px] justify-between">
								<View className="flex-1">
									<View className="flex-row items-center">
										<AppBadge
											appName={biggestTimeLeak.appName}
											packageName={biggestTimeLeak.packageName}
											size={42}
										/>
										<Text
											className="ml-3 flex-1 font-heading-semibold text-card-title text-text"
											numberOfLines={2}
										>
											{biggestTimeLeak.appName}
										</Text>
									</View>
									<Text className="mt-4 text-3xl font-bold text-danger">
										{formatTime(biggestTimeLeak.totalTimeMs)}
									</Text>
									<Text className="mt-2 font-body text-secondary text-muted">
										{biggestTimeLeak.percentage}% of distraction time
									</Text>
								</View>
							</View>
						) : (
							<View className="mt-3 min-h-[150px] justify-center">
								<Text className="font-body text-secondary text-muted">
									No obvious villain today.
								</Text>
							</View>
						)}
					</Card>

					<Card className="ml-sm flex-1 px-5 py-5">
						<View className="min-h-[170px] justify-between">
							<View className="pr-16">
								<Text className="font-heading-bold text-card-title text-text">
									Brain Score
								</Text>
								<Text className="mt-3 text-4xl font-bold text-accent">
									{getBrainScoreText(summary)}
								</Text>
								<Text className="mt-2 font-body text-secondary text-muted">
									{summary?.brainHealthStatus || "No rating yet"}
								</Text>
							</View>
							<View className="absolute bottom-0 right-0">
								<ExpressionBadge
									source={getBrainExpression(
										summary?.focusScore ?? summary?.brainScore,
									)}
									size={106}
								/>
							</View>
						</View>
					</Card>
				</View>
			</ScrollView>
		</SafeAreaView>
	);
}

function thisMomentFilteredEntries(
	insights: DailyInsights,
	selectedMoment?: string,
): ReplayEntry[] {
	if (!selectedMoment) {
		return insights.replayEntries;
	}

	const matchingEntries = insights.replayEntries.filter(
		(entry) => entry.moment === selectedMoment,
	);
	return matchingEntries.length > 0 ? matchingEntries : insights.replayEntries;
}

function AppBadge({
	appName,
	packageName,
	size = 44,
}: {
	appName: string;
	packageName: string;
	size?: number;
}) {
	const visual = getAppVisual(appName, packageName);
	const key = `${appName} ${packageName}`.toLowerCase();
	const hasBrandIcon =
		key.includes("instagram") ||
		key.includes("youtube") ||
		key.includes("reddit") ||
		key.includes("facebook");

	return (
		<View
			className="items-center justify-center rounded-2xl"
			style={{ backgroundColor: visual.bg, width: size, height: size }}
		>
			{hasBrandIcon ? (
				<Ionicons
					name={visual.icon}
					size={Math.round(size * 0.5)}
					color="#FFFFFF"
				/>
			) : (
				<Text className="font-heading-bold text-white">
					{getAppInitials(appName)}
				</Text>
			)}
		</View>
	);
}

function ExpressionBadge({ source, size }: { source: number; size: number }) {
	return (
		<View
			className="items-center justify-center overflow-hidden"
			style={{ width: size, height: size }}
		>
			<Image
				source={source}
				style={{ width: size * 1.22, height: size * 1.22 }}
				resizeMode="contain"
			/>
		</View>
	);
}
