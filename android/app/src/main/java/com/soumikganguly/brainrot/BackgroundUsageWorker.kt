package com.soumikganguly.brainrot

import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import androidx.work.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class BackgroundUsageWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    companion object {
        private const val TAG = "BackgroundUsageWorker"
        private const val WORK_NAME = "brainrot_usage_monitoring"
        
        fun startPeriodicWork(context: Context, intervalMinutes: Long = 15) {
            val constraints = Constraints.Builder()
                .setRequiresBatteryNotLow(false) // Allow even on low battery
                .setRequiredNetworkType(NetworkType.NOT_REQUIRED)
                .build()

            val request = PeriodicWorkRequestBuilder<BackgroundUsageWorker>(
                intervalMinutes, TimeUnit.MINUTES,
                5, TimeUnit.MINUTES // 5 minute flex period
            )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .addTag(WORK_NAME)
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP, // Keep existing work
                request
            )
            
            Log.d(TAG, "Periodic work scheduled with interval: $intervalMinutes minutes")
        }
        
        fun stopPeriodicWork(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
            Log.d(TAG, "Periodic work cancelled")
        }
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        return@withContext try {
            Log.d(TAG, "Background usage worker started")
            
            // Check if app has required permissions
            val usageModule = UsageChecker(applicationContext)
            usageModule.checkUsageAndNotify()
            
            // Check for app blocking violations
            checkBlockingViolations()
            
            Log.d(TAG, "Background usage worker completed successfully")
            Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "Worker failed", e)
            if (runAttemptCount < 3) {
                Result.retry()
            } else {
                Result.failure()
            }
        }
    }
    
    private suspend fun checkBlockingViolations() {
        try {
            val prefs = applicationContext.getSharedPreferences("brainrot_prefs", Context.MODE_PRIVATE)
            val blockingConfigString = prefs.getString("blocking_config", null) ?: return
            val blockingConfig = runCatching { JSONObject(blockingConfigString) }.getOrNull() ?: return

            if (!blockingConfig.optBoolean("blockingEnabled", true)) {
                return
            }

            if (hasAccessibilityPermission()) {
                Log.d(TAG, "Accessibility enabled, skipping worker backup enforcement")
                return
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(applicationContext)) {
                Log.d(TAG, "Overlay permission missing, skipping worker backup enforcement")
                return
            }

            val currentForegroundPackage = getCurrentForegroundPackage() ?: return
            if (currentForegroundPackage == applicationContext.packageName || currentForegroundPackage == "com.android.systemui") {
                return
            }

            val effectiveMode = getEffectiveMode(blockingConfig, currentForegroundPackage) ?: return
            if (effectiveMode == "monitor" || effectiveMode == "ignore") {
                return
            }

            if (isTemporarilyAllowed(prefs, currentForegroundPackage, effectiveMode)) {
                return
            }

            showBlockingOverlay(currentForegroundPackage, effectiveMode)
            Log.d(TAG, "Worker backup enforcement triggered for $currentForegroundPackage in $effectiveMode mode")
        } catch (e: Exception) {
            Log.e(TAG, "Error checking blocking violations", e)
        }
    }

    private fun getCurrentForegroundPackage(): String? {
        return try {
            val usageStatsManager = applicationContext.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
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

            foregroundApp
        } catch (e: Exception) {
            Log.e(TAG, "Error getting current foreground package", e)
            null
        }
    }

    private fun getEffectiveMode(config: JSONObject, packageName: String): String? {
        val protectedApps = config.optJSONArray("protectedApps") ?: JSONArray()
        var storedMode: String? = null

        for (i in 0 until protectedApps.length()) {
            val item = protectedApps.optJSONObject(i) ?: continue
            if (item.optString("packageName") == packageName) {
                storedMode = item.optString("mode")
                break
            }
        }

        if (storedMode.isNullOrBlank()) {
            return null
        }

        if (storedMode == "ignore") {
            return "ignore"
        }

        return if (config.optBoolean("focusSessionActive", false)) "locked" else storedMode
    }

    private fun isTemporarilyAllowed(
        prefs: android.content.SharedPreferences,
        packageName: String,
        effectiveMode: String
    ): Boolean {
        val cooldownUntil = prefs.getLong("soft_block_cooldown_until_$packageName", 0L)
        if (cooldownUntil > System.currentTimeMillis()) {
            return true
        }

        if (effectiveMode != "locked") {
            return false
        }

        val pendingPackage = prefs.getString("emergency_pass_pending_package", null)
        val activePackage = prefs.getString("emergency_pass_active_package", null)
        return pendingPackage == packageName || activePackage == packageName
    }

    private fun showBlockingOverlay(packageName: String, effectiveMode: String) {
        val intent = Intent(applicationContext, BlockingOverlayService::class.java).apply {
            putExtra("blocked_app", getReadableAppName(packageName))
            putExtra("block_mode", if (effectiveMode == "locked") "hard" else "soft")
            putExtra("package_name", packageName)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            applicationContext.startForegroundService(intent)
        } else {
            applicationContext.startService(intent)
        }
    }

    private fun getReadableAppName(packageName: String): String {
        return try {
            val appInfo = applicationContext.packageManager.getApplicationInfo(packageName, 0)
            applicationContext.packageManager.getApplicationLabel(appInfo).toString()
        } catch (_: Exception) {
            packageName.substringAfterLast('.').replaceFirstChar { it.uppercase() }
        }
    }

    private fun hasAccessibilityPermission(): Boolean {
        return try {
            val enabled = Settings.Secure.getInt(
                applicationContext.contentResolver,
                Settings.Secure.ACCESSIBILITY_ENABLED,
                0
            ) == 1
            val expected = "${applicationContext.packageName}/${BrainrotAccessibilityService::class.java.name}"
            val services = Settings.Secure.getString(
                applicationContext.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: ""
            enabled && services.contains(expected, ignoreCase = true)
        } catch (_: Exception) {
            false
        }
    }
}
