import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import LottieView from 'lottie-react-native';
import React, { useEffect, useState } from 'react';
import { Alert, AppState, Modal, Pressable, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '../../components/Buttons';
import { Card } from '../../components/Card';
import { database } from '../../services/database';

import { TrialService } from '../../services/TrialService';
import { UsageService } from '../../services/UsageService';

import { DailyResetService } from '@/services/DailyResetService';
import { HistoricalDataService } from '@/services/HistoricalDataService';
import { UsageMonitoringService } from '@/services/UsageMonitoringService';
import { computeBrainScoreForMonitored } from '@/utils/brainScoreRunner';
import { calculateBrainScore, getBrainScoreStatus } from '../../utils/brainScore';
import { formatTime } from '../../utils/time';

import { AppBlockingService } from '@/services/AppBlockingService';


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
  const [trialInfo, setTrialInfo] = useState({ isActive: false, daysRemaining: 0, expired: false });
  const [loading, setLoading] = useState(true);
  const [hasUsagePermission, setHasUsagePermission] = useState(false);
  const [debugMessages, setDebugMessages] = useState<string[]>([]);
  const [showAllAppsModal, setShowAllAppsModal] = useState(false);

  useEffect(() => {
    let isInitialized = false;
    
    const initializeAllServices = async () => {
      if (isInitialized) return; // Prevent multiple initializations
      
      try {
        console.log('=== INITIALIZING ALL SERVICES ===');
        
        // 1. Initialize monitoring service first (handles notifications)
        const monitoringService = UsageMonitoringService.getInstance();
        await monitoringService.initialize();
        console.log('✓ Monitoring service initialized');
        
        // 2. Initialize blocking service
        const blockingService = AppBlockingService.getInstance();
        await blockingService.initialize();
        console.log('✓ Blocking service initialized');
        
        // 3. Initialize historical data service
        const historicalService = HistoricalDataService.getInstance();
        // Only backfill if needed, not on every app start
        const lastBackfill = await database.getMeta('last_backfill_date');
        const today = new Date().toISOString().split('T')[0];
        if (lastBackfill !== today) {
          await historicalService.backfillHistoricalData(90);
          await database.setMeta('last_backfill_date', today);
          console.log('✓ Historical data backfilled');
        }
        
        // 4. Initialize service coordinator (connects monitoring and blocking)
        const coordinator = (await import('@/services/ServiceCoordinator')).ServiceCoordinator.getInstance();
        await coordinator.initialize();
        console.log('✓ Service coordinator initialized');
        
        // 5. Initialize daily reset service
        const dailyResetService = DailyResetService.getInstance();
        dailyResetService.initialize();
        console.log('✓ Daily reset service initialized');
        
        // 5. Clean up duplicates once
        await database.cleanupDuplicateEntries();
        console.log('✓ Database cleanup completed');
        
        isInitialized = true;
        console.log('=== ALL SERVICES INITIALIZED ===');
        
      } catch (error) {
        console.error('Failed to initialize services:', error);
      }
    };

    // Initialize once
    initializeAllServices();

    
    // Handle app state changes
    const handleAppStateChange = async (nextAppState: string) => {
      if (nextAppState === 'active') {
        console.log('App became active, refreshing services...');
        
        // Refresh monitoring when app comes to foreground
        const monitoringService = UsageMonitoringService.getInstance();
        await monitoringService.startMonitoring();
        
        // Refresh blocking service
        const blockingService = AppBlockingService.getInstance();
        await blockingService.initialize(); // This will reload settings and blocked apps
        
        // Trigger immediate usage check
        setTimeout(() => {
          monitoringService.triggerManualCheck();
        }, 1000);
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    // Cleanup on unmount
    return () => {
      subscription?.remove();
    };
  }, []);

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
        } catch {
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

  const deduplicateUsageData = (data: AppUsage[]): AppUsage[] => {
    const seen = new Map<string, AppUsage>();
    
    data.forEach(app => {
      const existing = seen.get(app.packageName);
      if (!existing || app.totalTimeMs > existing.totalTimeMs) {
        seen.set(app.packageName, app);
      }
    });
    
    return Array.from(seen.values());
  };

  const loadUsageDataFromNative = async () => {
    addDebugMessage('Fetching today\'s usage from native module...');
    
    try {
      const todayUsage = await UsageService.getTodayUsage();
      addDebugMessage(`Received ${todayUsage.length} apps with usage data`);
      
      if (todayUsage.length === 0) {
        return [];
      }

      // Deduplicate native data first
      const deduplicatedUsage = deduplicateUsageData(todayUsage);
      
      // Save to database (this will replace existing entries due to UNIQUE constraint)
      const today = new Date().toISOString().split('T')[0];
      const dbUsageData = deduplicatedUsage.map(app => ({
        ...app,
        date: today
      }));
      
      try {
        await database.saveDailyUsage(today, dbUsageData);
        addDebugMessage(`Saved ${deduplicatedUsage.length} deduplicated apps to database`);
      } catch (dbError: unknown) {
        const errorMessage = dbError instanceof Error ? dbError.message : 'Unknown database error';
        addDebugMessage(`Database save failed: ${errorMessage}`);
      }

      return deduplicatedUsage;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown native fetch error';
      addDebugMessage(`Native fetch failed: ${errorMessage}`);
      throw error;
    }
  };

  // Add this as a new function in your HomeScreen
  const saveCurrentUsageData = async () => {
    try {
      if (UsageService.isNativeModuleAvailable()) {
        const hasPermission = await UsageService.isUsageAccessGranted();
        if (hasPermission) {
          const todayUsage = await UsageService.getTodayUsage();
          if (todayUsage.length > 0) {
            const today = new Date().toISOString().split('T')[0];
            const dbUsageData = todayUsage.map(app => ({
              ...app,
              date: today
            }));
            await database.saveDailyUsage(today, dbUsageData);
            addDebugMessage('Background save completed');
          }
        }
      }
    } catch (error) {
      console.log('Background save failed:', error);
    }
  };

  // Add this useEffect to periodically save data
  useEffect(() => {
    const interval = setInterval(saveCurrentUsageData, 5 * 60 * 1000); // Save every 5 minutes
    return () => clearInterval(interval);
  }, []);

  const dailyResetService = DailyResetService.getInstance();
  dailyResetService.initialize();
  
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

  // Add this debug method to HomeScreen.tsx
  const debugDuplicateIssue = async () => {
    const today = new Date().toISOString().split('T')[0];
    
    // Check raw database entries
    const rawEntries = await database.getDailyUsage(today);
    console.log('=== RAW DATABASE ENTRIES ===');
    rawEntries.forEach((entry, index) => {
      console.log(`${index}: ${entry.packageName} - ${entry.appName} - ${entry.totalTimeMs}ms`);
    });
    
    // Check for Instagram specifically
    const instagramEntries = rawEntries.filter(e => e.packageName === 'com.instagram.android');
    console.log('=== INSTAGRAM ENTRIES ===');
    console.log(`Found ${instagramEntries.length} Instagram entries:`);
    instagramEntries.forEach((entry, index) => {
      console.log(`${index}: ${entry.totalTimeMs}ms - ${entry.appName}`);
    });
    
    // Check what's in topApps state
    console.log('=== TOP APPS STATE ===');
    topApps.forEach((app, index) => {
      console.log(`${index}: ${app.packageName} - ${app.appName} - ${app.totalTimeMs}ms`);
    });
    
    // Check allApps state
    const instagramInAllApps = allApps.filter(a => a.packageName === 'com.instagram.android');
    console.log('=== INSTAGRAM IN ALL APPS ===');
    console.log(`Found ${instagramInAllApps.length} Instagram entries in allApps:`);
    instagramInAllApps.forEach((app, index) => {
      console.log(`${index}: ${app.totalTimeMs}ms`);
    });
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
          let rawUsageData = await loadUsageDataFromNative();
          // DEDUPLICATE HERE
          usageData = deduplicateUsageData(rawUsageData);
        } catch {
          addDebugMessage('Native failed, trying database fallback...');
          let rawDbData = await loadUsageDataFromDatabase();
          // DEDUPLICATE HERE TOO
          usageData = deduplicateUsageData(rawDbData);
        }
      } else {
        addDebugMessage('Using database fallback (no native access)...');
        let rawDbData = await loadUsageDataFromDatabase();
        // DEDUPLICATE HERE AS WELL
        usageData = deduplicateUsageData(rawDbData);
      }

      // Step 3: Process the data
      let monitoredPackages: string[] = [];
        try {
          const monitoredMeta = await database.getMeta('monitored_apps');
          monitoredPackages = monitoredMeta ? JSON.parse(monitoredMeta) : [];
          addDebugMessage(`Monitored packages loaded: ${monitoredPackages.length}`);
        } catch {
          addDebugMessage('Failed to load monitored packages meta, defaulting to empty');
          monitoredPackages = [];
        }

        // 1) Save raw data to DB for calendar/backups (you already do this; keep it)
        if (usageData.length > 0) {
          try {
            const today = new Date().toISOString().split('T')[0];
            const dbUsageData = usageData.map(app => ({ ...app, date: today }));
            await database.saveDailyUsage(today, dbUsageData);
            addDebugMessage('Raw usage saved to DB');
          } catch {
            addDebugMessage('Failed saving raw usage to DB');
          }
        }

        // 2) Compute brain score only for monitored apps (this also excludes the app itself)
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        let computed = { totalUsageMs: 0, score: 100, details: [] as any[] };
        try {
          computed = await computeBrainScoreForMonitored(monitoredPackages, startOfDay.getTime(), { debug: __DEV__ });
          addDebugMessage(`Computed brain score from monitored apps: ${computed.score}`);
        } catch {
          addDebugMessage('computeBrainScoreForMonitored failed, falling back to raw sum');
          // fallback: sum everything (but this should rarely happen)
          const fallbackTotal = usageData.reduce((s, a) => s + (a.totalTimeMs || 0), 0);
          computed = { totalUsageMs: fallbackTotal, score: calculateBrainScore(fallbackTotal), details: usageData };
        }

        // 3) Use computed values for UI (monitored-only lists)
        const monitoredSorted = (computed.details || [])
          .filter(a => a.totalTimeMs > 0)
          .sort((a, b) => b.totalTimeMs - a.totalTimeMs);

        const monitoredTopThree = monitoredSorted.slice(0, 3);

        setBrainScore(computed.score);
        setTotalScreenTime(computed.totalUsageMs);
        setTopApps(monitoredTopThree);
        setAllApps(monitoredSorted); // This ensures modal data consistency

      // Ensure data is saved to database for calendar consistency
      // if (monitoredTopThree.length > 0) {
      //   const today = new Date().toISOString().split('T')[0];
      //   const dbUsageData = monitoredTopThree.map(app => ({
      //     ...app,
      //     date: today
      //   }));
        
      //   try {
      //     await database.saveDailyUsage(today, dbUsageData);
          
      //     addDebugMessage('Data synced to database for calendar consistency');
      //   } catch (dbError: unknown) {
      //     const errorMessage = dbError instanceof Error ? dbError.message : 'Unknown database error';
      //     addDebugMessage(`Database sync failed: ${errorMessage}`);
      //   }
      // }

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
      // Also save current data when screen comes into focus
      setTimeout(saveCurrentUsageData, 1000); // Delay to avoid conflicts
    }, [])
  );

  const getBrainAnimationState = () => {
    if (brainScore >= 80) return 'healthy';
    if (brainScore >= 50) return 'warning';
    return 'critical';
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
        <View className="bg-white rounded-t-3xl" style={{ height: '50%' }}>
          {/* Header */}
          <View className="flex-row items-center justify-between p-4 border-b border-gray-200">
            <Text className="text-lg font-semibold text-gray-900">
              All Apps Today ({allApps.length})
            </Text>
            <TouchableOpacity
              onPress={() => setShowAllAppsModal(false)}
              className="w-8 h-8 rounded-full bg-gray-100 items-center justify-center"
            >
              <Ionicons name="close" size={20} color="#374151" />
            </TouchableOpacity>
          </View>
          
          {/* Apps List */}
          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            {allApps.length === 0 ? (
              <View className="py-12 items-center">
                <Text className="text-base text-gray-500 text-center">
                  {hasUsagePermission 
                    ? "No usage data available for today" 
                    : "Grant usage permission to see your app usage"
                  }
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
                      <View className="w-10 h-10 bg-blue-100 rounded-full items-center justify-center mr-3">
                        <Text className="text-sm font-bold text-blue-600">{index + 1}</Text>
                      </View>
                      <View className="flex-1">
                        <Text className="text-base font-medium text-gray-900" numberOfLines={1}>
                          {app.appName}
                        </Text>
                        <Text className="text-sm text-gray-500">
                          {app.packageName}
                        </Text>
                      </View>
                    </View>
                    <View className="items-end">
                      <Text className="text-base font-semibold text-gray-900">
                        {formatTime(app.totalTimeMs)}
                      </Text>
                      <Text className="text-xs text-gray-500">
                        {totalScreenTime > 0 ? ((app.totalTimeMs / totalScreenTime) * 100).toFixed(1) : '0.0'}%
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
        {/* <Header title="Brainrot" showInfo /> */}
        
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
              Apps Loaded: {topApps.length} / {allApps.length}
            </Text>

            <TouchableOpacity 
              onPress={() => {
                const today = new Date().toISOString().split('T')[0];
                database.cleanupDuplicateEntries(today);
              }} 
              className="mt-2 p-1 bg-yellow-200 rounded"
            >
              <Text className="text-xs text-center">Clean Today</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={debugDuplicateIssue} className="mt-2 p-1 bg-red-200 rounded">
              <Text className="text-xs text-center">Debug Duplicates</Text>
            </TouchableOpacity>
            
            <TouchableOpacity onPress={testNativeModule} className="mt-2 p-1 bg-gray-200 rounded">
              <Text className="text-xs text-center">Run Full Test</Text>
            </TouchableOpacity>
          </Card>
        )}
        
        {/* Brain Animation Section */}
        <View className="items-center py-lg">
          <View className="w-64 h-64">
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
          <View className="flex-row justify-between items-center">
            <Text className="text-base text-muted">Total Screen Time</Text>
            <Text className="text-base font-semibold text-text">{formatTime(totalScreenTime)}</Text>
          </View>
        </Card>

        {/* Top Apps */}
        <Card className="mx-md mb-md">
          <View className="flex-row items-center justify-between mb-sm">
            <Text className="text-lg font-semibold text-text">Top Apps Today</Text>
            {allApps.length > 0 && (
              <TouchableOpacity 
                onPress={() => setShowAllAppsModal(true)}
                className="flex-row items-center"
              >
                <Text className="text-sm text-accent font-medium mr-1">Show All</Text>
                <Ionicons name="chevron-forward" size={16} color="#3B82F6" />
              </TouchableOpacity>
            )}
          </View>
          
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
                key={`${app.packageName}-${index}`} 
                className="flex-row items-center justify-between py-sm border-b border-surface last:border-b-0"
                onPress={() => setShowAllAppsModal(true)}
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
      
      {/* All Apps Modal */}
      {renderAllAppsModal()}
    </SafeAreaView>
  );
}