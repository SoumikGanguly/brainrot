import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Image,
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import AppSelectionBottomSheet from "@/components/AppSelectionBottomSheet";
import { Card } from "@/components/Card";
import FocusEducationModal, {
  type FocusEducationStep,
} from "@/components/FocusEducationModal";
import { Header } from "@/components/Header";
import SkeletonBlock from "@/components/SkeletonBlock";
import {
  AppBlockingService,
  type ProtectedApp,
  type ProtectionMode,
} from "@/services/AppBlockingService";
import { CapabilitiesService } from "@/services/CapabilitiesService";
import { InsightInvalidationService } from "@/services/InsightInvalidationService";
import {
  UnifiedUsageService,
  type ManufacturerPermissionInfo,
} from "@/services/UnifiedUsageService";
import { UsageService } from "@/services/UsageService";
import { database } from "@/services/database";
import type { AppSelectionItem } from "@/types";
import { formatTime } from "@/utils/time";

type PermissionState = {
	usage: boolean | null;
	overlay: boolean | null;
	accessibility: boolean | null;
};
type ViewApp = ProtectedApp & {
	usageTodayMs: number;
	opensToday: number;
};
type RefreshUsageStrategy = "never" | "auto" | "always";
type RefreshSource =
	| "initial_mount"
	| "app_active"
	| "invalidation"
	| "user_action"
	| "permission_reconcile";

const focusHero = require("../../assets/expressions/disappointed.png");
const LOCK_MODE_PROMPT_SEEN_KEY = "focus_lock_mode_prompt_seen";
const FOCUS_USAGE_STALE_MS = 45_000;

type LockModePromptState =
	| { source: "focus_session" }
	| { source: "locked_mode"; app: ViewApp }
	| null;

const MODE_META: Record<
	ProtectionMode,
	{
		label: string;
		icon: keyof typeof MaterialIcons.glyphMap;
		chipClass: string;
		textClass: string;
		description: string;
	}
> = {
	monitor: {
		label: "Monitor",
		icon: "shield",
		chipClass: "border-[#D8E3FF] bg-[#F3F7FF]",
		textClass: "text-[#3563E9]",
		description: "Track usage and impact your brain score.",
	},
	limit: {
		label: "Limit",
		icon: "hourglass-top",
		chipClass: "border-[#FBD7B5] bg-[#FFF5EB]",
		textClass: "text-[#F97316]",
		description: "Show the reflection screen on app open and every 15 minutes.",
	},
	locked: {
		label: "Locked",
		icon: "lock",
		chipClass: "border-[#F5C6CC] bg-[#FFF2F4]",
		textClass: "text-[#EF4444]",
		description: "Block the app completely with 2 passes for emergencies.",
	},
	ignore: {
		label: "Ignore",
		icon: "visibility-off",
		chipClass: "border-[#E5E7EB] bg-[#F8FAFC]",
		textClass: "text-[#64748B]",
		description: "Remove this app from your protected list.",
	},
};

