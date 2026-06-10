/* eslint-disable react-hooks/immutability, react-hooks/set-state-in-effect, react/no-unescaped-entities */
import { Ionicons } from "@expo/vector-icons";
import * as Google from "expo-auth-session/providers/google";
import { router } from "expo-router";
import type { User } from "firebase/auth";
import { useEffect, useState } from "react";
import {
	Alert,
	AppState,
	Image,
	Modal,
	ScrollView,
	Switch,
	Text,
	TouchableOpacity,
	View,
	type AlertButton,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Card } from "@/components/Card";
import FocusEducationModal, {
	type FocusEducationStep,
} from "@/components/FocusEducationModal";
import { Header } from "@/components/Header";
import PermissionRecoveryCard from "@/components/PermissionRecoveryCard";
import SkeletonBlock from "@/components/SkeletonBlock";
import { AuthService } from "@/services/AuthService";
import { CapabilitiesService } from "@/services/CapabilitiesService";
import { DailyInsightsService } from "@/services/DailyInsightsService";
import { LoginNudgeService, type LoginNudge } from "@/services/LoginNudgeService";
import { MonitoringDiagnosticsService } from "@/services/MonitoringDiagnosticsService";
import {
	PermissionHealthService,
	type PermissionNudge,
} from "@/services/PermissionHealthService";
import type { InsightCard } from "@/services/InsightTypes";
import { TelemetryService } from "@/services/TelemetryService";
import {
	UnifiedUsageService,
	type MonitoringDiagnostics,
	type ManufacturerPermissionInfo,
} from "@/services/UnifiedUsageService";
import { database } from "@/services/database";
import { firebaseGoogleClientIds } from "@/services/firebase";
import { getScoreColor } from "@/utils/brainScore";

type PermissionState = {
	usage: boolean | null;
	overlay: boolean | null;
	accessibility: boolean | null;
	notifications: boolean | null;
};
type ViewApp = {
	packageName: string;
	appName: string;
	isRecommended: boolean;
	isCurrentlyMonitored: boolean;
};

