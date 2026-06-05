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
    private var limitLoopRunnable: Runnable? = null
    private var limitLoopPackage: String? = null

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val packageName = event?.packageName?.toString() ?: return
        reconcileTemporaryPasses(packageName)
        if (packageName.isBlank() || packageName == applicationContext.packageName || packageName == "com.android.systemui") {
            if (limitLoopPackage != null && packageName != limitLoopPackage) {
                stopLimitLoop()
            }
            return
        }

        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
            event.eventType != AccessibilityEvent.TYPE_WINDOWS_CHANGED) {
            return
        }

        val config = loadConfig() ?: run {
            stopLimitLoop()
            return
        }

        if (!config.blockingEnabled) {
            stopLimitLoop()
            return
        }

        val effectiveMode = config.getEffectiveMode(packageName)
        if (effectiveMode == null || effectiveMode == "monitor" || effectiveMode == "ignore") {
            if (limitLoopPackage == packageName) {
                stopLimitLoop()
            }
            return
        }

        if (isTemporarilyAllowed(packageName, effectiveMode)) {
            if (limitLoopPackage == packageName) {
                stopLimitLoop()
            }
            return
        }

        val now = System.currentTimeMillis()
        if (packageName == lastHandledPackage && now - lastHandledAt < 1200) {
            return
        }
        lastHandledPackage = packageName
        lastHandledAt = now

        Log.d(tag, "Blocking $packageName in $effectiveMode mode")

        if (effectiveMode == "locked") {
            stopLimitLoop()
            performGlobalAction(GLOBAL_ACTION_HOME)
            showOverlay(packageName, "hard")
            return
        }

        showOverlay(packageName, "soft")
        startLimitLoop(packageName, config.limitIntervalMinutes)
    }

    override fun onInterrupt() {
        Log.d(tag, "Accessibility interrupted")
        stopLimitLoop()
    }

    override fun onDestroy() {
        super.onDestroy()
        stopLimitLoop()
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

    private fun startLimitLoop(packageName: String, intervalMinutes: Int) {
        stopLimitLoop()
        limitLoopPackage = packageName

        val intervalMs = intervalMinutes.coerceAtLeast(15) * 60 * 1000L
        Log.d(tag, "Starting limit loop for $packageName with interval ${intervalMinutes.coerceAtLeast(15)} minutes")
        limitLoopRunnable = object : Runnable {
            override fun run() {
                val config = loadConfig()
                val effectiveMode = config?.getEffectiveMode(packageName)
                if (
                    config == null ||
                    !config.blockingEnabled ||
                    effectiveMode != "limit" ||
                    isTemporarilyAllowed(packageName, effectiveMode) ||
                    !isPackageStillForeground(packageName)
                ) {
                    stopLimitLoop()
                    return
                }

                showOverlay(packageName, "soft")
                handler.postDelayed(this, intervalMs)
            }
        }

        handler.postDelayed(limitLoopRunnable!!, intervalMs)
    }

    private fun stopLimitLoop() {
        limitLoopRunnable?.let { handler.removeCallbacks(it) }
        limitLoopRunnable = null
        limitLoopPackage = null
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
        val protectedAppsJson = json.optJSONArray("protectedApps") ?: JSONArray()
        val protectedApps = buildMap {
            for (i in 0 until protectedAppsJson.length()) {
                val item = protectedAppsJson.optJSONObject(i) ?: continue
                val packageName = item.optString("packageName")
                val mode = item.optString("mode")
                if (packageName.isNotBlank() && mode.isNotBlank()) {
                    put(packageName, mode)
                }
            }
        }

        return BlockingConfig(
            blockingEnabled = json.optBoolean("blockingEnabled", true),
            protectedApps = protectedApps,
            focusSessionActive = json.optBoolean("focusSessionActive", false),
            limitIntervalMinutes = json.optInt("limitIntervalMinutes", 15),
        )
    }

    private fun isTemporarilyAllowed(packageName: String, mode: String): Boolean {
        return isLimitCooldownActive(packageName) || isEmergencyPassActive(packageName, mode)
    }

    private fun isLimitCooldownActive(packageName: String): Boolean {
        val prefs = getSharedPreferences("brainrot_prefs", Context.MODE_PRIVATE)
        return prefs.getLong("soft_block_cooldown_until_$packageName", 0L) > System.currentTimeMillis()
    }

    private fun isEmergencyPassActive(packageName: String, mode: String): Boolean {
        if (mode != "locked") {
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
        val protectedApps: Map<String, String>,
        val focusSessionActive: Boolean,
        val limitIntervalMinutes: Int,
    ) {
        fun getEffectiveMode(packageName: String): String? {
            val storedMode = protectedApps[packageName] ?: return null
            if (storedMode == "ignore") {
                return "ignore"
            }
            return if (focusSessionActive) "locked" else storedMode
        }
    }
}
