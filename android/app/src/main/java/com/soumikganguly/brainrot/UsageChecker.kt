package com.soumikganguly.brainrot

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.util.Log
import org.json.JSONArray
import java.text.SimpleDateFormat
import java.util.*
import kotlin.math.roundToInt
import kotlin.math.sqrt

class UsageChecker(private val context: Context) {
    
    private val TAG = "UsageChecker"
    private val usageStatsManager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    
    fun checkUsageAndNotify() {
        Log.d(TAG, "Starting background usage brain-state refresh")
        
        try {
            val monitoredApps = getMonitoredApps()
            updateBrainState(monitoredApps, null)
            if (monitoredApps.isEmpty()) {
                Log.d(TAG, "No monitored apps configured")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error in background usage check", e)
        }
    }

    fun getCurrentBrainState(forceRefresh: Boolean = false): BrainState {
        val prefs = context.getSharedPreferences("brainrot_prefs", Context.MODE_PRIVATE)
        if (!forceRefresh) {
            val cachedScore = prefs.getInt("brain_score_value", -1)
            val cachedStatus = prefs.getString("brain_score_status", null)
            if (cachedScore >= 0 && !cachedStatus.isNullOrBlank()) {
                return BrainState(cachedScore, cachedStatus)
            }
        }

        val monitoredApps = getMonitoredApps()
        val todayUsage = getTodayUsageStats()
        return updateBrainState(monitoredApps, todayUsage)
    }
    
    fun checkRealtimeAppUsage(packageName: String) {
        Log.d(TAG, "Real-time check for app: $packageName")
        
        if (!getMonitoredApps().contains(packageName)) {
            return
        }

        getCurrentBrainState(forceRefresh = true)
    }
    
    private fun getTodayUsageStats(): Map<String, Long> {
        val cal = Calendar.getInstance()
        cal.set(Calendar.HOUR_OF_DAY, 0)
        cal.set(Calendar.MINUTE, 0)
        cal.set(Calendar.SECOND, 0)
        cal.set(Calendar.MILLISECOND, 0)
        val startTime = cal.timeInMillis
        val endTime = System.currentTimeMillis()
        
        val stats = usageStatsManager.queryUsageStats(
            UsageStatsManager.INTERVAL_DAILY,
            startTime,
            endTime
        )
        
        val usageMap = mutableMapOf<String, Long>()
        stats?.forEach { stat ->
            usageMap[stat.packageName] = stat.totalTimeInForeground
        }
        
        return usageMap
    }
    
    private fun getMonitoredApps(): List<String> {
        try {
            // Read monitored apps from SharedPreferences (synced from React Native)
            val prefs = context.getSharedPreferences("brainrot_prefs", Context.MODE_PRIVATE)
            val monitoredAppsJson = prefs.getString("monitored_apps", null)
            
            if (monitoredAppsJson != null && monitoredAppsJson.isNotEmpty()) {
                val jsonArray = JSONArray(monitoredAppsJson)
                val apps = mutableListOf<String>()
                for (i in 0 until jsonArray.length()) {
                    apps.add(jsonArray.getString(i))
                }
                if (apps.isNotEmpty()) {
                    Log.d(TAG, "Loaded ${apps.size} monitored apps from SharedPreferences")
                    return apps
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error reading monitored apps from SharedPreferences", e)
        }
        
        // Fallback to default monitored apps if nothing configured
        Log.d(TAG, "Using default monitored apps list")
        return listOf(
            "com.google.android.youtube",
            "com.instagram.android",
            "com.zhiliaoapp.musically",  // TikTok international
            "com.ss.android.ugc.tiktok", // TikTok/Douyin Chinese
            "com.whatsapp",
            "com.facebook.katana",
            "com.twitter.android",
            "com.snapchat.android",
            "com.reddit.frontpage",
            "com.discord"
        )
    }
    
    private fun updateBrainState(
        monitoredApps: List<String>,
        todayUsage: Map<String, Long>?
    ): BrainState {
        val usageMap = todayUsage ?: getTodayUsageStats()
        val totalUsageMs = monitoredApps.sumOf { usageMap[it] ?: 0L }
        val metrics = getTodayBrainMetrics(monitoredApps)
        val score = calculateBrainScore(
            totalDistractingMinutes = totalUsageMs / 60000.0,
            totalMonitoredOpens = metrics.totalMonitoredOpens,
            longestSessionMinutes = metrics.longestSessionMinutes,
            lateNightMinutes = metrics.lateNightMinutes,
            beforeLunchMinutes = metrics.beforeLunchMinutes,
            limitDismissals = metrics.limitDismissals,
            bypassCount = metrics.bypassCount,
            successfulAvoidances = metrics.successfulAvoidances
        )
        val status = getBrainStatus(score)

        context.getSharedPreferences("brainrot_prefs", Context.MODE_PRIVATE)
            .edit()
            .putInt("brain_score_value", score)
            .putString("brain_score_status", status)
            .putLong("brain_score_updated_at", System.currentTimeMillis())
            .apply()
        BrainScoreWidgetUpdater.updateAll(context)

        return BrainState(score, status, totalUsageMs)
    }

    private fun getTodayBrainMetrics(monitoredApps: List<String>): BrainMetrics {
        val monitoredSet = monitoredApps.toSet()
        val currentTime = System.currentTimeMillis()
        val startOfDay = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis

        val events = usageStatsManager.queryEvents(startOfDay, currentTime)
        val event = UsageEvents.Event()
        val sessionStartTimes = HashMap<String, Long>()
        var totalMonitoredOpens = 0
        var longestSessionMs = 0L
        var lateNightMs = 0L
        var beforeLunchMs = 0L

        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            val packageName = event.packageName ?: continue
            if (!monitoredSet.contains(packageName)) {
                continue
            }

            when (event.eventType) {
                UsageEvents.Event.MOVE_TO_FOREGROUND -> {
                    totalMonitoredOpens += 1
                    sessionStartTimes[packageName] = event.timeStamp
                }
                UsageEvents.Event.MOVE_TO_BACKGROUND -> {
                    val startTs = sessionStartTimes.remove(packageName) ?: continue
                    if (event.timeStamp > startTs) {
                        val durationMs = event.timeStamp - startTs
                        longestSessionMs = maxOf(longestSessionMs, durationMs)
                        lateNightMs += overlapWithWindow(startTs, event.timeStamp, 22, 24)
                        lateNightMs += overlapWithWindow(startTs, event.timeStamp, 0, 6)
                        beforeLunchMs += overlapWithWindow(startTs, event.timeStamp, 0, 12)
                    }
                }
            }
        }

        sessionStartTimes.values.forEach { startTs ->
            if (currentTime > startTs) {
                val durationMs = currentTime - startTs
                longestSessionMs = maxOf(longestSessionMs, durationMs)
                lateNightMs += overlapWithWindow(startTs, currentTime, 22, 24)
                lateNightMs += overlapWithWindow(startTs, currentTime, 0, 6)
                beforeLunchMs += overlapWithWindow(startTs, currentTime, 0, 12)
            }
        }

        val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        val prefs = context.getSharedPreferences("brainrot_prefs", Context.MODE_PRIVATE)
        val bypassCount = monitoredApps.sumOf { packageName ->
            prefs.getInt("bypass_count_${packageName}_$today", 0)
        }
        val successfulAvoidances = prefs.getInt("block_event_count_abandoned_$today", 0)
        val limitDismissals = prefs.getInt("block_event_count_cooldown_started_$today", 0)

        return BrainMetrics(
            totalMonitoredOpens = totalMonitoredOpens,
            longestSessionMinutes = longestSessionMs / 60000.0,
            lateNightMinutes = lateNightMs / 60000.0,
            beforeLunchMinutes = beforeLunchMs / 60000.0,
            limitDismissals = limitDismissals,
            bypassCount = bypassCount,
            successfulAvoidances = successfulAvoidances
        )
    }

    private fun calculateBrainScore(
        totalDistractingMinutes: Double,
        totalMonitoredOpens: Int,
        longestSessionMinutes: Double,
        lateNightMinutes: Double,
        beforeLunchMinutes: Double,
        limitDismissals: Int,
        bypassCount: Int,
        successfulAvoidances: Int
    ): Int {
        val score =
            100.0 -
                clampPenalty(getProgressiveTimePenalty(totalDistractingMinutes), 100.0) -
                clampPenalty(sqrt(totalMonitoredOpens / 30.0) * 12.0, 12.0) -
                clampPenalty(sqrt(longestSessionMinutes / 60.0) * 8.0, 8.0) -
                clampPenalty(sqrt(lateNightMinutes / 50.0) * 8.0, 8.0) -
                clampPenalty(sqrt(beforeLunchMinutes / 45.0) * 4.0, 4.0) -
                clampPenalty(limitDismissals * 2.25, 6.0) -
                clampPenalty(bypassCount * 4.0, 8.0) +
                clampBonus(successfulAvoidances * 1.2, 4.0)

        return score.roundToInt().coerceIn(0, 100)
    }

    private fun clampPenalty(value: Double, max: Double): Double = value.coerceIn(0.0, max)

    private fun clampBonus(value: Double, max: Double): Double = value.coerceIn(0.0, max)

    private fun getProgressiveTimePenalty(totalDistractingMinutes: Double): Double {
        val minutes = totalDistractingMinutes.coerceAtLeast(0.0)
        return when {
            minutes <= 60.0 -> (minutes / 60.0) * 10.0
            minutes <= 120.0 -> 10.0 + ((minutes - 60.0) / 60.0) * 15.0
            minutes <= 180.0 -> 25.0 + ((minutes - 120.0) / 60.0) * 20.0
            minutes <= 240.0 -> 45.0 + ((minutes - 180.0) / 60.0) * 20.0
            minutes <= 360.0 -> 65.0 + ((minutes - 240.0) / 120.0) * 22.0
            else -> 87.0 + minOf(13.0, ((minutes - 360.0) / 120.0) * 13.0)
        }
    }

    private fun overlapWithWindow(startMs: Long, endMs: Long, startHour: Int, endHour: Int): Long {
        if (endMs <= startMs) {
            return 0L
        }

        val calendar = Calendar.getInstance()
        calendar.timeInMillis = startMs
        calendar.set(Calendar.HOUR_OF_DAY, startHour)
        calendar.set(Calendar.MINUTE, 0)
        calendar.set(Calendar.SECOND, 0)
        calendar.set(Calendar.MILLISECOND, 0)
        val windowStart = calendar.timeInMillis
        calendar.set(Calendar.HOUR_OF_DAY, endHour)
        val windowEnd = calendar.timeInMillis
        val overlapStart = maxOf(startMs, windowStart)
        val overlapEnd = minOf(endMs, windowEnd)
        return (overlapEnd - overlapStart).coerceAtLeast(0L)
    }

    private fun getBrainStatus(score: Int): String {
        return when {
            score >= 90 -> "Focused"
            score >= 70 -> "Healthy"
            score >= 50 -> "Foggy"
            else -> "Exhausted"
        }
    }
    data class BrainState(
        val score: Int,
        val status: String,
        val totalUsageMs: Long = 0L
    )

    data class BrainMetrics(
        val totalMonitoredOpens: Int,
        val longestSessionMinutes: Double,
        val lateNightMinutes: Double,
        val beforeLunchMinutes: Double,
        val limitDismissals: Int,
        val bypassCount: Int,
        val successfulAvoidances: Int
    )
}
