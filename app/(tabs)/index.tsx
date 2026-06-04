import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import LottieView from "lottie-react-native";
import React, { useEffect, useRef, useState } from "react";
import {
	Alert,
	AppState,
	AppStateStatus,
	Modal,
	Pressable,
	ScrollView,
	Text,
	TouchableOpacity,
	View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PrimaryButton } from "../../components/Buttons";
import { Card } from "../../components/Card";
import { database } from "../../services/database";

import { DailyResetService } from "@/services/DailyResetService";
import { HistoricalDataService } from "@/services/HistoricalDataService";
import { TrialService } from "../../services/TrialService";
import { getBrainScoreStatus } from "../../utils/brainScore";
import { formatTime } from "../../utils/time";

import { AppBlockingService } from "@/services/AppBlockingService";
import { BrainScoreService } from "@/services/BrainScore";
import { DataSyncService } from "@/services/DataSyncService";
import { DailyInsightsService } from "@/services/DailyInsightsService";
import { NotificationService } from "@/services/NotificationService";
import { PurchaseService } from "@/services/PurchaseService";
import { TelemetryService } from "@/services/TelemetryService";

import {
	ManufacturerPermissionInfo,
	UnifiedUsageService,
} from "@/services/UnifiedUsageService";

interface AppUsage {
	packageName: string;
	appName: string;
	totalTimeMs: number;
}

