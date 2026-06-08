package com.soumikganguly.brainrot

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStats
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*

class UsageChecker(private val context: Context) {
    
    private val TAG = "UsageChecker"
    private val notificationManager = NotificationManagerCompat.from(context)
    private val usageStatsManager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    private val packageManager = context.packageManager
    
    // Track which notifications we've already sent today
    private val sentNotifications = mutableSetOf<String>()
    
    init {
        createNotificationChannels()
    }
    
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
                checkAppUsageThresholds(packageName, appUsage)
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
        
        val todayUsage = getTodayUsageForApp(packageName)
        checkAppUsageThresholds(packageName, todayUsage)
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
    
    private fun getTodayUsageForApp(packageName: String): Long {
        val todayUsage = getTodayUsageStats()
        return todayUsage[packageName] ?: 0L
    }
    
    private fun checkAppUsageThresholds(packageName: String, usageMs: Long) {
        val appName = getAppName(packageName)
        val usageMinutes = usageMs / (1000 * 60)
        
        val thresholds = listOf(
            Threshold(30, "mild", "Time for a quick break?"),
            Threshold(45, "normal", "Consider switching to something productive"),
            Threshold(60, "harsh", "Your brain needs a break from $appName"),
            Threshold(90, "critical", "🧠 BRAIN ROT ALERT: $appName overload!")
        )
        
        for (threshold in thresholds) {
            val notificationKey = "$packageName-${threshold.minutes}-${getCurrentDateString()}"
            
            if (usageMinutes >= threshold.minutes && !sentNotifications.contains(notificationKey)) {
                sendUsageNotification(appName, usageMinutes.toInt(), threshold)
                sentNotifications.add(notificationKey)
                Log.d(TAG, "Sent ${threshold.intensity} notification for $appName (${usageMinutes}min)")
                break // Only send one notification per check
            }
        }
    }
    
    private fun sendUsageNotification(appName: String, usageMinutes: Int, threshold: Threshold) {
        val channelId = when (threshold.intensity) {
            "critical" -> "brainrot_critical"
            "harsh" -> "brainrot_harsh"
            "normal" -> "brainrot_normal"
            else -> "brainrot_mild"
        }
        
        val title = when (threshold.intensity) {
            "critical" -> "🚨 BRAIN ROT ALERT"
            "harsh" -> "⚠️ Heavy Usage Warning"
            "normal" -> "📱 Usage Reminder"
            else -> "💡 Gentle Reminder"
        }
        
        val message = "${threshold.message}\n${formatUsageTime(usageMinutes)} on $appName today"
        
        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(when (threshold.intensity) {
                "critical" -> NotificationCompat.PRIORITY_MAX
                "harsh" -> NotificationCompat.PRIORITY_HIGH
                else -> NotificationCompat.PRIORITY_DEFAULT
            })
            .setAutoCancel(true)
            .setVibrate(if (threshold.intensity in listOf("harsh", "critical")) longArrayOf(0, 500, 200, 500) else null)
            .build()
            
        try {
            notificationManager.notify("${appName}_usage".hashCode(), notification)
        } catch (e: SecurityException) {
            Log.e(TAG, "Notification permission not granted", e)
        }
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
    
    private fun formatUsageTime(minutes: Int): String {
        return when {
            minutes < 60 -> "${minutes}min"
            else -> {
                val hours = minutes / 60
                val remainingMinutes = minutes % 60
                if (remainingMinutes == 0) "${hours}h" else "${hours}h ${remainingMinutes}min"
            }
        }
    }
    
    private fun getCurrentDateString(): String {
        val cal = Calendar.getInstance()
        return "${cal.get(Calendar.YEAR)}-${cal.get(Calendar.MONTH)}-${cal.get(Calendar.DAY_OF_MONTH)}"
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
                        longestSessionMs = maxOf(longestSessionMs, event.timeStamp - startTs)
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
    
    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channels = listOf(
                NotificationChannel("brainrot_mild", "Gentle Reminders", NotificationManager.IMPORTANCE_LOW),
                NotificationChannel("brainrot_normal", "Usage Reminders", NotificationManager.IMPORTANCE_DEFAULT),
                NotificationChannel("brainrot_harsh", "Strong Warnings", NotificationManager.IMPORTANCE_HIGH),
                NotificationChannel("brainrot_critical", "Critical Alerts", NotificationManager.IMPORTANCE_HIGH)
            )
            
            val notificationManager = context.getSystemService(NotificationManager::class.java)
            channels.forEach { channel ->
                channel.description = "Brain health notifications - ${channel.name}"
                if (channel.id == "brainrot_critical") {
                    channel.enableVibration(true)
                    channel.vibrationPattern = longArrayOf(0, 500, 200, 500)
                }
                notificationManager.createNotificationChannel(channel)
            }
        }
    }
    
    // Reset daily notifications (call at midnight)
    fun resetDailyNotifications() {
        sentNotifications.clear()
        Log.d(TAG, "Daily notifications reset")
    }
    
    data class Threshold(
        val minutes: Int,
        val intensity: String,
        val message: String
    )

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
