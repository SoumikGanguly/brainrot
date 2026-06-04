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
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CapabilitiesService } from "@/services/CapabilitiesService";
import { MonitoredAppsService } from "@/services/MonitoredAppsService";
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

type ProtectionLevel = "soft" | "hard";
type OemBrand =
	| "Samsung"
	| "Xiaomi"
	| "Realme"
	| "Oppo"
	| "OnePlus"
	| "Vivo"
	| "Motorola"
	| "Pixel"
	| "Other";

const TOTAL_STEPS = 9;
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

const OEM_GUIDES: Record<OemBrand, { subtitle: string; steps: string[] }> = {
	Samsung: {
		subtitle: "How to enable Accessibility",
		steps: [
			"Open Settings",
			"Tap Accessibility",
			"Open Installed apps",
			"Select Brainrot",
			"Turn the service on",
		],
	},
	Xiaomi: {
		subtitle: "How to enable Accessibility",
		steps: [
			"Open Settings",
			"Tap Additional settings",
			"Open Accessibility",
			"Select Downloaded apps",
			"Turn Brainrot on",
		],
	},
	Realme: {
		subtitle: "How to enable Accessibility",
		steps: [
			"Open Settings",
			"Tap Accessibility",
			"Open Downloaded Apps",
			"Find Brainrot",
			"Enable the service",
		],
	},
	Oppo: {
		subtitle: "How to enable Accessibility",
		steps: [
			"Open Settings",
			"Tap Additional settings",
			"Open Accessibility",
			"Tap Downloaded apps",
			"Allow Brainrot",
		],
	},
	OnePlus: {
		subtitle: "How to enable Accessibility",
		steps: [
			"Open Settings",
			"Tap Additional settings",
			"Open Accessibility",
			"Tap Downloaded apps",
			"Enable Brainrot",
		],
	},
	Vivo: {
		subtitle: "How to enable Accessibility",
		steps: [
			"Open Settings",
			"Tap Shortcuts & accessibility",
			"Open Accessibility",
			"Tap Downloaded apps",
			"Allow Brainrot",
		],
	},
	Motorola: {
		subtitle: "How to enable Accessibility",
		steps: [
			"Open Settings",
			"Tap Accessibility",
			"Open Downloaded apps",
			"Select Brainrot",
			"Turn it on",
		],
	},
	Pixel: {
		subtitle: "How to enable Accessibility",
		steps: [
			"Open Settings",
			"Tap Accessibility",
			"Open Downloaded apps",
			"Select Brainrot",
			"Use the toggle to enable",
		],
	},
	Other: {
		subtitle: "How to enable Accessibility",
		steps: [
			"Open Settings",
			"Search for Accessibility",
			"Look for Downloaded or Installed apps",
			"Find Brainrot",
			"Enable the service",
		],
	},
};

