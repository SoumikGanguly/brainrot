import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import LottieView from 'lottie-react-native';
import React, { useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '../../components/Buttons';
import { Card } from '../../components/Card';
import { Header } from '../../components/Header';
import { database } from '../../services/database';
import { TrialService } from '../../services/TrialService';
import { UsageService } from '../../services/UsageService';
import { formatTime } from '../../utils/time';

interface AppUsage {
  packageName: string;
  appName: string;
  totalTimeMs: number;
}

export default function HomeScreen() {
  const [brainScore, setBrainScore] = useState(100);
  const [topApps, setTopApps] = useState<AppUsage[]>([]);
  const [totalScreenTime, setTotalScreenTime] = useState(0);
  const [trialInfo, setTrialInfo] = useState({ isActive: false, daysRemaining: 0, expired: false });
  const [loading, setLoading] = useState(true);
  const [hasUsagePermission, setHasUsagePermission] = useState(false);
  const [debugMessages, setDebugMessages] = useState<string[]>([]);

  const addDebugMessage = (message: string) => {
    console.log(message);
    setDebugMessages(prev => [...prev.slice(-4), message]); // Keep last 5 messages
  };

  const checkNativeModuleAndPermissions = async () => {
    addDebugMessage('Checking native module availability...');
    
    // Check if native module is available
    const isModuleAvailable = UsageService.isNativeModuleAvailable();
    addDebugMessage(`Native module available: ${isModuleAvailable}`);
    
    if (!isModuleAvailable) {
      addDebugMessage('Native module not available - using fallback data');
      return { hasModule: false, hasPermission: false };
    }

    // Check permissions with retry
    addDebugMessage('Checking usage access permissions...');
    try {
      let hasPermission = await UsageService.isUsageAccessGranted();
      addDebugMessage(`Usage permission granted: ${hasPermission}`);
      
      // If permission is false but we're returning from settings, try again after a delay
      if (!hasPermission) {
        addDebugMessage('Permission denied, trying force refresh...');
        // Try the force refresh method if available
        try {
          if (UsageService.forceRefreshPermission) {
            hasPermission = await UsageService.forceRefreshPermission();
            addDebugMessage(`Force refresh result: ${hasPermission}`);
          }
        } catch (refreshError: unknown) {
          addDebugMessage('Force refresh failed, continuing with normal flow...');
        }
      }
      
      setHasUsagePermission(hasPermission);
      
      if (!hasPermission) {
        addDebugMessage('Requesting usage permission from user...');
        Alert.alert(
          'Usage Access Required',
          'Grant usage access permission to track screen time.\n\n1. Find your app in the list\n2. Toggle the permission ON\n3. Return to the app',
          [
            { text: 'Later', style: 'cancel' },
            { 
              text: 'Grant Permission', 
              onPress: async () => {
                try {
                  addDebugMessage('Opening usage access settings...');
                  await UsageService.openUsageAccessSettings();
                } catch (settingsError: unknown) {
                  const errorMessage = settingsError instanceof Error ? settingsError.message : 'Unknown error opening settings';
                  addDebugMessage(`Failed to open settings: ${errorMessage}`);
                }
              }
            }
          ]
        );
      }
      
      return { hasModule: true, hasPermission };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown permission check error';
      addDebugMessage(`Permission check failed: ${errorMessage}`);
      return { hasModule: true, hasPermission: false };
    }
  };

  const loadUsageDataFromNative = async () => {
    addDebugMessage('Fetching today\'s usage from native module...');
    
    try {
      const todayUsage = await UsageService.getTodayUsage();
      addDebugMessage(`Received ${todayUsage.length} apps with usage data`);
      
      if (todayUsage.length === 0) {
        addDebugMessage('No usage data received - this is normal for first run or no app usage');
        return [];
      }

      // Log the raw data for debugging
      todayUsage.forEach((app, index) => {
        if (index < 3) { // Log top 3 apps
          addDebugMessage(`${app.appName}: ${formatTime(app.totalTimeMs)}`);
        }
      });

      // Save to database for offline access
      try {
        const today = new Date().toISOString().split('T')[0];
        // Convert UsageService format to database format by adding the date field
        const dbUsageData = todayUsage.map(app => ({
          ...app,
          date: today
        }));
        await database.saveDailyUsage(today, dbUsageData);
        addDebugMessage('Data saved to local database');
      } catch (dbError: unknown) {
        const errorMessage = dbError instanceof Error ? dbError.message : 'Unknown database error';
        addDebugMessage(`Database save failed: ${errorMessage}`);
      }

      return todayUsage;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown native fetch error';
      addDebugMessage(`Native fetch failed: ${errorMessage}`);
      throw error;
    }
  };

  const loadUsageDataFromDatabase = async () => {
    addDebugMessage('Loading data from local database...');
    
    try {
      const today = new Date().toISOString().split('T')[0];
      const dbUsage = await database.getDailyUsage(today);
      addDebugMessage(`Database returned ${dbUsage.length} apps`);
      // Convert database format to component format (remove date field)
      return dbUsage.map(({ date, ...rest }) => rest);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown database error';
      addDebugMessage(`Database load failed: ${errorMessage}`);
      return [];
    }
  };

  const loadHomeData = async () => {
    try {
      setLoading(true);
      addDebugMessage('Starting home data load...');
      
      // Step 1: Check module and permissions
      const { hasModule, hasPermission } = await checkNativeModuleAndPermissions();
      
      let usageData: AppUsage[] = [];
      
      // Step 2: Try to load usage data
      if (hasModule && hasPermission) {
        try {
          usageData = await loadUsageDataFromNative();
        } catch (error: unknown) {
          addDebugMessage('Native failed, trying database fallback...');
          usageData = await loadUsageDataFromDatabase();
        }
      } else {
        addDebugMessage('Using database fallback (no native access)...');
        usageData = await loadUsageDataFromDatabase();
      }

      // Step 3: Process the data
      const totalMs = usageData.reduce((sum, app) => sum + app.totalTimeMs, 0);
      const allowedMs = 8 * 60 * 60 * 1000; // 8 hours
      const score = Math.max(0, Math.round(100 - (totalMs / allowedMs) * 100));
      
      const topThreeApps = usageData
        .filter(app => app.totalTimeMs > 0)
        .sort((a, b) => b.totalTimeMs - a.totalTimeMs)
        .slice(0, 3);

      addDebugMessage(`Calculated brain score: ${score}`);
      addDebugMessage(`Total screen time: ${formatTime(totalMs)}`);

      setBrainScore(score);
      setTotalScreenTime(totalMs);
      setTopApps(topThreeApps);

      // Step 4: Load trial info
      try {
        const trial = await TrialService.getTrialInfo();
        setTrialInfo(trial);
        addDebugMessage('Trial info loaded successfully');
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown trial error';
        addDebugMessage(`Trial info load failed: ${errorMessage}`);
      }

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addDebugMessage(`Critical error in loadHomeData: ${errorMessage}`);
    } finally {
      setLoading(false);
      addDebugMessage('Home data loading completed');
    }
  };

  const testNativeModule = async () => {
    addDebugMessage('Running native module test...');
    
    try {
      const isAvailable = UsageService.isNativeModuleAvailable();
      let testResults = `Module Available: ${isAvailable}\n`;
      
      if (isAvailable) {
        const hasAccess = await UsageService.isUsageAccessGranted();
        testResults += `Has Permission: ${hasAccess}\n`;
        
        const apps = await UsageService.getInstalledApps();
        testResults += `Installed Apps: ${apps.length}\n`;
        
        if (hasAccess) {
          const usage = await UsageService.getTodayUsage();
          testResults += `Today's Usage: ${usage.length} apps`;
        }
      }
      
      Alert.alert('Native Module Test', testResults, [{ text: 'OK' }]);
      addDebugMessage('Test completed - check popup for results');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown test error';
      addDebugMessage(`Test failed: ${errorMessage}`);
      Alert.alert('Test Error', errorMessage, [{ text: 'OK' }]);
    }
  };

  const refreshData = async () => {
    addDebugMessage('Manual refresh triggered');
    await loadHomeData();
  };

  useFocusEffect(
    React.useCallback(() => {
      loadHomeData();
    }, [])
  );

  const getBrainAnimationState = () => {
    if (brainScore >= 80) return 'healthy';
    if (brainScore >= 50) return 'warning';
    return 'critical';
  };

  const getBrainStatusText = () => {
    if (brainScore >= 80) return "Your brain is healthy today!";
    if (brainScore >= 50) return "Your brain is getting foggy...";
    if (brainScore >= 25) return "Your brain needs attention!";
    return "Your brain is in critical condition!";
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-bg">
        <View className="flex-1 justify-center items-center p-4">
          <Text className="text-base text-muted mb-4">Loading...</Text>
          
          {/* Debug messages during loading */}
          <View className="bg-gray-100 p-3 rounded-lg mb-4 w-full max-w-sm">
            <Text className="text-xs font-semibold mb-2">Debug Log:</Text>
            {debugMessages.map((msg, index) => (
              <Text key={index} className="text-xs text-gray-600 mb-1">
                {msg}
              </Text>
            ))}
          </View>
          
          <TouchableOpacity 
            onPress={testNativeModule}
            className="px-4 py-2 bg-blue-500 rounded"
          >
            <Text className="text-white text-sm">Test Native Module</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <Header title="Brainrot" showInfo />
        
        {/* Debug Panel (only in development) */}
        {__DEV__ && (
          <Card className="mx-md mb-md bg-gray-50">
            <View className="flex-row justify-between items-center mb-2">
              <Text className="text-sm font-semibold">Debug Info</Text>
              <TouchableOpacity onPress={refreshData} className="px-2 py-1 bg-blue-500 rounded">
                <Text className="text-white text-xs">Refresh</Text>
              </TouchableOpacity>
            </View>
            <Text className="text-xs text-gray-600 mb-1">
              Native Module: {UsageService.isNativeModuleAvailable() ? 'Available' : 'Not Available'}
            </Text>
            <Text className="text-xs text-gray-600 mb-1">
              Permission: {hasUsagePermission ? 'Granted' : 'Not Granted'}
            </Text>
            <Text className="text-xs text-gray-600">
              Apps Loaded: {topApps.length}
            </Text>
            
            <TouchableOpacity onPress={testNativeModule} className="mt-2 p-1 bg-gray-200 rounded">
              <Text className="text-xs text-center">Run Full Test</Text>
            </TouchableOpacity>
          </Card>
        )}
        
        {/* Brain Animation Section */}
        <View className="items-center py-lg">
          <View className="w-48 h-48">
            <LottieView
              source={require('../../assets/animations/brain.json')}
              autoPlay
              loop
              style={{ width: '100%', height: '100%' }}
              speed={getBrainAnimationState() === 'critical' ? 0.5 : 1}
            />
          </View>
          
          <View className="items-center mt-md">
            <Text className="text-5xl font-bold text-text">{brainScore}</Text>
            <Text className="text-base text-muted mt-xs">{getBrainStatusText()}</Text>
          </View>
        </View>

        {/* Trial/Purchase CTA */}
        {trialInfo.isActive && !trialInfo.expired && (
          <Card className="mx-md mb-md bg-accent/10 border-accent/20">
            <View className="items-center">
              <Text className="text-base text-accent font-semibold mb-sm">
                7-day trial active — {trialInfo.daysRemaining} days left
              </Text>
              <Text className="text-sm text-muted mb-md text-center">
                Unlock permanently for ₹149 / $2.99
              </Text>
              <PrimaryButton 
                title="Unlock ₹149" 
                onPress={() => {/* Handle purchase */}}
                className="w-full"
              />
            </View>
          </Card>
        )}

        {trialInfo.expired && (
          <Card className="mx-md mb-md bg-danger/10 border-danger/20">
            <View className="items-center">
              <Text className="text-base text-danger font-semibold mb-sm">
                Trial Expired
              </Text>
              <Text className="text-sm text-muted mb-md text-center">
                Unlock all features and remove limitations
              </Text>
              <PrimaryButton 
                title="Unlock Now ₹149" 
                onPress={() => {/* Handle purchase */}}
                className="w-full bg-danger"
              />
            </View>
          </Card>
        )}

        {/* Today's Summary */}
        <Card className="mx-md mb-md">
          <Text className="text-lg font-semibold text-text mb-sm">Today&apos;s Summary</Text>
          <View className="flex-row justify-between items-center mb-md">
            <Text className="text-base text-muted">Total Screen Time</Text>
            <Text className="text-base font-semibold text-text">{formatTime(totalScreenTime)}</Text>
          </View>
          <TouchableOpacity 
            className="bg-surface p-sm rounded-lg"
            onPress={() => {/* Navigate to calendar */}}
          >
            <Text className="text-sm text-accent text-center">View Calendar Details</Text>
          </TouchableOpacity>
        </Card>

        {/* Top Apps */}
        <Card className="mx-md mb-md">
          <Text className="text-lg font-semibold text-text mb-sm">Top Apps Today</Text>
          {topApps.length === 0 ? (
            <View className="py-lg">
              <Text className="text-base text-muted text-center">
                {hasUsagePermission 
                  ? "No usage data available for today" 
                  : "Grant usage permission to see your app usage"
                }
              </Text>
              {!hasUsagePermission && (
                <Text className="text-sm text-muted text-center mt-2">
                  You&apos;ll be prompted for permission when you open the app
                </Text>
              )}
            </View>
          ) : (
            topApps.map((app, index) => (
              <TouchableOpacity 
                key={app.packageName}
                className="flex-row items-center justify-between py-sm border-b border-surface last:border-b-0"
                onPress={() => {/* Navigate to app settings */}}
              >
                <View className="flex-row items-center flex-1">
                  <View className="w-8 h-8 bg-accent/20 rounded-full items-center justify-center mr-sm">
                    <Text className="text-sm font-bold text-accent">{index + 1}</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-medium text-text">{app.appName}</Text>
                    <Text className="text-sm text-muted">{formatTime(app.totalTimeMs)}</Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#6B7280" />
              </TouchableOpacity>
            ))
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}