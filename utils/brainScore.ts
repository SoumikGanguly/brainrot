export const DEFAULT_ALLOWED_TIME_MS = 8 * 60 * 60 * 1000; // 8 hours

/**
 * Calculate brain score based on total screen time
 * @param totalUsageMs Total usage time in milliseconds
 * @param allowedMs Maximum allowed time in milliseconds (defaults to 8 hours)
 * @returns Brain score from 0-100
 */
export const calculateBrainScore = (
  totalUsageMs: number, 
  allowedMs: number = DEFAULT_ALLOWED_TIME_MS
): number => {
  if (totalUsageMs < 0) return 100;
  if (allowedMs <= 0) return 0;
  
  const score = Math.max(0, Math.round(100 - (totalUsageMs / allowedMs) * 100));
  return score;
};

/**
 * Get brain score status text and color
 * @param score Brain score (0-100)
 * @returns Object with status text and color
 */
export const getBrainScoreStatus = (score: number) => {
  if (score >= 80) return { 
    text: "Your brain is healthy today!", 
    color: '#059669',
    level: 'healthy' as const
  };
  if (score >= 50) return { 
    text: "Your brain is getting foggy...", 
    color: '#F59E0B',
    level: 'warning' as const
  };
  if (score >= 25) return { 
    text: "Your brain needs attention!", 
    color: '#EF4444',
    level: 'attention' as const
  };
  return { 
    text: "Your brain is in critical condition!", 
    color: '#DC2626',
    level: 'critical' as const
  };
};

/**
 * Get score label for display
 * @param score Brain score (0-100)
 * @returns Human readable label
 */
export const getScoreLabel = (score: number): string => {
  if (score >= 90) return 'Excellent';
  if (score >= 80) return 'Good';
  if (score >= 70) return 'Okay';
  if (score >= 50) return 'Warning';
  if (score >= 30) return 'Poor';
  if (score >= 15) return 'Bad';
  return 'Critical';
};

/**
 * Get score color for visual indicators
 * @param score Brain score (0-100)
 * @returns Hex color string
 */
export const getScoreColor = (score: number): string => {
  if (score >= 90) return '#059669'; // Emerald-600 - Excellent
  if (score >= 80) return '#10B981'; // Emerald-500 - Good
  if (score >= 70) return '#34D399'; // Emerald-400 - Okay
  if (score >= 50) return '#FCD34D'; // Yellow-300 - Warning
  if (score >= 30) return '#F59E0B'; // Amber-500 - Poor
  if (score >= 15) return '#EF4444'; // Red-500 - Bad
  return '#DC2626'; // Red-600 - Critical
};