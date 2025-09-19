package com.soumikganguly.brainrot

import android.app.AppOpsManager
import android.app.usage.UsageStats
import android.app.usage.UsageStatsManager
import android.app.usage.UsageEvents
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import android.provider.Settings
import android.util.Log
import com.facebook.react.bridge.*
import java.util.*

class UsageStatsModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val TAG = "UsageStatsModule"

    init {
        Log.d(TAG, "UsageStatsModule initialized")
    }

    override fun getName(): String {
        Log.d(TAG, "getName() called - returning UsageStatsModule")
        return "UsageStatsModule"
    }

    @ReactMethod
    fun isUsageAccessGranted(promise: Promise) {
        Log.d(TAG, "isUsageAccessGranted() called")
        try {
            val hasAccess = checkUsageStatsPermission()
            Log.d(TAG, "Usage access granted: $hasAccess")
            promise.resolve(hasAccess)
        } catch (e: Exception) {
            Log.e(TAG, "Error checking usage access", e)
            promise.resolve(false)
        }
    }

    private fun checkUsageStatsPermission(): Boolean {
        try {
            // Method 1: Try AppOpsManager approach (more reliable)
            val appOpsManager = reactApplicationContext.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
            val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                appOpsManager.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), reactApplicationContext.packageName)
            } else {
                @Suppress("DEPRECATION")
                appOpsManager.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), reactApplicationContext.packageName)
            }
            
            Log.d(TAG, "AppOpsManager check result: $mode")
            
            if (mode == AppOpsManager.MODE_ALLOWED) {
                return true
            }

            // Method 2: Try UsageStatsManager approach as fallback
            Log.d(TAG, "AppOpsManager denied, trying UsageStatsManager approach")
            val usageStatsManager = reactApplicationContext.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val time = System.currentTimeMillis()
            
            // Try different time ranges to be more lenient
            val timeRanges = arrayOf(
                time - 1000 * 60,           // 1 minute ago
                time - 1000 * 60 * 60,      // 1 hour ago  
                time - 1000 * 60 * 60 * 24  // 1 day ago
            )
            
            for (startTime in timeRanges) {
                val stats = usageStatsManager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, startTime, time)
                Log.d(TAG, "UsageStats check with ${(time - startTime) / (1000 * 60)} min range: ${stats.size} apps")
                if (stats.isNotEmpty()) {
                    return true
                }
            }
            
            Log.d(TAG, "All permission checks failed")
            return false
            
        } catch (e: Exception) {
            Log.e(TAG, "Exception in permission check", e)
            return false
        }
    }

    @ReactMethod
    fun openUsageAccessSettings() {
        Log.d(TAG, "openUsageAccessSettings() called")
        try {
            val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
            reactApplicationContext.startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "Error opening usage settings", e)
        }
    }

    @ReactMethod
    fun getInstalledMonitoredApps(promise: Promise) {
    Log.d(TAG, "getInstalledMonitoredApps() called - using launcher query")
    try {
        val pm = reactApplicationContext.packageManager

        // Intent to discover launchable apps
        val mainIntent = Intent(Intent.ACTION_MAIN, null)
        mainIntent.addCategory(Intent.CATEGORY_LAUNCHER)

        val resolveInfos = pm.queryIntentActivities(mainIntent, 0)
        Log.d(TAG, "queryIntentActivities returned: ${resolveInfos.size}")

        val monitoredApps = setOf(
        "com.google.android.youtube",
        "com.instagram.android",
        "com.whatsapp",
        "com.facebook.katana",
        "com.ss.android.ugc.tiktok",
        "com.zhiliaoapp.musically",
        "com.twitter.android",
        "com.snapchat.android",
        "com.reddit.frontpage",
        "com.discord"
        )

        val result = WritableNativeArray()
        val seen = HashSet<String>()

        for (ri in resolveInfos) {
        val pkg = ri.activityInfo?.packageName ?: continue
        if (seen.contains(pkg)) continue
        seen.add(pkg)

        // Skip system-only apps if you want (optional)
        // val applicationInfo = pm.getApplicationInfo(pkg, 0)
        // if ((applicationInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0) continue

        val label = ri.loadLabel(pm)?.toString() ?: pkg
        val map = WritableNativeMap()
        map.putString("packageName", pkg)
        map.putString("appName", label)
        map.putBoolean("isRecommended", monitoredApps.contains(pkg))
        result.pushMap(map)
        }

        Log.d(TAG, "Returning ${result.size()} launchable apps")
        promise.resolve(result)
    } catch (e: Exception) {
        Log.e(TAG, "Error in getInstalledMonitoredApps", e)
        promise.reject("GET_APPS_ERROR", e.message)
    }
    }

    @ReactMethod
    fun getUsageSince(startTimeMs: Double, promise: Promise) {
        Log.d(TAG, "getUsageSince (events-based) called with startTime: $startTimeMs")
        try {
            if (!checkUsageStatsPermission()) {
                Log.d(TAG, "No usage permission, returning empty array")
                promise.resolve(WritableNativeArray())
                return
            }

            val usageStatsManager = reactApplicationContext.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val endTime = System.currentTimeMillis()
            val startTime = startTimeMs.toLong()

            // Query events
            val events = usageStatsManager.queryEvents(startTime, endTime)
            val event = UsageEvents.Event()
            val usageMap = HashMap<String, Long>()
            val sessionStartTimes = HashMap<String, Long>()

            while (events.hasNextEvent()) {
                events.getNextEvent(event)
                val pkg = event.packageName ?: continue
                
                // Skip our own app
                if (pkg == reactApplicationContext.packageName) continue

                when (event.eventType) {
                    UsageEvents.Event.MOVE_TO_FOREGROUND -> {
                        sessionStartTimes[pkg] = event.timeStamp
                    }
                    UsageEvents.Event.MOVE_TO_BACKGROUND -> {
                        val startTs = sessionStartTimes[pkg]
                        if (startTs != null && event.timeStamp > startTs) {
                            val sessionDuration = event.timeStamp - startTs
                            usageMap[pkg] = (usageMap[pkg] ?: 0L) + sessionDuration
                            sessionStartTimes.remove(pkg)
                        }
                    }
                }
            }

            // Close any open sessions at endTime
            sessionStartTimes.forEach { (pkg, startTs) ->
                if (endTime > startTs) {
                    val sessionDuration = endTime - startTs
                    usageMap[pkg] = (usageMap[pkg] ?: 0L) + sessionDuration
                }
            }

            // Convert to result array
            val pm = reactApplicationContext.packageManager
            val result = WritableNativeArray()
            
            usageMap.entries
                .filter { it.value > 0 } // Only include apps with actual usage
                .sortedByDescending { it.value } // Sort by usage time
                .forEach { (pkg, totalMs) ->
                    try {
                        val ai = pm.getApplicationInfo(pkg, 0)
                        val label = pm.getApplicationLabel(ai).toString()
                        
                        val map = WritableNativeMap()
                        map.putString("packageName", pkg)
                        map.putString("appName", label)
                        map.putDouble("totalTimeMs", totalMs.toDouble())
                        map.putDouble("lastTimeUsed", endTime.toDouble())
                        result.pushMap(map)
                    } catch (e: PackageManager.NameNotFoundException) {
                        // App was uninstalled, skip
                    }
                }

            Log.d(TAG, "Returning ${result.size()} apps with usage data")
            promise.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "Error in getUsageSince", e)
            promise.reject("GET_USAGE_ERROR", e.message)
        }
    }

    @ReactMethod
    fun startBackgroundMonitoring(intervalMinutes: Int) {
        Log.d(TAG, "startBackgroundMonitoring() called with interval: $intervalMinutes")
        BackgroundUsageWorker.startPeriodicWork(reactApplicationContext, intervalMinutes.toLong())
    }

    @ReactMethod  
    fun stopBackgroundMonitoring() {
        Log.d(TAG, "stopBackgroundMonitoring() called")
        BackgroundUsageWorker.stopPeriodicWork(reactApplicationContext)
    }

    @ReactMethod
    fun testModule(promise: Promise) {
        Log.d(TAG, "testModule() called - module is working!")
        promise.resolve("UsageStatsModule is working correctly!")
    }

    @ReactMethod
    fun forceRefreshPermission(promise: Promise) {
        Log.d(TAG, "forceRefreshPermission() called")
        try {
            // Wait a bit then check again
            Thread.sleep(1000)
            val hasAccess = checkUsageStatsPermission()
            Log.d(TAG, "Force refresh result: $hasAccess")
            promise.resolve(hasAccess)
        } catch (e: Exception) {
            Log.e(TAG, "Error in force refresh", e)
            promise.resolve(false)
        }
    }
}