export default function SettingsScreen() {
	const [apps, setApps] = useState<ViewApp[]>([]);
	const [permissions, setPermissions] = useState<PermissionState>({
		usage: false,
		overlay: false,
		accessibility: false,
		notifications: false,
	});
	const [authUser, setAuthUser] = useState<User | null>(
		AuthService.getCurrentUser(),
	);
	const [accountActionLoading, setAccountActionLoading] = useState(false);
	const [state, setState] = useState({
		monitoringEnabled: false,
		backgroundChecksEnabled: true,
		realtimeMonitoringEnabled: false,
		analyticsEnabled: true,
		lastCloudSyncAt: 0,
	});
	const [loading, setLoading] = useState(true);
	const [initialLoadComplete, setInitialLoadComplete] = useState(false);
	const [widgetPreviewVisible, setWidgetPreviewVisible] = useState(false);
	const [widgetPreviewScore, setWidgetPreviewScore] = useState<string>("--");
	const [widgetPreviewScoreColor, setWidgetPreviewScoreColor] =
		useState("#5D3DF0");
	const [insightsPreviewVisible, setInsightsPreviewVisible] = useState(false);
	const [focusEducationPreviewVisible, setFocusEducationPreviewVisible] =
		useState(false);
	const [focusEducationPreviewStep, setFocusEducationPreviewStep] =
		useState<FocusEducationStep>("accessibility");
	const [manufacturerInfo, setManufacturerInfo] =
		useState<ManufacturerPermissionInfo | null>(null);
	const [permissionNudges, setPermissionNudges] = useState<PermissionNudge[]>([]);
	const [loginNudge, setLoginNudge] = useState<LoginNudge | null>(null);
	const [monitoringDiagnostics, setMonitoringDiagnostics] =
		useState<MonitoringDiagnostics | null>(null);
	const [qaInsightMeta, setQaInsightMeta] = useState({
		summarySource: "missing",
		integrityDeltaMs: 0,
		insightSource: "missing",
	});
	const [insightPreviewSections, setInsightPreviewSections] = useState<
		{
			title: string;
			date: string;
			insights: InsightCard[];
		}[]
	>([]);
	const [analyticsLabelTapCount, setAnalyticsLabelTapCount] = useState(0);
	const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
		webClientId: firebaseGoogleClientIds.webClientId,
		androidClientId: firebaseGoogleClientIds.androidClientId,
		iosClientId: firebaseGoogleClientIds.iosClientId,
		selectAccount: true,
	});

	useEffect(() => {
		void refresh();
		const subscription = AppState.addEventListener("change", (status) => {
			if (status === "active") {
				void refresh();
			}
		});
		return () => subscription.remove();
	}, []);

	useEffect(() => {
		return AuthService.subscribe((user) => {
			setAuthUser(user);
			void refresh();
		});
	}, []);

	useEffect(() => {
		if (!response) {
			return;
		}

		if (response.type === "success") {
			const idToken =
				response.params?.id_token ||
				(response.authentication && "idToken" in response.authentication
					? response.authentication.idToken
					: null);

			if (!idToken) {
				Alert.alert(
					"Google Sign-In Failed",
					"Google did not return an ID token for Firebase sign-in.",
				);
				return;
			}

			setAccountActionLoading(true);
			AuthService.signInWithGoogleIdToken(idToken)
				.then(() => refresh())
				.catch((error: unknown) => {
					const message =
						error instanceof Error ? error.message : "Unknown sign-in error";
					Alert.alert("Google Sign-In Failed", message);
				})
				.finally(() => {
					setAccountActionLoading(false);
				});
			return;
		}

		if (response.type === "error") {
			setAccountActionLoading(false);
			Alert.alert(
				"Google Sign-In Failed",
				response.error?.message || "Unknown OAuth error.",
			);
			return;
		}

		setAccountActionLoading(false);
	}, [response]);

	const refresh = async () => {
		if (!initialLoadComplete) {
			setLoading(true);
		}
		try {
			const [
				installedApps,
				monitoredPackages,
				usage,
				overlay,
				accessibility,
				notifications,
				nextManufacturerInfo,
				permissionHealth,
				nextLoginNudge,
				nextDiagnostics,
				todaySummary,
				todayInsights,
			] = await Promise.all([
				UnifiedUsageService.getInstalledApps(),
				database.getMonitoredPackages(),
				CapabilitiesService.hasUsageAccess(),
				CapabilitiesService.hasOverlayPermission(),
				CapabilitiesService.hasAccessibilityPermission(),
				CapabilitiesService.hasNotificationPermission(),
				UnifiedUsageService.getManufacturerInfo(),
				PermissionHealthService.getPermissionHealth().catch(() => null),
				LoginNudgeService.getLoginNudge().catch(() => null),
				MonitoringDiagnosticsService.getDiagnostics().catch(() => null),
				database.getDailySummary(new Date().toISOString().split("T")[0]),
				DailyInsightsService.getInstance()
					.getDailyInsights(new Date().toISOString().split("T")[0], {
						allowInsightRegeneration: false,
						preferPersistedInsights: true,
					})
					.catch(() => null),
			]);

			setApps(
				installedApps
					.map((app) => ({
						packageName: app.packageName,
						appName: app.appName,
						isRecommended: !!(app as { isRecommended?: boolean }).isRecommended,
						isCurrentlyMonitored: monitoredPackages.includes(app.packageName),
					}))
					.sort((a, b) => a.appName.localeCompare(b.appName)),
			);
			setPermissions({ usage, overlay, accessibility, notifications });
			setManufacturerInfo(
				nextManufacturerInfo?.needsSpecialPermission
					? nextManufacturerInfo
					: null,
			);
			setPermissionNudges(permissionHealth?.nudges || []);
			setLoginNudge(nextLoginNudge?.shouldShow ? nextLoginNudge : null);
			setMonitoringDiagnostics(nextDiagnostics);
			setQaInsightMeta({
				summarySource: todaySummary?.summarySource || "missing",
				integrityDeltaMs: todaySummary?.integrityDeltaMs ?? 0,
				insightSource: todayInsights?.insightLoadState || "missing",
			});
			setState({
				monitoringEnabled:
					(await database.getMeta("monitoring_enabled")) === "true",
				backgroundChecksEnabled:
					(await database.getMeta("background_checks_enabled")) !== "false",
				realtimeMonitoringEnabled:
					(await database.getMeta("realtime_monitoring_enabled")) === "true",
				analyticsEnabled:
					(await database.getMeta("analytics_enabled")) !== "false",
				lastCloudSyncAt: parseInt(
					(await database.getMeta("cloud_last_sync_at")) || "0",
					10,
				),
			});
		} finally {
			setLoading(false);
			setInitialLoadComplete(true);
		}
	};

	const guardedUsageToggle = async (work: () => Promise<void>) => {
		const granted = await CapabilitiesService.ensureUsageAccess("settings");
		if (!granted) {
			Alert.alert(
				"Usage Access Required",
				"This feature stays off until Usage Access is enabled.",
			);
			await refresh();
			return;
		}
		await work();
	};

	const maybeShowBackgroundGuidance = async () => {
		const guidance =
			await CapabilitiesService.getBackgroundReliabilityGuidance();
		if (!guidance.needsManufacturerGuidance) {
			return;
		}

		const buttons: AlertButton[] = [{ text: "OK" }];
		if (guidance.canOpenDirectly) {
			buttons.unshift({
				text: "Open OEM Settings",
				onPress: () => {
					void CapabilitiesService.openBackgroundReliabilitySettings("settings");
				},
			});
		}

		Alert.alert(
			guidance.title || "Background Reliability",
			guidance.instructions ||
				"Your phone may require extra battery optimization changes for reliable background checks.",
			buttons,
		);
	};

	const updateMonitoringToggle = async (
		key:
			| "monitoring_enabled"
			| "background_checks_enabled"
			| "realtime_monitoring_enabled",
		value: boolean,
	) => {
		if (value) {
			await guardedUsageToggle(async () => {
				await database.setMeta(key, "true");
				if (key !== "monitoring_enabled") {
					await database.setMeta("monitoring_enabled", "true");
				}
				const service = UnifiedUsageService.getInstance();
				await service.startMonitoring();
				await service.applyMonitoringSettings();
				if (key !== "monitoring_enabled") {
					await maybeShowBackgroundGuidance();
				}
			});
		} else {
			await database.setMeta(key, "false");
			if (key === "monitoring_enabled") {
				await UnifiedUsageService.getInstance().stopMonitoring();
			} else {
				await UnifiedUsageService.getInstance().applyMonitoringSettings();
			}
		}
		await refresh();
	};

	const previewBlockingScreen = async (mode: "soft" | "hard") => {
		try {
			if (mode === "soft" && !permissions.overlay) {
				const granted = await CapabilitiesService.ensureOverlayPermission("settings");
				if (!granted) {
					Alert.alert(
						"Overlay Required",
						"Grant Display over other apps to preview the limit screen.",
					);
					await refresh();
					return;
				}
			}

			if (mode === "hard" && !permissions.accessibility) {
				const granted =
					await CapabilitiesService.ensureAccessibilityPermission("settings");
				if (!granted) {
					Alert.alert(
						"Accessibility Required",
						"Enable Accessibility to preview the locked screen.",
					);
					await refresh();
					return;
				}
			}

			await UnifiedUsageService.showBlockingOverlay(
				"dev.preview.app",
				mode === "soft" ? "Limit Screen Preview" : "Locked Screen Preview",
				mode,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			Alert.alert("Preview Failed", message);
		}
	};

	const previewOnboardingFlow = async () => {
		router.push("/onboarding/preview" as never);
	};

	const signInWithGoogle = async () => {
		if (!firebaseGoogleClientIds.webClientId) {
			Alert.alert(
				"Firebase Not Configured",
				"Add your Google web client ID to the Expo env file first.",
			);
			return;
		}

		if (!request) {
			Alert.alert(
				"Google Sign-In Not Ready",
				"The Google sign-in request is still initializing.",
			);
			return;
		}

		setAccountActionLoading(true);
		try {
			await promptAsync();
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Unknown prompt error";
			Alert.alert("Google Sign-In Failed", message);
			setAccountActionLoading(false);
		}
	};

	const signOutUser = async () => {
		setAccountActionLoading(true);
		try {
			await AuthService.signOut();
			await refresh();
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Unknown sign-out error";
			Alert.alert("Sign Out Failed", message);
		} finally {
			setAccountActionLoading(false);
		}
	};

	const runNativeModuleTest = async () => {
		try {
			const isAvailable = UnifiedUsageService.isNativeModuleAvailable();
			let testResults = `Module Available: ${isAvailable}\n`;

			if (isAvailable) {
				const hasAccess = await UnifiedUsageService.isUsageAccessGranted();
				testResults += `Has Permission: ${hasAccess}\n`;

				const apps = await UnifiedUsageService.getInstalledApps();
				testResults += `Installed Apps: ${apps.length}\n`;

				const monitoredAppsData = await database.getMeta("monitored_apps");
				const monitoredPackages = monitoredAppsData
					? JSON.parse(monitoredAppsData)
					: [];
				testResults += `Monitored Apps (DB): ${monitoredPackages.length}\n`;

				const syncedApps = await UnifiedUsageService.getSyncedMonitoredApps();
				testResults += `Synced to Native: ${syncedApps.length}\n`;

				if (hasAccess) {
					const usage = await UnifiedUsageService.getTodayUsage();
					testResults += `Today's Usage: ${usage.length} apps\n`;

					if (usage.length > 0) {
						testResults += `\nTop 3 Apps:\n`;
						usage.slice(0, 3).forEach((app, i) => {
							const mins = Math.round(app.totalTimeMs / 60000);
							testResults += `${i + 1}. ${app.appName}: ${mins}m\n`;
						});
					}
				} else {
					testResults += `\nGrant usage permission to see app data`;
				}
			} else {
				testResults += `\nNative module not available.\nThis may indicate a build issue.`;
			}

			Alert.alert("Native Module Test", testResults, [{ text: "OK" }]);
		} catch (error: unknown) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown test error";
			Alert.alert("Test Error", errorMessage, [{ text: "OK" }]);
		}
	};

	const cleanTodayDuplicates = async () => {
		const today = new Date().toISOString().split("T")[0];
		await database.cleanupDuplicateEntries(today);
		Alert.alert("Cleanup Complete", "Today's duplicate entries were cleaned.");
	};

	const debugDuplicateIssue = async () => {
		const today = new Date().toISOString().split("T")[0];
		const rawEntries = await database.getDailyUsage(today);
		const duplicates = rawEntries.reduce<Record<string, number>>(
			(acc, entry) => {
				acc[entry.packageName] = (acc[entry.packageName] || 0) + 1;
				return acc;
			},
			{},
		);

		const duplicatePackages = Object.entries(duplicates)
			.filter(([, count]) => count > 1)
			.map(([packageName, count]) => `${packageName}: ${count}`);

		console.log("=== RAW DATABASE ENTRIES ===");
		rawEntries.forEach((entry, index) => {
			console.log(
				`${index}: ${entry.packageName} - ${entry.appName} - ${entry.totalTimeMs}ms`,
			);
		});

		Alert.alert(
			"Duplicate Usage Debug",
			duplicatePackages.length > 0
				? `Found duplicate package entries:\n${duplicatePackages.join("\n")}`
				: "No duplicate package entries found for today.",
		);
	};

	const inspectTodaySummary = async () => {
		const today = new Date().toISOString().split("T")[0];

		try {
			const [summary, sessions] = await Promise.all([
				database.getDailySummary(today),
				database.getAppSessionsForDate(today, { monitoredOnly: true }),
			]);

			const sessionLines = sessions.length
				? sessions
						.slice(0, 20)
						.map((session, index) => {
							const startedAt = new Date(session.startedAt).toLocaleTimeString(
								[],
								{
									hour: "numeric",
									minute: "2-digit",
								},
							);
							return `${index + 1}. ${startedAt}  ${session.appName}  ${formatDuration(session.durationMs)}`;
						})
						.join("\n")
				: "No monitored sessions stored yet for today.";

			const message = [
				`Date: ${today}`,
				`Summary Source: ${summary?.summarySource || "missing"}`,
				`Brain Score: ${summary?.brainScore ?? "missing"}`,
				`Total Screen Time: ${formatDuration(summary?.totalScreenTime ?? 0)}`,
				`Session Total: ${formatDuration(summary?.sessionTotalMs ?? 0)}`,
				`Raw Usage Total: ${formatDuration(summary?.rawUsageTotalMs ?? 0)}`,
				`Integrity Delta: ${formatDuration(Math.abs(summary?.integrityDeltaMs ?? 0))}`,
				`Stored Sessions: ${sessions.length}`,
				"",
				"Today Sessions:",
				sessionLines,
				sessions.length > 20
					? `\nShowing first 20 of ${sessions.length} sessions.`
					: "",
			].join("\n");

			Alert.alert("Today Summary Debug", message, [{ text: "OK" }]);
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown debug error";
			Alert.alert("Summary Debug Failed", errorMessage, [{ text: "OK" }]);
		}
	};

	const openWidgetPreview = async () => {
		const today = new Date().toISOString().split("T")[0];
		try {
			const summary = await database.getDailySummary(today);
			if (summary?.brainScore != null) {
				setWidgetPreviewScore(String(summary.brainScore));
				setWidgetPreviewScoreColor(getScoreColor(summary.brainScore));
			} else {
				setWidgetPreviewScore("--");
				setWidgetPreviewScoreColor("#5D3DF0");
			}
		} catch {
			setWidgetPreviewScore("--");
			setWidgetPreviewScoreColor("#5D3DF0");
		}
		setWidgetPreviewVisible(true);
	};

	const openInsightsPreview = async () => {
		const formatLocalDate = (date: Date) => date.toISOString().split("T")[0];
		const today = new Date();
		const yesterday = new Date();
		yesterday.setDate(yesterday.getDate() - 1);

		try {
			const [todayInsights, yesterdayInsights] = await Promise.all([
				DailyInsightsService.getInstance().getDailyInsights(
					formatLocalDate(today),
					{
						forceSummaryRefresh: true,
						allowInsightRegeneration: true,
						preferPersistedInsights: true,
					},
				),
				DailyInsightsService.getInstance().getDailyInsights(
					formatLocalDate(yesterday),
					{
						allowInsightRegeneration: false,
						preferPersistedInsights: true,
					},
				),
			]);

			setInsightPreviewSections([
				{
					title: "Today's Ranked Insights",
					date: formatLocalDate(today),
					insights: todayInsights.rankedInsights,
				},
				{
					title: "Yesterday's Ranked Insights",
					date: formatLocalDate(yesterday),
					insights: yesterdayInsights.rankedInsights,
				},
			]);
			setInsightsPreviewVisible(true);
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "Unknown insight preview error";
			Alert.alert("Insight Preview Failed", message);
		}
	};

	const toggleFixedNotificationEasterEgg = async () => {
		setAnalyticsLabelTapCount((currentCount) => {
			const nextCount = currentCount + 1;
			if (nextCount < 4) {
				return nextCount;
			}

			void (async () => {
				try {
					const isEnabled =
						await UnifiedUsageService.isFocusStatusNotificationEnabled();
					await UnifiedUsageService.setFocusStatusNotificationEnabled(
						!isEnabled,
					);
					Alert.alert(
						"Shh...",
						isEnabled
							? "The fixed focus notification has been disabled on this device."
							: "The fixed focus notification has been restored on this device.",
					);
				} catch (error) {
					const message =
						error instanceof Error
							? error.message
							: "Unknown notification error";
					Alert.alert("Couldn't disable notification", message);
				}
			})();

			return 0;
		});
	};

	const openFocusEducationPreview = () => {
		setFocusEducationPreviewStep("accessibility");
		setFocusEducationPreviewVisible(true);
	};

	const advanceFocusEducationPreview = () => {
		if (focusEducationPreviewStep === "accessibility") {
			setFocusEducationPreviewStep("oem");
			return;
		}
		setFocusEducationPreviewVisible(false);
		setFocusEducationPreviewStep("accessibility");
	};

	const closeFocusEducationPreview = () => {
		setFocusEducationPreviewVisible(false);
		setFocusEducationPreviewStep("accessibility");
	};

	return (
		<SafeAreaView className="flex-1 bg-bg">
			<FocusEducationModal
				visible={focusEducationPreviewVisible}
				step={focusEducationPreviewStep}
				accessibilityGranted={permissions.accessibility === true}
				manufacturerTitle={manufacturerInfo?.title}
				manufacturerInstructions={manufacturerInfo?.instructions}
				canOpenManufacturerSettings={manufacturerInfo?.canOpenDirectly}
				onClose={closeFocusEducationPreview}
				onPrimary={advanceFocusEducationPreview}
				onSecondary={closeFocusEducationPreview}
			/>
			<Modal
				visible={insightsPreviewVisible}
				animationType="fade"
				transparent
				onRequestClose={() => setInsightsPreviewVisible(false)}
			>
				<View className="flex-1 items-center justify-center bg-black/40 px-md">
					<View className="max-h-[88%] w-full max-w-[420px] rounded-[28px] bg-white p-5">
						<View className="mb-4 flex-row items-center justify-between">
							<View className="flex-1 pr-sm">
								<Text className="font-heading-bold text-card-title text-text">
									Generated Insights
								</Text>
								<Text className="mt-1 font-body text-secondary text-muted">
									Dev preview of the current ranked insight output.
								</Text>
							</View>
							<TouchableOpacity
								onPress={() => setInsightsPreviewVisible(false)}
							>
								<Ionicons name="close" size={24} color="#0F172A" />
							</TouchableOpacity>
						</View>

						<ScrollView showsVerticalScrollIndicator={false}>
							{insightPreviewSections.map((section) => (
								<View key={section.title} className="mb-5">
									<Text className="font-heading-bold text-card-title text-text">
										{section.title}
									</Text>
									<Text className="mt-1 font-body text-secondary text-muted">
										{section.date}
									</Text>

									{section.insights.length === 0 ? (
										<View className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
											<Text className="font-body text-secondary text-muted">
												No insights generated.
											</Text>
										</View>
									) : (
										section.insights.map((insight, index) => (
											<View
												key={`${section.title}-${insight.id}-${index}`}
												className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4"
											>
												<Text className="font-heading-semibold text-card-title text-text">
													{index + 1}. {insight.category}
												</Text>
												<Text className="mt-2 font-heading-semibold text-card-title text-text">
													{insight.headline}
												</Text>
												<Text className="mt-2 font-body text-secondary text-slate-600">
													{insight.subtext}
												</Text>
												<Text className="mt-3 font-body text-secondary text-accent">
													Action: {insight.actionLabel}
												</Text>
												<Text className="mt-1 font-body text-secondary text-muted">
													{insight.action.type}
												</Text>
												<Text className="mt-1 font-body text-secondary text-muted">
													Priority: {insight.priority}
												</Text>
												<Text className="mt-1 font-body text-secondary text-muted">
													Severity {insight.scoreBreakdown.severity} ·
													Actionability {insight.scoreBreakdown.actionability} ·
													Confidence {insight.scoreBreakdown.confidence}
												</Text>
												<Text className="mt-1 font-body text-secondary text-muted">
													Novelty {insight.scoreBreakdown.novelty} · Freshness{" "}
													{insight.scoreBreakdown.freshness}
												</Text>
											</View>
										))
									)}
								</View>
							))}
						</ScrollView>
					</View>
				</View>
			</Modal>
			<Modal
				visible={widgetPreviewVisible}
				animationType="fade"
				transparent
				onRequestClose={() => setWidgetPreviewVisible(false)}
			>
				<View className="flex-1 items-center justify-center bg-black/40 px-md">
					<View className="w-full max-w-[360px] rounded-[28px] bg-white p-5">
						<View className="mb-4 flex-row items-center justify-between">
							<Text className="font-heading-bold text-card-title text-text">
								Widget Preview
							</Text>
							<TouchableOpacity onPress={() => setWidgetPreviewVisible(false)}>
								<Ionicons name="close" size={24} color="#0F172A" />
							</TouchableOpacity>
						</View>
						<View className="aspect-square rounded-[32px] border border-[#E7E5FF] bg-white p-6">
							<View className="flex-1">
								<View>
									<Text className="font-heading-bold text-[22px] leading-[28px] text-text">
										Brain Score
									</Text>
									<Text
										className="mt-3 font-heading-bold text-[84px] leading-[88px]"
										style={{ color: widgetPreviewScoreColor }}
									>
										{widgetPreviewScore}
									</Text>
								</View>
								<View className="flex-1 items-end justify-end">
									<Image
										source={require("../../assets/images/widget.png")}
										className="h-40 w-40"
										resizeMode="contain"
									/>
								</View>
							</View>
						</View>
						<Text className="mt-4 text-center font-body text-secondary text-muted">
							Dev preview of the 3x3 Android home-screen widget.
						</Text>
					</View>
				</View>
			</Modal>
			<ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
				<Header title="Settings" />

				{loading ? (
					<>
						<SettingsSkeletonCard />
						<SettingsSkeletonCard />
						<SettingsSkeletonCard />
					</>
				) : (
					<>
				<Card className="mx-md mb-md">
					<Text className="mb-sm font-heading-bold text-section text-text">
						Protect Your Data
					</Text>
					<Text className="mb-md font-body text-secondary text-muted">
						Sign in with Google to back up your settings, monitored apps,
						blocked apps, and up to 90 days of daily summaries to Firestore.
					</Text>
					{authUser ? (
						<View>
							<View className="flex-row items-center rounded-xl border border-slate-200 bg-card p-4">
								{authUser.photoURL ? (
									<Image
										source={{ uri: authUser.photoURL }}
										className="h-12 w-12 rounded-full"
									/>
								) : (
									<View className="h-12 w-12 rounded-full bg-accent/10 items-center justify-center">
										<Ionicons name="person" size={24} color="#5B4CF0" />
									</View>
								)}
								<View className="ml-3 flex-1">
									<Text className="font-heading-semibold text-card-title text-text">
										{authUser.displayName || "Google Account Connected"}
									</Text>
									<Text className="font-body text-secondary text-muted">
										{authUser.email || authUser.uid}
									</Text>
									<Text className="mt-1 font-body text-secondary text-muted">
										{state.lastCloudSyncAt > 0
											? `Last cloud sync: ${new Date(state.lastCloudSyncAt).toLocaleString()}`
											: "Cloud sync will run automatically after sign-in."}
									</Text>
								</View>
							</View>
							<TouchableOpacity
								onPress={() => void signOutUser()}
								disabled={accountActionLoading}
								className="mt-sm flex-row items-center justify-center rounded-lg border border-gray-200 bg-surface px-4 py-3"
							>
								<Text className="font-heading-semibold text-card-title text-text">
									{accountActionLoading ? "Working..." : "Sign Out"}
								</Text>
							</TouchableOpacity>
						</View>
					) : (
						<TouchableOpacity
							onPress={() => void signInWithGoogle()}
							disabled={accountActionLoading || !request}
							className="flex-row items-center justify-center rounded-lg border border-gray-200 bg-white px-4 py-3"
						>
							<Ionicons name="logo-google" size={20} color="#EA4335" />
							<Text className="ml-3 font-heading-semibold text-card-title text-text">
								{accountActionLoading
									? "Connecting..."
									: "Continue with Google"}
							</Text>
						</TouchableOpacity>
					)}
				</Card>

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
								onPress={() => void signInWithGoogle()}
								disabled={accountActionLoading || !request}
								className="mr-2 rounded-xl bg-[#2563EB] px-4 py-2"
							>
								<Text className="font-heading-semibold text-secondary text-white">
									{accountActionLoading ? "Connecting..." : loginNudge.ctaLabel}
								</Text>
							</TouchableOpacity>
							<TouchableOpacity
								onPress={() => void LoginNudgeService.dismiss().then(refresh)}
								className="rounded-xl border border-slate-200 px-4 py-2"
							>
								<Text className="font-heading-semibold text-secondary text-muted">
									Not now
								</Text>
							</TouchableOpacity>
						</View>
					</Card>
				) : null}

				{permissionNudges.map((nudge) => (
					<PermissionRecoveryCard
						key={nudge.id}
						nudge={nudge}
						onFix={() =>
							void PermissionHealthService.runNudgeAction(nudge).finally(refresh)
						}
						onRecheck={() => void refresh()}
						onDismiss={() =>
							void PermissionHealthService.dismissNudge(nudge.id).then(refresh)
						}
					/>
				))}

				<Card className="mx-md mb-md">
					<Text className="mb-sm font-heading-bold text-section text-text">
						Focus Tracking
					</Text>
					<ToggleRow
						label="Enable Monitoring"
						value={state.monitoringEnabled}
						onValueChange={(value) =>
							updateMonitoringToggle("monitoring_enabled", value)
						}
					/>
					<ToggleRow
						label="Background Checks"
						value={state.backgroundChecksEnabled}
						onValueChange={(value) =>
							updateMonitoringToggle("background_checks_enabled", value)
						}
					/>
					<ToggleRow
						label="Real-time Monitoring"
						value={state.realtimeMonitoringEnabled}
						onValueChange={(value) =>
							updateMonitoringToggle("realtime_monitoring_enabled", value)
						}
					/>
					<Text className="mt-sm font-body text-secondary text-muted">
						Background reliability may require battery optimization exemptions
						on some devices.
					</Text>
				</Card>

				<Card className="mx-md mb-md">
					<Text className="mb-sm font-heading-bold text-section text-text">
						Permissions
					</Text>
					<PermissionRow
						label="Notifications"
						granted={permissions.notifications}
						onPress={() =>
							CapabilitiesService.ensureNotificationPermission().then(
								() => void refresh(),
							)
						}
					/>
					<PermissionRow
						label="Usage Access"
						granted={permissions.usage}
						onPress={() =>
							CapabilitiesService.ensureUsageAccess("settings").then(() => void refresh())
						}
					/>
					<PermissionRow
						label="Accessibility"
						granted={permissions.accessibility}
						onPress={() =>
							CapabilitiesService.ensureAccessibilityPermission("settings").then(
								() => void refresh(),
							)
						}
					/>
					<PermissionRow
						label="Display Over Other Apps"
						granted={permissions.overlay}
						onPress={() =>
							CapabilitiesService.ensureOverlayPermission("settings").then(
								() => void refresh(),
							)
						}
					/>
				</Card>

				<Card className="mx-md mb-md">
					<Text className="mb-sm font-heading-bold text-section text-text">
						Privacy
					</Text>
					<ToggleRow
						label="Enable Analytics"
						value={state.analyticsEnabled}
						onValueChange={(value) =>
							TelemetryService.setEnabled(value).then(() => void refresh())
						}
						onLabelPress={() => void toggleFixedNotificationEasterEgg()}
					/>
					<Text className="mt-sm font-body text-secondary text-muted">
						Allow the app to send anonymous usage data to help improve the app.
					</Text>
					<TouchableOpacity
						onPress={() => router.push("/privacy-policy" as never)}
						className="py-sm border-b border-gray-100"
					>
						<LinkRow label="Privacy Policy" />
					</TouchableOpacity>
					<TouchableOpacity
						onPress={() => router.push("/terms" as never)}
						className="py-sm"
					>
						<LinkRow label="Terms of Service" />
					</TouchableOpacity>
				</Card>

				{__DEV__ && (
					<Card className="mx-md mb-md bg-gray-50">
						<Text className="mb-sm font-heading-bold text-section text-text">
							Dev Focus Preview
						</Text>
						<Text className="mb-md font-body text-secondary text-muted">
							Open the native limit and locked screens directly for testing.
						</Text>
						<View className="flex-row">
							<TouchableOpacity
								onPress={() => void previewBlockingScreen("soft")}
								className="flex-1 rounded-lg bg-accent px-4 py-3 items-center"
							>
								<Text className="font-heading-semibold text-secondary text-white">
									Preview Limit Screen
								</Text>
							</TouchableOpacity>
							<TouchableOpacity
								onPress={() => void previewBlockingScreen("hard")}
								className="flex-1 rounded-lg bg-danger ml-sm px-4 py-3 items-center"
							>
								<Text className="font-heading-semibold text-secondary text-white">
									Preview Locked Screen
								</Text>
							</TouchableOpacity>
						</View>
						<TouchableOpacity
							onPress={() => void previewOnboardingFlow()}
							className="mt-sm rounded-lg bg-surface border border-gray-200 px-4 py-3 items-center"
						>
							<Text className="font-heading-semibold text-secondary text-text">
								Check Onboarding Flow
							</Text>
						</TouchableOpacity>
						<TouchableOpacity
							onPress={openFocusEducationPreview}
							className="mt-sm rounded-lg bg-surface border border-gray-200 px-4 py-3 items-center"
						>
							<Text className="font-heading-semibold text-secondary text-text">
								Preview Focus First-Use Flow
							</Text>
						</TouchableOpacity>
					</Card>
				)}

				{__DEV__ && (
					<Card className="mx-md mb-md bg-gray-50">
						<Text className="mb-sm font-heading-bold text-section text-text">
							Dev QA Dashboard
						</Text>
						{monitoringDiagnostics ? (
							<View>
								<DiagnosticRow
									label="Permission Health"
									value={[
										monitoringDiagnostics.usageAccessGranted ? "Usage OK" : "Usage missing",
										monitoringDiagnostics.accessibilityGranted ? "Access OK" : "Access missing",
										monitoringDiagnostics.overlayPermissionGranted ? "Overlay OK" : "Overlay missing",
									].join(" · ")}
								/>
								<DiagnosticRow
									label="Native Blocking Config"
									value={compactJson(monitoringDiagnostics.blockingConfig)}
								/>
								<DiagnosticRow
									label="Last Summary Sync"
									value={`${monitoringDiagnostics.dailySummaryDate || "none"} · ${
										monitoringDiagnostics.dailySummarySource || "missing"
									}`}
								/>
								<DiagnosticRow
									label="Summary Integrity"
									value={`${qaInsightMeta.summarySource} · delta ${formatDuration(Math.abs(qaInsightMeta.integrityDeltaMs))}`}
								/>
								<DiagnosticRow
									label="Last Insight Source"
									value={qaInsightMeta.insightSource}
								/>
								<DiagnosticRow
									label="Pending Block Events"
									value={String(monitoringDiagnostics.pendingBlockEvents)}
								/>
								<DiagnosticRow
									label="Monitoring"
									value={[
										monitoringDiagnostics.monitoringEnabled ? "enabled" : "off",
										monitoringDiagnostics.backgroundChecksEnabled ? "background" : "no background",
										monitoringDiagnostics.realtimeMonitoringEnabled ? "realtime" : "no realtime",
										monitoringDiagnostics.realtimeLoopRunning ? "loop running" : "loop stopped",
									].join(" · ")}
								/>
								<DiagnosticRow
									label="Battery"
									value={`${monitoringDiagnostics.batteryPercent}% · ${
										monitoringDiagnostics.batteryCharging ? "charging" : "not charging"
									}`}
								/>
								<DiagnosticRow
									label="Query Counts"
									value={`usage ${monitoringDiagnostics.usageQueryCount} · events ${monitoringDiagnostics.eventQueryCount} · fg ${monitoringDiagnostics.foregroundQueryCount}`}
								/>
								<DiagnosticRow
									label="Last Blocking Failure"
									value={monitoringDiagnostics.lastBlockingFailureReason || "none"}
								/>
								<DiagnosticRow
									label="Telemetry Buffer"
									value={TelemetryService.getDebugEvents()
										.slice(0, 6)
										.map((event) => event.event)
										.join(" · ") || "empty"}
								/>
							</View>
						) : (
							<Text className="font-body text-secondary text-muted">
								Native diagnostics unavailable on this platform/build.
							</Text>
						)}
						<TouchableOpacity
							onPress={() => void refresh()}
							className="mt-sm rounded-lg bg-white border border-gray-200 px-4 py-3 items-center"
						>
							<Text className="font-heading-semibold text-secondary text-text">
								Refresh QA Dashboard
							</Text>
						</TouchableOpacity>
					</Card>
				)}

				{__DEV__ && (
					<Card className="mx-md mb-md bg-gray-50">
						<Text className="mb-sm font-heading-bold text-section text-text">
							Dev Diagnostics
						</Text>
						<Text className="mb-md font-body text-secondary text-muted">
							Use these helpers for native module verification and
							duplicate-usage investigation.
						</Text>
						<TouchableOpacity
							onPress={() => void runNativeModuleTest()}
							className="rounded-lg bg-white border border-gray-200 px-4 py-3 items-center mb-sm"
						>
							<Text className="font-heading-semibold text-secondary text-text">
								Run Full Native Test
							</Text>
						</TouchableOpacity>
						<TouchableOpacity
							onPress={() => void cleanTodayDuplicates()}
							className="rounded-lg bg-white border border-gray-200 px-4 py-3 items-center mb-sm"
						>
							<Text className="font-heading-semibold text-secondary text-text">
								Clean Today's Duplicates
							</Text>
						</TouchableOpacity>
						<TouchableOpacity
							onPress={() => void debugDuplicateIssue()}
							className="rounded-lg bg-white border border-gray-200 px-4 py-3 items-center"
						>
							<Text className="font-heading-semibold text-secondary text-text">
								Debug Duplicate Usage
							</Text>
						</TouchableOpacity>
						<TouchableOpacity
							onPress={() => void inspectTodaySummary()}
							className="rounded-lg bg-white border border-gray-200 px-4 py-3 items-center mt-sm"
						>
							<Text className="font-heading-semibold text-secondary text-text">
								Inspect Today's Summary
							</Text>
						</TouchableOpacity>
						<TouchableOpacity
							onPress={() => void openWidgetPreview()}
							className="rounded-lg bg-white border border-gray-200 px-4 py-3 items-center mt-sm"
						>
							<Text className="font-heading-semibold text-secondary text-text">
								Preview Widget
							</Text>
						</TouchableOpacity>
						<TouchableOpacity
							onPress={() => void openInsightsPreview()}
							className="rounded-lg bg-white border border-gray-200 px-4 py-3 items-center mt-sm"
						>
							<Text className="font-heading-semibold text-secondary text-text">
								Show Generated Insights
							</Text>
						</TouchableOpacity>
					</Card>
				)}
					</>
				)}
			</ScrollView>
		</SafeAreaView>
	);
}

