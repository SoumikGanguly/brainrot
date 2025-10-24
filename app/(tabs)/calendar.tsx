import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Alert, Dimensions, Modal, ScrollView, Share, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';

import { SecondaryButton } from '../../components/Buttons';
import { Card } from '../../components/Card';
import { Header } from '../../components/Header';
import { database } from '../../services/database';

import { BrainScoreService } from '@/services/BrainScore';
import { calculateBrainScore, getScoreColor, getScoreLabel } from '../../utils/brainScore';
import { formatTime, formatTimeDetailed } from '../../utils/time';

interface DailyData {
  date: string;
  totalScreenTime: number;
  brainScore: number;
  apps: {
    packageName: string;
    appName: string;
    totalTimeMs: number;
  }[];
}

interface HeatmapDay {
  date: string;
  score: number;
  screenTime: number;
  isToday: boolean;
  hasData: boolean;
  dayOfMonth: number;
}

const { width: screenWidth } = Dimensions.get('window');

export default function Calendar() {
  const [historicalData, setHistoricalData] = useState<DailyData[]>([]);
  const [selectedDay, setSelectedDay] = useState<DailyData | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [viewMode, setViewMode] = useState<'heatmap' | 'list'>('heatmap');

  useEffect(() => {
    loadHistoricalData();
  }, []);

  const loadHistoricalData = async () => {
    try {
      setLoading(true);

      const brainScoreService = BrainScoreService.getInstance();
      const data: DailyData[] = [];
      
      // Get last 90 days
      const today = new Date();
      for (let i = 0; i < 90; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        
        try {
          // Use SAME service as HomeScreen
          const result = await brainScoreService.getBrainScoreForDate(dateStr);
          
          if (result.apps.length > 0 || result.totalUsageMs > 0) {
            data.push({
              date: dateStr,
              totalScreenTime: result.totalUsageMs,
              brainScore: result.score,
              apps: result.apps.map(app => ({
                packageName: app.packageName,
                appName: app.appName,
                totalTimeMs: app.totalTimeMs
              }))
            });
          }
        } catch (error) {
          console.warn(`Failed to get data for ${dateStr}:`, error);
          // Skip this day, continue with next
        }
      }
      
      // Sort by date descending
      data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
      setHistoricalData(data);
    } catch (error) {
      console.error('Error loading historical data:', error);
      setHistoricalData([]);
    } finally {
      setLoading(false);
    }
  };

  const openDayDetail = async (dateStr: string) => {
    try {
      // Use SAME service - no more inconsistent fallback logic
      const brainScoreService = BrainScoreService.getInstance();
      const result = await brainScoreService.getBrainScoreForDate(dateStr);
      
      setSelectedDay({
        date: dateStr,
        totalScreenTime: result.totalUsageMs,
        brainScore: result.score,
        apps: result.apps
      });
      setShowModal(true);
    } catch (error) {
      console.error('Error loading day detail:', error);
      Alert.alert('Error', 'Could not load day details. Please try again.');
    }
  };

  const generateHeatmapData = (): HeatmapDay[][] => {
    const weeks = [];
    const firstDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const lastDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
    const startDate = new Date(firstDayOfMonth);
    
    // Go back to the Sunday of the week containing the first day
    startDate.setDate(startDate.getDate() - startDate.getDay());
    
    const today = new Date();
    let currentDate = new Date(startDate);
    
    while (currentDate <= lastDayOfMonth || currentDate.getDay() !== 0) {
      const week: HeatmapDay[] = [];
      
      for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const dayData = historicalData.find(d => d.date === dateStr);
        const isCurrentMonth = currentDate.getMonth() === currentMonth.getMonth();
        
        week.push({
          date: dateStr,
          score: dayData?.brainScore || (isCurrentMonth ? 100 : 0),
          screenTime: dayData?.totalScreenTime || 0,
          isToday: dateStr === today.toISOString().split('T')[0],
          hasData: !!dayData,
          dayOfMonth: currentDate.getDate()
        });
        
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      weeks.push(week);
      
      if (currentDate > lastDayOfMonth && currentDate.getDay() === 0) break;
    }
    
    return weeks;
  };


  const exportData = async () => {
    try {
      // Ensure we have up-to-date historical data
      const data = await database.getHistoricalData(365); // e.g. 1 year

      // Generate CSV data
      let csvContent = 'Date,Total Screen Time (minutes),Brain Score,Top App,Usage (minutes)\n';

      for (const day of data.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())) {
        let total = day.totalScreenTime ?? 0;
        let score = day.brainScore ?? calculateBrainScore(total);
        let topAppName = 'N/A';
        let topAppUsage = 0;

        if (day.apps && day.apps.length > 0) {
          const top = day.apps[0];
          topAppName = top.appName || top.packageName || 'N/A';
          topAppUsage = Math.round((top.totalTimeMs || 0) / (1000 * 60));
        } else {
          // Fallback to raw usage
          const raw = await database.getDailyUsage(day.date);
          const rawTotal = raw.reduce((s: number, a: any) => s + (a.totalTimeMs || 0), 0);
          total = total || rawTotal;
          score = score || calculateBrainScore(rawTotal);
        }

        const screenTimeMinutes = Math.round(total / (1000 * 60));
        csvContent += `${day.date},${screenTimeMinutes},${score},"${topAppName}",${topAppUsage}\n`;
      }

      await Share.share({
        message: csvContent,
        title: 'Brainrot Usage Data Export',
      });
    } catch (error) {
      console.error('Error exporting data:', error);
      Alert.alert('Export Failed', 'Could not export your data. Please try again.');
    }
  };


  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentMonth(prev => {
      const newDate = new Date(prev);
      newDate.setMonth(prev.getMonth() + (direction === 'next' ? 1 : -1));
      return newDate;
    });
  };

  const renderHeatmapView = () => {
    const heatmapWeeks = generateHeatmapData();
    const cellSize = Math.min(42, (screenWidth - 80) / 7);
    const heatmapWidth = cellSize * 7;
    const heatmapHeight = cellSize * heatmapWeeks.length;

    return (
      <>
        {/* Month Navigation */}
        <Card className="mx-md mb-md">
          <View className="flex-row items-center justify-between mb-md">
            <TouchableOpacity 
              onPress={() => navigateMonth('prev')}
              className="p-sm"
            >
              <Ionicons name="chevron-back" size={24} color="#4F46E5" />
            </TouchableOpacity>
            
            <Text className="text-lg font-semibold text-text">
              {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </Text>
            
            <TouchableOpacity 
              onPress={() => navigateMonth('next')}
              className="p-sm"
              disabled={currentMonth.getMonth() >= new Date().getMonth()}
            >
              <Ionicons 
                name="chevron-forward" 
                size={24} 
                color={currentMonth.getMonth() >= new Date().getMonth() ? "#9CA3AF" : "#4F46E5"} 
              />
            </TouchableOpacity>
          </View>

          <View className="flex-row items-center justify-between mb-sm">
            <Text className="text-lg font-semibold text-text">Brain Health Heatmap</Text>
            <View className="flex-row space-x-sm">
              <TouchableOpacity
                onPress={() => setViewMode('heatmap')}
                className={`px-sm py-xs rounded ${viewMode === 'heatmap' ? 'bg-accent' : 'bg-surface'}`}
              >
                <Text className={`text-sm ${viewMode === 'heatmap' ? 'text-white' : 'text-muted'}`}>
                  Grid
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setViewMode('list')}
                className={`px-sm py-xs rounded ${viewMode === 'list' ? 'bg-accent' : 'bg-surface'}`}
              >
                <Text className={`text-sm ${viewMode === 'list' ? 'text-white' : 'text-muted'}`}>
                  List
                </Text>
              </TouchableOpacity>
            </View>
          </View>
          
          {/* Day labels */}
          <View className="flex-row justify-center mb-sm">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
              <View key={i} style={{ width: cellSize }} className="items-center">
                <Text className="text-sm text-muted font-medium">{day}</Text>
              </View>
            ))}
          </View>
          
          {/* Heatmap grid */}
          <View className="items-center">
            <Svg height={heatmapHeight + 20} width={heatmapWidth}>
              {heatmapWeeks.map((week, weekIndex) =>
                week.map((day, dayIndex) => {
                  const x = dayIndex * cellSize;
                  const y = weekIndex * cellSize;
                  const isCurrentMonth = new Date(day.date).getMonth() === currentMonth.getMonth();
                  
                  return (
                    <React.Fragment key={`${weekIndex}-${dayIndex}`}>
                      <Rect
                        x={x + 2}
                        y={y + 2}
                        width={cellSize - 4}
                        height={cellSize - 4}
                        rx={4}
                        fill={
                          !isCurrentMonth 
                            ? '#F3F4F6' 
                            : day.hasData 
                              ? getScoreColor(day.score) 
                              : '#E5E7EB'
                        }
                        opacity={day.isToday ? 1 : isCurrentMonth ? 0.9 : 0.3}
                        stroke={day.isToday ? '#4F46E5' : 'transparent'}
                        strokeWidth={day.isToday ? 2 : 0}
                        onPress={() => isCurrentMonth && day.hasData && openDayDetail(day.date)}
                      />
                      {isCurrentMonth && (
                        <SvgText
                          x={x + cellSize / 2}
                          y={y + cellSize / 2 + 4}
                          fontSize={10}
                          fill={day.hasData && day.score < 50 ? '#FFFFFF' : '#374151'}
                          textAnchor="middle"
                          fontWeight="500"
                        >
                          {day.dayOfMonth}
                        </SvgText>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </Svg>
          </View>

          {/* Legend */}
          <View className="items-center mt-md pt-md border-t border-gray-200">
            <View className="flex-row items-center justify-between w-full max-w-xs">
              <Text className="text-xs text-muted">Less healthy</Text>
              <View className="flex-row space-x-1">
                <View className="w-3 h-3 rounded" style={{ backgroundColor: getScoreColor(10) }} />
                <View className="w-3 h-3 rounded" style={{ backgroundColor: getScoreColor(30) }} />
                <View className="w-3 h-3 rounded" style={{ backgroundColor: getScoreColor(50) }} />
                <View className="w-3 h-3 rounded" style={{ backgroundColor: getScoreColor(70) }} />
                <View className="w-3 h-3 rounded" style={{ backgroundColor: getScoreColor(90) }} />
              </View>
              <Text className="text-xs text-muted">More healthy</Text>
            </View>
            <Text className="text-xs text-muted mt-xs">Tap a day to see details</Text>
          </View>
        </Card>

        {/* Quick Stats */}
        <Card className="mx-md mb-md">
          <Text className="text-lg font-semibold text-text mb-md">This Month</Text>
          <View className="flex-row justify-between">
            <View className="items-center flex-1">
              <Text className="text-2xl font-bold text-accent">
                {Math.round(historicalData
                  .filter(d => new Date(d.date).getMonth() === currentMonth.getMonth())
                  .reduce((sum, d) => sum + d.brainScore, 0) / 
                  Math.max(1, historicalData.filter(d => new Date(d.date).getMonth() === currentMonth.getMonth()).length)
                )}
              </Text>
              <Text className="text-sm text-muted">Avg Score</Text>
            </View>
            <View className="items-center flex-1">
              <Text className="text-2xl font-bold text-danger">
                {formatTime(historicalData
                  .filter(d => new Date(d.date).getMonth() === currentMonth.getMonth())
                  .reduce((sum, d) => sum + d.totalScreenTime, 0) / 
                  Math.max(1, historicalData.filter(d => new Date(d.date).getMonth() === currentMonth.getMonth()).length)
                )}
              </Text>
              <Text className="text-sm text-muted">Avg Daily</Text>
            </View>
            <View className="items-center flex-1">
              <Text className="text-2xl font-bold text-text">
                {historicalData.filter(d => 
                  new Date(d.date).getMonth() === currentMonth.getMonth() && 
                  d.brainScore >= 80
                ).length}
              </Text>
              <Text className="text-sm text-muted">Good Days</Text>
            </View>
          </View>
        </Card>
      </>
    );
  };

  const renderListView = () => (
    <Card className="mx-md mb-md">
      <View className="flex-col items-center justify-between mb-md">
        <View className='flex-row justify-between w-full'>
          <Text className="text-lg font-semibold text-text">Recent Days</Text>
        
          <View className="flex-row space-x-sm">
            <TouchableOpacity
              onPress={() => setViewMode('heatmap')}
              className={`px-sm py-xs rounded ${viewMode === 'heatmap' ? 'bg-accent' : 'bg-surface'}`}
            >
              <Text className={`text-sm ${viewMode === 'heatmap' ? 'text-white' : 'text-muted'}`}>
                Grid
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setViewMode('list')}
              className={`px-sm py-xs rounded ${viewMode === 'list' ? 'bg-accent' : 'bg-surface'}`}
            >
              <Text className={`text-sm ${viewMode === 'list' ? 'text-white' : 'text-muted'}`}>
                List
              </Text>
            </TouchableOpacity>
          </View>
        
        </View>
        <View className='flex-row justify-end w-full mt-sm'>
          <SecondaryButton className='' title="Export CSV" onPress={exportData} />
        </View>
      </View>
      
      {/* Rest of the list view content stays the same */}
      {historicalData.slice(0, 30).map((day) => (
        <TouchableOpacity
          key={day.date}
          className="flex-row items-center justify-between py-md border-b border-gray-100 last:border-b-0"
          onPress={() => openDayDetail(day.date)}
        >
          <View className="flex-1">
            <Text className="text-base font-medium text-text">
              {new Date(day.date).toLocaleDateString('en-US', { 
                weekday: 'short', 
                month: 'short', 
                day: 'numeric' 
              })}
            </Text>
            <View className="flex-row items-center mt-xs">
              <Text className="text-sm text-muted mr-md">
                {formatTime(day.totalScreenTime)}
              </Text>
              <View className="flex-row items-center">
                <View 
                  className="w-3 h-3 rounded-full mr-xs"
                  style={{ backgroundColor: getScoreColor(day.brainScore) }}
                />
                <Text className="text-sm text-muted">
                  {day.brainScore} • {getScoreLabel(day.brainScore)}
                </Text>
              </View>
            </View>
          </View>
          <View className="items-end mr-sm">
            <Text className="text-lg font-bold text-text">{day.brainScore}</Text>
            <Text className="text-xs text-muted">{day.apps.length} apps</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#6B7280" />
        </TouchableOpacity>
      ))}
    </Card>
  );

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-bg">
        <View className="flex-1 justify-center items-center">
          <Text className="text-base text-muted">Loading calendar...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <Header title="Calendar" />

        {viewMode === 'heatmap' ? renderHeatmapView() : renderListView()}
      </ScrollView>

      {/* Day Detail Modal */}
      <Modal
        visible={showModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowModal(false)}
      >
        <SafeAreaView className="flex-1 bg-bg">
          <View className="flex-row items-center justify-between p-md border-b border-gray-200">
            <View className="flex-1">
              <Text className="text-lg font-semibold text-text">
                {selectedDay && new Date(selectedDay.date).toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </Text>
              {selectedDay && (
                <Text className="text-sm text-muted mt-xs">
                  {getScoreLabel(selectedDay.brainScore)} Day
                </Text>
              )}
            </View>
            <TouchableOpacity 
              onPress={() => setShowModal(false)}
              className="p-sm"
            >
              <Ionicons name="close" size={24} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {selectedDay && (
            <ScrollView className="flex-1 p-md">
              {/* Daily Summary */}
              <Card className="mb-md">
                <Text className="text-lg font-semibold text-text mb-md">Daily Summary</Text>
                
                <View className="items-center mb-md">
                  <View 
                    className="w-20 h-20 rounded-full items-center justify-center mb-sm"
                    style={{ backgroundColor: `${getScoreColor(selectedDay.brainScore)}20` }}
                  >
                    <Text className="text-2xl font-bold" style={{ color: getScoreColor(selectedDay.brainScore) }}>
                      {Math.round(selectedDay.brainScore)}
                    </Text>
                  </View>
                  <Text className="text-base font-medium text-text">
                    {getScoreLabel(selectedDay.brainScore)} Brain Health
                  </Text>
                </View>

                <View className="space-y-sm">
                  <View className="flex-row justify-between items-center py-sm border-b border-gray-100">
                    <Text className="text-base text-muted">Total Screen Time</Text>
                    <Text className="text-base font-semibold text-text">
                      {formatTimeDetailed(selectedDay.totalScreenTime)}
                    </Text>
                  </View>
                  <View className="flex-row justify-between items-center py-sm border-b border-gray-100">
                    <Text className="text-base text-muted">Apps Used</Text>
                    <Text className="text-base font-semibold text-text">
                      {selectedDay.apps.length} apps
                    </Text>
                  </View>
                  <View className="flex-row justify-between items-center py-sm">
                    <Text className="text-base text-muted">Most Used</Text>
                    <Text className="text-base font-semibold text-text">
                      {selectedDay.apps[0]?.appName || 'None'}
                    </Text>
                  </View>
                </View>
              </Card>

              {/* App Usage Breakdown */}
              <Card>
                <Text className="text-lg font-semibold text-text mb-md">App Usage Breakdown</Text>
                {selectedDay.apps.length === 0 ? (
                  <View className="items-center py-lg">
                    <Text className="text-base text-muted">No app usage recorded</Text>
                  </View>
                ) : (
                  selectedDay.apps.map((app, index) => {
                    const percentage = (app.totalTimeMs / selectedDay.totalScreenTime) * 100;
                    return (
                      <View key={app.packageName} className="py-sm border-b border-gray-100 last:border-b-0">
                        <View className="flex-row items-center justify-between mb-xs">
                          <View className="flex-row items-center flex-1">
                            <View className="w-8 h-8 bg-accent/20 rounded-full items-center justify-center mr-sm">
                              <Text className="text-sm font-bold text-accent">{index + 1}</Text>
                            </View>
                            <Text className="text-base font-medium text-text flex-1">
                              {app.appName}
                            </Text>
                          </View>
                          <View className="items-end">
                            <Text className="text-base font-semibold text-text">
                              {formatTime(app.totalTimeMs)}
                            </Text>
                            <Text className="text-xs text-muted">
                              {percentage.toFixed(1)}%
                            </Text>
                          </View>
                        </View>
                        {/* Usage bar */}
                        <View className="h-1 bg-gray-200 rounded-full ml-10">
                          <View 
                            className="h-full bg-accent rounded-full"
                            style={{ width: `${percentage}%` }}
                          />
                        </View>
                      </View>
                    );
                  })
                )}
              </Card>
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}