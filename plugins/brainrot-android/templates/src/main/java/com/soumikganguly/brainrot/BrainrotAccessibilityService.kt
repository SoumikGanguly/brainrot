package com.soumikganguly.brainrot

import android.accessibilityservice.AccessibilityService
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import org.json.JSONArray
import org.json.JSONObject

class BrainrotAccessibilityService : AccessibilityService() {
    private val tag = "BrainrotAccessibility"
    private var lastHandledPackage: String? = null
    private var lastHandledAt = 0L
    private val handler = Handler(Looper.getMainLooper())
    private var softLoopRunnable: Runnable? = null
    private var softLoopPackage: String? = null

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val packageName = event?.packageName?.toString() ?: return
        reconcileTemporaryPasses(packageName)
        if (packageName.isBlank() || packageName == applicationContext.packageName || packageName == "com.android.systemui") {
            if (softLoopPackage != null && packageName != softLoopPackage) {
                stopSoftLoop()
            }
            return
        }

        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
            event.eventType != AccessibilityEvent.TYPE_WINDOWS_CHANGED) {
            return
        }

        val config = loadConfig() ?: run {
            stopSoftLoop()
            return
        }

        if (!config.blockingEnabled) {
            stopSoftLoop()
            return
        }

        val isBlocked = config.blockedApps.any { it == packageName }
        if (!isBlocked || isTemporarilyAllowed(packageName, config.blockingMode)) {
            if (softLoopPackage == packageName) {
                stopSoftLoop()
            }
            return
        }

        val effectiveMode = if (config.scheduleEnabled &&
            isInSchedule(config.scheduleStart, config.scheduleEnd)) {
            "hard"
        } else {
            config.blockingMode
        }

        val now = System.currentTimeMillis()
        if (packageName == lastHandledPackage && now - lastHandledAt < 1200) {
            return
        }
        lastHandledPackage = packageName
        lastHandledAt = now

        Log.d(tag, "Blocking $packageName in $effectiveMode mode")

        if (effectiveMode == "hard") {
            stopSoftLoop()
            performGlobalAction(GLOBAL_ACTION_HOME)
            showOverlay(packageName, effectiveMode)
            return
        }

        showOverlay(packageName, effectiveMode)
        startSoftLoop(packageName, config.softBlockIntervalMinutes)
    }

    override fun onInterrupt() {
        Log.d(tag, "Accessibility interrupted")
        stopSoftLoop()
    }

    override fun onDestroy() {
        super.onDestroy()
        stopSoftLoop()
    }

    private fun showOverlay(packageName: String, mode: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            return
        }

        val intent = Intent(this, BlockingOverlayService::class.java).apply {
            putExtra("blocked_app", getReadableAppName(packageName))
            putExtra("block_mode", mode)
            putExtra("package_name", packageName)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    private fun startSoftLoop(packageName: String, intervalMinutes: Int) {
        stopSoftLoop()
        softLoopPackage = packageName

        val intervalMs = intervalMinutes.coerceAtLeast(15) * 60 * 1000L
        Log.d(tag, "Starting soft block loop for $packageName with interval ${intervalMinutes.coerceAtLeast(15)} minutes")
        softLoopRunnable = object : Runnable {
            override fun run() {
                val config = loadConfig()
                if (
                    config == null ||
                    !config.blockingEnabled ||
                    config.blockingMode != "soft" ||
                    config.blockedApps.none { it == packageName } ||
                    isTemporarilyAllowed(packageName, "soft") ||
                    !isPackageStillForeground(packageName)
                ) {
                    stopSoftLoop()
                    return
                }

                showOverlay(packageName, "soft")
                handler.postDelayed(this, intervalMs)
            }
        }

        handler.postDelayed(softLoopRunnable!!, intervalMs)
    }

    private fun stopSoftLoop() {
        softLoopRunnable?.let { handler.removeCallbacks(it) }
        softLoopRunnable = null
        softLoopPackage = null
    }

    private fun isPackageStillForeground(packageName: String): Boolean {
        return try {
            val usageStatsManager = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val currentTime = System.currentTimeMillis()
            val events = usageStatsManager.queryEvents(currentTime - 4000, currentTime)
            val event = UsageEvents.Event()
            var foregroundApp: String? = null
            var lastEventTime = 0L

            while (events.hasNextEvent()) {
                events.getNextEvent(event)
                if (event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND && event.timeStamp > lastEventTime) {
                    foregroundApp = event.packageName
                    lastEventTime = event.timeStamp
                }
            }

            foregroundApp == packageName
        } catch (_: Exception) {
            false
        }
    }

    private fun loadConfig(): BlockingConfig? {
        val prefs = getSharedPreferences("brainrot_prefs", Context.MODE_PRIVATE)
        val configString = prefs.getString("blocking_config", null) ?: return null
        val json = runCatching { JSONObject(configString) }.getOrNull() ?: return null
        val blockedAppsJson = json.optJSONArray("blockedApps") ?: JSONArray()
        val blockedApps = buildList {
            for (i in 0 until blockedAppsJson.length()) {
                add(blockedAppsJson.optString(i))
            }
        }

        return BlockingConfig(
            blockingEnabled = json.optBoolean("blockingEnabled", false),
            blockingMode = json.optString("blockingMode", "soft"),
            blockedApps = blockedApps,
            scheduleEnabled = json.optBoolean("scheduleEnabled", false),
            scheduleStart = json.optString("scheduleStart", "22:00"),
            scheduleEnd = json.optString("scheduleEnd", "06:00"),
            softBlockIntervalMinutes = json.optInt("softBlockIntervalMinutes", 15)
        )
    }

    private fun isTemporarilyAllowed(packageName: String, blockingMode: String): Boolean {
        return isSoftCooldownActive(packageName) || isEmergencyPassActive(packageName, blockingMode)
    }

    private fun isSoftCooldownActive(packageName: String): Boolean {
        val prefs = getSharedPreferences("brainrot_prefs", Context.MODE_PRIVATE)
        return prefs.getLong("soft_block_cooldown_until_$packageName", 0L) > System.currentTimeMillis()
    }

    private fun isEmergencyPassActive(packageName: String, blockingMode: String): Boolean {
        if (blockingMode != "hard") {
            return false
        }

        val prefs = getSharedPreferences("brainrot_prefs", Context.MODE_PRIVATE)
        val pendingPackage = prefs.getString("emergency_pass_pending_package", null)
        val activePackage = prefs.getString("emergency_pass_active_package", null)
        return pendingPackage == packageName || activePackage == packageName
    }

    private fun reconcileTemporaryPasses(currentPackageName: String) {
        if (currentPackageName.isBlank()) {
            return
        }

        val prefs = getSharedPreferences("brainrot_prefs", Context.MODE_PRIVATE)
        val editor = prefs.edit()
        var changed = false

        prefs.all.keys
            .filter { it.startsWith("soft_block_cooldown_until_") }
            .forEach { key ->
                if (prefs.getLong(key, 0L) <= System.currentTimeMillis()) {
                    editor.remove(key)
                    changed = true
                }
            }

        val pendingPackage = prefs.getString("emergency_pass_pending_package", null)
        val activePackage = prefs.getString("emergency_pass_active_package", null)

        if (pendingPackage != null && currentPackageName == pendingPackage) {
            editor.remove("emergency_pass_pending_package")
            editor.putString("emergency_pass_active_package", pendingPackage)
            changed = true
            Log.d(tag, "Emergency pass activated for $pendingPackage")
        } else if (activePackage != null && currentPackageName != activePackage) {
            editor.remove("emergency_pass_active_package")
            changed = true
            Log.d(tag, "Emergency pass cleared for $activePackage")
        }

        if (changed) {
            editor.apply()
        }
    }

    private fun isInSchedule(start: String, end: String): Boolean {
        val currentTime = java.text.SimpleDateFormat("HH:mm", java.util.Locale.US).format(java.util.Date())
        return if (start > end) {
            currentTime >= start || currentTime <= end
        } else {
            currentTime in start..end
        }
    }

    private fun getReadableAppName(packageName: String): String {
        return try {
            val appInfo = packageManager.getApplicationInfo(packageName, 0)
            packageManager.getApplicationLabel(appInfo).toString()
        } catch (_: Exception) {
            packageName.substringAfterLast('.').replaceFirstChar { it.uppercase() }
        }
    }

    private data class BlockingConfig(
        val blockingEnabled: Boolean,
        val blockingMode: String,
        val blockedApps: List<String>,
        val scheduleEnabled: Boolean,
        val scheduleStart: String,
        val scheduleEnd: String,
        val softBlockIntervalMinutes: Int,
    )
}
