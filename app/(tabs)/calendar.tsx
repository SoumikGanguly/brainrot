import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import React, { useEffect, useRef, useState } from "react";
import {
	Alert,
	AppState,
	AppStateStatus,
	Dimensions,
	Image,
	ImageBackground,
	InteractionManager,
	Modal,
	ScrollView,
	Share,
	Text,
	TouchableOpacity,
	View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Rect, Text as SvgText } from "react-native-svg";

import SkeletonBlock from "@/components/SkeletonBlock";
import { CalendarPeriodInsightService } from "@/services/CalendarPeriodInsightService";
import { Card } from "../../components/Card";
import { Header } from "../../components/Header";
import { database } from "../../services/database";

import { CapabilitiesService } from "@/services/CapabilitiesService";
import {
	type ReplayEntry,
} from "@/services/DailyInsightsService";
import {
	HistoryRefreshCoordinator,
	type HistoryRefreshEvent,
} from "@/services/HistoryRefreshCoordinator";
import { InsightActionService } from "@/services/InsightActionService";
import type {
	CalendarPeriodInsight,
	DailyInsightSignals,
} from "@/services/InsightTypes";
import {
	buildCalendarInsightTelemetry,
	withDefinedProperties,
} from "@/services/TelemetryEvents";
import { TelemetryService } from "@/services/TelemetryService";
import {
	ManufacturerPermissionInfo,
	UnifiedUsageService,
} from "@/services/UnifiedUsageService";
import { ReplayLoaderService } from "@/services/ReplayLoaderService";
import {
	calculateBrainScore,
	getScoreColor,
	getScoreLabel,
} from "../../utils/brainScore";
import { formatTime } from "../../utils/time";

interface DailyData {
	date: string;
	totalScreenTime: number;
	brainScore: number;
	brainHealthStatus?: string;
	totalMonitoredOpens?: number;
	insightSignals?: DailyInsightSignals;
	apps: {
		packageName: string;
		appName: string;
		totalTimeMs: number;
	}[];
}

interface DayDetailData extends DailyData {
	totalMonitoredOpens: number;
	replayEntries: ReplayEntry[];
	biggestTimeLeak: {
		packageName: string;
		appName: string;
		totalTimeMs: number;
		percentage: number;
	} | null;
}

interface HeatmapDay {
	date: string;
	score: number;
	screenTime: number;
	isToday: boolean;
	hasData: boolean;
	dayOfMonth: number;
}

interface MonthSummaryMetric {
	currentValue: number;
	previousValue: number;
	delta: number;
}

interface PeriodSummary {
	avgScore: MonthSummaryMetric;
	avgDailyMs: MonthSummaryMetric;
	focusDays: MonthSummaryMetric;
}

interface MonthlyAppStat {
	packageName: string;
	appName: string;
	totalTimeMs: number;
	previousTotalTimeMs: number;
	deltaPercent: number;
}

interface TimeReclaimedSummary {
	currentTotalMs: number;
	previousTotalMs: number;
	reclaimedMs: number;
}

const { width: screenWidth } = Dimensions.get("window");
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
function formatLocalDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function parseLocalDate(dateStr: string): Date {
	const [year, month, day] = dateStr.split("-").map(Number);
	return new Date(year, (month || 1) - 1, day || 1);
}

