export const DEFAULT_ALLOWED_TIME_MS = 8 * 60 * 60 * 1000; // 8 hours

export interface BrainScoreMetrics {
  totalDistractingMinutes: number;
  totalMonitoredOpens: number;
  longestSessionMinutes: number;
  bypassCount: number;
  successfulAvoidances: number;
}

export type BrainStateLevel = 'focused' | 'healthy' | 'foggy' | 'exhausted';

export function calculateBrainScore(
  input: number | BrainScoreMetrics,
  allowedMs: number = DEFAULT_ALLOWED_TIME_MS
): number {
  if (typeof input === 'number') {
    if (input < 0) return 100;
    if (allowedMs <= 0) return 0;

    const score = Math.max(0, Math.round(100 - (input / allowedMs) * 100));
    return score;
  }

  const score =
    100
    - Math.min(input.totalDistractingMinutes / 3, 35)
    - Math.min(input.totalMonitoredOpens * 0.8, 25)
    - Math.min(input.longestSessionMinutes / 2, 20)
    - input.bypassCount * 5
    + input.successfulAvoidances * 2;

  return Math.round(Math.max(0, Math.min(100, score)));
}

export function getBrainStateLevel(score: number): BrainStateLevel {
  if (score >= 90) return 'focused';
  if (score >= 70) return 'healthy';
  if (score >= 50) return 'foggy';
  return 'exhausted';
}

export function getBrainStateLabel(score: number): string {
  const level = getBrainStateLevel(score);
  if (level === 'focused') return 'Focused';
  if (level === 'healthy') return 'Healthy';
  if (level === 'foggy') return 'Foggy';
  return 'Exhausted';
}

export function getBrainScoreStatus(score: number): {
  text: string;
  color: string;
  level: BrainStateLevel;
} {
  const level = getBrainStateLevel(score);

  if (level === 'focused') {
    return {
      text: 'Locked in and focused.',
      color: '#0F766E',
      level,
    };
  }

  if (level === 'healthy') {
    return {
      text: 'Your brain is healthy today!',
      color: '#059669',
      level,
    };
  }

  if (level === 'foggy') {
    return {
      text: 'Your brain is getting foggy...',
      color: '#D97706',
      level,
    };
  }

  return {
    text: 'Your brain is exhausted. Step away for a bit.',
    color: '#DC2626',
    level,
  };
}

export function getScoreLabel(score: number): string {
  return getBrainStateLabel(score);
}

export function getScoreColor(score: number): string {
  const level = getBrainStateLevel(score);

  if (level === 'focused') return '#0F766E';
  if (level === 'healthy') return '#10B981';
  if (level === 'foggy') return '#F59E0B';
  return '#DC2626';
}
