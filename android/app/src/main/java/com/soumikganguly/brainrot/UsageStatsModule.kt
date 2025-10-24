package com.soumikganguly.brainrot

import androidx.core.content.ContextCompat

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.provider.Settings
import android.util.Log
import com.facebook.react.bridge.*
import java.util.*

class UsageStatsModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val TAG = "UsageStatsModule"
    private val usageChecker = UsageChecker(reactContext)
    private var realtimeHandler: Handler? = null
    private var realtimeRunnable: Runnable? = null
    private var lastForegroundApp: String? = null
    private var isRealtimeMonitoring = false
    private val permissionHelper = ManufacturerPermissionHelper(reactContext)

    init {
        Log.d(TAG, "UsageStatsModule initialized with enhanced UsageChecker")
    }

    override fun getName(): String = "UsageStatsModule"

    // MANUFACTURER PERMISSION METHODS
    @ReactMethod
    fun getManufacturerInfo(promise: Promise) {
        try {
            val info = permissionHelper.getPermissionInstructions()
            promise.resolve(info)
        } catch (e: Exception) {
            promise.reject("GET_MANUFACTURER_ERROR", e.message)
        }
    }
    
    @ReactMethod
    fun needsSpecialPermission(promise: Promise) {
        promise.resolve(permissionHelper.needsSpecialPermission())
    }


    
    @ReactMethod
    fun openManufacturerSettings(promise: Promise) {
        try {
            val success = permissionHelper.openManufacturerSettings()
            promise.resolve(success)
        } catch (e: Exception) {
            promise.reject("OPEN_SETTINGS_ERROR", e.message)
        }
    }
    
    @ReactMethod
    fun requestBatteryOptimizationExemption(promise: Promise) {
        try {
            val success = permissionHelper.requestIgnoreBatteryOptimization()
            promise.resolve(success)
        } catch (e: Exception) {
            promise.reject("BATTERY_OPT_ERROR", e.message)
        }
    }

    // USAGE ACCESS METHODS
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
    fun forceRefreshPermission(promise: Promise) {
        Log.d(TAG, "forceRefreshPermission() called")
        try {
            Thread.sleep(1000)
            val hasAccess = checkUsageStatsPermission()
            Log.d(TAG, "Force refresh result: $hasAccess")
            promise.resolve(hasAccess)
        } catch (e: Exception) {
            Log.e(TAG, "Error in force refresh", e)
            promise.resolve(false)
        }
    }

    // APP LISTING METHODS
    @ReactMethod
    fun getInstalledMonitoredApps(promise: Promise) {
        Log.d(TAG, "getInstalledMonitoredApps() called")
        try {
            val pm = reactApplicationContext.packageManager
            val mainIntent = Intent(Intent.ACTION_MAIN, null)
            mainIntent.addCategory(Intent.CATEGORY_LAUNCHER)

            val resolveInfos = pm.queryIntentActivities(mainIntent, 0)
            Log.d(TAG, "Found ${resolveInfos.size} launchable apps")

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

                val label = ri.loadLabel(pm)?.toString() ?: pkg
                val map = WritableNativeMap()
                map.putString("packageName", pkg)
                map.putString("appName", label)
                map.putBoolean("isRecommended", monitoredApps.contains(pkg))
                result.pushMap(map)
            }

            Log.d(TAG, "Returning ${result.size()} apps")
            promise.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "Error in getInstalledMonitoredApps", e)
            promise.reject("GET_APPS_ERROR", e.message)
        }
    }

    // USAGE DATA METHODS
    @ReactMethod
    fun getUsageSince(startTimeMs: Double, promise: Promise) {
        Log.d(TAG, "getUsageSince called with startTime: $startTimeMs")
        try {
            if (!checkUsageStatsPermission()) {
                Log.d(TAG, "No usage permission, returning empty array")
                promise.resolve(WritableNativeArray())
                return
            }

            val usageData = getUsageDataSince(startTimeMs.toLong())
            promise.resolve(usageData)
        } catch (e: Exception) {
            Log.e(TAG, "Error in getUsageSince", e)
            promise.reject("GET_USAGE_ERROR", e.message)
        }
    }

    // MONITORING METHODS
    @ReactMethod
    fun startBackgroundMonitoring(intervalMinutes: Int) {
        Log.d(TAG, "startBackgroundMonitoring() called with interval: $intervalMinutes")
        try {
            BackgroundUsageWorker.startPeriodicWork(reactApplicationContext, intervalMinutes.toLong())
            startRealtimeMonitoring()
        } catch (e: Exception) {
            Log.e(TAG, "Error starting background monitoring", e)
        }
    }

    @ReactMethod
    fun stopBackgroundMonitoring() {
        Log.d(TAG, "stopBackgroundMonitoring() called")
        try {
            BackgroundUsageWorker.stopPeriodicWork(reactApplicationContext)
            stopRealtimeMonitoring()
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping background monitoring", e)
        }
    }

    @ReactMethod
    fun startRealtimeAppDetection(promise: Promise) {
        Log.d(TAG, "startRealtimeAppDetection() called")
        try {
            if (!checkUsageStatsPermission()) {
                promise.reject("NO_PERMISSION", "Usage access permission required")
                return
            }
            
            startRealtimeMonitoring()
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Error starting realtime detection", e)
            promise.reject("START_REALTIME_ERROR", e.message)
        }
    }

    @ReactMethod
    fun stopRealtimeAppDetection(promise: Promise) {
        Log.d(TAG, "stopRealtimeAppDetection() called")
        try {
            stopRealtimeMonitoring()
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping realtime detection", e)
            promise.reject("STOP_REALTIME_ERROR", e.message)
        }
    }

    @ReactMethod
    fun triggerUsageCheck() {
        Log.d(TAG, "Manual usage check triggered")
        try {
            usageChecker.checkUsageAndNotify()
        } catch (e: Exception) {
            Log.e(TAG, "Error in manual usage check", e)
        }
    }

    @ReactMethod
    fun getCurrentForegroundApp(promise: Promise) {
        try {
            if (!checkUsageStatsPermission()) {
                promise.resolve(null)
                return
            }
            
            val usageStatsManager = reactApplicationContext.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val currentTime = System.currentTimeMillis()
            
            // Query events from last 3 seconds
            val events = usageStatsManager.queryEvents(currentTime - 3000, currentTime)
            
            var lastEventTime = 0L
            var foregroundApp: String? = null
            val event = UsageEvents.Event()
            
            // Find the most recent MOVE_TO_FOREGROUND event
            while (events.hasNextEvent()) {
                events.getNextEvent(event)
                if (event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND && 
                    event.timeStamp > lastEventTime) {
                    lastEventTime = event.timeStamp
                    foregroundApp = event.packageName
                }
            }
            
            if (foregroundApp != null) {
                val pm = reactApplicationContext.packageManager
                try {
                    val ai = pm.getApplicationInfo(foregroundApp, 0)
                    val appName = pm.getApplicationLabel(ai).toString()
                    
                    val result = WritableNativeMap()
                    result.putString("packageName", foregroundApp)
                    result.putString("appName", appName)
                    result.putDouble("timestamp", lastEventTime.toDouble())
                    
                    Log.d(TAG, "Current foreground app: $appName ($foregroundApp)")
                    promise.resolve(result)
                } catch (e: PackageManager.NameNotFoundException) {
                    promise.resolve(null)
                }
            } else {
                Log.d(TAG, "No foreground app detected")
                promise.resolve(null)
            }
            
        } catch (e: Exception) {
            Log.e(TAG, "Error getting current foreground app", e)
            promise.resolve(null)
        }
    }

    // OVERLAY PERMISSION METHODS - KEEP ONLY ONE SET
    @ReactMethod
    fun hasOverlayPermission(promise: Promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            promise.resolve(Settings.canDrawOverlays(reactApplicationContext))
        } else {
            promise.resolve(true)
        }
    }
    
    @ReactMethod
    fun requestOverlayPermission(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                if (!Settings.canDrawOverlays(reactApplicationContext)) {
                    val intent = Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:${reactApplicationContext.packageName}")
                    )
                    intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    reactApplicationContext.startActivity(intent)
                }
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("PERMISSION_ERROR", e.message)
        }
    }

    // BLOCKING OVERLAY METHODS
    @ReactMethod
    fun showBlockingOverlay(packageName: String, appName: String, blockMode: String, promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                if (!Settings.canDrawOverlays(reactApplicationContext)) {
                    promise.reject("NO_OVERLAY_PERMISSION", "Overlay permission required")
                    return
                }
            }
            
            val intent = Intent(reactApplicationContext, BlockingOverlayService::class.java)
            intent.putExtra("blocked_app", appName)
            intent.putExtra("block_mode", blockMode)
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactApplicationContext.startForegroundService(intent)
            } else {
                reactApplicationContext.startService(intent)
            }
            
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("OVERLAY_ERROR", e.message)
        }
    }

    // FLOATING SCORE METHODS
    @ReactMethod
    fun startFloatingScore(appName: String, initialScore: Int, timeMs: Double, promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                if (!Settings.canDrawOverlays(reactApplicationContext)) {
                    promise.reject("NO_OVERLAY_PERMISSION", "Overlay permission required")
                    return
                }
            }
            
            val intent = Intent(reactApplicationContext, FloatingScoreService::class.java)
            intent.putExtra("EXTRA_SCORE", initialScore)
            intent.putExtra("EXTRA_APP_NAME", appName)
            intent.putExtra("EXTRA_TIME_MS", timeMs.toLong())
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactApplicationContext.startForegroundService(intent)
            } else {
                reactApplicationContext.startService(intent)
            }
            
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Error starting floating score", e)
            promise.reject("START_FLOATING_ERROR", e.message)
        }
    }
    
    @ReactMethod
    fun updateFloatingScore(score: Int, appName: String, timeMs: Double) {
        try {
            val intent = Intent(reactApplicationContext, FloatingScoreService::class.java)
            intent.action = "ACTION_UPDATE_SCORE"
            intent.putExtra("EXTRA_SCORE", score)
            intent.putExtra("EXTRA_APP_NAME", appName)
            intent.putExtra("EXTRA_TIME_MS", timeMs.toLong())
            
            reactApplicationContext.startService(intent)
        } catch (e: Exception) {
            Log.e(TAG, "Error updating floating score", e)
        }
    }
    
    @ReactMethod
    fun stopFloatingScore(promise: Promise) {
        try {
            val intent = Intent(reactApplicationContext, FloatingScoreService::class.java)
            reactApplicationContext.stopService(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping floating score", e)
            promise.reject("STOP_FLOATING_ERROR", e.message)
        }
    }

    // TEST METHOD
    @ReactMethod
    fun testModule(promise: Promise) {
        Log.d(TAG, "testModule() called - enhanced module working!")
        promise.resolve("Enhanced UsageStatsModule is working correctly!")
    }

    // PRIVATE HELPER METHODS
    private fun startRealtimeMonitoring() {
        if (isRealtimeMonitoring) {
            Log.d(TAG, "Realtime monitoring already running")
            return
        }

        Log.d(TAG, "Starting realtime app monitoring")
        isRealtimeMonitoring = true
        realtimeHandler = Handler(Looper.getMainLooper())
        
        realtimeRunnable = object : Runnable {
            override fun run() {
                if (isRealtimeMonitoring) {
                    checkCurrentForegroundApp()
                    realtimeHandler?.postDelayed(this, 2000)
                }
            }
        }
        
        realtimeHandler?.post(realtimeRunnable!!)
        Log.d(TAG, "Realtime monitoring started")
    }

    private fun hasUsageStatsPermission(): Boolean {
        val appOps = reactApplicationContext.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                android.os.Process.myUid(),
                reactApplicationContext.packageName
            )
        } else {
            appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                android.os.Process.myUid(),
                reactApplicationContext.packageName
            )
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    private fun hasOverlayPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(reactApplicationContext)
        } else {
            true // Permission not needed before M
        }
    }

    private fun stopRealtimeMonitoring() {
        Log.d(TAG, "Stopping realtime monitoring")
        isRealtimeMonitoring = false
        realtimeRunnable?.let { realtimeHandler?.removeCallbacks(it) }
        realtimeHandler = null
        realtimeRunnable = null
    }

    private fun checkCurrentForegroundApp() {
        try {
            val usageStatsManager = reactApplicationContext.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val currentTime = System.currentTimeMillis()
            val events = usageStatsManager.queryEvents(currentTime - 10000, currentTime)

            var lastEventTime = 0L
            var foregroundApp: String? = null
            val event = UsageEvents.Event()

            while (events.hasNextEvent()) {
                events.getNextEvent(event)
                if (event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND && event.timeStamp > lastEventTime) {
                    lastEventTime = event.timeStamp
                    foregroundApp = event.packageName
                }
            }

            if (foregroundApp != null && 
                foregroundApp != lastForegroundApp && 
                foregroundApp != reactApplicationContext.packageName &&
                isMonitoredApp(foregroundApp)) {
                
                Log.d(TAG, "Detected monitored app in foreground: $foregroundApp")
                lastForegroundApp = foregroundApp
                usageChecker.checkRealtimeAppUsage(foregroundApp)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error checking foreground app", e)
        }
    }

    private fun isMonitoredApp(packageName: String): Boolean {
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
        return monitoredApps.contains(packageName)
    }

    private fun getUsageDataSince(startTimeMs: Long): WritableNativeArray {
        val usageStatsManager = reactApplicationContext.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val endTime = System.currentTimeMillis()

        val events = usageStatsManager.queryEvents(startTimeMs, endTime)
        val event = UsageEvents.Event()
        val usageMap = HashMap<String, Long>()
        val sessionStartTimes = HashMap<String, Long>()

        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            val pkg = event.packageName ?: continue
            
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

        sessionStartTimes.forEach { (pkg, startTs) ->
            if (endTime > startTs) {
                val sessionDuration = endTime - startTs
                usageMap[pkg] = (usageMap[pkg] ?: 0L) + sessionDuration
            }
        }

        val pm = reactApplicationContext.packageManager
        val result = WritableNativeArray()
        
        usageMap.entries
            .filter { it.value > 0 }
            .sortedByDescending { it.value }
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
                    // Skip uninstalled apps
                }
            }

        return result
    }

    private fun checkUsageStatsPermission(): Boolean {
        return try {
            val appOpsManager = reactApplicationContext.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
            val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                appOpsManager.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), reactApplicationContext.packageName)
            } else {
                @Suppress("DEPRECATION")
                appOpsManager.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), reactApplicationContext.packageName)
            }
            
            Log.d(TAG, "Permission check result: $mode")
            mode == AppOpsManager.MODE_ALLOWED
        } catch (e: Exception) {
            Log.e(TAG, "Exception in permission check", e)
            false
        }
    }
}