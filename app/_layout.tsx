import * as Sentry from '@sentry/react-native';
import * as Notifications from 'expo-notifications';
import {
  Inter_400Regular,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import {
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { useFonts } from 'expo-font';
import { Redirect, Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
import "../global.css";
import { AuthService } from '../services/AuthService';
import { database } from '../services/database';
import { TelemetryService } from '../services/TelemetryService';

TelemetryService.prime();

export default Sentry.wrap(function RootLayout() {
  const [loaded] = useFonts({
    Inter_400Regular,
    Inter_600SemiBold,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);
  const segments = useSegments();
  const router = useRouter();
  const lastTrackedScreenRef = useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    TelemetryService.initialize().catch((error) => {
      console.warn('Failed to initialize telemetry:', error);
    });
    AuthService.initialize();

    database
      .getMeta('onboarding_completed')
      .then((value) => {
        if (isMounted) {
          setOnboardingComplete(value === 'true');
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
    const handleNotificationRoute = (route: unknown) => {
      if (typeof route !== 'string' || !route) {
        return;
      }

      router.push(route as never);
    };

    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        const route = response?.notification.request.content.data?.route;
        handleNotificationRoute(route);
        if (route && Notifications.clearLastNotificationResponseAsync) {
          void Notifications.clearLastNotificationResponseAsync();
        }
      })
      .catch((error) => {
        console.warn('Failed to read last notification response:', error);
      });

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const route = response.notification.request.content.data?.route;
      handleNotificationRoute(route);
    });

    return () => {
      subscription.remove();
    };
  }, [router]);

  useEffect(() => {
    if (!loaded || onboardingComplete === null) {
      return;
    }

    const routeName = segments.length > 0 ? `/${segments.join('/')}` : '/';
    if (lastTrackedScreenRef.current === routeName) {
      return;
    }

    lastTrackedScreenRef.current = routeName;
    void TelemetryService.screen(routeName, {
      route_segments: segments,
    });
  }, [loaded, onboardingComplete, segments]);

  if (!loaded || onboardingComplete === null) {
    return null;
  }

  const currentRoute = segments.length > 0 ? `/${segments.join('/')}` : '/';
  const inOnboarding = segments[0] === 'onboarding';
  const inOnboardingPreview = currentRoute === '/onboarding/preview';
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
        <Stack.Screen name="privacy-policy" options={{ title: 'Privacy Policy' }} />
        <Stack.Screen name="terms" options={{ title: 'Terms of Service' }} />
        <Stack.Screen name="+not-found" />
      </Stack>
      <StatusBar style="dark" />
    </GestureHandlerRootView>
  );
});
