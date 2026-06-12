import { Inter_400Regular, Inter_600SemiBold } from "@expo-google-fonts/inter";
import {
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from "@expo-google-fonts/plus-jakarta-sans";
import * as Sentry from "@sentry/react-native";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import { Redirect, Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import type React from "react";
import { AppState, type AppStateStatus } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import "../global.css";
import ExpiredTrialGate from "../components/ExpiredTrialGate";
import { AppOpenTelemetryService } from "../services/AppOpenTelemetryService";
import { AuthService } from "../services/AuthService";
import {
	type SubscriptionAccessState,
	SubscriptionAccessService,
} from "../services/SubscriptionAccessService";
import { database } from "../services/database";
import { TelemetryService } from "../services/TelemetryService";

TelemetryService.prime();

type ObserveModule = {
	ObserveRoot: {
		wrap<T extends React.ComponentType<any>>(component: T): T;
	};
	useObserve: () => {
		markInteractive: () => void;
	};
};

const observeModule: ObserveModule = (() => {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		return require("expo-observe") as ObserveModule;
	} catch (error) {
		console.warn(
			"expo-observe is unavailable in this build. Falling back to a no-op observer until the native app is rebuilt.",
			error,
		);
		return {
			ObserveRoot: {
				wrap: <T extends React.ComponentType<any>>(component: T) => component,
			},
			useObserve: () => ({
				markInteractive: () => {},
			}),
		};
	}
})();

const { ObserveRoot, useObserve } = observeModule;

function RootLayout() {
	const [loaded] = useFonts({
		Inter_400Regular,
		Inter_600SemiBold,
		PlusJakartaSans_600SemiBold,
		PlusJakartaSans_700Bold,
	});
	const [onboardingComplete, setOnboardingComplete] = useState<
		boolean | null
	>(null);
	const { markInteractive } = useObserve();
	const segments = useSegments();
	const router = useRouter();
	const [accessState, setAccessState] = useState<SubscriptionAccessState | null>(
		null,
	);
	const lastTrackedScreenRef = useRef<string | null>(null);
	const hasMarkedInteractiveRef = useRef(false);
	const appStateRef = useRef<AppStateStatus>(AppState.currentState);

	useEffect(() => {
		let isMounted = true;

		void (async () => {
			try {
				await TelemetryService.initialize();
			} catch (error) {
				console.warn("Failed to initialize telemetry:", error);
			}
		})();
		AuthService.initialize();

		Promise.all([
			database.getMeta("onboarding_completed"),
			database.getMeta("onboarding_completed_at"),
		])
			.then(([value, completedAt]) => {
				if (isMounted) {
					setOnboardingComplete(value === "true" && Boolean(completedAt));
				}
			})
			.catch(() => {
				if (isMounted) {
					setOnboardingComplete(false);
				}
			});

		return () => {
			isMounted = false;
		};
	}, []);

	useEffect(() => {
		return SubscriptionAccessService.subscribe((state) => {
			setAccessState(state);
		});
	}, []);

	useEffect(() => {
		if (!loaded || onboardingComplete !== true) {
			return;
		}

		let cancelled = false;
		void (async () => {
			try {
				const state =
					await SubscriptionAccessService.reconcileAccess("app_startup");
				if (cancelled) {
					return;
				}
				setAccessState(state);
				await AppOpenTelemetryService.trackAppOpen(
					state.subscriptionStatus,
					state.expiredFlowState,
				);
			} catch (error) {
				console.warn("Failed to reconcile subscription access on startup:", error);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [loaded, onboardingComplete]);

	useEffect(() => {
		if (!loaded || onboardingComplete !== true) {
			return;
		}

		const subscription = AppState.addEventListener("change", (nextAppState) => {
			if (
				appStateRef.current.match(/inactive|background/) &&
				nextAppState === "active"
			) {
				void (async () => {
					try {
						const state =
							await SubscriptionAccessService.reconcileAccess("app_resume");
						await AppOpenTelemetryService.trackAppOpen(
							state.subscriptionStatus,
							state.expiredFlowState,
						);
					} catch (error) {
						console.warn(
							"Failed to refresh subscription access on resume:",
							error,
						);
					}
				})();
			}
			appStateRef.current = nextAppState;
		});

		return () => {
			subscription.remove();
		};
	}, [loaded, onboardingComplete]);

	useEffect(() => {
		const appendNotificationParams = (
			route: string,
			params: Record<string, string | number | undefined>,
		) => {
			const entries = Object.entries(params).filter(
				([, value]) => value !== undefined && value !== "",
			);
			if (entries.length === 0) {
				return route;
			}

			const query = entries
				.map(
					([key, value]) =>
						`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
				)
				.join("&");
			return `${route}${route.includes("?") ? "&" : "?"}${query}`;
		};

		const handleNotificationRoute = (
			route: unknown,
			data?:
				| {
						source?: string;
						replayDay?: string;
						replayDate?: string;
						notification_type?:
							| "morning_insight"
							| "weekly_report"
							| "monthly_report"
							| "permission_reminder";
						insight_type?: string;
				  }
				| undefined,
			notificationId?: string,
		) => {
			if (typeof route !== "string" || !route) {
				return;
			}

			router.push(
				appendNotificationParams(route, {
					source: data?.source,
					replayDay: data?.replayDay,
					replayDate: data?.replayDate,
					notificationType: data?.notification_type,
					insightType: data?.insight_type,
					notificationId,
				}) as never,
			);
		};

		Notifications.getLastNotificationResponseAsync()
			.then((response) => {
				const route = response?.notification.request.content.data?.route;
				const data = response?.notification.request.content.data as
					| {
							source?: string;
							replayDay?: string;
							replayDate?: string;
							notification_type?:
								| "morning_insight"
								| "weekly_report"
								| "monthly_report"
								| "permission_reminder";
							insight_type?: string;
							app_name?: string;
							brain_score?: number;
					  }
					| undefined;
				if (data?.notification_type) {
					TelemetryService.track("notification_opened", {
						notification_type: data.notification_type,
						insight_type: data.insight_type,
						app_name: data.app_name,
						brain_score: data.brain_score,
					});
				}
				handleNotificationRoute(
					route,
					data,
					response?.notification.request.identifier,
				);
				if (route && Notifications.clearLastNotificationResponseAsync) {
					void Notifications.clearLastNotificationResponseAsync();
				}
			})
			.catch((error) => {
				console.warn("Failed to read last notification response:", error);
			});

		const subscription =
			Notifications.addNotificationResponseReceivedListener((response) => {
				const route = response.notification.request.content.data?.route;
				const data = response.notification.request.content.data as
					| {
							source?: string;
							replayDay?: string;
							replayDate?: string;
							notification_type?:
								| "morning_insight"
								| "weekly_report"
								| "monthly_report"
								| "permission_reminder";
							insight_type?: string;
							app_name?: string;
							brain_score?: number;
					  }
					| undefined;
				if (data?.notification_type) {
					TelemetryService.track("notification_opened", {
						notification_type: data.notification_type,
						insight_type: data.insight_type,
						app_name: data.app_name,
						brain_score: data.brain_score,
					});
				}
				handleNotificationRoute(
					route,
					data,
					response.notification.request.identifier,
				);
			});

		return () => {
			subscription.remove();
		};
	}, [router]);

	useEffect(() => {
		if (!loaded || onboardingComplete === null) {
			return;
		}

		const routeName = segments.length > 0 ? `/${segments.join("/")}` : "/";
		if (lastTrackedScreenRef.current === routeName) {
			return;
		}

		lastTrackedScreenRef.current = routeName;
		void TelemetryService.screen(routeName, {
			route_segments: segments,
		});
	}, [loaded, onboardingComplete, segments]);

	useEffect(() => {
		if (!loaded || onboardingComplete === null || hasMarkedInteractiveRef.current) {
			return;
		}

		hasMarkedInteractiveRef.current = true;
		markInteractive();
	}, [loaded, markInteractive, onboardingComplete]);

	if (!loaded || onboardingComplete === null) {
		return null;
	}

	if (onboardingComplete && accessState === null) {
		return null;
	}

	const currentRoute = segments.length > 0 ? `/${segments.join("/")}` : "/";
	const inOnboarding = segments[0] === "onboarding";
	const inOnboardingPreview = currentRoute === "/onboarding/preview";
	if (!onboardingComplete && !inOnboarding) {
		return <Redirect href="/onboarding" />;
	}

	if (onboardingComplete && inOnboarding && !inOnboardingPreview) {
		return <Redirect href="/" />;
	}

	return (
		<GestureHandlerRootView style={{ flex: 1 }}>
			<Stack>
				<Stack.Screen name="(tabs)" options={{ headerShown: false }} />
				<Stack.Screen name="onboarding" options={{ headerShown: false }} />
				<Stack.Screen
					name="privacy-policy"
					options={{ title: "Privacy Policy" }}
				/>
				<Stack.Screen name="terms" options={{ title: "Terms of Service" }} />
				<Stack.Screen name="+not-found" />
			</Stack>
			{onboardingComplete && accessState?.subscriptionStatus === "expired" ? (
				<ExpiredTrialGate
					key={accessState.expiredFlowState}
					accessState={accessState}
				/>
			) : null}
			<StatusBar style="dark" />
		</GestureHandlerRootView>
	);
}

const ObservedRootLayout = ObserveRoot.wrap(Sentry.wrap(RootLayout));

export default ObservedRootLayout;
