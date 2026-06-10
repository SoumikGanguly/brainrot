/* eslint-disable react-hooks/set-state-in-effect */
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	Alert,
	AppState,
	Image,
	ScrollView,
	Text,
	TextInput,
	TouchableOpacity,
	View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppBlockingService } from "@/services/AppBlockingService";
import { CapabilitiesService } from "@/services/CapabilitiesService";
import { MonitoredAppsService } from "@/services/MonitoredAppsService";
import { buildPermissionTelemetry } from "@/services/TelemetryEvents";
import { TelemetryService } from "@/services/TelemetryService";
import { TrialService } from "@/services/TrialService";
import { UnifiedUsageService } from "@/services/UnifiedUsageService";
import { database } from "@/services/database";

type OnboardingFlowProps = {
	preview?: boolean;
};

type InstalledAppOption = {
	packageName: string;
	appName: string;
	isRecommended: boolean;
};

const TOTAL_STEPS = 8;
const BRAND_PURPLE = "#5D3DF0";
const BRAND_PURPLE_DARK = "#4C2EF0";

const COMMON_APP_OPTIONS: InstalledAppOption[] = [
	{
		packageName: "com.instagram.android",
		appName: "Instagram",
		isRecommended: true,
	},
	{
		packageName: "com.google.android.youtube",
		appName: "YouTube",
		isRecommended: true,
	},
	{ packageName: "com.twitter.android", appName: "X", isRecommended: true },
	{
		packageName: "com.reddit.frontpage",
		appName: "Reddit",
		isRecommended: true,
	},
	{
		packageName: "com.facebook.katana",
		appName: "Facebook",
		isRecommended: true,
	},
	{ packageName: "com.whatsapp", appName: "WhatsApp", isRecommended: true },
];

const DEFAULT_MONITORED_PACKAGES = new Set([
	"com.google.android.youtube",
	"com.instagram.android",
	"com.whatsapp",
	"com.facebook.katana",
	"com.ss.android.ugc.tiktok",
	"com.zhiliaoapp.musically",
	"com.twitter.android",
	"com.snapchat.android",
	"com.reddit.frontpage",
	"com.discord",
	"com.netflix.mediaclient",
]);

const ASSETS = {
	brainHealth: require("../../assets/onboarding_illustrations/brain_health.png"),
	confused: require("../../assets/onboarding_illustrations/onboarding_confused.png"),
	complete: require("../../assets/onboarding_illustrations/onboarding_complete.png"),
	replay: require("../../assets/onboarding_illustrations/replay_preview.png"),
	replayCard: require("../../assets/onboarding_illustrations/yesterday_replay.png"),
	blocking: require("../../assets/onboarding_illustrations/blocking_screen_preview.png"),
	permissions: require("../../assets/onboarding_illustrations/notification_preview.png"),
	completeCards: require("../../assets/onboarding_illustrations/onboarding_complete_cards.png"),
};

const SAMPLE_REPLAY = [
	{ time: "8:12 AM", app: "Instagram", duration: "17m", color: "#EF4444" },
	{ time: "1:43 PM", app: "YouTube", duration: "41m", color: "#F97316" },
	{ time: "5:32 PM", app: "WhatsApp", duration: "9m", color: "#16A34A" },
	{ time: "10:58 PM", app: "Instagram", duration: "53m", color: "#EF4444" },
];

function getOnboardingScreenName(step: number): string {
	const names = [
		"intro",
		"brain_health",
		"replay_preview",
		"app_picker",
		"focus_preview",
		"notification_preview",
		"usage_access",
		"all_set",
	] as const;
	return names[step] || `step_${step}`;
}