function PermissionRow({
	label,
	granted,
	onPress,
}: {
	label: string;
	granted: boolean | null;
	onPress: () => void;
}) {
	return (
		<View className="py-sm border-b border-gray-100 last:border-b-0">
			<View className="flex-row items-center justify-between">
				<Text className="font-heading-semibold text-card-title text-text">
					{label}
				</Text>
				{granted === null ? (
					<SkeletonBlock className="h-10 w-20 rounded-lg" />
				) : granted ? (
					<Ionicons name="checkmark-circle" size={24} color="#10B981" />
				) : (
					<TouchableOpacity
						onPress={onPress}
						className="rounded-lg bg-accent px-4 py-2"
					>
						<Text className="font-heading-semibold text-secondary text-white">
							Grant
						</Text>
					</TouchableOpacity>
				)}
			</View>
		</View>
	);
}

function DiagnosticRow({ label, value }: { label: string; value: string }) {
	return (
		<View className="border-b border-gray-200 py-2 last:border-b-0">
			<Text className="font-heading-semibold text-secondary text-text">
				{label}
			</Text>
			<Text className="mt-1 font-body text-secondary text-muted">
				{value}
			</Text>
		</View>
	);
}

function compactJson(value: string): string {
	try {
		return JSON.stringify(JSON.parse(value));
	} catch {
		return value || "{}";
	}
}