export default function HomeScreen() {
	const [brainScore, setBrainScore] = useState(100);
	const [topApps, setTopApps] = useState<AppUsage[]>([]);
	const [allApps, setAllApps] = useState<AppUsage[]>([]);
	const [totalScreenTime, setTotalScreenTime] = useState(0);
	const [trialInfo, setTrialInfo] = useState({
		isActive: false,
		daysRemaining: 0,
		expired: false,
	});
	const [loading, setLoading] = useState(true);
	const [hasUsagePermission, setHasUsagePermission] = useState(false);
	const [showAllAppsModal, setShowAllAppsModal] = useState(false);
	const [manufacturerInfo, setManufacturerInfo] =
		useState<ManufacturerPermissionInfo | null>(null);
	const pendingPermissionCheck = useRef(false);
	const appStateRef = useRef<AppStateStatus>(AppState.currentState);
	const paywallLoggedRef = useRef<"trial" | "expired" | null>(null);

	useEffect(() => {
		let isInitialized = false;

		const initializeAllServices = async () => {
			if (isInitialized) return; // Prevent multiple initializations

			try {
				console.log("=== INITIALIZING ALL SERVICES ===");

				// 1. Initialize monitoring service first (handles notifications)
				const unifiedService = UnifiedUsageService.getInstance();
				await unifiedService.initialize();
				await NotificationService.ensureDefaultSchedules();
				console.log("✓ Unified usage service initialized");

				// 2. Initialize blocking service
				const blockingService = AppBlockingService.getInstance();
				await blockingService.initialize();
				console.log("✓ Blocking service initialized");

				// 3. Initialize historical data service
				const historicalService = HistoricalDataService.getInstance();
				// Only backfill if needed, not on every app start
				const lastBackfill = await database.getMeta("last_backfill_date");
				const today = new Date().toISOString().split("T")[0];
				if (lastBackfill !== today) {
					await historicalService.backfillHistoricalData(90);
					await database.setMeta("last_backfill_date", today);
					console.log("✓ Historical data backfilled");
				}

				// 4. Initialize daily reset service
				const dailyResetService = DailyResetService.getInstance();
				dailyResetService.initialize();
				console.log("✓ Daily reset service initialized");

				// 5. Sync monitored apps to native for background services
				try {
					const monitoredAppsData = await database.getMeta("monitored_apps");
					if (monitoredAppsData) {
						const monitoredPackages = JSON.parse(monitoredAppsData) as string[];
						await UnifiedUsageService.syncMonitoredAppsToNative(
							monitoredPackages,
						);
						console.log("✓ Monitored apps synced to native");
					}
				} catch (syncError) {
					console.warn("Failed to sync monitored apps to native:", syncError);
				}

				// 5. Clean up duplicates once
				await database.cleanupDuplicateEntries();
				console.log("✓ Database cleanup completed");

				isInitialized = true;
				console.log("=== ALL SERVICES INITIALIZED ===");
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

		// Initialize once
		initializeAllServices();
		loadManufacturerInfo();

		// Handle app state changes
		const handleAppStateChange = async (nextAppState: AppStateStatus) => {
			if (
				appStateRef.current.match(/inactive|background/) &&
				nextAppState === "active"
			) {
				console.log("App became active, refreshing services...");

				// Check if we were waiting for permission after opening settings
				if (pendingPermissionCheck.current) {
					pendingPermissionCheck.current = false;
					console.log("Checking permission after returning from settings...");

					// Small delay to let the system update permission state
					setTimeout(async () => {
						try {
							const hasPermission =
								await UnifiedUsageService.isUsageAccessGranted();
							console.log("Permission after settings:", hasPermission);
							setHasUsagePermission(hasPermission);

							if (hasPermission) {
								console.log("Permission granted! Refreshing data...");
								loadHomeData();
							}
						} catch (error) {
							console.error("Error checking permission after settings:", error);
						}
					}, 500);
				}

				// Refresh monitoring when app comes to foreground
				const monitoringService = UnifiedUsageService.getInstance();
				await monitoringService.startMonitoring();
				await NotificationService.ensureDefaultSchedules();

				// Refresh blocking service
				const blockingService = AppBlockingService.getInstance();
				await blockingService.initialize();

				// Trigger immediate usage check
				setTimeout(() => {
					monitoringService.triggerManualCheck();
				}, 1000);
			}

			appStateRef.current = nextAppState;
		};

		const subscription = AppState.addEventListener(
			"change",
			handleAppStateChange,
		);

		// Cleanup on unmount
		return () => {
			subscription?.remove();
		};
	}, []);

	const checkNativeModuleAndPermissions = async () => {
		console.log("Checking native module availability...");

		// Check if native module is available
		const isModuleAvailable = UnifiedUsageService.isNativeModuleAvailable();
		console.log(`Native module available: ${isModuleAvailable}`);

		if (!isModuleAvailable) {
			console.log("Native module not available - using fallback data");
			return { hasModule: false, hasPermission: false };
		}

		// Check permissions with retry
		console.log("Checking usage access permissions...");
		try {
			let hasPermission = await UnifiedUsageService.isUsageAccessGranted();
			console.log(`Usage permission granted: ${hasPermission}`);

			// If permission is false but we're returning from settings, try again after a delay
			if (!hasPermission) {
				console.log("Permission denied, trying force refresh...");
				// Try the force refresh method if available
				try {
					if (UnifiedUsageService.forceRefreshPermission) {
						hasPermission = await UnifiedUsageService.forceRefreshPermission();
						console.log(`Force refresh result: ${hasPermission}`);
					}
				} catch {
					console.log("Force refresh failed, continuing with normal flow...");
				}
			}

			setHasUsagePermission(hasPermission);

			if (!hasPermission) {
				console.log("Requesting usage permission from user...");
				Alert.alert(
					"Usage Access Required",
					"Grant usage access permission to track screen time.\n\n1. Find your app in the list\n2. Toggle the permission ON\n3. Return to the app",
					[
						{ text: "Later", style: "cancel" },
						{
							text: "Grant Permission",
							onPress: async () => {
								try {
									pendingPermissionCheck.current = true;
									console.log("Opening usage access settings...");
									await UnifiedUsageService.openUsageAccessSettings();
								} catch (settingsError: unknown) {
									const errorMessage =
										settingsError instanceof Error
											? settingsError.message
											: "Unknown error opening settings";
									console.log(`Failed to open settings: ${errorMessage}`);
									pendingPermissionCheck.current = false;
								}
							},
						},
					],
				);
			}

			return { hasModule: true, hasPermission };
		} catch (error: unknown) {
			const errorMessage =
				error instanceof Error
					? error.message
					: "Unknown permission check error";
			console.log(`Permission check failed: ${errorMessage}`);
			return { hasModule: true, hasPermission: false };
		}
	};

	async function loadHomeData() {
		try {
			setLoading(true);
			console.log("Starting home data load...");

			// Step 1: Check permissions (keep existing logic)
			const { hasModule, hasPermission } =
				await checkNativeModuleAndPermissions();

			// Step 2: Sync data from native to database (if we have permission)
			if (hasModule && hasPermission) {
				try {
					const syncService = DataSyncService.getInstance();
					await syncService.syncUsageData();
					console.log("Data synced from native");
				} catch (error) {
					console.log(`Sync failed: ${error}`);
				}
			}

			// Step 3: Get brain score using SINGLE source of truth
			const today = new Date().toISOString().split("T")[0];
			const insights = await DailyInsightsService.getInstance().getDailyInsights(today, {
				forceSummaryRefresh: true,
			});
			const result = insights.summary
				? insights.summary
				: await BrainScoreService.getInstance().getTodayScore().then((value) => ({
						totalScreenTime: value.totalUsageMs,
						brainScore: value.score,
						focusScore: value.score,
						apps: value.apps,
					}));

			console.log(
				`Score computed: ${result.brainScore}, ${result.apps.length} apps`,
			);

			// Step 4: Update UI
			setBrainScore(result.focusScore ?? result.brainScore);
			setTotalScreenTime(result.totalScreenTime);
			setTopApps(result.apps.slice(0, 3));
			setAllApps(result.apps);

			// Step 5: Load trial info (keep existing)
			try {
				const trial = await TrialService.getTrialInfo();
				setTrialInfo(trial);
				console.log("Trial info loaded");
			} catch (error) {
				console.log(`Trial info failed: ${error}`);
			}
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			console.log(`Critical error: ${errorMessage}`);
		} finally {
			setLoading(false);
			console.log("Home data loading completed");
		}
	}

	useFocusEffect(
		React.useCallback(() => {
			loadHomeData();
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

	const getBrainAnimationState = () => {
		if (brainScore >= 80) return "healthy";
		if (brainScore >= 50) return "warning";
		return "critical";
	};

	const getBrainStatusText = () => {
		return getBrainScoreStatus(brainScore).text;
	};

	const renderAllAppsModal = () => (
		<Modal
			visible={showAllAppsModal}
			transparent={true}
			animationType="slide"
			onRequestClose={() => setShowAllAppsModal(false)}
		>
			<View className="flex-1 justify-end bg-black/50">
				<Pressable
					className="flex-1"
					onPress={() => setShowAllAppsModal(false)}
				/>
				<View className="bg-card rounded-t-3xl" style={{ height: "50%" }}>
					{/* Header */}
					<View className="flex-row items-center justify-between p-4 border-b border-gray-200">
						<Text className="font-heading-semibold text-section text-text">
							All Apps Today ({allApps.length})
						</Text>
						<TouchableOpacity
							onPress={() => setShowAllAppsModal(false)}
							className="w-8 h-8 rounded-full bg-gray-100 items-center justify-center"
						>
							<Ionicons name="close" size={20} color="#64748B" />
						</TouchableOpacity>
					</View>

					{/* Apps List */}
					<ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
						{allApps.length === 0 ? (
							<View className="py-12 items-center">
								<Text className="font-body text-body text-muted text-center">
									{hasUsagePermission
										? "No usage data available for today"
										: "Grant usage permission to see your app usage"}
								</Text>
							</View>
						) : (
							<View className="p-4">
								{allApps.map((app, index) => (
									<View
										key={`${app.packageName}-${index}`}
										className="flex-row items-center justify-between py-3 border-b border-gray-100 last:border-b-0"
									>
										<View className="flex-row items-center flex-1">
											<View className="w-10 h-10 bg-accent/10 rounded-full items-center justify-center mr-3">
												<Text className="font-heading-bold text-secondary text-accent">
													{index + 1}
												</Text>
											</View>
											<View className="flex-1">
												<Text
													className="font-heading-semibold text-card-title text-text"
													numberOfLines={1}
												>
													{app.appName}
												</Text>
												<Text className="font-body text-secondary text-muted">
													{app.packageName}
												</Text>
											</View>
										</View>
										<View className="items-end">
											<Text className="font-heading-semibold text-card-title text-text">
												{formatTime(app.totalTimeMs)}
											</Text>
											<Text className="font-body text-secondary text-muted">
												{totalScreenTime > 0
													? ((app.totalTimeMs / totalScreenTime) * 100).toFixed(
															1,
														)
													: "0.0"}
												%
											</Text>
										</View>
									</View>
								))}
							</View>
						)}
					</ScrollView>
				</View>
			</View>
		</Modal>
	);

	if (loading) {
		return (
			<SafeAreaView className="flex-1 bg-bg">
				<View className="flex-1 justify-center items-center p-4">
					<Text className="mb-4 font-body text-body text-muted">
						Loading...
					</Text>
				</View>
			</SafeAreaView>
		);
	}

	return (
		<SafeAreaView className="flex-1 bg-bg">
			<ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
				{/* Brain Animation Section */}
				<View className="items-center py-lg">
					<View className="w-64 h-64">
						<LottieView
							source={require("../../assets/animations/brain.json")}
							autoPlay
							loop
							style={{ width: "100%", height: "100%" }}
							speed={getBrainAnimationState() === "critical" ? 0.5 : 1}
						/>
					</View>

					<View className="items-center mt-md">
						<Text className="text-5xl font-bold text-text">{brainScore}</Text>
						<Text className="mt-xs font-body text-body text-muted">
							{getBrainStatusText()}
						</Text>
					</View>
				</View>

				{/* Permission Warning - Show prominently when not granted */}
				{!hasUsagePermission && (
					<Card className="mx-md mb-md bg-yellow-50 border border-yellow-200">
						<View className="flex-row items-start">
							<Ionicons
								name="warning"
								size={24}
								color="#D97706"
								style={{ marginRight: 12, marginTop: 2 }}
							/>
							<View className="flex-1">
								<Text className="text-base font-semibold text-yellow-800 mb-1">
									Usage Access Required
								</Text>
								<Text className="text-sm text-yellow-700 mb-3">
									Grant usage access permission to track your screen time and
									protect your brain health.
								</Text>
								<TouchableOpacity
									onPress={async () => {
										try {
											pendingPermissionCheck.current = true;
											console.log("Opening usage settings...");
											await UnifiedUsageService.openUsageAccessSettings();
										} catch (error) {
											console.error("Failed to open settings:", error);
											pendingPermissionCheck.current = false;
										}
									}}
									className="bg-yellow-600 px-4 py-2 rounded-lg self-start"
								>
									<Text className="text-white font-medium">
										Grant Permission
									</Text>
								</TouchableOpacity>

								{manufacturerInfo?.needsSpecialPermission && (
									<View className="mt-3 p-3 bg-yellow-100 rounded-lg border border-yellow-200">
										<Text className="text-sm font-semibold text-yellow-900 mb-1">
											{manufacturerInfo.title}
										</Text>
										<Text className="text-xs text-yellow-800 mb-2">
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
												className="bg-yellow-700 px-3 py-2 rounded-lg self-start"
											>
												<Text className="text-white text-xs font-medium">
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

				{/* Trial/Purchase CTA */}
				{trialInfo.isActive && !trialInfo.expired && (
					<Card className="mx-md mb-md bg-accent/10 border-accent/20">
						<View className="items-center">
							<Text className="text-base text-accent font-semibold mb-sm">
								7-day trial active — {trialInfo.daysRemaining} days left
							</Text>
							<Text className="mb-md font-body text-secondary text-muted text-center">
								Unlock permanently for ₹149 / $2.99
							</Text>
							<PrimaryButton
								title="Unlock ₹149"
								onPress={() => void handlePurchasePress()}
								className="w-full"
							/>
						</View>
					</Card>
				)}

				{/* {trialInfo.expired && (
					<Card className="mx-md mb-md bg-danger/10 border-danger/20">
						<View className="items-center">
							<Text className="text-base text-danger font-semibold mb-sm">
								Trial Expired
							</Text>
							<Text className="mb-md font-body text-secondary text-muted text-center">
								Unlock all features and remove limitations
							</Text>
							<PrimaryButton
								title="Unlock Now ₹149"
								onPress={() => void handlePurchasePress()}
								className="w-full bg-danger"
							/>
						</View>
					</Card>
				)} */}

				{/* Today's Summary */}
				<Card className="mx-md mb-md">
					<Text className="mb-sm font-heading-bold text-section text-text">
						Today&apos;s Summary
					</Text>
					<View className="flex-row justify-between items-center">
						<Text className="font-body text-body text-muted">
							Total Screen Time
						</Text>
						<Text className="font-heading-semibold text-card-title text-text">
							{formatTime(totalScreenTime)}
						</Text>
					</View>
				</Card>

				{/* Top Apps */}
				<Card className="mx-md mb-md">
					<View className="flex-row items-center justify-between mb-sm">
						<Text className="font-heading-bold text-section text-text">
							Top Apps Today
						</Text>
						{allApps.length > 0 && (
							<TouchableOpacity
								onPress={() => setShowAllAppsModal(true)}
								className="flex-row items-center"
							>
								<Text className="mr-1 font-body-semibold text-secondary text-accent">
									Show All
								</Text>
								<Ionicons name="chevron-forward" size={16} color="#5B4CF0" />
							</TouchableOpacity>
						)}
					</View>

					{topApps.length === 0 ? (
						<View className="py-lg">
							<Text className="font-body text-body text-muted text-center">
								{hasUsagePermission
									? "No usage data available for today"
									: "Grant usage permission to see your app usage"}
							</Text>
							{!hasUsagePermission && (
								<Text className="mt-2 font-body text-secondary text-muted text-center">
									You&apos;ll be prompted for permission when you open the app
								</Text>
							)}
						</View>
					) : (
						topApps.map((app, index) => (
							<TouchableOpacity
								key={`${app.packageName}-${index}`}
								className="flex-row items-center justify-between py-sm border-b border-surface last:border-b-0"
								onPress={() => setShowAllAppsModal(true)}
							>
								<View className="flex-row items-center flex-1">
									<View className="w-8 h-8 bg-accent/20 rounded-full items-center justify-center mr-sm">
										<Text className="font-heading-bold text-secondary text-accent">
											{index + 1}
										</Text>
									</View>
									<View className="flex-1">
										<Text className="font-heading-semibold text-card-title text-text">
											{app.appName}
										</Text>
										<Text className="font-body text-secondary text-muted">
											{formatTime(app.totalTimeMs)}
										</Text>
									</View>
								</View>
								<Ionicons name="chevron-forward" size={20} color="#64748B" />
							</TouchableOpacity>
						))
					)}
				</Card>
			</ScrollView>

			{/* All Apps Modal */}
			{renderAllAppsModal()}
		</SafeAreaView>
	);
}