function getAppVisual(
	appName: string,
	packageName: string,
): {
	icon: keyof typeof Ionicons.glyphMap;
	bg: string;
} {
	const key = `${appName} ${packageName}`.toLowerCase();
	if (key.includes("instagram")) {
		return { icon: "logo-instagram", bg: "#EC4899" };
	}
	if (key.includes("youtube")) {
		return { icon: "logo-youtube", bg: "#EF4444" };
	}
	if (key.includes("reddit")) {
		return { icon: "logo-reddit", bg: "#F97316" };
	}
	if (key.includes("facebook")) {
		return { icon: "logo-facebook", bg: "#2563EB" };
	}
	return { icon: "phone-portrait", bg: "#7C3AED" };
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

function escapeCsvValue(value: string | number): string {
	const stringValue = String(value ?? "");
	if (/[",\n]/.test(stringValue)) {
		return `"${stringValue.replace(/"/g, '""')}"`;
	}
	return stringValue;
}

function getMonthToDateWindow(month: Date): {
	year: number;
	month: number;
	dayLimit: number;
} {
	const today = new Date();
	const isCurrentMonth =
		month.getMonth() === today.getMonth() &&
		month.getFullYear() === today.getFullYear();
	const lastDayOfMonth = new Date(
		month.getFullYear(),
		month.getMonth() + 1,
		0,
	).getDate();

	return {
		year: month.getFullYear(),
		month: month.getMonth(),
		dayLimit: isCurrentMonth ? today.getDate() : lastDayOfMonth,
	};
}

function getMonthToDateEntries(data: DailyData[], month: Date): DailyData[] {
	const window = getMonthToDateWindow(month);
	return data.filter((entry) => {
		const entryDate = parseLocalDate(entry.date);
		return (
			entryDate.getFullYear() === window.year &&
			entryDate.getMonth() === window.month &&
			entryDate.getDate() <= window.dayLimit
		);
	});
}

function getSummaryAnchorDate(month: Date): Date {
	const today = new Date();
	const isCurrentMonth =
		month.getMonth() === today.getMonth() &&
		month.getFullYear() === today.getFullYear();

	return isCurrentMonth
		? today
		: new Date(month.getFullYear(), month.getMonth() + 1, 0);
}

function getStartOfWeek(date: Date): Date {
	const start = new Date(date);
	const day = start.getDay();
	const diff = day === 0 ? -6 : 1 - day;
	start.setHours(0, 0, 0, 0);
	start.setDate(start.getDate() + diff);
	return start;
}

function getEntriesBetweenDates(
	data: DailyData[],
	startDate: Date,
	endDate: Date,
): DailyData[] {
	const startMs = new Date(startDate).setHours(0, 0, 0, 0);
	const endMs = new Date(endDate).setHours(23, 59, 59, 999);
	return data.filter((entry) => {
		const entryMs = parseLocalDate(entry.date).getTime();
		return entryMs >= startMs && entryMs <= endMs;
	});
}

function buildSummaryFromBuckets(
	currentEntries: DailyData[],
	previousEntries: DailyData[],
): PeriodSummary {
	const currentAvgScore = Math.round(
		currentEntries.reduce((sum, entry) => sum + entry.brainScore, 0) /
			Math.max(1, currentEntries.length),
	);
	const previousAvgScore = Math.round(
		previousEntries.reduce((sum, entry) => sum + entry.brainScore, 0) /
			Math.max(1, previousEntries.length),
	);

	const currentAvgDailyMs = Math.round(
		currentEntries.reduce((sum, entry) => sum + entry.totalScreenTime, 0) /
			Math.max(1, currentEntries.length),
	);
	const previousAvgDailyMs = Math.round(
		previousEntries.reduce((sum, entry) => sum + entry.totalScreenTime, 0) /
			Math.max(1, previousEntries.length),
	);

	const currentFocusDays = currentEntries.filter(
		(entry) => entry.brainScore >= 80,
	).length;
	const previousFocusDays = previousEntries.filter(
		(entry) => entry.brainScore >= 80,
	).length;

	return {
		avgScore: {
			currentValue: currentAvgScore,
			previousValue: previousAvgScore,
			delta: currentAvgScore - previousAvgScore,
		},
		avgDailyMs: {
			currentValue: currentAvgDailyMs,
			previousValue: previousAvgDailyMs,
			delta: currentAvgDailyMs - previousAvgDailyMs,
		},
		focusDays: {
			currentValue: currentFocusDays,
			previousValue: previousFocusDays,
			delta: currentFocusDays - previousFocusDays,
		},
	};
}

function buildMonthSummary(data: DailyData[], month: Date): PeriodSummary {
	const previousMonthDate = new Date(
		month.getFullYear(),
		month.getMonth() - 1,
		1,
	);
	const currentMonthData = getMonthToDateEntries(data, month);
	const previousMonthData = getMonthToDateEntries(data, previousMonthDate);

	return buildSummaryFromBuckets(currentMonthData, previousMonthData);
}

function buildWeekSummary(data: DailyData[], month: Date): PeriodSummary {
	const anchorDate = getSummaryAnchorDate(month);
	const currentWeekStart = getStartOfWeek(anchorDate);
	const elapsedDays =
		Math.floor(
			(anchorDate.getTime() - currentWeekStart.getTime()) /
				(24 * 60 * 60 * 1000),
		) + 1;
	const previousWeekStart = new Date(currentWeekStart);
	previousWeekStart.setDate(previousWeekStart.getDate() - 7);
	const previousWeekEnd = new Date(previousWeekStart);
	previousWeekEnd.setDate(previousWeekEnd.getDate() + elapsedDays - 1);

	const currentWeekData = getEntriesBetweenDates(
		data,
		currentWeekStart,
		anchorDate,
	);
	const previousWeekData = getEntriesBetweenDates(
		data,
		previousWeekStart,
		previousWeekEnd,
	);

	return buildSummaryFromBuckets(currentWeekData, previousWeekData);
}

function buildTimeReclaimedSummary(
	data: DailyData[],
	month: Date,
): TimeReclaimedSummary {
	const previousMonthDate = new Date(
		month.getFullYear(),
		month.getMonth() - 1,
		1,
	);
	const currentTotalMs = getMonthToDateEntries(data, month).reduce(
		(sum, entry) => sum + entry.totalScreenTime,
		0,
	);
	const previousTotalMs = getMonthToDateEntries(data, previousMonthDate).reduce(
		(sum, entry) => sum + entry.totalScreenTime,
		0,
	);

	return {
		currentTotalMs,
		previousTotalMs,
		reclaimedMs: previousTotalMs - currentTotalMs,
	};
}

function buildMonthlyAppStats(
	data: DailyData[],
	month: Date,
	monitoredPackages: string[],
): MonthlyAppStat[] {
	const previousMonthDate = new Date(
		month.getFullYear(),
		month.getMonth() - 1,
		1,
	);
	const monitoredSet = new Set(monitoredPackages);
	const currentTotals = new Map<
		string,
		{ appName: string; totalTimeMs: number }
	>();
	const previousTotals = new Map<string, number>();

	const accumulate = (
		entries: DailyData[],
		target: Map<string, { appName: string; totalTimeMs: number }>,
	) => {
		for (const entry of entries) {
			for (const app of entry.apps) {
				if (!monitoredSet.has(app.packageName)) {
					continue;
				}

				const existing = target.get(app.packageName);
				target.set(app.packageName, {
					appName: app.appName,
					totalTimeMs: (existing?.totalTimeMs || 0) + app.totalTimeMs,
				});
			}
		}
	};

	accumulate(getMonthToDateEntries(data, month), currentTotals);

	for (const entry of getMonthToDateEntries(data, previousMonthDate)) {
		for (const app of entry.apps) {
			if (!monitoredSet.has(app.packageName)) {
				continue;
			}
			previousTotals.set(
				app.packageName,
				(previousTotals.get(app.packageName) || 0) + app.totalTimeMs,
			);
		}
	}

	return Array.from(currentTotals.entries())
		.map(([packageName, value]) => {
			const previousTotalTimeMs = previousTotals.get(packageName) || 0;
			const deltaPercent =
				previousTotalTimeMs > 0
					? Math.round(
							((value.totalTimeMs - previousTotalTimeMs) /
								previousTotalTimeMs) *
								100,
						)
					: 0;

			return {
				packageName,
				appName: value.appName,
				totalTimeMs: value.totalTimeMs,
				previousTotalTimeMs,
				deltaPercent,
			};
		})
		.sort((a, b) => b.totalTimeMs - a.totalTimeMs);
}

function buildDayDetailPlaceholder(
	date: string,
	cachedDay?: DailyData,
): DayDetailData {
	const topApp = cachedDay?.apps[0];

	return {
		date,
		totalScreenTime: cachedDay?.totalScreenTime ?? 0,
		brainScore: cachedDay?.brainScore ?? 0,
		brainHealthStatus: cachedDay?.brainHealthStatus,
		apps: cachedDay?.apps ?? [],
		totalMonitoredOpens: cachedDay?.totalMonitoredOpens ?? 0,
		replayEntries: [],
		biggestTimeLeak: topApp
			? {
					packageName: topApp.packageName,
					appName: topApp.appName,
					totalTimeMs: topApp.totalTimeMs,
					percentage:
						(cachedDay?.totalScreenTime ?? 0) > 0
							? Math.round((topApp.totalTimeMs / cachedDay!.totalScreenTime) * 100)
							: 0,
				}
			: null,
	};
}

export default function Calendar() {
	const router = useRouter();
	const [historicalData, setHistoricalData] = useState<DailyData[]>([]);
	const [selectedDay, setSelectedDay] = useState<DayDetailData | null>(null);
	const [periodInsightDeck, setPeriodInsightDeck] = useState<CalendarPeriodInsight[]>(
		[],
	);
	const [periodInsightIndex, setPeriodInsightIndex] = useState(0);
	const [showModal, setShowModal] = useState(false);
	const [showAppsSheet, setShowAppsSheet] = useState(false);
	const [selectedDayLoading, setSelectedDayLoading] = useState(false);
	const [loading, setLoading] = useState(true);
	const [currentMonth, setCurrentMonth] = useState(new Date());
	const [statsView, setStatsView] = useState<"week" | "month">("week");
	const [statsCardWidth, setStatsCardWidth] = useState(0);
	const [hasUsagePermission, setHasUsagePermission] = useState<boolean | null>(
		null,
	);
	const [monitoredPackages, setMonitoredPackages] = useState<string[]>([]);
	const [protectionModes, setProtectionModes] = useState<Map<string, string>>(
		new Map(),
	);
	const [manufacturerInfo, setManufacturerInfo] =
		useState<ManufacturerPermissionInfo | null>(null);
	const [isRefreshingHistory, setIsRefreshingHistory] = useState(false);
	const [insightFeedback, setInsightFeedback] = useState<"up" | "down" | null>(
		null,
	);
	const pendingPermissionCheck = useRef(false);
	const appStateRef = useRef<AppStateStatus>(AppState.currentState);
	const selectedDayRequestRef = useRef(0);
	const coordinator = HistoryRefreshCoordinator.getInstance();
	const statsPageWidth = Math.max(statsCardWidth - 32, 1);
	const statsPagerRef = useRef<ScrollView | null>(null);
	const trackedInsightViewRef = useRef<string | null>(null);
	const selectedPeriodInsight = periodInsightDeck[periodInsightIndex] || null;

	function mapHistoricalEntry(
		entry: Awaited<ReturnType<typeof database.getHistoricalData>>[number],
	): DailyData {
		return {
			date: entry.date,
			totalScreenTime: entry.totalScreenTime,
			brainScore: entry.focusScore ?? entry.brainScore,
			brainHealthStatus: entry.brainHealthStatus,
			totalMonitoredOpens: entry.totalMonitoredOpens,
			insightSignals: entry.insightSignals,
			apps: entry.apps.map((app) => ({
				packageName: app.packageName,
				appName: app.appName,
				totalTimeMs: app.totalTimeMs,
			})),
		};
	}

	function getPriorityDatesForMonth(month: Date): string[] {
		const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
		const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0);
		const dates: string[] = [];
		const cursor = new Date(firstDay);
		cursor.setDate(cursor.getDate() - 7);
		const end = new Date(lastDay);
		end.setDate(end.getDate() + 7);

		while (cursor <= end) {
			dates.push(formatLocalDate(cursor));
			cursor.setDate(cursor.getDate() + 1);
		}

		return dates;
	}

	async function queueHistoricalRefresh(
		source: string,
		month: Date = currentMonth,
	) {
		void coordinator.requestRefresh({
			source,
			days: 90,
			prioritizeDates: getPriorityDatesForMonth(month),
			syncToday: true,
		});
	}

	async function checkPermissionAndLoadData() {
		try {
			// Check if native module is available and permission is granted
			if (UnifiedUsageService.isNativeModuleAvailable()) {
				const hasPermission = await UnifiedUsageService.isUsageAccessGranted();
				setHasUsagePermission(hasPermission);
			}
		} catch (error) {
			console.error("Error checking permission:", error);
		}

		void loadHistoricalData();
	}

	async function loadHistoricalData(
		options: { showLoader?: boolean; scheduleRefresh?: boolean } = {},
	) {
		const { showLoader = true, scheduleRefresh = true } = options;

		try {
			if (showLoader) {
				setLoading(true);
			}

			const [summaries, monitored, appSettings] = await Promise.all([
				database.getHistoricalData(90),
				database.getMonitoredPackages(),
				database.getAppSettings(),
			]);

			setMonitoredPackages(monitored);
			setHistoricalData(summaries.map(mapHistoricalEntry));
			setProtectionModes(
				new Map(
					appSettings.map((setting) => [
						setting.packageName,
						setting.protectionMode || "monitor",
					]),
				),
			);
		} catch (error) {
			console.error("Error loading historical data:", error);
			if (showLoader) {
				setHistoricalData([]);
			}
		} finally {
			if (showLoader) {
				setLoading(false);
			}
		}

		if (scheduleRefresh) {
			InteractionManager.runAfterInteractions(() => {
				void queueHistoricalRefresh("calendar_initial_load", currentMonth);
			});
		}
	}

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

		void Promise.resolve().then(() => {
			void checkPermissionAndLoadData();
			void loadManufacturerInfo();
		});

		const unsubscribeCoordinator = coordinator.subscribe(
			(event: HistoryRefreshEvent) => {
				if (event.type === "started") {
					setIsRefreshingHistory(true);
					return;
				}

				setIsRefreshingHistory(false);
				void loadHistoricalData({ showLoader: false, scheduleRefresh: false });
			},
		);

		// Handle app state changes for permission refresh
		const handleAppStateChange = async (nextAppState: AppStateStatus) => {
			if (
				appStateRef.current.match(/inactive|background/) &&
				nextAppState === "active"
			) {
				// Check if we were waiting for permission after opening settings
				if (pendingPermissionCheck.current) {
					pendingPermissionCheck.current = false;
					console.log(
						"Calendar: Checking permission after returning from settings...",
					);

					setTimeout(async () => {
						try {
							const hasPermission =
								await UnifiedUsageService.isUsageAccessGranted();
							setHasUsagePermission(hasPermission);

							if (hasPermission) {
								void loadHistoricalData();
							}
						} catch (error) {
							console.error("Error checking permission after settings:", error);
						}
					}, 500);
				}
			}

			appStateRef.current = nextAppState;
		};

		const subscription = AppState.addEventListener(
			"change",
			handleAppStateChange,
		);

		return () => {
			unsubscribeCoordinator();
			subscription.remove();
		};
	}, [coordinator]);

	useEffect(() => {
		if (!loading) {
			void queueHistoricalRefresh("calendar_month_changed", currentMonth);
		}
	}, [currentMonth, loading]);

	useEffect(() => {
		if (!statsCardWidth || !statsPagerRef.current) {
			return;
		}

		statsPagerRef.current.scrollTo({
			x: statsView === "week" ? 0 : statsPageWidth,
			animated: true,
		});
	}, [statsCardWidth, statsPageWidth, statsView]);

	const syncStatsView = (
		nextView: "week" | "month",
		options: { animated?: boolean } = {},
	) => {
		const { animated = false } = options;
		setStatsView(nextView);

		if (!statsCardWidth || !statsPagerRef.current) {
			return;
		}

		statsPagerRef.current.scrollTo({
			x: nextView === "week" ? 0 : statsPageWidth,
			animated,
		});
	};

	const closeDayDetail = () => {
		selectedDayRequestRef.current += 1;
		setSelectedDayLoading(false);
		setShowModal(false);
	};

	const openDayDetail = async (dateStr: string) => {
		const requestId = selectedDayRequestRef.current + 1;
		selectedDayRequestRef.current = requestId;
		const cachedDay = historicalData.find((entry) => entry.date === dateStr);
		const placeholder = buildDayDetailPlaceholder(dateStr, cachedDay);

		setSelectedDay(placeholder);
		setSelectedDayLoading(true);
		setShowModal(true);

		try {
			const replayDay = await ReplayLoaderService.loadDay(dateStr, {
				selectedMoment: undefined,
			});
			if (selectedDayRequestRef.current !== requestId) {
				return;
			}
			const summary = replayDay.summary;

			setSelectedDay({
				date: dateStr,
				totalScreenTime: summary?.totalScreenTime ?? 0,
				brainScore: summary?.focusScore ?? summary?.brainScore ?? 0,
				brainHealthStatus: summary?.brainHealthStatus,
				apps: summary?.apps ?? [],
				totalMonitoredOpens:
					summary?.totalMonitoredOpens ?? replayDay.replayEntries.length,
				replayEntries: replayDay.replayEntries,
				biggestTimeLeak: replayDay.biggestTimeLeak,
			} as DayDetailData);
		} catch (error) {
			if (selectedDayRequestRef.current !== requestId) {
				return;
			}
			console.error("Error loading day detail:", error);
			if (!cachedDay) {
				setShowModal(false);
			}
			Alert.alert("Error", "Could not load day details. Please try again.");
		} finally {
			if (selectedDayRequestRef.current === requestId) {
				setSelectedDayLoading(false);
			}
		}
	};

	const getPeriodEntries = (periodType: "week" | "month") => {
		if (periodType === "month") {
			const previousMonthDate = new Date(
				currentMonth.getFullYear(),
				currentMonth.getMonth() - 1,
				1,
			);
			return {
				currentEntries: getMonthToDateEntries(historicalData, currentMonth),
				previousEntries: getMonthToDateEntries(historicalData, previousMonthDate),
			};
		}

		const anchorDate = getSummaryAnchorDate(currentMonth);
		const currentWeekStart = getStartOfWeek(anchorDate);
		const elapsedDays =
			Math.floor(
				(anchorDate.getTime() - currentWeekStart.getTime()) /
					(24 * 60 * 60 * 1000),
			) + 1;
		const previousWeekStart = new Date(currentWeekStart);
		previousWeekStart.setDate(previousWeekStart.getDate() - 7);
		const previousWeekEnd = new Date(previousWeekStart);
		previousWeekEnd.setDate(previousWeekEnd.getDate() + elapsedDays - 1);

		return {
			currentEntries: getEntriesBetweenDates(
				historicalData,
				currentWeekStart,
				anchorDate,
			),
			previousEntries: getEntriesBetweenDates(
				historicalData,
				previousWeekStart,
				previousWeekEnd,
			),
		};
	};

	const openPeriodInsight = (periodType: "week" | "month") => {
		const { currentEntries } = getPeriodEntries(periodType);
		const insight = CalendarPeriodInsightService.build({
			periodType,
			entries: currentEntries,
			protectionModes,
		});

		if (!insight) {
			Alert.alert(
				"No insight yet",
				"Not enough distraction data has been recorded for this period yet.",
			);
			return;
		}

		trackedInsightViewRef.current = null;
		setInsightFeedback(null);
		setPeriodInsightDeck([insight]);
		setPeriodInsightIndex(0);
		TelemetryService.track(
			"insight_generated",
			withDefinedProperties(buildCalendarInsightTelemetry(insight)),
		);
	};

	const openAllPeriodInsightsPreview = () => {
		const { currentEntries } = getPeriodEntries(statsView);
		const insights = CalendarPeriodInsightService.buildAllPreview({
			periodType: statsView,
			entries: currentEntries,
			protectionModes,
		});

		if (!insights.length) {
			Alert.alert(
				"No preview data",
				"There isn't enough period data yet to preview all insight variants.",
			);
			return;
		}

		trackedInsightViewRef.current = null;
		setInsightFeedback(null);
		setPeriodInsightDeck(insights);
		setPeriodInsightIndex(0);
		for (const insight of insights) {
			TelemetryService.track(
				"insight_generated",
				withDefinedProperties(buildCalendarInsightTelemetry(insight)),
			);
		}
	};

	const closePeriodInsight = () => {
		if (selectedPeriodInsight) {
			TelemetryService.track(
				"insight_dismissed",
				withDefinedProperties(buildCalendarInsightTelemetry(selectedPeriodInsight)),
			);
		}
		trackedInsightViewRef.current = null;
		setPeriodInsightDeck([]);
		setPeriodInsightIndex(0);
		setInsightFeedback(null);
	};

	const handlePeriodInsightAction = async () => {
		if (!selectedPeriodInsight) {
			return;
		}

		const telemetry = withDefinedProperties(
			buildCalendarInsightTelemetry(selectedPeriodInsight),
		);
		TelemetryService.track("insight_card_tapped", telemetry);
		TelemetryService.track("insight_cta_clicked", telemetry);
		await InsightActionService.execute(
			selectedPeriodInsight.action,
			router,
			"insight_cta",
		);
		closePeriodInsight();
	};

	useEffect(() => {
		if (!selectedPeriodInsight) {
			return;
		}

		if (trackedInsightViewRef.current === selectedPeriodInsight.id) {
			return;
		}

		trackedInsightViewRef.current = selectedPeriodInsight.id;
		TelemetryService.track(
			"insight_card_viewed",
			withDefinedProperties(buildCalendarInsightTelemetry(selectedPeriodInsight)),
		);
	}, [selectedPeriodInsight]);

	const generateHeatmapData = (): HeatmapDay[][] => {
		const weeks = [];
		const firstDayOfMonth = new Date(
			currentMonth.getFullYear(),
			currentMonth.getMonth(),
			1,
		);
		const lastDayOfMonth = new Date(
			currentMonth.getFullYear(),
			currentMonth.getMonth() + 1,
			0,
		);
		const startDate = new Date(firstDayOfMonth);

		// Go back to the Sunday of the week containing the first day
		startDate.setDate(startDate.getDate() - startDate.getDay());

		const today = new Date();
		let currentDate = new Date(startDate);

		while (currentDate <= lastDayOfMonth || currentDate.getDay() !== 0) {
			const week: HeatmapDay[] = [];

			for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
				const dateStr = formatLocalDate(currentDate);
				const dayData = historicalData.find((d) => d.date === dateStr);
				const isCurrentMonth =
					currentDate.getMonth() === currentMonth.getMonth();

				week.push({
					date: dateStr,
					score: dayData?.brainScore ?? (isCurrentMonth ? 100 : 0),
					screenTime: dayData?.totalScreenTime ?? 0,
					isToday: dateStr === formatLocalDate(today),
					hasData: !!dayData,
					dayOfMonth: currentDate.getDate(),
				});

				currentDate.setDate(currentDate.getDate() + 1);
			}

			weeks.push(week);

			if (currentDate > lastDayOfMonth && currentDate.getDay() === 0) break;
		}

		return weeks;
	};

	const exportData = async () => {
		try {
			// Ensure we have up-to-date historical data
			const data = await database.getHistoricalData(365); // e.g. 1 year

			// Generate CSV data
			const csvRows = [
				"Date,Total Screen Time (minutes),Brain Score,Top App,Usage (minutes)",
			];

			for (const day of data.sort(
				(a, b) =>
					parseLocalDate(a.date).getTime() - parseLocalDate(b.date).getTime(),
			)) {
				let total = day.totalScreenTime ?? 0;
				let score = day.brainScore ?? calculateBrainScore(total);
				let topAppName = "N/A";
				let topAppUsage = 0;

				if (day.apps && day.apps.length > 0) {
					const top = day.apps[0];
					topAppName = top.appName || top.packageName || "N/A";
					topAppUsage = Math.round((top.totalTimeMs || 0) / (1000 * 60));
				} else {
					// Fallback to raw usage
					const raw = await database.getDailyUsage(day.date);
					const rawTotal = raw.reduce(
						(s: number, a: any) => s + (a.totalTimeMs || 0),
						0,
					);
					total = total || rawTotal;
					score = score ?? calculateBrainScore(rawTotal);
				}

				const screenTimeMinutes = Math.round(total / (1000 * 60));
				csvRows.push(
					[
						escapeCsvValue(day.date),
						escapeCsvValue(screenTimeMinutes),
						escapeCsvValue(score),
						escapeCsvValue(topAppName),
						escapeCsvValue(topAppUsage),
					].join(","),
				);
			}

			const directoryUri =
				FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
			if (!directoryUri) {
				throw new Error("No writable directory available for CSV export");
			}

			const fileUri = `${directoryUri}brainrot-usage-export-${formatLocalDate(new Date())}.csv`;
			await FileSystem.writeAsStringAsync(fileUri, csvRows.join("\n"), {
				encoding: FileSystem.EncodingType.UTF8,
			});

			if (await Sharing.isAvailableAsync()) {
				await Sharing.shareAsync(fileUri, {
					dialogTitle: "Export Brainrot Usage Data",
					mimeType: "text/csv",
					UTI: "public.comma-separated-values-text",
				});
				return;
			}

			await Share.share({
				message: `Brainrot usage export: ${fileUri}`,
				url: fileUri,
				title: "Brainrot Usage Data Export",
			});
		} catch (error) {
			console.error("Error exporting data:", error);
			Alert.alert(
				"Export Failed",
				"Could not export your data. Please try again.",
			);
		}
	};

	const navigateMonth = (direction: "prev" | "next") => {
		setCurrentMonth((prev) => {
			const newDate = new Date(prev);
			newDate.setMonth(prev.getMonth() + (direction === "next" ? 1 : -1));
			return newDate;
		});
	};

	const renderHeatmapView = () => {
		const heatmapWeeks = generateHeatmapData();
		const cellSize = Math.min(42, (screenWidth - 80) / 7);
		const heatmapWidth = cellSize * 7;
		const heatmapHeight = cellSize * heatmapWeeks.length;
		const weekSummary = buildWeekSummary(historicalData, currentMonth);
		const monthSummary = buildMonthSummary(historicalData, currentMonth);
		const timeReclaimedSummary = buildTimeReclaimedSummary(
			historicalData,
			currentMonth,
		);
		const monthlyAppStats = buildMonthlyAppStats(
			historicalData,
			currentMonth,
			monitoredPackages,
		);
		const topDistractions = monthlyAppStats.slice(0, 3);
		return (
			<>
				{/* Month Navigation */}
				<Card className="mx-md mb-md">
					<View className="flex-row items-center justify-between mb-sm">
						<Text className="font-heading-bold text-section text-text">
							Brain Health Heatmap
						</Text>
						<TouchableOpacity
							onPress={() => void exportData()}
							className="h-10 w-10 items-center justify-center rounded-full bg-surface border border-gray-200"
							accessibilityLabel="Export CSV"
						>
							<Ionicons name="download-outline" size={18} color="#5B4CF0" />
						</TouchableOpacity>
					</View>

					<View className="mb-md flex-row items-center justify-between">
						<TouchableOpacity
							onPress={() => navigateMonth("prev")}
							className="p-sm"
							activeOpacity={1}
						>
							<Ionicons name="chevron-back" size={22} color="#5B4CF0" />
						</TouchableOpacity>

						<Text className="font-body-semibold text-secondary text-muted">
							{currentMonth.toLocaleDateString("en-US", {
								month: "long",
								year: "numeric",
							})}
						</Text>

						<TouchableOpacity
							onPress={() => navigateMonth("next")}
							className="p-sm"
							disabled={
								currentMonth >=
								new Date(new Date().getFullYear(), new Date().getMonth(), 1)
							}
							activeOpacity={1}
						>
							<Ionicons
								name="chevron-forward"
								size={22}
								color={
									currentMonth >=
									new Date(new Date().getFullYear(), new Date().getMonth(), 1)
										? "#9CA3AF"
										: "#5B4CF0"
								}
							/>
						</TouchableOpacity>
					</View>

					{/* Day labels */}
					<View className="flex-row justify-center mb-sm">
						{["S", "M", "T", "W", "T", "F", "S"].map((day, i) => (
							<View
								key={i}
								style={{ width: cellSize }}
								className="items-center"
							>
								<Text className="font-body-semibold text-secondary text-muted">
									{day}
								</Text>
							</View>
						))}
					</View>

					{/* Heatmap grid */}
					<View className="items-center">
						<Svg height={heatmapHeight + 20} width={heatmapWidth}>
							{heatmapWeeks.map((week, weekIndex) =>
								week.map((day, dayIndex) => {
									const x = dayIndex * cellSize;
									const y = weekIndex * cellSize;
									const isCurrentMonth =
										parseLocalDate(day.date).getMonth() ===
										currentMonth.getMonth();

									return (
										<React.Fragment key={`${weekIndex}-${dayIndex}`}>
											<Rect
												x={x + 2}
												y={y + 2}
												width={cellSize - 4}
												height={cellSize - 4}
												rx={4}
												fill={
													!isCurrentMonth
														? "#F3F4F6"
														: day.hasData
															? getScoreColor(day.score)
															: "#E5E7EB"
												}
												opacity={day.isToday ? 1 : isCurrentMonth ? 0.9 : 0.3}
												stroke={day.isToday ? "#5B4CF0" : "transparent"}
												strokeWidth={day.isToday ? 2 : 0}
												onPress={() =>
													isCurrentMonth &&
													day.hasData &&
													openDayDetail(day.date)
												}
											/>
											{isCurrentMonth && (
												<SvgText
													x={x + cellSize / 2}
													y={y + cellSize / 2 + 4}
													fontSize={10}
													fill={
														day.hasData && day.score < 50
															? "#FFFFFF"
															: "#0F172A"
													}
													textAnchor="middle"
													fontWeight="500"
												>
													{day.dayOfMonth}
												</SvgText>
											)}
										</React.Fragment>
									);
								}),
							)}
						</Svg>
					</View>

					{/* Legend */}
					<View className="items-center mt-md pt-md border-t border-gray-200">
						<View className="flex-row items-center justify-between w-full max-w-xs">
							<Text className="font-body text-secondary text-muted">
								Less healthy
							</Text>
							<View className="mx-sm flex-1 flex-row items-center justify-center">
								<View
									className="w-3 h-3 rounded"
									style={{ backgroundColor: getScoreColor(10) }}
								/>
								<View className="w-2" />
								<View
									className="w-3 h-3 rounded"
									style={{ backgroundColor: getScoreColor(30) }}
								/>
								<View className="w-2" />
								<View
									className="w-3 h-3 rounded"
									style={{ backgroundColor: getScoreColor(50) }}
								/>
								<View className="w-2" />
								<View
									className="w-3 h-3 rounded"
									style={{ backgroundColor: getScoreColor(70) }}
								/>
								<View className="w-2" />
								<View
									className="w-3 h-3 rounded"
									style={{ backgroundColor: getScoreColor(90) }}
								/>
							</View>
							<Text className="font-body text-secondary text-muted">
								More healthy
							</Text>
						</View>
						<Text className="mt-xs font-body text-secondary text-muted">
							Tap a day to see details
						</Text>
					</View>
				</Card>

				{/* Quick Stats */}
				<Card
					className="mx-md mb-md"
					onLayout={(event) => {
						const width = event.nativeEvent.layout.width;
						if (width && width !== statsCardWidth) {
							setStatsCardWidth(width);
						}
					}}
				>
					<View className="mb-md flex-row rounded-full bg-slate-100 p-1">
						<View
							className={`flex-1 rounded-full px-4 py-3 ${statsView === "week" ? "bg-white" : ""}`}
						>
							<Text
								className={`text-center font-heading-semibold ${statsView === "week" ? "text-accent" : "text-slate-500"}`}
							>
								This Week
							</Text>
						</View>
						<View
							className={`flex-1 rounded-full px-4 py-3 ${statsView === "month" ? "bg-white" : ""}`}
						>
							<Text
								className={`text-center font-heading-semibold ${statsView === "month" ? "text-accent" : "text-slate-500"}`}
							>
								This Month
							</Text>
						</View>
					</View>
					<ScrollView
						ref={statsPagerRef}
						horizontal
						pagingEnabled
						showsHorizontalScrollIndicator={false}
						scrollEventThrottle={16}
						decelerationRate="fast"
						bounces={false}
						overScrollMode="never"
						onMomentumScrollEnd={(event) => {
							if (!statsCardWidth) {
								return;
							}

							const nextView =
								event.nativeEvent.contentOffset.x >= statsPageWidth / 2
									? "month"
									: "week";
							if (nextView !== statsView) {
								syncStatsView(nextView);
							}
						}}
					>
						{([
							{
								key: "week",
								summary: weekSummary,
								hint: "Swipe left for monthly view",
							},
							{
								key: "month",
								summary: monthSummary,
								hint: "Swipe right for weekly view",
							},
						] as const).map((item) => (
							<TouchableOpacity
								key={item.key}
								style={{ width: statsPageWidth }}
								className="px-2"
								activeOpacity={0.96}
								disabled={item.key !== statsView}
								onPress={() => openPeriodInsight(item.key)}
							>
								<View className="flex-row justify-between">
									<View className="items-center flex-1">
										<Text className="text-2xl font-bold text-accent">
											{item.summary.avgScore.currentValue}
										</Text>
										<MonthDelta
											delta={item.summary.avgScore.delta}
											isPositiveBetter={true}
											formatter={(value) => `${Math.abs(value)}`}
										/>
										<Text className="font-body text-secondary text-muted">
											Avg Score
										</Text>
									</View>
									<View className="items-center flex-1">
										<Text className="text-2xl font-bold text-danger">
											{formatTime(item.summary.avgDailyMs.currentValue)}
										</Text>
										<MonthDelta
											delta={item.summary.avgDailyMs.delta}
											isPositiveBetter={false}
											formatter={(value) => formatTime(Math.abs(value))}
										/>
										<Text className="font-body text-secondary text-muted">
											Avg Daily
										</Text>
									</View>
									<View className="items-center flex-1">
										<Text className="text-2xl font-bold text-text">
											{item.summary.focusDays.currentValue}
										</Text>
										<MonthDelta
											delta={item.summary.focusDays.delta}
											isPositiveBetter={true}
											formatter={(value) => `${Math.abs(value)}`}
										/>
										<Text className="font-body text-secondary text-muted">
											Focus Days
										</Text>
									</View>
								</View>
								<Text className="mt-md text-center font-body text-secondary text-muted">
									{item.hint}
								</Text>
							</TouchableOpacity>
						))}
					</ScrollView>
				</Card>

				{__DEV__ ? (
					<View className="mx-md mb-md">
						<TouchableOpacity
							onPress={openAllPeriodInsightsPreview}
							className="self-start rounded-full border border-dashed border-violet-300 bg-violet-50 px-4 py-2"
						>
							<Text className="font-heading-semibold text-secondary text-accent">
								Preview All Insights
							</Text>
						</TouchableOpacity>
					</View>
				) : null}

				<Card className="mx-md mb-md">
					<View className="flex-row items-start justify-between">
						<View className="flex-1 pr-md">
							<Text className="font-heading-bold text-section text-text">
								Time Reclaimed
							</Text>
							<Text className="mt-sm text-3xl font-bold text-emerald-600">
								{formatTime(Math.abs(timeReclaimedSummary.reclaimedMs))}
							</Text>
							<MonthDelta
								delta={timeReclaimedSummary.reclaimedMs}
								isPositiveBetter={true}
								formatter={(value) =>
									`${formatTime(Math.abs(value))} from last month`
								}
							/>
						</View>
						<View className="flex-row items-end self-stretch">
							{[0.75, 1.3, 0.55, 1.6, 0.8].map((scale, index) => (
								<View
									key={index}
									className="ml-2 w-3 rounded-full bg-emerald-300"
									style={{
										height: 22 + scale * 26,
										opacity: 0.45 + index * 0.08,
									}}
								/>
							))}
						</View>
					</View>
				</Card>

				<Card className="mx-md mb-md">
					<View className="mb-md flex-row items-center justify-between">
						<Text className="font-heading-bold text-section text-text">
							Top Distractions
						</Text>
						<TouchableOpacity onPress={() => setShowAppsSheet(true)}>
							<Text className="font-body-semibold text-secondary text-accent">
								View All
							</Text>
						</TouchableOpacity>
					</View>

					{topDistractions.length === 0 ? (
						<Text className="font-body text-body text-muted">
							No distracting app usage recorded for this month yet.
						</Text>
					) : (
						topDistractions.map((app, index) => {
							const topTime = topDistractions[0]?.totalTimeMs || 1;
							const barWidth =
								`${Math.max(14, (app.totalTimeMs / topTime) * 100)}%` as const;
							const improved = app.deltaPercent <= 0;
							const hasDelta = app.previousTotalTimeMs > 0;

							return (
								<View
									key={app.packageName}
									className="py-sm border-b border-gray-100 last:border-b-0"
								>
									<View className="flex-row items-center justify-between">
										<View className="mr-sm flex-1 flex-row items-center">
											<View className="mr-sm h-6 w-6 items-center justify-center rounded-full bg-slate-100">
												<Text className="font-heading-bold text-secondary text-muted">
													{index + 1}
												</Text>
											</View>
											<View className="flex-1">
												<Text className="font-heading-semibold text-card-title text-text">
													{app.appName}
												</Text>
												<View className="mt-2 h-1.5 rounded-full bg-gray-200">
													<View
														className="h-full rounded-full bg-accent"
														style={{ width: barWidth }}
													/>
												</View>
											</View>
										</View>
										<View className="items-end">
											<Text className="font-heading-semibold text-card-title text-text">
												{formatTime(app.totalTimeMs)}
											</Text>
											{hasDelta ? (
												<View className="mt-1 flex-row items-center">
													<Ionicons
														name={
															app.deltaPercent <= 0 ? "arrow-down" : "arrow-up"
														}
														size={12}
														color={improved ? "#16A34A" : "#DC2626"}
													/>
													<Text
														className="ml-1 font-body-semibold text-secondary"
														style={{ color: improved ? "#16A34A" : "#DC2626" }}
													>
														{Math.abs(app.deltaPercent)}%
													</Text>
												</View>
											) : null}
										</View>
									</View>
								</View>
							);
						})
					)}
				</Card>
			</>
		);
	};

	if (loading) {
		return (
			<SafeAreaView className="flex-1 bg-bg">
				<ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
					<Header title="Progress" />
					<CalendarSkeleton />
				</ScrollView>
			</SafeAreaView>
		);
	}

	return (
		<SafeAreaView className="flex-1 bg-bg">
			<ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
				<Header title="Progress" />

				{isRefreshingHistory && (
					<View className="px-md pb-sm">
						<Text className="font-body text-secondary text-muted">
							Updating your history...
						</Text>
					</View>
				)}

				{/* Permission Warning - Show prominently when not granted */}
				{hasUsagePermission === false && (
					<Card className="mx-md mb-md bg-yellow-50 border border-yellow-200">
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
									Grant usage access permission to see your historical screen
									time data.
								</Text>
								<TouchableOpacity
									onPress={async () => {
										try {
											pendingPermissionCheck.current = true;
											await CapabilitiesService.ensureUsageAccess("settings");
										} catch (error) {
											console.error("Failed to open settings:", error);
											pendingPermissionCheck.current = false;
										}
									}}
									className="bg-yellow-600 px-4 py-2 rounded-lg self-start"
								>
									<Text className="font-heading-semibold text-secondary text-white">
										Grant Permission
									</Text>
								</TouchableOpacity>

								{manufacturerInfo?.needsSpecialPermission && (
									<View className="mt-3 p-3 bg-yellow-100 rounded-lg border border-yellow-200">
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
														await CapabilitiesService.openBackgroundReliabilitySettings(
															"settings",
														);
													} catch (oemError) {
														console.warn(
															"Failed to open OEM settings:",
															oemError,
														);
													}
												}}
												className="bg-yellow-700 px-3 py-2 rounded-lg self-start"
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

				{renderHeatmapView()}
			</ScrollView>

			<Modal
				visible={!!selectedPeriodInsight}
				animationType="slide"
				presentationStyle="pageSheet"
				onRequestClose={closePeriodInsight}
			>
				{selectedPeriodInsight ? (
					<CalendarPeriodInsightScreen
						insight={selectedPeriodInsight}
						onClose={closePeriodInsight}
						onAction={() => void handlePeriodInsightAction()}
						feedback={insightFeedback}
						onFeedbackChange={setInsightFeedback}
						currentIndex={periodInsightIndex}
						totalInsights={periodInsightDeck.length}
						onPrevious={
							periodInsightDeck.length > 1
								? () =>
										setPeriodInsightIndex((current) =>
											Math.max(0, current - 1),
										)
								: undefined
						}
						onNext={
							periodInsightDeck.length > 1
								? () =>
										setPeriodInsightIndex((current) =>
											Math.min(periodInsightDeck.length - 1, current + 1),
										)
								: undefined
						}
					/>
				) : null}
			</Modal>

			<Modal
				visible={showAppsSheet}
				transparent
				animationType="slide"
				onRequestClose={() => setShowAppsSheet(false)}
			>
				<View className="flex-1 justify-end bg-black/40">
					<TouchableOpacity
						className="flex-1"
						activeOpacity={1}
						onPress={() => setShowAppsSheet(false)}
					/>
					<View className="max-h-[70%] rounded-t-3xl bg-bg px-md pb-lg pt-md">
						<View className="mb-md flex-row items-center justify-between">
							<View>
								<Text className="font-heading-bold text-section text-text">
									Monthly Distractions
								</Text>
								<Text className="mt-xs font-body text-secondary text-muted">
									Month-to-date totals for all monitored apps
								</Text>
							</View>
							<TouchableOpacity
								onPress={() => setShowAppsSheet(false)}
								className="p-sm"
							>
								<Ionicons name="close" size={22} color="#64748B" />
							</TouchableOpacity>
						</View>

						<ScrollView showsVerticalScrollIndicator={false}>
							{buildMonthlyAppStats(
								historicalData,
								currentMonth,
								monitoredPackages,
							).length === 0 ? (
								<Text className="font-body text-body text-muted">
									No distracting app usage recorded for this month yet.
								</Text>
							) : (
								buildMonthlyAppStats(
									historicalData,
									currentMonth,
									monitoredPackages,
								).map((app, index) => (
									<View
										key={app.packageName}
										className="flex-row items-center justify-between py-sm border-b border-gray-100 last:border-b-0"
									>
										<View className="mr-sm flex-1">
											<Text className="font-heading-semibold text-card-title text-text">
												{index + 1}. {app.appName}
											</Text>
											<Text className="font-body text-secondary text-muted">
												{app.packageName}
											</Text>
										</View>
										<Text className="font-heading-semibold text-card-title text-text">
											{formatTime(app.totalTimeMs)}
										</Text>
									</View>
								))
							)}
						</ScrollView>
					</View>
				</View>
			</Modal>

			{/* Day Detail Modal */}
			<Modal
				visible={showModal}
				animationType="slide"
				presentationStyle="pageSheet"
				onRequestClose={closeDayDetail}
			>
				<SafeAreaView className="flex-1 bg-bg">
					<View className="flex-row items-center justify-between p-md border-b border-gray-200">
						<View className="flex-1">
							<Text className="font-heading-bold text-section text-text">
								{selectedDay &&
									parseLocalDate(selectedDay.date).toLocaleDateString("en-US", {
										weekday: "long",
										year: "numeric",
										month: "long",
										day: "numeric",
									})}
							</Text>
							{selectedDay && (
								<Text className="mt-xs font-body text-secondary text-muted">
									{selectedDay.brainHealthStatus ||
										getScoreLabel(selectedDay.brainScore)}{" "}
									Day
								</Text>
							)}
						</View>
						<TouchableOpacity
							onPress={closeDayDetail}
							className="p-sm"
						>
							<Ionicons name="close" size={24} color="#64748B" />
						</TouchableOpacity>
					</View>

					{selectedDay && (
						<ScrollView className="flex-1 p-md">
							{selectedDayLoading ? (
								<DayDetailSkeleton />
							) : (
								<>
									<Card className="mb-md">
								<View className="flex-row items-center justify-between">
									<View className="flex-1 pr-md">
										<Text className="font-heading-bold text-section text-text">
											You wasted
										</Text>
										<Text className="mt-sm text-4xl font-bold text-danger">
											{formatTime(
												selectedDay.replayEntries.reduce(
													(sum, entry) => sum + entry.durationMs,
													0,
												),
											)}
										</Text>
										<Text className="mt-2 font-body text-secondary text-muted">
											opening apps {selectedDay.totalMonitoredOpens} times
										</Text>
									</View>
									<View className="flex-row items-center">
										<Image
											source={require("../../assets/expressions/disappointed.png")}
											style={{ width: 100, height: 100 }}
											resizeMode="contain"
										/>
									</View>
								</View>
							</Card>

							<View className="mb-md flex-row">
								<Card className="mr-sm flex-1 px-5 py-5">
									<Text className="font-heading-bold text-card-title text-text">
										Biggest Time Leak
									</Text>
									{selectedDay.biggestTimeLeak ? (
										<View className="mt-3 min-h-[128px] justify-between">
											<View className="flex-1">
												<View className="flex-row items-center">
													<AppBadge
														appName={selectedDay.biggestTimeLeak.appName}
														packageName={
															selectedDay.biggestTimeLeak.packageName
														}
														size={42}
													/>
													<Text
														className="ml-3 flex-1 font-heading-semibold text-card-title text-text"
														numberOfLines={2}
													>
														{selectedDay.biggestTimeLeak.appName}
													</Text>
												</View>
												<Text className="mt-4 text-3xl font-bold text-danger">
													{formatTime(selectedDay.biggestTimeLeak.totalTimeMs)}
												</Text>
												<Text className="mt-2 font-body text-secondary text-muted">
													{selectedDay.biggestTimeLeak.percentage}% of
													distraction time
												</Text>
											</View>
										</View>
									) : (
										<View className="mt-3 min-h-[128px] justify-center">
											<Text className="font-body text-secondary text-muted">
												No obvious villain today.
											</Text>
										</View>
									)}
								</Card>

								<Card className="ml-sm flex-1 px-5 py-5">
									<View className="min-h-[128px] justify-between">
										<View>
											<Text className="font-heading-bold text-section text-text">
												Brain Score
											</Text>
											<Text
												className="mt-2 text-5xl font-bold"
												style={{ color: getScoreColor(selectedDay.brainScore) }}
											>
												{Math.round(selectedDay.brainScore)}
											</Text>
											<Text className="mt-2 font-body text-secondary text-muted">
												{selectedDay.brainHealthStatus ||
													getScoreLabel(selectedDay.brainScore)}
											</Text>
										</View>
									</View>
								</Card>
							</View>

							<Card className="mb-md">
								<Text className="mb-md font-heading-bold text-section text-text">
									Session Replay
								</Text>
								{selectedDay.replayEntries.length === 0 ? (
									<Text className="font-body text-body text-muted">
										No monitored distraction sessions were recorded for this
										day.
									</Text>
								) : (
									<ScrollView
										nestedScrollEnabled
										showsVerticalScrollIndicator={false}
										style={{ maxHeight: TIMELINE_MAX_HEIGHT }}
									>
										{selectedDay.replayEntries.map((entry, index) => (
											<View
												key={`${entry.packageName}-${entry.startedAt}-${index}`}
												className="flex-row pb-md last:pb-0"
											>
												<View className="w-16 pt-3">
													<Text className="font-body-semibold text-secondary text-muted">
														{new Date(entry.startedAt).toLocaleTimeString([], {
															hour: "numeric",
															minute: "2-digit",
														})}
													</Text>
												</View>
												<View className="mr-md items-center">
													{(() => {
														const momentTheme = getReplayMomentTheme(
															entry.moment,
														);
														return (
															<>
																<View
																	className="mt-3 h-3 w-3 rounded-full"
																	style={{ backgroundColor: momentTheme.dot }}
																/>
																{index <
																selectedDay.replayEntries.length - 1 ? (
																	<View
																		className="mt-1 w-0.5 flex-1"
																		style={{
																			backgroundColor: `${momentTheme.dot}55`,
																		}}
																	/>
																) : (
																	<View className="w-0.5 flex-1" />
																)}
															</>
														);
													})()}
												</View>
												<View className="flex-1 rounded-3xl border border-slate-200 bg-card px-4 py-4">
													<View className="flex-row items-start justify-between">
														<View className="flex-row flex-1 items-center">
															<AppBadge
																appName={entry.appName}
																packageName={entry.packageName}
																size={42}
															/>
															<Text className="ml-3 flex-1 font-heading-semibold text-card-title text-text">
																{entry.appName}
															</Text>
														</View>
														<Text className="ml-3 font-heading-bold text-card-title text-danger">
															+{formatTime(entry.durationMs)}
														</Text>
													</View>
													<View className="mt-3 flex-row justify-end">
														<View
															className="rounded-full px-3 py-1"
															style={{
																backgroundColor: getReplayMomentTheme(
																	entry.moment,
																).pillBackground,
															}}
														>
															<Text
																className="font-body-semibold text-secondary"
																style={{
																	color: getReplayMomentTheme(entry.moment)
																		.pillText,
																}}
															>
																{entry.moment}
															</Text>
														</View>
													</View>
												</View>
											</View>
										))}
									</ScrollView>
								)}
							</Card>

							{/* App Usage Breakdown */}
							<Card className="mb-md">
								<View className="mb-md flex-row items-center justify-between gap-3">
									<Text className="font-heading-bold text-section text-text">
										App Usage Breakdown
									</Text>
									<Text className="font-body-semibold text-secondary text-muted">
										{formatTime(selectedDay.totalScreenTime)}
									</Text>
								</View>
								{selectedDay.apps.length === 0 ? (
									<View className="items-center py-lg">
										<Text className="font-body text-body text-muted">
											No app usage recorded
										</Text>
									</View>
								) : (
									selectedDay.apps.map((app, index) => {
										const percentage =
											(app.totalTimeMs / selectedDay.totalScreenTime) * 100;
										return (
											<View
												key={app.packageName}
												className="py-sm border-b border-gray-100 last:border-b-0"
											>
												<View className="flex-row items-center justify-between mb-xs">
													<View className="flex-row items-center flex-1">
														<View className="w-8 h-8 bg-accent/20 rounded-full items-center justify-center mr-sm">
															<Text className="font-heading-bold text-secondary text-accent">
																{index + 1}
															</Text>
														</View>
														<Text className="flex-1 font-heading-semibold text-card-title text-text">
															{app.appName}
														</Text>
													</View>
													<View className="items-end">
														<Text className="font-heading-semibold text-card-title text-text">
															{formatTime(app.totalTimeMs)}
														</Text>
														<Text className="font-body text-secondary text-muted">
															{percentage.toFixed(1)}%
														</Text>
													</View>
												</View>
												{/* Usage bar */}
												<View className="h-1 bg-gray-200 rounded-full ml-10">
													<View
														className="h-full bg-accent rounded-full"
														style={{ width: `${percentage}%` }}
													/>
												</View>
											</View>
										);
									})
								)}
							</Card>
								</>
							)}
						</ScrollView>
					)}
				</SafeAreaView>
			</Modal>
		</SafeAreaView>
	);
}