export default function FocusScreen() {
	const [availableApps, setAvailableApps] = useState<AppSelectionItem[]>([]);
	const [protectedApps, setProtectedApps] = useState<ViewApp[]>([]);
	const [permissions, setPermissions] = useState<PermissionState>({
		usage: null,
		overlay: null,
		accessibility: null,
	});
	const [loading, setLoading] = useState(true);
	const [showAppSelection, setShowAppSelection] = useState(false);
	const [modePickerApp, setModePickerApp] = useState<ViewApp | null>(null);
	const [focusSessionActive, setFocusSessionActive] = useState(false);
	const [lockModePrompt, setLockModePrompt] =
		useState<LockModePromptState>(null);
	const [focusSessionPending, setFocusSessionPending] = useState(false);
	const [focusSessionPendingAction, setFocusSessionPendingAction] = useState<
		"start" | "end" | null
	>(null);
	const [firstUseFlowStep, setFirstUseFlowStep] =
		useState<FocusEducationStep>("accessibility");
	const [manufacturerInfo, setManufacturerInfo] =
		useState<ManufacturerPermissionInfo | null>(null);
	const appStateRef = useRef(AppState.currentState);
	const availableAppsRef = useRef<AppSelectionItem[]>([]);
	const protectedAppsRef = useRef<ViewApp[]>([]);
	const permissionsRef = useRef<PermissionState>({
		usage: null,
		overlay: null,
		accessibility: null,
	});
	const usageDetailsLoadedAtRef = useRef(0);
	const refreshSequenceRef = useRef(0);
	const initialLoadCompleteRef = useRef(false);

	useEffect(() => {
		availableAppsRef.current = availableApps;
	}, [availableApps]);

	useEffect(() => {
		protectedAppsRef.current = protectedApps;
	}, [protectedApps]);

	useEffect(() => {
		permissionsRef.current = permissions;
	}, [permissions]);

	useEffect(() => {
		console.log("[Focus] mounted");
		void refresh({
			showLoader: true,
			source: "initial_mount",
			refreshUsage: "always",
		});
		const subscription = AppState.addEventListener("change", (status) => {
			if (
				appStateRef.current.match(/inactive|background/) &&
				status === "active"
			) {
				void refresh({ source: "app_active", refreshUsage: "auto" });
			}
			appStateRef.current = status;
		});
		return () => {
			console.log("[Focus] unmounted");
			subscription.remove();
		};
	}, []);

	useEffect(() => {
		const unsubscribe = InsightInvalidationService.subscribe((event) => {
			const refreshUsage: RefreshUsageStrategy =
				event.type === "permissions_changed" ? "always" : "auto";
			if (
				event.type === "focus_session_changed" ||
				event.type === "protected_apps_changed" ||
				event.type === "permissions_changed" ||
				event.type === "insight_action_applied"
			) {
				void refresh({ source: "invalidation", refreshUsage });
			}
		});
		return unsubscribe;
	}, []);

	const mergeProtectedApps = (
		protectedList: ProtectedApp[],
		usageMap: Map<string, number>,
		opensMap: Map<string, number>,
	): ViewApp[] => {
		const previousByPackage = new Map(
			protectedAppsRef.current.map((app) => [app.packageName, app]),
		);

		return protectedList
			.map((app) => {
				const previous = previousByPackage.get(app.packageName);
				return {
					...app,
					usageTodayMs:
						usageMap.get(app.packageName) ?? previous?.usageTodayMs ?? 0,
					opensToday:
						opensMap.get(app.packageName) ?? previous?.opensToday ?? 0,
				};
			})
			.sort((a, b) => a.appName.localeCompare(b.appName));
	};

	const syncAvailableAppsMonitoredState = (
		apps: AppSelectionItem[],
		protectedList: ProtectedApp[],
	): AppSelectionItem[] => {
		const protectedPackages = new Set(
			protectedList.map((app) => app.packageName),
		);
		return apps.map((app) => ({
			...app,
			isCurrentlyMonitored: protectedPackages.has(app.packageName),
		}));
	};

	const refreshFocusStatus = async (
		source: RefreshSource,
	): Promise<ProtectedApp[]> => {
		const blockingService = AppBlockingService.getInstance();
		await blockingService.initialize();

		console.log(
			`[Focus] refresh status #${++refreshSequenceRef.current} (${source})`,
		);

		const [
			protectedList,
			usage,
			overlay,
			accessibility,
			focusActive,
			nextManufacturerInfo,
		] = await Promise.all([
			blockingService.getProtectedApps(),
			CapabilitiesService.hasUsageAccess(),
			CapabilitiesService.hasOverlayPermission(),
			CapabilitiesService.hasAccessibilityPermission(),
			blockingService.isFocusSessionActive(),
			UnifiedUsageService.getManufacturerInfo(),
		]);

		setPermissions({ usage, overlay, accessibility });
		setFocusSessionActive(focusActive);
		setManufacturerInfo(
			nextManufacturerInfo?.needsSpecialPermission
				? nextManufacturerInfo
				: null,
		);
		setProtectedApps(mergeProtectedApps(protectedList, new Map(), new Map()));

		if (availableAppsRef.current.length > 0) {
			setAvailableApps(
				syncAvailableAppsMonitoredState(
					availableAppsRef.current,
					protectedList,
				),
			);
		}

		return protectedList;
	};

	const refreshUsageDetails = async (
		source: RefreshSource,
		options: { force?: boolean; protectedList?: ProtectedApp[] } = {},
	) => {
		const { force = false, protectedList = protectedAppsRef.current } = options;
		const isStale =
			Date.now() - usageDetailsLoadedAtRef.current > FOCUS_USAGE_STALE_MS ||
			availableAppsRef.current.length === 0;

		if (!force && !isStale) {
			console.log(`[Focus] skipped usage refresh (${source})`);
			return;
		}

		console.log(`[Focus] refresh usage (${source})`);

		const [installedApps, todayUsage, todaySessions] = await Promise.all([
			UnifiedUsageService.getInstalledApps(),
			UnifiedUsageService.getTodayUsage(),
			UsageService.getTodaySessions(),
		]);

		const usageMap = new Map(
			todayUsage.map((app) => [app.packageName, app.totalTimeMs]),
		);
		const opensMap = new Map<string, number>();
		for (const session of todaySessions) {
			opensMap.set(
				session.packageName,
				(opensMap.get(session.packageName) || 0) + 1,
			);
		}

		const protectedPackages = new Set(
			protectedList.map((app) => app.packageName),
		);
		setAvailableApps(
			installedApps.map(
				(app): AppSelectionItem => ({
					packageName: app.packageName,
					appName: app.appName,
					isRecommended: !!(app as { isRecommended?: boolean }).isRecommended,
					isCurrentlyMonitored: protectedPackages.has(app.packageName),
					isSelected: false,
				}),
			),
		);
		setProtectedApps(mergeProtectedApps(protectedList, usageMap, opensMap));
		usageDetailsLoadedAtRef.current = Date.now();
	};

	async function refresh({
		showLoader = false,
		source,
		refreshUsage = "auto",
	}: {
		showLoader?: boolean;
		source: RefreshSource;
		refreshUsage?: RefreshUsageStrategy;
	}) {
		if (showLoader && !initialLoadCompleteRef.current) {
			setLoading(true);
		}

		try {
			const previousPermissions = permissionsRef.current;
			const protectedList = await refreshFocusStatus(source);
			const permissionsChanged =
				previousPermissions.usage !== permissionsRef.current.usage ||
				previousPermissions.overlay !== permissionsRef.current.overlay ||
				previousPermissions.accessibility !==
					permissionsRef.current.accessibility;

			if (
				refreshUsage === "always" ||
				(refreshUsage === "auto" &&
					(permissionsChanged ||
						!initialLoadCompleteRef.current ||
						Date.now() - usageDetailsLoadedAtRef.current >
							FOCUS_USAGE_STALE_MS))
			) {
				await refreshUsageDetails(source, {
					force:
						refreshUsage === "always" ||
						permissionsChanged ||
						!initialLoadCompleteRef.current,
					protectedList,
				});
			}
		} finally {
			setLoading(false);
			initialLoadCompleteRef.current = true;
		}
	}

	const handleModeChange = async (app: ViewApp, mode: ProtectionMode) => {
		if (mode === "locked") {
			const hasSeenPrompt =
				(await database.getMeta(LOCK_MODE_PROMPT_SEEN_KEY)) === "true";
			if (!hasSeenPrompt) {
				setModePickerApp(null);
				setFirstUseFlowStep("accessibility");
				setLockModePrompt({ source: "locked_mode", app });
				return;
			}
			await applyLockedMode(app);
			return;
		}

		if (
			mode === "limit" &&
			!permissions.accessibility &&
			!permissions.overlay
		) {
			const granted =
				await CapabilitiesService.ensureOverlayPermission("focus_mode");
			if (!granted) {
				await refresh({
					source: "permission_reconcile",
					refreshUsage: "always",
				});
				return;
			}
		}

		setProtectedApps((current) =>
			current.map((item) =>
				item.packageName === app.packageName
					? { ...item, protectionMode: mode }
					: item,
			),
		);
		await AppBlockingService.getInstance().setProtectionMode(
			app.packageName,
			app.appName,
			mode,
			"focus_tab",
		);
		InsightInvalidationService.emit({
			type: "protected_apps_changed",
			source: "focus",
			packageName: app.packageName,
		});
		setModePickerApp(null);
		await refresh({ source: "user_action", refreshUsage: "never" });
	};

	const triggerLightHaptic = async () => {
		try {
			await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
		} catch (error) {
			console.warn("Haptics unavailable:", error);
		}
	};

	const applyLockedMode = async (app: ViewApp) => {
		if (!permissions.accessibility) {
			const granted =
				await CapabilitiesService.ensureAccessibilityPermission("lock_mode");
			if (!granted) {
				await refresh({
					source: "permission_reconcile",
					refreshUsage: "always",
				});
				return;
			}
		}

		setProtectedApps((current) =>
			current.map((item) =>
				item.packageName === app.packageName
					? { ...item, protectionMode: "locked" }
					: item,
			),
		);
		await AppBlockingService.getInstance().setProtectionMode(
			app.packageName,
			app.appName,
			"locked",
			"focus_tab",
		);
		InsightInvalidationService.emit({
			type: "protected_apps_changed",
			source: "focus",
			packageName: app.packageName,
		});
		setModePickerApp(null);
		await refresh({ source: "user_action", refreshUsage: "never" });
	};

	const startFocusSession = async () => {
		const service = AppBlockingService.getInstance();
		if (focusSessionActive) {
			await service.endFocusSession();
			setFocusSessionActive(false);
			InsightInvalidationService.emit({
				type: "focus_session_changed",
				source: "focus",
			});
			await refresh({ source: "user_action", refreshUsage: "never" });
			return;
		}

		if (!permissions.usage) {
			const granted = await CapabilitiesService.ensureUsageAccess("focus_mode");
			if (!granted) {
				await refresh({
					source: "permission_reconcile",
					refreshUsage: "always",
				});
				return;
			}
		}

		if (!permissions.accessibility) {
			const granted =
				await CapabilitiesService.ensureAccessibilityPermission("focus_mode");
			if (!granted) {
				await refresh({
					source: "permission_reconcile",
					refreshUsage: "always",
				});
				return;
			}
		}

		const started = await service.startFocusSession();
		if (started) {
			setFocusSessionActive(true);
			InsightInvalidationService.emit({
				type: "focus_session_changed",
				source: "focus",
			});
			await refresh({ source: "user_action", refreshUsage: "never" });
		}
	};

	const handleFocusSessionPress = async () => {
		if (focusSessionPending) {
			return;
		}

		await triggerLightHaptic();
		const pendingAction: "start" | "end" = focusSessionActive ? "end" : "start";
		setFocusSessionPendingAction(pendingAction);
		setFocusSessionPending(true);

		try {
			if (!focusSessionActive) {
				const hasSeenPrompt =
					(await database.getMeta(LOCK_MODE_PROMPT_SEEN_KEY)) === "true";
				if (!hasSeenPrompt) {
					setFirstUseFlowStep("accessibility");
					setLockModePrompt({ source: "focus_session" });
					return;
				}
			}

			await startFocusSession();
		} finally {
			setFocusSessionPending(false);
			setFocusSessionPendingAction(null);
		}
	};

	const continueLockModePrompt = async () => {
		const prompt = lockModePrompt;
		if (!prompt) {
			return;
		}

		if (firstUseFlowStep === "accessibility") {
			if (permissions.accessibility) {
				await database.setMeta(LOCK_MODE_PROMPT_SEEN_KEY, "true");
				setLockModePrompt(null);
				setFirstUseFlowStep("accessibility");

				if (prompt.source === "focus_session") {
					await startFocusSession();
					return;
				}

				await applyLockedMode(prompt.app);
				return;
			}

			const granted =
				await CapabilitiesService.ensureAccessibilityPermission("lock_mode");
			await refresh({ source: "permission_reconcile", refreshUsage: "always" });
			if (granted) {
				await database.setMeta(LOCK_MODE_PROMPT_SEEN_KEY, "true");
				setLockModePrompt(null);
				setFirstUseFlowStep("accessibility");

				if (prompt.source === "focus_session") {
					await startFocusSession();
					return;
				}

				await applyLockedMode(prompt.app);
			}
			return;
		}

		if (manufacturerInfo?.canOpenDirectly) {
			await CapabilitiesService.openBackgroundReliabilitySettings("lock_mode");
		}

		await database.setMeta(LOCK_MODE_PROMPT_SEEN_KEY, "true");
		setLockModePrompt(null);
		setFirstUseFlowStep("accessibility");

		if (prompt.source === "focus_session") {
			await startFocusSession();
			return;
		}

		await applyLockedMode(prompt.app);
	};

	const closeFirstUseFlow = () => {
		setLockModePrompt(null);
		setFirstUseFlowStep("accessibility");
	};

	return (
		<SafeAreaView className="flex-1 bg-bg">
			<ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
				<Header title="Focus" />

				<View className="px-md pb-sm">
					<Text className="font-body text-body text-muted">
						Choose how Brainrot protects you from distractions.
					</Text>
				</View>

				{loading ? (
					<>
						<FocusHeroSkeleton />
						<FocusListSkeleton />
					</>
				) : (
					<>
						<Card className="mx-md mb-md overflow-hidden border border-[#E8DFFF] bg-[#F7F3FF] px-md">
							<View className="flex-row items-center">
								<View className="flex-1 pr-md">
									<Text className="font-heading-bold text-section text-accent">
										Focus Session
									</Text>
									<Text className="mt-sm font-body text-body text-slate-600">
										Lock all protected apps and stay in the zone.
									</Text>
									<TouchableOpacity
										onPress={handleFocusSessionPress}
										disabled={focusSessionPending}
										className={`mt-md self-start rounded-2xl px-5 py-3 ${
											focusSessionActive
												? "bg-[#EF4444]"
												: "bg-accent"
										}`}
										style={{ opacity: focusSessionPending ? 0.72 : 1 }}
									>
										<View className="flex-row items-center">
											{focusSessionPending ? (
												<ActivityIndicator size="small" color="#FFFFFF" />
											) : (
												<Ionicons
													name={
														focusSessionActive
															? "stop-circle-outline"
															: "timer-outline"
													}
													size={18}
													color="#FFFFFF"
												/>
											)}
											<Text className="ml-2 font-heading-semibold text-card-title text-white">
												{focusSessionPending
													? focusSessionPendingAction === "end"
														? "Ending Focus Session..."
														: "Starting Focus Session..."
													: focusSessionActive
														? "End Focus Session"
														: "Start Focus Session"}
											</Text>
										</View>
									</TouchableOpacity>
								</View>
								<View
									style={{
										width: 142,
										height: 142,
										overflow: "hidden",
									}}
								>
									<Image
										source={focusHero}
										resizeMode="cover"
										style={{
											width: 170,
											height: 170,
											marginLeft: -14,
											marginTop: -14,
										}}
									/>
								</View>
							</View>
						</Card>

						<Card className="mx-md mb-md">
							<View className="mb-md flex-row items-center justify-between">
								<View className="flex-1 pr-sm">
									<Text className="font-heading-bold text-section text-text">
										Protected Apps
									</Text>
									<Text className="mt-1 font-body text-secondary text-muted">
										Choose the protection level for each app.
									</Text>
								</View>
								<TouchableOpacity
									onPress={() => setShowAppSelection(true)}
									className="flex-row items-center rounded-full border border-[#D9D1FF] bg-white px-4 py-2"
								>
									<Ionicons
										name="add-circle-outline"
										size={18}
										color="#5B4CF0"
									/>
									<Text className="ml-2 font-heading-semibold text-secondary text-accent">
										Add App
									</Text>
								</TouchableOpacity>
							</View>

							{protectedApps.length === 0 ? (
								<View className="rounded-2xl bg-surface px-4 py-6">
									<Text className="text-center font-body text-body text-muted">
										No protected apps yet. Add one to start monitoring your
										focus.
									</Text>
								</View>
							) : (
								protectedApps.map((app) => {
									const modeMeta = MODE_META[app.protectionMode];
									return (
										<View
											key={app.packageName}
											className="border-b border-gray-100 py-md last:border-b-0"
										>
											<View className="flex-row items-center justify-between">
												<View className="flex-1 pr-sm">
													<Text className="font-heading-semibold text-card-title text-text">
														{app.appName}
													</Text>
													<Text className="mt-1 font-body text-secondary text-muted">
														{formatTime(app.usageTodayMs)} today
														{`  •  `}
														{app.opensToday} opens
													</Text>
												</View>
												<View className="ml-sm flex-row items-center">
													<TouchableOpacity
														onPress={() => setModePickerApp(app)}
														className={`flex-row items-center rounded-full border px-4 py-2 ${modeMeta.chipClass}`}
													>
														<MaterialIcons
															name={modeMeta.icon}
															size={18}
															color={getModeColor(app.protectionMode)}
														/>
														<Text
															className={`mx-2 font-heading-semibold text-secondary ${modeMeta.textClass}`}
														>
															{focusSessionActive &&
															app.protectionMode !== "ignore"
																? "Locked"
																: modeMeta.label}
														</Text>
														<Ionicons
															name="chevron-down"
															size={16}
															color={getModeColor(app.protectionMode)}
														/>
													</TouchableOpacity>
												</View>
											</View>
										</View>
									);
								})
							)}
						</Card>
					</>
				)}
			</ScrollView>

			<Modal
				visible={modePickerApp !== null}
				transparent
				animationType="fade"
				onRequestClose={() => setModePickerApp(null)}
			>
				<View className="flex-1 justify-end bg-black/35 px-md pb-md">
					<TouchableOpacity
						className="flex-1"
						activeOpacity={1}
						onPress={() => setModePickerApp(null)}
					/>
					<View className="rounded-[28px] bg-white p-md">
						<View className="mb-md flex-row items-center justify-between">
							<View className="flex-1 pr-sm">
								<Text className="font-heading-bold text-section text-text">
									Protection Level
								</Text>
								<Text className="mt-1 font-body text-secondary text-muted">
									{modePickerApp?.appName}
								</Text>
							</View>
							<TouchableOpacity
								onPress={() => setModePickerApp(null)}
								className="rounded-full bg-slate-100 p-2"
							>
								<Ionicons name="close" size={18} color="#475569" />
							</TouchableOpacity>
						</View>

						{(Object.keys(MODE_META) as ProtectionMode[]).map((mode) => {
							const meta = MODE_META[mode];
							const isActive = modePickerApp?.protectionMode === mode;
							return (
								<TouchableOpacity
									key={mode}
									onPress={() =>
										modePickerApp && void handleModeChange(modePickerApp, mode)
									}
									className={`mb-sm flex-row items-center rounded-2xl border px-4 py-4 ${isActive ? meta.chipClass : "border-gray-200 bg-white"}`}
								>
									<MaterialIcons
										name={meta.icon}
										size={20}
										color={getModeColor(mode)}
									/>
									<View className="ml-3 flex-1">
										<Text
											className={`font-heading-semibold text-card-title ${meta.textClass}`}
										>
											{meta.label}
										</Text>
										<Text className="mt-1 font-body text-secondary text-muted">
											{meta.description}
										</Text>
									</View>
									{isActive ? (
										<Ionicons
											name="checkmark-circle"
											size={20}
											color={getModeColor(mode)}
										/>
									) : null}
								</TouchableOpacity>
							);
						})}
					</View>
				</View>
			</Modal>

			<AppSelectionBottomSheet
				key={showAppSelection ? "open" : "closed"}
				isOpen={showAppSelection}
				onClose={() => setShowAppSelection(false)}
				onSave={(selectedPackages) =>
					AppBlockingService.getInstance()
						.addProtectedApps(
							selectedPackages.map((packageName) => ({
								packageName,
								appName:
									availableApps.find((app) => app.packageName === packageName)
										?.appName ||
									UnifiedUsageService.getAppDisplayName(packageName),
							})),
							"focus_tab",
						)
						.then(() => {
							InsightInvalidationService.emit({
								type: "protected_apps_changed",
								source: "focus",
							});
							setShowAppSelection(false);
							void refresh({ source: "user_action", refreshUsage: "auto" });
						})
				}
				availableApps={availableApps}
				currentlyMonitored={protectedApps.map((app) => app.packageName)}
			/>

			<FocusEducationModal
				visible={lockModePrompt !== null}
				step={firstUseFlowStep}
				accessibilityGranted={permissions.accessibility === true}
				manufacturerTitle={manufacturerInfo?.title}
				manufacturerInstructions={manufacturerInfo?.instructions}
				canOpenManufacturerSettings={manufacturerInfo?.canOpenDirectly}
				onClose={closeFirstUseFlow}
				onPrimary={() => void continueLockModePrompt()}
				onSecondary={closeFirstUseFlow}
			/>
		</SafeAreaView>
	);
}

