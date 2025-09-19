// utils/brainScoreRunner.ts
import { UsageService } from '@/services/UsageService'; // adjust path
import { calculateBrainScore } from './brainScore'; // adjust path

export type UsageEntry = {
  packageName: string;
  appName?: string;
  totalTimeMs: number;
  lastTimeUsed?: number;
};

type ComputeOpts = {
  // package name of your app to always exclude (optional)
  selfPackageName?: string;
  // debug logs
  debug?: boolean;
};

/**
 * Sum usage only for monitoredPackages and exclude selfPackageName.
 */
export function sumUsageForMonitored(
  usageArray: UsageEntry[] = [],
  monitoredPackages: string[] = [],
  selfPackageName: string | undefined = undefined
): { totalUsageMs: number; details: UsageEntry[] } {
  const monitoredSet = new Set(monitoredPackages || []);
  const filtered = (usageArray || []).filter(u => {
    if (!u || !u.packageName) return false;
    if (selfPackageName && u.packageName === selfPackageName) return false; // never include self
    return monitoredSet.has(u.packageName);
  });

  const totalUsageMs = filtered.reduce((sum, u) => sum + (u.totalTimeMs || 0), 0);
  return { totalUsageMs, details: filtered };
}

/**
 * Compute brain score for the currently monitored apps between startTimeMs and now.
 * - monitoredPackages: list of package names to include (from settings.monitoredApps.map(...))
 * - startTimeMs: epoch ms from which to calculate usage (e.g. start of day)
 *
 * Returns { totalUsageMs, score, details } where details is filtered usage array.
 */
export async function computeBrainScoreForMonitored(
  monitoredPackages: string[],
  startTimeMs: number,
  opts: ComputeOpts = {}
): Promise<{ totalUsageMs: number; score: number; details: UsageEntry[] }> {
  const { selfPackageName = 'com.soumikganguly.brainrot', debug = false } = opts;

  if (!Array.isArray(monitoredPackages) || monitoredPackages.length === 0) {
    if (debug) console.log('[brain] No monitored packages provided — returning perfect score');
    return { totalUsageMs: 0, score: 100, details: [] };
  }

  if (debug) console.log('[brain] Fetching usage since', new Date(startTimeMs).toISOString());

  // Fetch usage from native module
  let usageArray: UsageEntry[] = [];
  try {
    usageArray = await UsageService.getUsageSince(startTimeMs);
    if (debug) console.log('[brain] raw usageArray length', usageArray?.length);
  } catch (err) {
    console.error('[brain] Error fetching usage from UsageService:', err);
    // fallback to empty array so we return 100
    return { totalUsageMs: 0, score: 100, details: [] };
  }

  // Filter and sum only monitored apps, exclude self
  const { totalUsageMs, details } = sumUsageForMonitored(usageArray, monitoredPackages, selfPackageName);

  // Compute score using your calculateBrainScore util
  const score = calculateBrainScore(totalUsageMs);

  if (debug) {
    console.log('[brain] monitoredPackages', monitoredPackages.length);
    console.log('[brain] filtered apps count', details.length);
    console.log('[brain] totalUsageMs', totalUsageMs, 'score', score);
    console.log('[brain] details sample', details.slice(0, 10));
  }

  return { totalUsageMs, score, details };
}