function ToggleRow({
	label,
	value,
	onValueChange,
	onLabelPress,
}: {
	label: string;
	value: boolean;
	onValueChange: (value: boolean) => void;
	onLabelPress?: () => void;
}) {
	return (
		<View className="py-sm border-b border-gray-100 last:border-b-0">
			<View className="flex-row items-center justify-between">
				{onLabelPress ? (
					<TouchableOpacity onPress={onLabelPress} activeOpacity={0.85}>
						<Text className="font-heading-semibold text-card-title text-text">
							{label}
						</Text>
					</TouchableOpacity>
				) : (
					<Text className="font-heading-semibold text-card-title text-text">
						{label}
					</Text>
				)}
				<Switch
					value={value}
					onValueChange={onValueChange}
					trackColor={{ false: "#E5E7EB", true: "#5D3DF0" }}
					thumbColor={value ? "#FFFFFF" : "#9CA3AF"}
				/>
			</View>
		</View>
	);
}

function LinkRow({ label }: { label: string }) {
	return (
		<View className="flex-row items-center justify-between">
			<Text className="font-body text-body text-text">{label}</Text>
			<Ionicons name="chevron-forward" size={20} color="#64748B" />
		</View>
	);
}

function formatDuration(durationMs: number): string {
	const totalMinutes = Math.max(0, Math.round(durationMs / 60000));
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;

	if (hours > 0 && minutes > 0) {
		return `${hours}h ${minutes}m`;
	}

	if (hours > 0) {
		return `${hours}h`;
	}

	return `${minutes}m`;
}

function SettingsSkeletonCard() {
	return (
		<Card className="mx-md mb-md">
			<SkeletonBlock className="h-7 w-40" />
			<SkeletonBlock className="mt-3 h-4 w-full" />
			<SkeletonBlock className="mt-2 h-4 w-4/5" />
			<View className="mt-md">
				{Array.from({ length: 3 }).map((_, index) => (
					<View
						key={index}
						className="flex-row items-center justify-between border-b border-gray-100 py-sm last:border-b-0"
					>
						<View className="flex-1 pr-sm">
							<SkeletonBlock className="h-5 w-32" />
							<SkeletonBlock className="mt-2 h-3.5 w-44" />
						</View>
						<SkeletonBlock className="h-10 w-16 rounded-full" />
					</View>
				))}
			</View>
		</Card>
	);
}