function MonthDelta({
	delta,
	isPositiveBetter,
	formatter,
}: {
	delta: number;
	isPositiveBetter: boolean;
	formatter: (value: number) => string;
}) {
	const isNeutral = delta === 0;
	const isBetter = isPositiveBetter ? delta > 0 : delta < 0;
	const color = isNeutral ? "#64748B" : isBetter ? "#16A34A" : "#DC2626";
	const iconName = isNeutral ? "remove" : delta > 0 ? "arrow-up" : "arrow-down";

	return (
		<View className="mt-1 flex-row items-center">
			<Ionicons name={iconName} size={14} color={color} />
			<Text
				className="ml-1 font-body-semibold text-secondary"
				style={{ color }}
			>
				{formatter(delta)}
			</Text>
		</View>
	);
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

function CalendarPeriodInsightScreen({
	insight,
	onClose,
	onAction,
	feedback,
	onFeedbackChange,
	currentIndex,
	totalInsights,
	onPrevious,
	onNext,
}: {
	insight: CalendarPeriodInsight;
	onClose: () => void;
	onAction: () => void;
	feedback: "up" | "down" | null;
	onFeedbackChange: (value: "up" | "down") => void;
	currentIndex: number;
	totalInsights: number;
	onPrevious?: () => void;
	onNext?: () => void;
}) {
	const heroImage =
		insight.heroVariant === "morning"
			? require("../../assets/insight_cards/insight_morning.png")
			: insight.heroVariant === "night"
				? require("../../assets/insight_cards/insight_night.png")
				: null;
	const periodLabel = insight.periodType === "week" ? "This Week" : "This Month";
	const headline = (
		<Text className="font-heading-bold text-3xl leading-[38px] text-white">
			{insight.headlineSegments.map((segment, index) => (
				<Text
					key={`${segment.text}-${index}`}
					style={segment.color ? { color: segment.color } : undefined}
				>
					{segment.text}
				</Text>
			))}
		</Text>
	);

	return (
		<SafeAreaView className="flex-1 bg-white">
			<ScrollView className="flex-1 px-md" showsVerticalScrollIndicator={false}>
				{heroImage ? (
					<ImageBackground
						source={heroImage}
						resizeMode="cover"
						className="mt-sm overflow-hidden rounded-[32px] bg-slate-900"
						style={{ minHeight: 320 }}
					>
						<View className="absolute inset-0 bg-slate-900/35" />
						<View className="flex-row items-start justify-between px-md py-md">
							<View className="flex-1 pr-md">
								<Text className="font-body-semibold text-secondary text-white/80">
									{periodLabel}
								</Text>
								{totalInsights > 1 ? (
									<Text className="mt-1 font-body text-secondary text-white/70">
										Preview {currentIndex + 1} of {totalInsights}
									</Text>
								) : null}
							</View>
							<TouchableOpacity
								onPress={onClose}
								className="rounded-full bg-white/20 p-sm"
							>
								<Ionicons name="close" size={22} color="#FFFFFF" />
							</TouchableOpacity>
						</View>
						<View className="flex-1 justify-end px-md pb-xl pt-lg">
							{headline}
							<Text className="mt-4 max-w-[92%] font-body text-body leading-7 text-white/90">
								{insight.summaryText}
							</Text>
						</View>
					</ImageBackground>
				) : (
					<View
						className="mt-sm overflow-hidden rounded-[32px] bg-[#F5F0FF]"
						style={{ minHeight: 320 }}
					>
						<View className="flex-row items-start justify-between px-md py-md">
							<View className="flex-1 pr-md">
								<Text className="font-body-semibold text-secondary text-accent">
									{periodLabel}
								</Text>
								{totalInsights > 1 ? (
									<Text className="mt-1 font-body text-secondary text-slate-500">
										Preview {currentIndex + 1} of {totalInsights}
									</Text>
								) : null}
							</View>
							<TouchableOpacity
								onPress={onClose}
								className="rounded-full bg-white/90 p-sm"
							>
								<Ionicons name="close" size={22} color="#64748B" />
							</TouchableOpacity>
						</View>
						<View className="flex-1 justify-between px-md pb-xl pt-md">
							<View>
								<Text className="font-heading-bold text-3xl leading-[38px] text-slate-900">
									{insight.headlineSegments.map((segment, index) => (
										<Text
											key={`${segment.text}-${index}`}
											style={
												segment.color ? { color: segment.color } : undefined
											}
										>
											{segment.text}
										</Text>
									))}
								</Text>
								<Text className="mt-4 max-w-[92%] font-body text-body leading-7 text-slate-600">
									{insight.summaryText}
								</Text>
							</View>
							<View className="mt-lg flex-row items-end justify-between">
								<View className="rounded-[28px] bg-white px-6 py-6 shadow-sm">
									<AppBadge
										appName={insight.relatedAppName || "App"}
										packageName={insight.relatedAppPackage || "app"}
										size={88}
									/>
								</View>
								{insight.metricValue ? (
									<View className="rounded-full border border-[#E7DFFD] bg-white px-4 py-3 shadow-sm">
										<Text className="font-heading-bold text-card-title text-slate-900">
											{insight.metricValue}
										</Text>
										<Text className="font-body text-xs text-slate-500">
											{insight.metricLabel || "opens"}
										</Text>
									</View>
								) : null}
							</View>
						</View>
					</View>
				)}

				{totalInsights > 1 ? (
					<View className="mt-md flex-row items-center justify-center">
						<TouchableOpacity
							onPress={onPrevious}
							disabled={!onPrevious || currentIndex === 0}
							className={`mx-2 rounded-full border px-4 py-2 ${currentIndex === 0 ? "border-slate-200 bg-slate-100" : "border-violet-200 bg-violet-50"}`}
						>
							<Text
								className={`font-heading-semibold ${currentIndex === 0 ? "text-slate-400" : "text-accent"}`}
							>
								Previous
							</Text>
						</TouchableOpacity>
						<TouchableOpacity
							onPress={onNext}
							disabled={!onNext || currentIndex >= totalInsights - 1}
							className={`mx-2 rounded-full border px-4 py-2 ${currentIndex >= totalInsights - 1 ? "border-slate-200 bg-slate-100" : "border-violet-200 bg-violet-50"}`}
						>
							<Text
								className={`font-heading-semibold ${currentIndex >= totalInsights - 1 ? "text-slate-400" : "text-accent"}`}
							>
								Next
							</Text>
						</TouchableOpacity>
					</View>
				) : null}

				<View className="mt-lg rounded-[26px] border border-slate-200 bg-white px-5 py-5">
					<Text className="font-heading-semibold text-card-title text-slate-900">
						{insight.whyTitle}
					</Text>
					<Text className="mt-3 font-body text-body leading-7 text-slate-600">
						{insight.whyBody}
					</Text>
				</View>

				<View className="mt-md rounded-[26px] border border-slate-200 bg-white px-5 py-5">
					<Text className="font-heading-semibold text-card-title text-slate-900">
						{insight.evidence.title}
					</Text>
					<Text className="mt-3 font-body text-body leading-7 text-slate-600">
						{insight.evidence.body}
					</Text>
					<CalendarInsightEvidenceView insight={insight} />
				</View>

				<View className="mt-md rounded-[26px] border border-slate-200 bg-white px-5 py-5">
					<Text className="font-heading-semibold text-card-title text-slate-900">
						{insight.recommendationTitle}
					</Text>
					<Text className="mt-3 font-body text-body leading-7 text-slate-600">
						{insight.recommendationBody}
					</Text>
				</View>

				<TouchableOpacity
					onPress={onAction}
					activeOpacity={0.92}
					className="mt-lg flex-row items-center justify-center rounded-[24px] bg-accent px-5 py-4"
				>
					<Text className="font-heading-semibold text-card-title text-white">
						{insight.actionLabel}
					</Text>
					<Ionicons
						name="arrow-forward"
						size={18}
						color="#FFFFFF"
						style={{ marginLeft: 10 }}
					/>
				</TouchableOpacity>

				<View className="items-center py-lg">
					<Text className="font-body text-secondary text-muted">
						Was this insight helpful?
					</Text>
					<View className="mt-3 flex-row">
						{([
							{ key: "up", icon: "thumbs-up-outline" },
							{ key: "down", icon: "thumbs-down-outline" },
						] as const).map((item) => {
							const selected = feedback === item.key;
							return (
								<TouchableOpacity
									key={item.key}
									onPress={() => onFeedbackChange(item.key)}
									className={`mx-2 rounded-full border px-4 py-3 ${selected ? "border-accent bg-violet-50" : "border-slate-200 bg-white"}`}
								>
									<Ionicons
										name={item.icon}
										size={18}
										color={selected ? "#5D3DF0" : "#64748B"}
									/>
								</TouchableOpacity>
							);
						})}
					</View>
				</View>
			</ScrollView>
		</SafeAreaView>
	);
}

function CalendarInsightEvidenceView({
	insight,
}: {
	insight: CalendarPeriodInsight;
}) {
	const evidence = insight.evidence;

	if (evidence.kind === "app_opens") {
		const maxValue = Math.max(
			...evidence.comparisonRows.map((row) => row.value),
			1,
		);
		return (
			<View className="mt-4">
				{evidence.comparisonRows.map((row) => (
					<View key={row.label} className="mb-4 last:mb-0">
						<View className="mb-2 flex-row items-center justify-between">
							<Text className="font-body-semibold text-secondary text-slate-700">
								{row.label}
							</Text>
							<Text className="font-body-semibold text-secondary text-slate-700">
								{row.value}
							</Text>
						</View>
						<View className="h-3 rounded-full bg-slate-200">
							<View
								className={`h-3 rounded-full ${row.highlighted ? "bg-[#2F80FF]" : "bg-slate-300"}`}
								style={{ width: `${Math.max(18, (row.value / maxValue) * 100)}%` }}
							/>
						</View>
					</View>
				))}
			</View>
		);
	}

	return (
		<View className="mt-5">
			<View className="flex-row items-end justify-between">
				{evidence.values.map((value, index) => {
					const highlighted = evidence.highlightedIndexes.includes(index);
					return (
						<View key={`${value}-${index}`} className="items-center">
							<View
								className="w-8 rounded-t-xl"
								style={{
									height: 14 + value,
									backgroundColor: highlighted ? "#8B5CF6" : "#DDD6FE",
									opacity: highlighted ? 1 : 0.8,
								}}
							/>
						</View>
					);
				})}
			</View>
			<View className="mt-3 flex-row items-center justify-between">
				{evidence.axisLabels.map((label, index) => (
					<Text
						key={`${label}-${index}`}
						className="flex-1 text-center font-body text-xs text-slate-400"
					>
						{label}
					</Text>
				))}
			</View>
		</View>
	);
}

function DayDetailSkeleton() {
	return (
		<>
			<Card className="mb-md">
				<View className="flex-row items-center justify-between">
					<View className="flex-1 pr-md">
						<SkeletonBlock className="h-7 w-32" />
						<SkeletonBlock className="mt-4 h-12 w-28" />
						<SkeletonBlock className="mt-3 h-4 w-40" />
					</View>
					<SkeletonBlock className="h-24 w-24 rounded-3xl" />
				</View>
			</Card>

			<View className="mb-md flex-row">
				<Card className="mr-sm flex-1 px-5 py-5">
					<SkeletonBlock className="h-5 w-28" />
					<SkeletonBlock className="mt-4 h-11 w-20" />
					<SkeletonBlock className="mt-3 h-4 w-24" />
				</Card>
				<Card className="ml-sm flex-1 px-5 py-5">
					<SkeletonBlock className="h-5 w-24" />
					<SkeletonBlock className="mt-4 h-12 w-16" />
					<SkeletonBlock className="mt-3 h-4 w-20" />
				</Card>
			</View>

			<Card className="mb-md">
				<SkeletonBlock className="h-7 w-40" />
				{Array.from({ length: 3 }).map((_, index) => (
					<View key={`day-detail-session-${index}`} className="mt-4 flex-row">
						<SkeletonBlock className="mt-2 h-4 w-14" />
						<View className="mx-4 items-center">
							<SkeletonBlock className="mt-2 h-3 w-3 rounded-full" />
							<SkeletonBlock className="mt-2 h-20 w-0.5" />
						</View>
						<View className="flex-1 rounded-3xl border border-slate-200 bg-card px-4 py-4">
							<SkeletonBlock className="h-5 w-28" />
							<SkeletonBlock className="mt-3 h-4 w-full" />
							<SkeletonBlock className="mt-2 h-4 w-3/4" />
						</View>
					</View>
				))}
			</Card>

			<Card className="mb-md">
				<View className="mb-md flex-row items-center justify-between">
					<SkeletonBlock className="h-7 w-44" />
					<SkeletonBlock className="h-4 w-14" />
				</View>
				{Array.from({ length: 4 }).map((_, index) => (
					<View
						key={`day-detail-breakdown-${index}`}
						className="border-b border-gray-100 py-sm last:border-b-0"
					>
						<View className="mb-2 flex-row items-center justify-between">
							<View className="flex-row items-center flex-1">
								<SkeletonBlock className="h-8 w-8 rounded-full" />
								<SkeletonBlock className="ml-3 h-5 w-28" />
							</View>
							<View className="items-end">
								<SkeletonBlock className="h-5 w-14" />
								<SkeletonBlock className="mt-2 h-3.5 w-10" />
							</View>
						</View>
						<SkeletonBlock className="ml-10 h-1 w-full rounded-full" />
					</View>
				))}
			</Card>
		</>
	);
}

function CalendarSkeleton() {
	return (
		<>
			<Card className="mx-md mb-md overflow-hidden">
				<View className="mb-md flex-row items-center justify-between">
					<View>
						<SkeletonBlock className="h-7 w-40" />
						<SkeletonBlock className="mt-2 h-4 w-32" />
					</View>
					<View className="flex-row">
						<SkeletonBlock className="h-10 w-10 rounded-full" />
						<SkeletonBlock className="ml-3 h-10 w-10 rounded-full" />
					</View>
				</View>
				<SkeletonBlock className="h-4 w-48" />
				<View className="mt-md rounded-3xl bg-slate-50 px-4 py-4">
					<View className="mb-4 flex-row justify-between">
						{Array.from({ length: 7 }).map((_, index) => (
							<SkeletonBlock
								key={`calendar-weekday-${index}`}
								className="h-4 w-6 rounded-md"
							/>
						))}
					</View>
					{Array.from({ length: 5 }).map((_, rowIndex) => (
						<View
							key={`calendar-row-${rowIndex}`}
							className="mb-3 flex-row justify-between last:mb-0"
						>
							{Array.from({ length: 7 }).map((_, colIndex) => (
								<SkeletonBlock
									key={`calendar-cell-${rowIndex}-${colIndex}`}
									className="h-11 w-11 rounded-2xl"
								/>
							))}
						</View>
					))}
				</View>
			</Card>

			<View className="mx-md mb-md flex-row">
				<Card className="mr-sm flex-1">
					<SkeletonBlock className="h-5 w-24" />
					<SkeletonBlock className="mt-4 h-10 w-16" />
					<SkeletonBlock className="mt-3 h-4 w-20" />
				</Card>
				<Card className="ml-sm flex-1">
					<SkeletonBlock className="h-5 w-24" />
					<SkeletonBlock className="mt-4 h-10 w-16" />
					<SkeletonBlock className="mt-3 h-4 w-24" />
				</Card>
			</View>

			<Card className="mx-md mb-md">
				<SkeletonBlock className="h-7 w-40" />
				{Array.from({ length: 4 }).map((_, index) => (
					<View
						key={`calendar-list-${index}`}
						className="flex-row items-center justify-between border-b border-gray-100 py-sm last:border-b-0"
					>
						<View className="flex-1 pr-sm">
							<SkeletonBlock className="h-5 w-32" />
							<SkeletonBlock className="mt-2 h-3.5 w-24" />
						</View>
						<View className="items-end">
							<SkeletonBlock className="h-5 w-14" />
							<SkeletonBlock className="mt-2 h-3.5 w-10" />
						</View>
					</View>
				))}
			</Card>
		</>
	);
}