export default function OnboardingFlow({
	preview = false,
}: OnboardingFlowProps) {
	const [currentStep, setCurrentStep] = useState(0);
	const [usageGranted, setUsageGranted] = useState(false);
	const [accessibilityGranted, setAccessibilityGranted] = useState(false);
	const [loadingApps, setLoadingApps] = useState(true);
	const [installedApps, setInstalledApps] = useState<InstalledAppOption[]>([]);
	const [selectedPackages, setSelectedPackages] = useState<string[]>([]);
	const [appSearchQuery, setAppSearchQuery] = useState("");
	const [appsFallbackMode, setAppsFallbackMode] = useState(false);
	const [permissionSuccess, setPermissionSuccess] = useState<
		Record<"usage" | "accessibility", boolean>
	>({
		usage: false,
		accessibility: false,
	});
	const permissionPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const defaultSelectedPackagesRef = useRef<string[]>([]);
	const onboardingTrackedRef = useRef(false);

	const appOptions = useMemo(() => {
		if (installedApps.length > 0) {
			return installedApps;
		}
		return appsFallbackMode ? COMMON_APP_OPTIONS : [];
	}, [appsFallbackMode, installedApps]);

	const selectedAppEntry = useMemo(() => {
		return (
			appOptions.find((app) => selectedPackages.includes(app.packageName)) ||
			appOptions.find((app) => app.isRecommended) ||
			COMMON_APP_OPTIONS[0]
		);
	}, [appOptions, selectedPackages]);

	const filteredAppOptions = useMemo(() => {
		const normalizedQuery = appSearchQuery.trim().toLowerCase();
		return appOptions
			.filter((app) => {
				if (!normalizedQuery) {
					return true;
				}
				return (
					app.appName.toLowerCase().includes(normalizedQuery) ||
					app.packageName.toLowerCase().includes(normalizedQuery)
				);
			})
			.sort((a, b) => {
				if (a.isRecommended !== b.isRecommended) {
					return a.isRecommended ? -1 : 1;
				}
				if (
					selectedPackages.includes(a.packageName) !==
					selectedPackages.includes(b.packageName)
				) {
					return selectedPackages.includes(a.packageName) ? -1 : 1;
				}
				return a.appName.localeCompare(b.appName);
			});
	}, [appOptions, appSearchQuery, selectedPackages]);

	const refreshPermissionState = useCallback(async () => {
		const [usage, accessibility] = await Promise.all([
			CapabilitiesService.hasUsageAccess(),
			CapabilitiesService.hasAccessibilityPermission(),
		]);

		if (usage && !usageGranted) {
			TelemetryService.track("usage_access_granted", {
				screen_name: getOnboardingScreenName(currentStep),
				permission_result: "granted",
			});
			setPermissionSuccess((previous) => ({ ...previous, usage: true }));
			setTimeout(() => {
				setPermissionSuccess((previous) => ({ ...previous, usage: false }));
			}, 1600);
		}

		if (accessibility && !accessibilityGranted) {
			TelemetryService.track(
				"accessibility_granted",
				buildPermissionTelemetry("onboarding"),
			);
			setPermissionSuccess((previous) => ({
				...previous,
				accessibility: true,
			}));
			setTimeout(() => {
				setPermissionSuccess((previous) => ({
					...previous,
					accessibility: false,
				}));
			}, 1600);
		}

		setUsageGranted(usage);
		setAccessibilityGranted(accessibility);
	}, [accessibilityGranted, currentStep, usageGranted]);

	const loadInstalledApps = useCallback(async () => {
		setLoadingApps(true);
		try {
			const apps = await UnifiedUsageService.getAllInstalledApps();
			const safeApps = apps.length > 0 ? apps : [];
			setInstalledApps(safeApps);
			setAppsFallbackMode(safeApps.length === 0);
			const defaultSelected = safeApps
				.filter(
					(app) =>
						app.isRecommended ||
						DEFAULT_MONITORED_PACKAGES.has(app.packageName),
				)
				.map((app) => app.packageName);
			defaultSelectedPackagesRef.current =
				defaultSelected.length > 0
					? Array.from(new Set(defaultSelected))
					: safeApps
							.slice(0, Math.min(3, safeApps.length))
							.map((app) => app.packageName);
			setSelectedPackages(defaultSelectedPackagesRef.current);
		} catch (error) {
			console.warn("Unable to load installed apps for onboarding:", error);
			setInstalledApps(COMMON_APP_OPTIONS);
			setAppsFallbackMode(true);
			defaultSelectedPackagesRef.current = COMMON_APP_OPTIONS.filter(
				(app) => app.isRecommended,
			).map((app) => app.packageName);
			setSelectedPackages(defaultSelectedPackagesRef.current);
		} finally {
			setLoadingApps(false);
		}
	}, []);

	useEffect(() => {
		if (!preview && !onboardingTrackedRef.current) {
			onboardingTrackedRef.current = true;
			TelemetryService.track("onboarding_started", {
				screen_name: getOnboardingScreenName(0),
			});
		}

		let mounted = true;

		const bootstrap = async () => {
			try {
				const [usage, accessibility] = await Promise.all([
					CapabilitiesService.hasUsageAccess(),
					CapabilitiesService.hasAccessibilityPermission(),
				]);

				if (!mounted) {
					return;
				}

				setUsageGranted(usage);
				setAccessibilityGranted(accessibility);
			} catch (error) {
				console.warn("Failed to bootstrap onboarding permissions:", error);
			}
		};

		void bootstrap();
		void loadInstalledApps();

		const appStateSub = AppState.addEventListener("change", (state) => {
			if (state === "active") {
				void refreshPermissionState();
			}
		});

		return () => {
			mounted = false;
			appStateSub.remove();
			if (permissionPollRef.current) {
				clearInterval(permissionPollRef.current);
				permissionPollRef.current = null;
			}
		};
	}, [loadInstalledApps, refreshPermissionState]);

	useEffect(() => {
		if (preview) {
			return;
		}

		TelemetryService.track("onboarding_screen_viewed", {
			screen_name: getOnboardingScreenName(currentStep),
		});
	}, [currentStep, preview]);

	function clearPermissionPoll() {
		if (permissionPollRef.current) {
			clearInterval(permissionPollRef.current);
			permissionPollRef.current = null;
		}
	}

	function startPermissionPolling() {
		clearPermissionPoll();
		permissionPollRef.current = setInterval(() => {
			void refreshPermissionState();
		}, 1000);

		setTimeout(() => {
			clearPermissionPoll();
		}, 30000);
	}

	async function triggerHaptic(style: "light" | "medium") {
		try {
			await Haptics.impactAsync(
				style === "medium"
					? Haptics.ImpactFeedbackStyle.Medium
					: Haptics.ImpactFeedbackStyle.Light,
			);
		} catch (error) {
			console.warn("Haptics unavailable:", error);
		}
	}

	async function goNext() {
		await triggerHaptic(currentStep === 0 ? "medium" : "light");
		setCurrentStep((step) => Math.min(step + 1, TOTAL_STEPS - 1));
	}

	async function goBack() {
		await triggerHaptic("light");
		setCurrentStep((step) => Math.max(step - 1, 0));
	}

	async function jumpToFinalStep() {
		await triggerHaptic("light");
		setCurrentStep(TOTAL_STEPS - 1);
	}

	function goToApp() {
		router.replace("/");
	}

	async function openUsageAccess() {
		await triggerHaptic("medium");
		startPermissionPolling();
		const granted = await CapabilitiesService.ensureUsageAccess("onboarding");
		if (granted) {
			setUsageGranted(true);
			return;
		}
		TelemetryService.track("usage_access_denied", {
			screen_name: getOnboardingScreenName(currentStep),
			permission_result: "denied",
		});
	}

	async function openAccessibility() {
		await triggerHaptic("medium");
		startPermissionPolling();
		const granted =
			await CapabilitiesService.ensureAccessibilityPermission("onboarding");
		if (granted) {
			setAccessibilityGranted(true);
			return;
		}
		TelemetryService.track(
			"accessibility_denied",
			buildPermissionTelemetry("onboarding"),
		);
	}

	async function finishOnboarding() {
		await triggerHaptic("medium");

		if (preview) {
			goToApp();
			return;
		}

		try {
			const protectedApps = appOptions.filter((app) =>
				selectedPackages.includes(app.packageName),
			);

			await MonitoredAppsService.getInstance().replaceMonitoredApps(
				appOptions.map((app) => ({
					packageName: app.packageName,
					appName: app.appName,
					monitored: selectedPackages.includes(app.packageName),
				})),
			);

			await Promise.all([
				TrialService.startTrial(),
				database.setMeta("monitoring_enabled", "true"),
				database.setMeta("background_checks_enabled", "true"),
				database.setMeta("realtime_monitoring_enabled", "false"),
				database.setMeta("notifications_enabled", "true"),
				database.setMeta("app_blocking_enabled", "true"),
				database.setMeta("blocking_mode", "soft"),
				database.setMeta("blocked_apps", JSON.stringify([])),
				database.setMeta("block_bypass_limit", "2"),
				database.setMeta("soft_block_interval_minutes", "15"),
				database.setMeta("block_schedule_enabled", "false"),
				database.setMeta("block_schedule_start", "22:00"),
				database.setMeta("block_schedule_end", "06:00"),
				database.setMeta(
					"onboarding_selected_app",
					selectedAppEntry.packageName,
				),
				database.setMeta(
					"onboarding_selected_app_name",
					selectedAppEntry.appName,
				),
				database.setMeta("onboarding_protection_level", "monitor"),
				database.setMeta("onboarding_completed", "true"),
				database.setMeta("onboarding_completed_at", Date.now().toString()),
			]);

			const blockingService = AppBlockingService.getInstance();
			await blockingService.initialize();
			await blockingService.addProtectedApps(
				protectedApps.map((app) => ({
					packageName: app.packageName,
					appName: app.appName,
				})),
				"onboarding",
			);

			const notificationsGranted =
				await CapabilitiesService.ensureNotificationPermission("onboarding");

			const defaultAppsRemovedCount = defaultSelectedPackagesRef.current.filter(
				(packageName) => !selectedPackages.includes(packageName),
			).length;

			TelemetryService.track("apps_selected_onboarding", {
				screen_name: getOnboardingScreenName(5),
				selected_app_count: protectedApps.length,
				default_apps_removed_count: defaultAppsRemovedCount,
			});

			TelemetryService.track("onboarding_completed", {
				screen_name: getOnboardingScreenName(currentStep),
				selected_app_count: protectedApps.length,
				default_apps_removed_count: defaultAppsRemovedCount,
				permission_result: [
					usageGranted ? "usage_granted" : "usage_missing",
					accessibilityGranted
						? "accessibility_granted"
						: "accessibility_missing",
					notificationsGranted
						? "notifications_granted"
						: "notifications_missing",
				].join(","),
			});

			goToApp();
		} catch (error) {
			console.error("Error finishing onboarding:", error);
			Alert.alert(
				"Setup Error",
				"We could not finish setup. Please try again.",
			);
		}
	}

	const renderTopBar = () => (
		<View className="mb-6 flex-row items-center justify-between px-2">
			<Text className="w-12 font-body text-secondary text-slate-600">
				{currentStep + 1}/{TOTAL_STEPS}
			</Text>
			<View className="mx-4 h-1.5 max-w-[170px] flex-1 overflow-hidden rounded-full bg-slate-200">
				<View
					className="h-full rounded-full"
					style={{
						width: `${((currentStep + 1) / TOTAL_STEPS) * 100}%`,
						backgroundColor: BRAND_PURPLE,
					}}
				/>
			</View>
			{currentStep < TOTAL_STEPS - 1 ? (
				<TouchableOpacity
					onPress={() => void jumpToFinalStep()}
					className="w-12 items-end"
				>
					<Text
						className="font-heading-semibold text-secondary"
						style={{ color: BRAND_PURPLE }}
					>
						Skip
					</Text>
				</TouchableOpacity>
			) : (
				<View className="w-12" />
			)}
		</View>
	);

	const renderPermissionPill = (
		granted: boolean,
		flash: boolean,
		copy: string,
	) => (
		<View
			className={`mt-4 flex-row items-center rounded-2xl px-4 py-3 ${granted ? "bg-emerald-50" : "bg-slate-100"}`}
		>
			<Ionicons
				name={granted ? "checkmark-circle" : "time-outline"}
				size={18}
				color={granted ? "#16A34A" : "#64748B"}
			/>
			<Text
				className={`ml-2 flex-1 font-body text-secondary ${granted ? "text-emerald-800" : "text-slate-600"}`}
			>
				{granted ? copy : "Still waiting for permission."}
			</Text>
			{flash ? (
				<Text className="ml-2 text-xs font-heading-semibold text-emerald-700">
					Done
				</Text>
			) : null}
		</View>
	);

	const renderStepContent = () => {
		switch (currentStep) {
			case 0:
				return (
					<StepLayout
						title="Your attention is being stolen."
						body="Most people don’t realize how often they open distracting apps."
						primaryLabel="Show me"
						onPrimary={() => void goNext()}
					>
						<OnboardingArt source={ASSETS.confused} height={380} />
					</StepLayout>
				);

			case 1:
				return (
					<StepLayout
						title="It’s not the hours. It’s the interruptions."
						body="Opening Instagram 40 times a day hurts focus more than one long session."
						primaryLabel="Continue"
						onPrimary={() => void goNext()}
					>
						<OnboardingArt source={ASSETS.replay} height={340} bleed={1.36} />
					</StepLayout>
				);

			case 2:
				return (
					<StepLayout
						title="Meet your Brain Health Score"
						body="Brainrot measures what really impacts your focus."
						primaryLabel="How does it work?"
						onPrimary={() => void goNext()}
					>
						<OnboardingArt source={ASSETS.brainHealth} height={420} />
					</StepLayout>
				);

			case 3:
				return (
					<StepLayout
						title="See where your day went"
						body="Most people know they waste time. Very few know exactly when."
						primaryLabel="Continue"
						onPrimary={() => void goNext()}
					>
						<OnboardingArt
							source={ASSETS.replayCard}
							height={380}
							bleed={1.78}
							className="mt-0 -ml-4"
						/>
					</StepLayout>
				);

			case 4:
				return (
					<StepLayout
						title="Stop distractions before they start"
						body={`Set limits. Add cooldowns. Block apps. Stay accountable with ${selectedAppEntry.appName}.`}
						primaryLabel="Protect my focus"
						onPrimary={() => void goNext()}
					>
						<View className="mt-6 flex-1 items-center justify-center">
							<OnboardingArt source={ASSETS.blocking} height={320} />
						</View>
					</StepLayout>
				);

			case 5:
				return (
					<StepLayout
						title="Add your first apps"
						body="Pick the distractions you want Brainrot to protect first. Recommended apps are already selected."
						primaryLabel="Continue"
						onPrimary={() => void goNext()}
						footer="You can add or remove protected apps anytime in Focus."
					>
						<View className="mt-5 flex-1 rounded-[28px] bg-white px-4 py-4">
							<View className="mb-4 flex-row items-center rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
								<Ionicons name="search" size={18} color="#64748B" />
								<TextInput
									value={appSearchQuery}
									onChangeText={setAppSearchQuery}
									placeholder="Search apps"
									placeholderTextColor="#94A3B8"
									className="ml-3 flex-1 font-body text-body text-slate-900"
								/>
							</View>

							{loadingApps ? (
								<Text className="py-6 text-center font-body text-body text-muted">
									Loading your apps...
								</Text>
							) : (
								<View className="max-h-[420px]">
									{appsFallbackMode ? (
										<Text className="mb-4 rounded-[18px] bg-amber-50 px-4 py-3 font-body text-secondary text-amber-800">
											Installed apps couldn&apos;t be loaded right now, so this
											fallback starter list is shown instead.
										</Text>
									) : null}
									<ScrollView showsVerticalScrollIndicator={false}>
										{filteredAppOptions.map((app) => {
											const selected = selectedPackages.includes(
												app.packageName,
											);
											return (
												<TouchableOpacity
													key={app.packageName}
													onPress={() => {
														void triggerHaptic("light");
														setSelectedPackages((current) =>
															current.includes(app.packageName)
																? current.filter(
																		(packageName) =>
																			packageName !== app.packageName,
																	)
																: [...current, app.packageName],
														);
													}}
													className="flex-row items-center border-b border-gray-100 py-3 last:border-b-0"
												>
													<View className="flex-1 pr-3">
														<View className="flex-row items-center">
															<Text className="font-heading-semibold text-card-title text-slate-900">
																{app.appName}
															</Text>
															{app.isRecommended ? (
																<View className="ml-2 rounded-full bg-violet-100 px-2 py-1">
																	<Text
																		className="text-[11px] font-heading-semibold"
																		style={{ color: BRAND_PURPLE }}
																	>
																		Recommended
																	</Text>
																</View>
															) : null}
														</View>
													</View>
													<View
														className={`h-6 w-6 items-center justify-center rounded-md border-2 ${selected ? "border-violet-600 bg-violet-600" : "border-slate-300 bg-white"}`}
													>
														{selected ? (
															<Ionicons
																name="checkmark"
																size={16}
																color="#FFFFFF"
															/>
														) : null}
													</View>
												</TouchableOpacity>
											);
										})}
									</ScrollView>
								</View>
							)}
						</View>
					</StepLayout>
				);

			case 6:
				return (
					<StepLayout
						title="Allow Usage Access"
						body="Brainrot needs this permission to calculate your Brain Health Score, generate replays, and detect distracting apps."
						primaryLabel={usageGranted ? "Continue" : "Grant Usage Access"}
						onPrimary={
							usageGranted ? () => void goNext() : () => void openUsageAccess()
						}
						secondaryLabel={usageGranted ? undefined : "I’ll do this later"}
						onSecondary={usageGranted ? undefined : () => void goNext()}
						footer="We’ll guide you step by step"
					>
						<View className="mt-5 rounded-[28px] bg-white px-5 py-5">
							{[
								"Calculate your Brain Health Score",
								"Generate Replays",
								"Detect distracting apps",
								"Enforce limits",
							].map((item) => (
								<View key={item} className="mb-3 flex-row items-center">
									<Ionicons name="checkmark" size={18} color="#16A34A" />
									<Text className="ml-3 font-body text-body text-slate-700">
										{item}
									</Text>
								</View>
							))}
							<View className="mt-4 rounded-2xl bg-violet-50 px-4 py-3">
								<Text className="font-body text-secondary text-slate-700">
									We never collect messages, photos, videos, or browsing data.
								</Text>
							</View>
							<OnboardingArt
								source={ASSETS.permissions}
								height={196}
								bleed={1.38}
							/>
						</View>
						{renderPermissionPill(
							usageGranted,
							permissionSuccess.usage,
							"Usage access granted.",
						)}
					</StepLayout>
				);

			case 7:
				return (
					<StepLayout
						title="You’re all set"
						body="Your brain is now being protected."
						primaryLabel="Start Tracking"
						onPrimary={() => void finishOnboarding()}
						footer="Your first replay will arrive tomorrow morning."
					>
						<View className="mt-4 items-center">
							<OnboardingArt
								source={ASSETS.complete}
								height={270}
								bleed={1.14}
							/>
						</View>
						<View className="mt-4 -mx-5 items-center">
							<OnboardingArt
								source={ASSETS.completeCards}
								height={262}
								bleed={1.58}
							/>
						</View>
					</StepLayout>
				);

			default:
				return null;
		}
	};

	return (
		<SafeAreaView className="flex-1 bg-white">
			<View className="flex-1 px-5 py-4">
				{renderTopBar()}

				{currentStep > 0 ? (
					<TouchableOpacity
						onPress={() => void goBack()}
						activeOpacity={1}
						className="mb-4 self-start rounded-full bg-slate-100 px-4 py-2"
					>
						<Text className="font-heading-semibold text-secondary text-slate-700">
							Back
						</Text>
					</TouchableOpacity>
				) : null}

				{preview ? (
					<View className="mb-4 self-start rounded-full bg-amber-100 px-4 py-2">
						<Text className="font-heading-semibold text-secondary text-amber-900">
							Preview Mode: completion will not be saved
						</Text>
					</View>
				) : null}

				<View className="flex-1 rounded-[36px] border border-slate-100 bg-[#FCFBFF] px-5 py-6">
					{renderStepContent()}
				</View>
			</View>
		</SafeAreaView>
	);
}