export default function OnboardingFlow({
	preview = false,
}: OnboardingFlowProps) {
	const [currentStep, setCurrentStep] = useState(0);
	const [usageGranted, setUsageGranted] = useState(false);
	const [accessibilityGranted, setAccessibilityGranted] = useState(false);
	const [loadingApps, setLoadingApps] = useState(true);
	const [installedApps, setInstalledApps] =
		useState<InstalledAppOption[]>(COMMON_APP_OPTIONS);
	const [selectedApp, setSelectedApp] = useState("com.instagram.android");
	const [selectedProtectionLevel] = useState<ProtectionLevel>("soft");
	const [permissionSuccess, setPermissionSuccess] = useState<
		Record<"usage" | "accessibility", boolean>
	>({
		usage: false,
		accessibility: false,
	});
	const [selectedGuideBrand, setSelectedGuideBrand] = useState<OemBrand | null>(
		null,
	);
	const permissionPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const appOptions = useMemo(() => {
		const merged = new Map<string, InstalledAppOption>();
		for (const fallback of COMMON_APP_OPTIONS) {
			merged.set(fallback.packageName, fallback);
		}
		for (const app of installedApps) {
			merged.set(app.packageName, app);
		}
		return Array.from(merged.values());
	}, [installedApps]);

	const selectedAppEntry = useMemo(() => {
		return (
			appOptions.find((app) => app.packageName === selectedApp) ||
			appOptions.find((app) => app.isRecommended) ||
			COMMON_APP_OPTIONS[0]
		);
	}, [appOptions, selectedApp]);

	const refreshPermissionState = useCallback(async () => {
		const [usage, accessibility] = await Promise.all([
			CapabilitiesService.hasUsageAccess(),
			CapabilitiesService.hasAccessibilityPermission(),
		]);

		if (usage && !usageGranted) {
			setPermissionSuccess((previous) => ({ ...previous, usage: true }));
			setTimeout(() => {
				setPermissionSuccess((previous) => ({ ...previous, usage: false }));
			}, 1600);
		}

		if (accessibility && !accessibilityGranted) {
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
	}, [accessibilityGranted, usageGranted]);

	const loadInstalledApps = useCallback(async () => {
		setLoadingApps(true);
		try {
			const apps = await UnifiedUsageService.getAllInstalledApps();
			const safeApps = apps.length > 0 ? apps : COMMON_APP_OPTIONS;
			setInstalledApps(safeApps);

			const preferredApp =
				safeApps.find((app) => app.packageName === "com.instagram.android") ||
				safeApps.find((app) => app.isRecommended) ||
				safeApps[0];

			if (preferredApp) {
				setSelectedApp(preferredApp.packageName);
			}
		} catch (error) {
			console.warn("Unable to load installed apps for onboarding:", error);
			setInstalledApps(COMMON_APP_OPTIONS);
			setSelectedApp("com.instagram.android");
		} finally {
			setLoadingApps(false);
		}
	}, []);

	useEffect(() => {
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
		const granted = await CapabilitiesService.ensureUsageAccess();
		if (granted) {
			setUsageGranted(true);
		}
	}

	async function openAccessibility() {
		await triggerHaptic("medium");
		startPermissionPolling();
		const granted = await CapabilitiesService.ensureAccessibilityPermission();
		if (granted) {
			setAccessibilityGranted(true);
		}
	}

	async function finishOnboarding() {
		await triggerHaptic("medium");

		if (preview) {
			goToApp();
			return;
		}

		try {
			const appsToMonitor = appOptions.map((app) => ({
				packageName: app.packageName,
				appName: app.appName,
				monitored:
					app.packageName === selectedAppEntry.packageName ||
					DEFAULT_MONITORED_PACKAGES.has(app.packageName),
			}));

			const blockedApps =
				selectedProtectionLevel === "soft" || selectedProtectionLevel === "hard"
					? [selectedAppEntry.packageName]
					: [];

			await MonitoredAppsService.getInstance().replaceMonitoredApps(
				appsToMonitor,
			);

			await Promise.all([
				TrialService.startTrial(),
				database.setMeta("monitoring_enabled", "true"),
				database.setMeta("background_checks_enabled", "true"),
				database.setMeta("realtime_monitoring_enabled", "false"),
				database.setMeta("notifications_enabled", "true"),
				database.setMeta("app_blocking_enabled", "true"),
				database.setMeta(
					"blocking_mode",
					selectedProtectionLevel === "hard" ? "hard" : "soft",
				),
				database.setMeta("blocked_apps", JSON.stringify(blockedApps)),
				database.setMeta("block_bypass_limit", "3"),
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
				database.setMeta(
					"onboarding_protection_level",
					selectedProtectionLevel,
				),
				database.setMeta("onboarding_completed", "true"),
			]);

			await UnifiedUsageService.syncBlockingConfigToNative({
				monitoredApps: await database.getMonitoredPackages(),
				blockedApps,
				blockingEnabled: true,
				blockingMode: selectedProtectionLevel === "hard" ? "hard" : "soft",
				bypassLimit: 3,
				softBlockIntervalMinutes: 15,
				scheduleEnabled: false,
				scheduleStart: "22:00",
				scheduleEnd: "06:00",
			});

			const notificationsGranted =
				await CapabilitiesService.ensureNotificationPermission();

			TelemetryService.capture("onboarding_completed", {
				selected_app: selectedAppEntry.appName,
				protection_level: selectedProtectionLevel,
				notifications_enabled: notificationsGranted,
				usage_access_granted: usageGranted,
				accessibility_granted: accessibilityGranted,
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

			case 6:
				return (
					<StepLayout
						title="Enable Focus Protection"
						body="This allows Brainrot to block distracting apps when limits are reached."
						primaryLabel={
							accessibilityGranted ? "Continue" : "Enable Protection"
						}
						onPrimary={
							accessibilityGranted
								? () => void goNext()
								: () => void openAccessibility()
						}
						secondaryLabel={
							accessibilityGranted ? undefined : "I’ll set this up later"
						}
						onSecondary={accessibilityGranted ? undefined : () => void goNext()}
						footer="We’ll guide you step by step"
					>
						<View className="mt-5 rounded-[28px] bg-white px-5 py-5">
							<View className="rounded-2xl bg-violet-50 px-4 py-4">
								<Text
									className="font-heading-semibold text-card-title"
									style={{ color: BRAND_PURPLE }}
								>
									Without it, you won’t get:
								</Text>
								{["No blocking", "No cooldowns", "No accountability mode"].map(
									(item) => (
										<View key={item} className="mt-3 flex-row items-center">
											<Ionicons name="close" size={16} color="#EF4444" />
											<Text className="ml-3 font-body text-body text-slate-700">
												{item}
											</Text>
										</View>
									),
								)}
							</View>
							<OnboardingArt source={ASSETS.blocking} height={208} />
						</View>
						{renderPermissionPill(
							accessibilityGranted,
							permissionSuccess.accessibility,
							"Focus Protection enabled.",
						)}
					</StepLayout>
				);

			case 7:
				return (
					<StepLayout
						title="Can’t find the setting?"
						body="Different phones call it different things. Choose your device for a step-by-step guide."
						primaryLabel="Continue"
						onPrimary={() => void goNext()}
					>
						<View className="mt-5 flex-row flex-wrap justify-between">
							{(Object.keys(OEM_GUIDES) as OemBrand[]).map((brand) => (
								<TouchableOpacity
									key={brand}
									onPress={() => setSelectedGuideBrand(brand)}
									className="mb-3 h-24 w-[31%] items-center justify-center rounded-[22px] border border-slate-200 bg-white px-2"
								>
									<View className="mb-2 h-9 w-9 items-center justify-center rounded-full bg-slate-100">
										<Text
											className="font-heading-bold text-secondary"
											style={{ color: BRAND_PURPLE }}
										>
											{brand[0]}
										</Text>
									</View>
									<Text className="text-center font-body text-secondary text-slate-700">
										{brand}
									</Text>
								</TouchableOpacity>
							))}
						</View>
						<View className="mt-4 flex-row rounded-2xl bg-violet-50 px-4 py-3">
							<Ionicons
								name="shield-checkmark-outline"
								size={18}
								color={BRAND_PURPLE}
							/>
							<Text className="ml-3 flex-1 font-body text-secondary text-slate-700">
								We only need Accessibility permission to block apps and protect
								your focus.
							</Text>
						</View>
					</StepLayout>
				);

			case 8:
				return (
					<StepLayout
						title="You’re all set!"
						body="Your brain is now being protected."
						primaryLabel={preview ? "Exit Preview" : "Start Tracking"}
						onPrimary={() => void finishOnboarding()}
						footer="Your first replay will arrive tomorrow morning."
					>
						<View className="mt-4 flex-1 items-center justify-center">
							<OnboardingArt
								source={ASSETS.complete}
								height={270}
								className="mt-0"
								centered
							/>
							<OnboardingArt
								source={ASSETS.completeCards}
								height={232}
								className="mt-4"
								centered
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

			<OemGuideModal
				brand={selectedGuideBrand}
				onClose={() => setSelectedGuideBrand(null)}
				onOpenSettings={() => void openAccessibility()}
			/>
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

function OemGuideModal({
	brand,
	onClose,
	onOpenSettings,
}: {
	brand: OemBrand | null;
	onClose: () => void;
	onOpenSettings: () => void;
}) {
	if (!brand) {
		return null;
	}

	const guide = OEM_GUIDES[brand];

	return (
		<Modal visible transparent animationType="slide" onRequestClose={onClose}>
			<View className="flex-1 justify-end bg-black/35">
				<TouchableOpacity
					className="flex-1"
					activeOpacity={1}
					onPress={onClose}
				/>
				<View className="rounded-t-[32px] bg-white px-5 pb-8 pt-5">
					<View className="mb-5 flex-row items-center justify-between">
						<View>
							<Text className="font-heading-bold text-section text-slate-900">
								{brand}
							</Text>
							<Text className="mt-1 font-body text-secondary text-slate-600">
								{guide.subtitle}
							</Text>
						</View>
						<TouchableOpacity
							onPress={onClose}
							className="rounded-full bg-slate-100 p-2"
						>
							<Ionicons name="close" size={20} color="#475569" />
						</TouchableOpacity>
					</View>

					{guide.steps.map((step, index) => (
						<View
							key={step}
							className="mb-3 flex-row rounded-2xl bg-slate-50 px-4 py-4"
						>
							<View
								className="mr-4 h-7 w-7 items-center justify-center rounded-full"
								style={{ backgroundColor: BRAND_PURPLE }}
							>
								<Text className="font-heading-semibold text-secondary text-white">
									{index + 1}
								</Text>
							</View>
							<Text className="flex-1 font-body text-body text-slate-700">
								{step}
							</Text>
						</View>
					))}

					<TouchableOpacity
						onPress={onOpenSettings}
						activeOpacity={0.9}
						className="mt-3 flex-row items-center justify-center rounded-2xl px-4 py-4"
						style={{
							backgroundColor: BRAND_PURPLE,
							borderColor: BRAND_PURPLE_DARK,
							borderWidth: 1,
						}}
					>
						<Text className="font-heading-semibold text-card-title text-white">
							Open Accessibility Settings
						</Text>
						<Ionicons
							name="arrow-forward"
							size={18}
							color="#FFFFFF"
							style={{ marginLeft: 10 }}
						/>
					</TouchableOpacity>

					<TouchableOpacity
						onPress={() =>
							Alert.alert(
								"Support",
								"If this setting still feels hidden, try searching for Accessibility in your phone settings.",
							)
						}
						className="mt-4 items-center"
					>
						<Text
							className="font-heading-semibold text-secondary"
							style={{ color: BRAND_PURPLE }}
						>
							Contact Support
						</Text>
					</TouchableOpacity>
				</View>
			</View>
		</Modal>
	);
}
