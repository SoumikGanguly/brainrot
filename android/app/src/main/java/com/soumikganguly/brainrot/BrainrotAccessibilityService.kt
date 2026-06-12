package com.soumikganguly.brainrot

import android.accessibilityservice.AccessibilityService
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
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
    private val prefs by lazy { getSharedPreferences("brainrot_prefs", Context.MODE_PRIVATE) }
    private var lastHandledPackage: String? = null
    private var lastHandledAt = 0L
    private val handler = Handler(Looper.getMainLooper())
    private var softLoopRunnable: Runnable? = null
    private var softLoopPackage: String? = null
    private var cachedConfigString: String? = null
    private var cachedConfig: BlockingConfig? = null
    private val blockingConfigListener =
        SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
            if (key == "blocking_config") {
                refreshCachedConfig()
            }
        }

    override fun onServiceConnected() {
        super.onServiceConnected()
        prefs.registerOnSharedPreferenceChangeListener(blockingConfigListener)
        refreshCachedConfig()
    }

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

        ForegroundAppResolver.recordForeground(this, packageName, event.eventTime)
        val config = loadConfig() ?: run {
            stopSoftLoop()
            return
        }

        if (!config.blockingEnabled) {
            stopSoftLoop()
            return
        }

        val effectiveMode = config.getEffectiveMode(packageName)
        if (effectiveMode == null || isTemporarilyAllowed(packageName, effectiveMode.mode)) {
            if (softLoopPackage == packageName) {
                stopSoftLoop()
            }
            return
        }

        val now = System.currentTimeMillis()
        if (packageName == lastHandledPackage && now - lastHandledAt < 1200) {
            return
        }
        lastHandledPackage = packageName
        lastHandledAt = now

        Log.d(tag, "Blocking $packageName in ${effectiveMode.mode} mode (${effectiveMode.context})")

        if (effectiveMode.mode == "hard") {
            stopSoftLoop()
            performGlobalAction(GLOBAL_ACTION_HOME)
            showOverlay(packageName, effectiveMode.mode, effectiveMode.context)
            return
        }

        showOverlay(packageName, effectiveMode.mode, effectiveMode.context)
        startSoftLoop(packageName, config.limitIntervalMinutes)
    }

    override fun onInterrupt() {
        Log.d(tag, "Accessibility interrupted")
        stopSoftLoop()
    }

    override fun onDestroy() {
        super.onDestroy()
        prefs.unregisterOnSharedPreferenceChangeListener(blockingConfigListener)
        stopSoftLoop()
    }

    private fun showOverlay(packageName: String, mode: String, protectionContext: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            recordRecoverableFailure("overlay_missing", packageName)
            return
        }

        val intent = Intent(this, BlockingOverlayService::class.java).apply {
            putExtra("blocked_app", getReadableAppName(packageName))
            putExtra("block_mode", mode)
            putExtra("package_name", packageName)
            putExtra("protection_context", protectionContext)
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

        val intervalMs = intervalMinutes.coerceAtLeast(1) * 60 * 1000L
        Log.d(tag, "Starting soft block loop for $packageName with interval ${intervalMinutes.coerceAtLeast(1)} minutes")
        softLoopRunnable = object : Runnable {
            override fun run() {
                val config = loadConfig()
                val effectiveMode = config?.getEffectiveMode(packageName)
                if (
                    config == null ||
                    !config.blockingEnabled ||
                    effectiveMode?.mode != "soft" ||
                    isTemporarilyAllowed(packageName, "soft") ||
                    !isPackageStillForeground(packageName)
                ) {
                    stopSoftLoop()
                    return
                }

                showOverlay(packageName, "soft", effectiveMode.context)
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
            val snapshot = ForegroundAppResolver.getCurrentForeground(
                context = this,
                usageStatsManager = usageStatsManager,
                bootstrapWindowMs = 2 * 60 * 60 * 1000L,
                ignoredPackages = setOf(applicationContext.packageName)
            )
            snapshot.packageName == packageName
        } catch (_: Exception) {
            false
        }
    }

    private fun loadConfig(): BlockingConfig? {
        val currentConfigString = prefs.getString("blocking_config", null)
        if (currentConfigString != cachedConfigString) {
            refreshCachedConfig()
        }
        return cachedConfig
    }

    private fun refreshCachedConfig() {
        val configString = prefs.getString("blocking_config", null)
        if (configString == cachedConfigString) {
            return
        }
        cachedConfigString = configString
        cachedConfig = parseConfig(configString)
    }

    private fun parseConfig(configString: String?): BlockingConfig? {
        configString ?: return null
        val json = runCatching { JSONObject(configString) }.getOrNull() ?: run {
            recordRecoverableFailure("malformed_blocking_config", null)
            return null
        }

        val modernProtectedApps = json.optJSONArray("protectedApps")
        if (modernProtectedApps != null) {
            val protectedApps = buildList {
                for (i in 0 until modernProtectedApps.length()) {
                    val item = modernProtectedApps.optJSONObject(i) ?: continue
                    val packageName = item.optString("packageName")
                    if (packageName.isNotBlank()) {
                        add(ProtectedAppConfig(packageName, item.optString("mode", "monitor")))
                    }
                }
            }

            return BlockingConfig(
                blockingEnabled = json.optBoolean("blockingEnabled", false),
                focusSessionActive = json.optBoolean("focusSessionActive", false),
                protectedApps = protectedApps,
                limitIntervalMinutes = json.optInt("limitIntervalMinutes", 15).coerceAtLeast(1),
                lockedPassesPerDay = json.optInt("lockedPassesPerDay", 2).coerceAtLeast(0)
            )
        }

        val blockedAppsJson = json.optJSONArray("blockedApps") ?: JSONArray()
        val legacyMode = json.optString("blockingMode", "soft")
        val protectedApps = buildList {
            for (i in 0 until blockedAppsJson.length()) {
                val packageName = blockedAppsJson.optString(i)
                if (packageName.isNotBlank()) {
                    add(ProtectedAppConfig(packageName, if (legacyMode == "hard") "locked" else "limit"))
                }
            }
        }

        return BlockingConfig(
            blockingEnabled = json.optBoolean("blockingEnabled", false),
            focusSessionActive = false,
            protectedApps = protectedApps,
            limitIntervalMinutes = json.optInt("softBlockIntervalMinutes", 15).coerceAtLeast(1),
            lockedPassesPerDay = json.optInt("bypassLimit", 2).coerceAtLeast(0)
        )
    }

    private fun isTemporarilyAllowed(packageName: String, blockingMode: String): Boolean {
        return isSoftCooldownActive(packageName) || isEmergencyPassActive(packageName, blockingMode)
    }

    private fun isSoftCooldownActive(packageName: String): Boolean {
        return prefs.getLong("soft_block_cooldown_until_$packageName", 0L) > System.currentTimeMillis()
    }

    private fun isEmergencyPassActive(packageName: String, blockingMode: String): Boolean {
        if (blockingMode != "hard") {
            return false
        }

        val pendingPackage = prefs.getString("emergency_pass_pending_package", null)
        val activePackage = prefs.getString("emergency_pass_active_package", null)
        return pendingPackage == packageName || activePackage == packageName
    }

    private fun reconcileTemporaryPasses(currentPackageName: String) {
        if (currentPackageName.isBlank()) {
            return
        }

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

    private fun recordRecoverableFailure(reason: String, packageName: String?) {
        getSharedPreferences("brainrot_prefs", Context.MODE_PRIVATE)
            .edit()
            .putString("last_blocking_failure_reason", reason)
            .putString("last_blocking_failure_package", packageName ?: "")
            .putLong("last_blocking_failure_at", System.currentTimeMillis())
            .apply()
        Log.w(tag, "Blocking skipped: $reason ${packageName ?: ""}".trim())
    }

    private data class ProtectedAppConfig(
        val packageName: String,
        val mode: String
    )

    private data class EffectiveBlock(
        val mode: String,
        val context: String
    )

    private data class BlockingConfig(
        val blockingEnabled: Boolean,
        val focusSessionActive: Boolean,
        val protectedApps: List<ProtectedAppConfig>,
        val limitIntervalMinutes: Int,
        val lockedPassesPerDay: Int,
    ) {
        fun getEffectiveMode(packageName: String): EffectiveBlock? {
            val app = protectedApps.firstOrNull { it.packageName == packageName } ?: return null
            if (app.mode == "ignore") {
                return null
            }

            if (focusSessionActive) {
                return EffectiveBlock("hard", "focus_session")
            }

            return when (app.mode) {
                "locked" -> EffectiveBlock("hard", "locked_mode")
                "limit" -> EffectiveBlock("soft", "limit_mode")
                "monitor" -> null
                else -> null
            }
        }
    }
}