function StepLayout({
	title,
	body,
	children,
	primaryLabel,
	onPrimary,
	secondaryLabel,
	onSecondary,
	footer,
}: {
	title: string;
	body: string;
	children: React.ReactNode;
	primaryLabel: string;
	onPrimary: () => void;
	secondaryLabel?: string;
	onSecondary?: () => void;
	footer?: string;
}) {
	return (
		<View className="flex-1">
			<ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
				<Text className="font-heading-bold text-4xl leading-[42px] text-slate-900">
					{title}
				</Text>
				<Text className="mt-3 font-body text-body leading-7 text-slate-600">
					{body}
				</Text>
				{children}
			</ScrollView>
			<View className="pt-4">
				{secondaryLabel && onSecondary ? (
					<TouchableOpacity
						onPress={onSecondary}
						className="mb-3 items-center rounded-2xl border border-slate-200 bg-white px-4 py-4"
					>
						<Text className="font-heading-semibold text-card-title text-slate-700">
							{secondaryLabel}
						</Text>
					</TouchableOpacity>
				) : null}
				<TouchableOpacity
					onPress={onPrimary}
					activeOpacity={0.9}
					className="flex-row items-center justify-center rounded-2xl px-4 py-4 shadow-sm"
					style={{
						backgroundColor: BRAND_PURPLE,
						borderColor: BRAND_PURPLE_DARK,
						borderWidth: 1,
					}}
				>
					<Text className="font-heading-semibold text-card-title text-white">
						{primaryLabel}
					</Text>
					<Ionicons
						name="arrow-forward"
						size={18}
						color="#FFFFFF"
						style={{ marginLeft: 10 }}
					/>
				</TouchableOpacity>
				{footer ? (
					<Text className="mt-4 text-center font-body text-secondary text-slate-500">
						{footer}
					</Text>
				) : null}
			</View>
		</View>
	);
}

function OnboardingArt({
	source,
	height,
	className = "mt-6",
	bleed = 1.22,
	centered = false,
}: {
	source: number;
	height: number;
	className?: string;
	bleed?: number;
	centered?: boolean;
}) {
	return (
		<Image
			source={source}
			resizeMode="contain"
			className={`${className} self-center`}
			style={{
				width: `${bleed * 100}%`,
				height,
				alignSelf: centered ? "center" : "center",
			}}
		/>
	);
}

function FloatingAppBubble({
	icon,
	color,
	style,
}: {
	icon: keyof typeof Ionicons.glyphMap;
	color: string;
	style: string;
}) {
	return (
		<View
			className={`absolute h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm ${style}`}
		>
			<Ionicons name={icon} size={30} color={color} />
		</View>
	);
}