function getModeColor(mode: ProtectionMode): string {
	switch (mode) {
		case "monitor":
			return "#3563E9";
		case "limit":
			return "#F97316";
		case "locked":
			return "#EF4444";
		case "ignore":
			return "#64748B";
	}
}

function FocusHeroSkeleton() {
	return (
		<Card className="mx-md mb-md overflow-hidden border border-[#E8DFFF] bg-[#F7F3FF] px-md py-lg">
			<View className="flex-row items-center">
				<View className="flex-1 pr-md">
					<SkeletonBlock className="h-8 w-40" />
					<SkeletonBlock className="mt-sm h-4 w-full" />
					<SkeletonBlock className="mt-2 h-4 w-4/5" />
					<SkeletonBlock className="mt-md h-12 w-44 rounded-2xl" />
				</View>
				<SkeletonBlock className="h-[182px] w-[182px] rounded-[32px]" />
			</View>
		</Card>
	);
}

function FocusListSkeleton() {
	return (
		<Card className="mx-md mb-md">
			<View className="mb-md flex-row items-center justify-between">
				<View className="flex-1 pr-sm">
					<SkeletonBlock className="h-7 w-40" />
					<SkeletonBlock className="mt-2 h-4 w-52" />
				</View>
				<SkeletonBlock className="h-10 w-28 rounded-full" />
			</View>

			{Array.from({ length: 4 }).map((_, index) => (
				<View
					key={index}
					className="border-b border-gray-100 py-md last:border-b-0"
				>
					<View className="flex-row items-center justify-between">
						<View className="flex-1 pr-sm">
							<SkeletonBlock className="h-5 w-32" />
							<SkeletonBlock className="mt-2 h-4 w-28" />
						</View>
						<SkeletonBlock className="h-10 w-28 rounded-full" />
					</View>
				</View>
			))}
		</Card>
	);
}
