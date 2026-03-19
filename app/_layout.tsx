import * as Sentry from '@sentry/react-native';
import { useFonts } from 'expo-font';
import { Redirect, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import 'react-native-reanimated';
import "../global.css";
import { database } from '../services/database';
import { TelemetryService } from '../services/TelemetryService';

export default Sentry.wrap(function RootLayout() {
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);
  const segments = useSegments();
  const lastTrackedScreenRef = useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    TelemetryService.initialize().catch((error) => {
      console.warn('Failed to initialize telemetry:', error);
    });

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

  const inOnboarding = segments[0] === 'onboarding';
  if (!onboardingComplete && !inOnboarding) {
    return <Redirect href="/onboarding" />;
  }

  if (onboardingComplete && inOnboarding) {
    return <Redirect href="/" />;
  }

  return (
    <>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="privacy-policy" options={{ title: 'Privacy Policy' }} />
        <Stack.Screen name="terms" options={{ title: 'Terms of Service' }} />
        <Stack.Screen name="+not-found" />
      </Stack>
      <StatusBar style="auto" />
    </>
  );
});
