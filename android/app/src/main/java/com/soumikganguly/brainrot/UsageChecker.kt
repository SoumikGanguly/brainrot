package com.soumikganguly.brainrot

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import org.json.JSONArray
import java.text.SimpleDateFormat
import java.util.*

class UsageChecker(private val context: Context) {
    
    private val TAG = "UsageChecker"
    private val usageStatsManager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    private val packageManager = context.packageManager
    
    fun checkUsageAndNotify() {
        Log.d(TAG, "Starting background usage check")
        
        try {
            // Get monitored apps from shared preferences or database equivalent
            val monitoredApps = getMonitoredApps()
            updateBrainState(monitoredApps, null)
            if (monitoredApps.isEmpty()) {
                Log.d(TAG, "No monitored apps configured")
                return
            }
            
            val todayUsage = getTodayUsageStats()
            Log.d(TAG, "Checking usage for ${monitoredApps.size} monitored apps")
            
            for (packageName in monitoredApps) {
                val appUsage = todayUsage[packageName] ?: 0L
                Log.d(TAG, "Usage for $packageName: ${appUsage / (1000 * 60)} min today")
            }
            
        } catch (e: Exception) {
            Log.e(TAG, "Error in background usage check", e)
        }
    }

    fun getCurrentBrainState(forceRefresh: Boolean = false): BrainState {
        getSyncedDailySummaryState()?.let { syncedState ->
            return syncedState
        }

        val prefs = context.getSharedPreferences("brainrot_prefs", Context.MODE_PRIVATE)
        if (!forceRefresh) {
            val cachedScore = prefs.getInt("brain_score_value", -1)
            val cachedStatus = prefs.getString("brain_score_status", null)
            val cachedTotalUsageMs = prefs.getLong("brain_score_total_usage_ms", 0L)
            if (cachedScore >= 0 && !cachedStatus.isNullOrBlank()) {
                return BrainState(cachedScore, cachedStatus, cachedTotalUsageMs)
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
        
    }

    private fun getTodayUsageStats(): Map<String, Long> {
        val cal = Calendar.getInstance()
        cal.set(Calendar.HOUR_OF_DAY, 0)
        cal.set(Calendar.MINUTE, 0)
        cal.set(Calendar.SECOND, 0)
        cal.set(Calendar.MILLISECOND, 0)
        val startTime = cal.timeInMillis
        val endTime = System.currentTimeMillis()

        return getUsageStatsFromEvents(startTime, endTime)
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
    
    private fun getAppName(packageName: String): String {
        return try {
            val appInfo = packageManager.getApplicationInfo(packageName, 0)
            packageManager.getApplicationLabel(appInfo).toString()
        } catch (e: PackageManager.NameNotFoundException) {
            packageName.split('.').lastOrNull()?.capitalize() ?: packageName
        }
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
            bypassCount = metrics.bypassCount,
            successfulAvoidances = metrics.successfulAvoidances
        )
        val status = getBrainStatus(score)

        context.getSharedPreferences("brainrot_prefs", Context.MODE_PRIVATE)
            .edit()
            .putInt("brain_score_value", score)
            .putString("brain_score_status", status)
            .putLong("brain_score_total_usage_ms", totalUsageMs)
            .putLong("brain_score_updated_at", System.currentTimeMillis())
            .apply()
        BrainScoreWidgetUpdater.updateAll(context)

        return BrainState(score, status, totalUsageMs)
    }

    private fun getSyncedDailySummaryState(): BrainState? {
        val prefs = context.getSharedPreferences("brainrot_prefs", Context.MODE_PRIVATE)
        val summaryDate = prefs.getString("daily_summary_date", null) ?: return null
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        if (summaryDate != today) {
            return null
        }

        val score = prefs.getInt("daily_summary_brain_score", -1)
        val status = prefs.getString("daily_summary_brain_status", null)
        val totalUsageMs = prefs.getLong("daily_summary_total_screen_time_ms", -1L)

        if (score < 0 || status.isNullOrBlank() || totalUsageMs < 0L) {
            return null
        }

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
        var activePackage: String? = null

        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            val packageName = event.packageName ?: continue

            when (event.eventType) {
                UsageEvents.Event.MOVE_TO_FOREGROUND -> {
                    if (activePackage != null && activePackage != packageName && monitoredSet.contains(activePackage)) {
                        val previousStartTs = sessionStartTimes.remove(activePackage)
                        if (previousStartTs != null && event.timeStamp > previousStartTs) {
                            longestSessionMs = maxOf(longestSessionMs, event.timeStamp - previousStartTs)
                        }
                    }
                    if (monitoredSet.contains(packageName)) {
                        totalMonitoredOpens += 1
                        sessionStartTimes[packageName] = event.timeStamp
                    }
                    activePackage = packageName
                }
                UsageEvents.Event.MOVE_TO_BACKGROUND -> {
                    if (!monitoredSet.contains(packageName)) {
                        if (activePackage == packageName) {
                            activePackage = null
                        }
                        continue
                    }
                    val startTs = sessionStartTimes.remove(packageName) ?: continue
                    if (event.timeStamp > startTs) {
                        longestSessionMs = maxOf(longestSessionMs, event.timeStamp - startTs)
                    }
                    if (activePackage == packageName) {
                        activePackage = null
                    }
                }
            }
        }

        sessionStartTimes.values.forEach { startTs ->
            if (currentTime > startTs) {
                longestSessionMs = maxOf(longestSessionMs, currentTime - startTs)
            }
        }

        val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        val prefs = context.getSharedPreferences("brainrot_prefs", Context.MODE_PRIVATE)
        val bypassCount = monitoredApps.sumOf { packageName ->
            prefs.getInt("bypass_count_${packageName}_$today", 0)
        }
        val successfulAvoidances = prefs.getInt("block_event_count_abandoned_$today", 0)

        return BrainMetrics(
            totalMonitoredOpens = totalMonitoredOpens,
            longestSessionMinutes = longestSessionMs / 60000.0,
            bypassCount = bypassCount,
            successfulAvoidances = successfulAvoidances
        )
    }

    private fun getUsageStatsFromEvents(startTime: Long, endTime: Long): Map<String, Long> {
        val events = usageStatsManager.queryEvents(startTime, endTime)
        val event = UsageEvents.Event()
        val usageMap = mutableMapOf<String, Long>()
        val sessionStartTimes = HashMap<String, Long>()
        var activePackage: String? = null

        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            val packageName = event.packageName ?: continue
            if (packageName == context.packageName) {
                continue
            }

            when (event.eventType) {
                UsageEvents.Event.MOVE_TO_FOREGROUND -> {
                    if (activePackage != null && activePackage != packageName) {
                        val previousStartTs = sessionStartTimes.remove(activePackage)
                        if (previousStartTs != null && event.timeStamp > previousStartTs) {
                            usageMap[activePackage!!] = (usageMap[activePackage!!] ?: 0L) + (event.timeStamp - previousStartTs)
                        }
                    }
                    sessionStartTimes[packageName] = event.timeStamp
                    activePackage = packageName
                }
                UsageEvents.Event.MOVE_TO_BACKGROUND -> {
                    val startTs = sessionStartTimes.remove(packageName) ?: continue
                    if (event.timeStamp > startTs) {
                        usageMap[packageName] = (usageMap[packageName] ?: 0L) + (event.timeStamp - startTs)
                    }
                    if (activePackage == packageName) {
                        activePackage = null
                    }
                }
            }
        }

        sessionStartTimes.forEach { (packageName, startTs) ->
            if (endTime > startTs) {
                usageMap[packageName] = (usageMap[packageName] ?: 0L) + (endTime - startTs)
            }
        }

        return usageMap
    }

    private fun calculateBrainScore(
        totalDistractingMinutes: Double,
        totalMonitoredOpens: Int,
        longestSessionMinutes: Double,
        bypassCount: Int,
        successfulAvoidances: Int
    ): Int {
        val score =
            100.0 -
                minOf(totalDistractingMinutes / 3.0, 35.0) -
                minOf(totalMonitoredOpens * 0.8, 25.0) -
                minOf(longestSessionMinutes / 2.0, 20.0) -
                (bypassCount * 5.0) +
                (successfulAvoidances * 2.0)

        return score.toInt().coerceIn(0, 100)
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
        val bypassCount: Int,
        val successfulAvoidances: Int
    )
}
