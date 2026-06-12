import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
	BackHandler,
	Image,
	ScrollView,
	Text,
	TouchableOpacity,
	View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type {
	ExpiredFlowState,
	SubscriptionAccessState,
} from "@/services/SubscriptionAccessService";
import { PurchaseService } from "@/services/PurchaseService";
import { SubscriptionAccessService } from "@/services/SubscriptionAccessService";
import { TelemetryService } from "@/services/TelemetryService";

import { Card } from "./Card";

const disappointedExpression = require("../assets/expressions/disappointed.png");

function getDaysAgoLabel(timestamp: number): string {
	const diffMs = Date.now() - timestamp;
	const diffDays = Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
	if (diffDays === 0) {
		return "today";
	}
	if (diffDays === 1) {
		return "1 day ago";
	}
	return `${diffDays} days ago`;
}

function formatPercentDelta(value: number): string {
	if (value === 0) {
		return "0%";
	}
	return `${value > 0 ? "↓" : "↑"} ${Math.abs(value)}%`;
}

export default function ExpiredTrialGate({
	accessState,
}: {
	accessState: SubscriptionAccessState;
}) {
	const [screen, setScreen] = useState<ExpiredFlowState>(
		accessState.expiredFlowState,
	);
	const trackedScreensRef = useRef<Set<ExpiredFlowState>>(new Set());
	const snapshot = accessState.frozenSnapshot;

	useEffect(() => {
		const subscription = BackHandler.addEventListener(
			"hardwareBackPress",
			() => true,
		);
		return () => subscription.remove();
	}, []);

	useEffect(() => {
		if (trackedScreensRef.current.has(screen)) {
			return;
		}

		trackedScreensRef.current.add(screen);
		TelemetryService.capture("paywall_shown", {
			state: screen,
			subscription_status: "expired",
		});
		TelemetryService.track("expired_paywall_viewed", {
			screen,
			subscription_status: "expired",
		});
	}, [screen]);

	const handleGetLifetimeAccess = () => {
		TelemetryService.track("expired_paywall_cta_clicked", {
			screen,
			cta: "get_lifetime_access",
			subscription_status: "expired",
		});
		void PurchaseService.purchaseLifetime();
	};

	const handleNoThanks = () => {
		TelemetryService.track("expired_paywall_cta_clicked", {
			screen: "intro",
			cta: "no_thanks",
			subscription_status: "expired",
		});
		TelemetryService.track("expired_paywall_declined", {
			screen: "intro",
			subscription_status: "expired",
		});
		setScreen("declined");
		void SubscriptionAccessService.setExpiredFlowState("declined");
	};

	const handleCloseApp = () => {
		TelemetryService.track("expired_paywall_cta_clicked", {
			screen: "declined",
			cta: "close_app",
			subscription_status: "expired",
		});
		void SubscriptionAccessService.setExpiredFlowState("returning").finally(() => {
			BackHandler.exitApp();
		});
	};

	const renderDevControls = () =>
		__DEV__ ? (
			<View className="mt-6 rounded-[24px] border border-dashed border-[#C9B9FF] bg-[#F6F2FF] p-4">
				<Text className="font-heading-semibold text-card-title text-text">
					Dev controls
				</Text>
				<View className="mt-3 flex-row flex-wrap">
					{[
						{
							label: "Trial",
							value: "trial",
							cta: "dev_force_trial",
						},
						{
							label: "Active",
							value: "active",
							cta: "dev_force_active",
						},
						{
							label: "Intro",
							value: "expired_intro",
							cta: "dev_force_expired_intro",
						},
						{
							label: "Declined",
							value: "expired_declined",
							cta: "dev_force_expired_declined",
						},
						{
							label: "Return",
							value: "expired_returning",
							cta: "dev_force_expired_returning",
						},
					].map((option) => (
						<TouchableOpacity
							key={option.value}
							onPress={() => {
								TelemetryService.track("expired_paywall_cta_clicked", {
									screen,
									cta: option.cta as
										| "dev_force_trial"
										| "dev_force_active"
										| "dev_force_expired_intro"
										| "dev_force_expired_declined"
										| "dev_force_expired_returning",
									subscription_status: "expired",
								});
								void SubscriptionAccessService.setDevOverrideState(
									option.value as
										| "trial"
										| "active"
										| "expired_intro"
										| "expired_declined"
										| "expired_returning",
								);
							}}
							className="mb-2 mr-2 rounded-full bg-white px-4 py-2"
						>
							<Text className="font-heading-semibold text-secondary text-slate-700">
								{option.label}
							</Text>
						</TouchableOpacity>
					))}
				</View>
			</View>
		) : null;

	const renderPrimaryButton = (label: string, price?: string) => (
		<TouchableOpacity
			onPress={handleGetLifetimeAccess}
			activeOpacity={0.9}
			className="rounded-[26px] bg-[#111827] px-5 py-4"
		>
			<Text className="text-center font-heading-semibold text-card-title text-white">
				{label}
			</Text>
			{price ? (
				<Text className="mt-1 text-center font-heading-bold text-xl text-white">
					{price}
				</Text>
			) : null}
		</TouchableOpacity>
	);

	const renderIntroScreen = () => (
		<>
			<Text className="font-body text-secondary text-slate-500">
				In the last 14 days
			</Text>
			<Text className="mt-4 font-heading-bold text-4xl leading-[42px] text-slate-900">
				You&apos;ve built momentum.
			</Text>
			<Text className="mt-2 font-heading-bold text-4xl leading-[42px] text-slate-900">
				Don&apos;t lose it.
			</Text>

			<View className="mt-8 rounded-[30px] bg-white p-5">
				<MetricRow
					label="Brain Score"
					value={`${snapshot?.progress.startBrainScore ?? 0} → ${snapshot?.progress.endBrainScore ?? 0}`}
				/>
				<MetricRow
					label={`${snapshot?.progress.appName ?? "App"} Opens`}
					value={`${snapshot?.progress.startOpenCount ?? 0} → ${snapshot?.progress.endOpenCount ?? 0}`}
				/>
				<MetricRow
					label="Distraction Time"
					value={formatPercentDelta(
						snapshot?.progress.distractionDeltaPercent ?? 0,
					)}
					isLast
				/>
			</View>

			<View className="mt-8">
				{renderPrimaryButton("Get Lifetime Access", "₹249")}
				<TouchableOpacity
					onPress={handleNoThanks}
					className="mt-3 rounded-[26px] border border-slate-200 bg-white px-5 py-4"
				>
					<Text className="text-center font-heading-semibold text-card-title text-slate-700">
						No Thanks
					</Text>
				</TouchableOpacity>
			</View>
			{renderDevControls()}
		</>
	);

	const renderDeclinedScreen = () => (
		<View className="flex-1 items-center justify-center py-6">
			<Image
				source={disappointedExpression}
				resizeMode="contain"
				style={{ width: 260, height: 260 }}
			/>
			<Text className="mt-6 text-center font-heading-bold text-4xl leading-[42px] text-slate-900">
				Your trial has ended.
			</Text>
			<Text className="mt-4 text-center font-body text-body leading-7 text-slate-600">
				Brainrot will stop generating new insights and reports.
			</Text>
			<View className="mt-8 w-full">
				{renderPrimaryButton("Get Lifetime Access")}
				<TouchableOpacity
					onPress={handleCloseApp}
					className="mt-3 rounded-[26px] border border-slate-200 bg-white px-5 py-4"
				>
					<Text className="text-center font-heading-semibold text-card-title text-slate-700">
						Close App
					</Text>
				</TouchableOpacity>
			</View>
			{renderDevControls()}
		</View>
	);

	const renderReturningScreen = () => (
		<>
			<View className="rounded-[30px] bg-white p-5">
				<Text className="font-body text-secondary text-slate-500">
					Last Known Brain Score
				</Text>
				<Text className="mt-3 font-heading-bold text-[56px] leading-[60px] text-slate-900">
					{snapshot?.brainScore ?? 0}
				</Text>
				<Text className="mt-2 font-heading-semibold text-section text-slate-700">
					{snapshot?.brainState ?? "Healthy"}
				</Text>
				<Text className="mt-4 font-body text-secondary text-slate-500">
					Last updated{" "}
					{snapshot ? getDaysAgoLabel(snapshot.capturedAt) : "recently"}
				</Text>
			</View>

			<Text className="mt-8 font-heading-semibold text-card-title text-slate-500">
				Your Last Insight
			</Text>
			<View className="relative mt-3 rounded-[30px] border border-slate-200 bg-white p-5">
				<View className="absolute right-4 top-4 rounded-full bg-slate-900 px-3 py-1">
					<Text className="font-heading-semibold text-xs text-white">Locked</Text>
				</View>
				<Text className="pr-20 font-heading-bold text-section leading-8 text-slate-900">
					{snapshot?.insightHeadline || "Your strongest pattern is waiting."}
				</Text>
				<Text className="mt-3 font-body text-body leading-6 text-slate-600">
					{snapshot?.insightSubtext ||
						"Unlock Brainrot again to keep receiving daily guidance."}
				</Text>
			</View>

			<Text className="mt-8 font-heading-semibold text-card-title text-slate-500">
				Continue Your Journey
			</Text>
			<Card className="mt-3 border border-[#E7DFFD] bg-[#F7F3FF] px-5 py-5">
				<Text className="font-heading-bold text-section leading-8 text-slate-900">
					Brainrot is no longer tracking your attention.
				</Text>
				<Text className="mt-3 font-body text-body leading-6 text-slate-600">
					Resume insights, reports and Focus Mode.
				</Text>
				<View className="mt-5">{renderPrimaryButton("Get Lifetime Access", "₹249")}</View>
			</Card>

			<TouchableOpacity
				onPress={() => void SubscriptionAccessService.markHelpShapeTapped()}
				activeOpacity={0.9}
				className="mt-4 rounded-[28px] border border-slate-200 bg-white p-5"
			>
				<Text className="font-heading-semibold text-card-title text-text">
					Help Shape Brainrot
				</Text>
				<Text className="mt-2 font-body text-secondary text-muted">
					Request a Feature
				</Text>
				<View className="mt-1 flex-row items-center">
					<Text className="font-body text-secondary text-muted">
						Vote on upcoming features
					</Text>
					<Ionicons
						name="arrow-forward"
						size={16}
						color="#64748B"
						style={{ marginLeft: 8 }}
					/>
				</View>
			</TouchableOpacity>

			<Text className="mt-6 text-center font-body text-secondary text-slate-500">
				Your progress is preserved.
			</Text>
			<Text className="text-center font-body text-secondary text-slate-500">
				Return anytime.
			</Text>
			{renderDevControls()}
		</>
	);

	return (
		<View className="absolute inset-0 z-[999] bg-[#F8F5FF]">
			<SafeAreaView className="flex-1">
				<ScrollView
					className="flex-1"
					contentContainerStyle={{ padding: 20, flexGrow: 1 }}
					showsVerticalScrollIndicator={false}
				>
					{screen === "intro"
						? renderIntroScreen()
						: screen === "declined"
							? renderDeclinedScreen()
							: renderReturningScreen()}
				</ScrollView>
			</SafeAreaView>
		</View>
	);
}

function MetricRow({
	label,
	value,
	isLast = false,
}: {
	label: string;
	value: string;
	isLast?: boolean;
}) {
	return (
		<View className={isLast ? "" : "mb-5 border-b border-slate-100 pb-5"}>
			<Text className="font-body text-secondary text-slate-500">{label}</Text>
			<Text className="mt-2 font-heading-bold text-[28px] leading-8 text-slate-900">
				{value}
			</Text>
		</View>
	);
}
