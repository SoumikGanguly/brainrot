export const DEFAULT_ALLOWED_TIME_MS = 8 * 60 * 60 * 1000; // 8 hours

export interface BrainScoreMetrics {
  totalDistractingMinutes: number;
  totalMonitoredOpens: number;
  longestSessionMinutes: number;
  lateNightMinutes?: number;
  beforeLunchMinutes?: number;
  limitDismissals?: number;
  bypassCount?: number;
  successfulAvoidances?: number;
  improvementVsYesterdayMinutes?: number;
  improvementVs7DayBaselineMinutes?: number;
}

export type BrainStateLevel = 'focused' | 'healthy' | 'foggy' | 'exhausted';

export function calculateBrainScore(
  input: number | BrainScoreMetrics,
  allowedMs: number = DEFAULT_ALLOWED_TIME_MS
): number {
  if (typeof input === 'number') {
    if (input < 0) return 100;
    if (allowedMs <= 0) return 0;

    const totalMinutes = input / 60000;
    const score = Math.max(0, Math.round(100 - getProgressiveTimePenalty(totalMinutes)));
    return score;
  }

  const lateNightMinutes = Math.max(0, input.lateNightMinutes || 0);
  const beforeLunchMinutes = Math.max(0, input.beforeLunchMinutes || 0);
  const limitDismissals = Math.max(0, input.limitDismissals || 0);
  const bypassCount = Math.max(0, input.bypassCount || 0);
  const successfulAvoidances = Math.max(0, input.successfulAvoidances || 0);
  const improvementVsYesterdayMinutes = input.improvementVsYesterdayMinutes || 0;
  const improvementVs7DayBaselineMinutes = input.improvementVs7DayBaselineMinutes || 0;

  const timePenalty = clampPenalty(getProgressiveTimePenalty(input.totalDistractingMinutes), 100);
  const opensPenalty = clampPenalty(Math.sqrt(input.totalMonitoredOpens / 30) * 12, 12);
  const longestPenalty = clampPenalty(Math.sqrt(input.longestSessionMinutes / 60) * 8, 8);
  const lateNightPenalty = clampPenalty(Math.sqrt(lateNightMinutes / 50) * 8, 8);
  const beforeLunchPenalty = clampPenalty(Math.sqrt(beforeLunchMinutes / 45) * 4, 4);
  const dismissalPenalty = clampPenalty(limitDismissals * 2.25, 6);
  const bypassPenalty = clampPenalty(bypassCount * 4, 8);
  const avoidanceBonus = clampBonus(successfulAvoidances * 1.2, 4);
  const yesterdayBonus = clampBonus(
    (improvementVsYesterdayMinutes / 15) * 2.2,
    5,
  );
  const weeklyBonus = clampBonus(
    (improvementVs7DayBaselineMinutes / 20) * 2.4,
    5,
  );

  const score =
    100 -
    timePenalty -
    opensPenalty -
    longestPenalty -
    lateNightPenalty -
    beforeLunchPenalty -
    dismissalPenalty -
    bypassPenalty +
    avoidanceBonus +
    yesterdayBonus +
    weeklyBonus;

  return Math.round(Math.max(0, Math.min(100, score)));
}

function clampPenalty(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

function getProgressiveTimePenalty(totalDistractingMinutes: number): number {
  const minutes = Math.max(0, totalDistractingMinutes);

  if (minutes <= 60) {
    return (minutes / 60) * 10;
  }

  if (minutes <= 120) {
    return 10 + ((minutes - 60) / 60) * 15;
  }

  if (minutes <= 180) {
    return 25 + ((minutes - 120) / 60) * 20;
  }

  if (minutes <= 240) {
    return 45 + ((minutes - 180) / 60) * 20;
  }

  if (minutes <= 360) {
    return 65 + ((minutes - 240) / 120) * 22;
  }

  return 87 + Math.min(13, ((minutes - 360) / 120) * 13);
}

function clampBonus(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
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
