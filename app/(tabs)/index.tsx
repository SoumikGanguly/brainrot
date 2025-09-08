import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import LottieView from 'lottie-react-native';
import React, { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '../../components/Buttons';
import { Card } from '../../components/Card';
import { Header } from '../../components/Header';
import { database } from '../../services/database';
import { TrialService } from '../../services/TrialService';
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

  const loadHomeData = async () => {
    try {
      setLoading(true);
      
      // Get today's date
      const today = new Date().toISOString().split('T')[0];
      
      // Load usage data
      const todayUsage = await database.getDailyUsage(today);
      const totalMs = todayUsage.reduce((sum, app) => sum + app.totalTimeMs, 0);
      
      // Calculate brain score
      const allowedMs = 8 * 60 * 60 * 1000; // 8 hours
      const score = Math.max(0, Math.round(100 - (totalMs / allowedMs) * 100));
      
      setBrainScore(score);
      setTotalScreenTime(totalMs);
      setTopApps(todayUsage.slice(0, 3));
      
      // Load trial info
      const trial = await TrialService.getTrialInfo();
      setTrialInfo(trial);
      
    } catch (error) {
      console.error('Error loading home data:', error);
    } finally {
      setLoading(false);
    }
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
    if (brainScore >= 80) return "Your brain is healthy today! 🧠✨";
    if (brainScore >= 50) return "Your brain is getting foggy... 🌫️";
    if (brainScore >= 25) return "Your brain needs attention! ⚠️";
    return "Your brain is in critical condition! 🚨";
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-bg">
        <View className="flex-1 justify-center items-center">
          <Text className="text-base text-muted">Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <Header title="Brainrot" showInfo />
        
        {/* Brain Animation Section */}
        <View className="items-center py-lg">
          <View className={`w-48 h-48 ${getBrainAnimationState() === 'healthy' ? 'brain-healthy' : getBrainAnimationState() === 'warning' ? 'brain-warning' : 'brain-critical'}`}>
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
            <Text className="text-base text-muted text-center py-lg">
              No usage data available
            </Text>
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