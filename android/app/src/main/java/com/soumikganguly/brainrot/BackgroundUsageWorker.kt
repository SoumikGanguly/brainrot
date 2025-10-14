package com.soumikganguly.brainrot

import android.content.Context
import android.util.Log
import androidx.work.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
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
            // Load blocked apps from SharedPreferences
            val prefs = applicationContext.getSharedPreferences("brainrot_prefs", Context.MODE_PRIVATE)
            val blockedAppsJson = prefs.getString("blocked_apps", "[]")
            
            // TODO: Parse JSON and check if any blocked apps are currently in use
            // This would integrate with your blocking service
            Log.d(TAG, "Checking blocking violations...")
        } catch (e: Exception) {
            Log.e(TAG, "Error checking blocking violations", e)
        }
    }
}