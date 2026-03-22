package com.soumikganguly.brainrot

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import org.json.JSONObject

class BrainrotAccessibilityService : AccessibilityService() {
    private val tag = "BrainrotAccessibility"
    private var lastHandledPackage: String? = null
    private var lastHandledAt = 0L

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val packageName = event?.packageName?.toString() ?: return
        if (packageName.isBlank() || packageName == applicationContext.packageName || packageName == "com.android.systemui") {
            return
        }

        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
            event.eventType != AccessibilityEvent.TYPE_WINDOWS_CHANGED) {
            return
        }

        val prefs = getSharedPreferences("brainrot_prefs", Context.MODE_PRIVATE)
        val configString = prefs.getString("blocking_config", null) ?: return
        val config = runCatching { JSONObject(configString) }.getOrNull() ?: return
        if (!config.optBoolean("blockingEnabled", false)) {
            return
        }

        val blockedApps = config.optJSONArray("blockedApps") ?: return
        val isBlocked = (0 until blockedApps.length()).any { blockedApps.optString(it) == packageName }
        if (!isBlocked || isBypassed(packageName)) {
            return
        }

        val now = System.currentTimeMillis()
        if (packageName == lastHandledPackage && now - lastHandledAt < 1500) {
            return
        }
        lastHandledPackage = packageName
        lastHandledAt = now

        val configuredMode = config.optString("blockingMode", "soft")
        val effectiveMode = if (config.optBoolean("scheduleEnabled", false) &&
            isInSchedule(config.optString("scheduleStart", "22:00"), config.optString("scheduleEnd", "06:00"))) {
            "hard"
        } else {
            configuredMode
        }

        Log.d(tag, "Blocking $packageName in $effectiveMode mode")

        if (effectiveMode == "hard") {
            performGlobalAction(GLOBAL_ACTION_HOME)
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)) {
            val intent = Intent(this, BlockingOverlayService::class.java).apply {
                putExtra("blocked_app", getReadableAppName(packageName))
                putExtra("block_mode", effectiveMode)
                putExtra("package_name", packageName)
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
        }
    }

    override fun onInterrupt() {
        Log.d(tag, "Accessibility interrupted")
    }

    private fun isBypassed(packageName: String): Boolean {
        val prefs = getSharedPreferences("brainrot_prefs", Context.MODE_PRIVATE)
        return prefs.getLong("bypass_until_$packageName", 0L) > System.currentTimeMillis()
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
}

