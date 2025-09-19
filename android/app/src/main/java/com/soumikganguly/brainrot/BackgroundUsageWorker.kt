package com.soumikganguly.brainrot

import android.content.Context
import android.util.Log
import androidx.work.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

private const val TAG = "BackgroundUsageWorker"
private const val WORK_NAME = "background_usage_check"

class BackgroundUsageWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        return@withContext try {
            Log.d(TAG, "Background usage worker started")
            val usageChecker = UsageChecker(applicationContext)
            usageChecker.checkUsageAndNotify()
            Log.d(TAG, "Background usage worker completed successfully")
            Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "Worker failed", e)
            Result.retry()
        }
    }

    companion object {
        fun startPeriodicWork(context: Context, intervalMinutes: Long = 15) {
            Log.d(TAG, "Starting periodic work with interval: $intervalMinutes minutes")
            
            val constraints = Constraints.Builder()
                .setRequiresBatteryNotLow(true)
                .setRequiredNetworkType(NetworkType.NOT_REQUIRED)
                .build()

            val request = PeriodicWorkRequestBuilder<BackgroundUsageWorker>(
                intervalMinutes, TimeUnit.MINUTES
            )
                .setBackoffCriteria(BackoffPolicy.LINEAR, 10, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .addTag(WORK_NAME)
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.REPLACE,
                request
            )
            
            Log.d(TAG, "Periodic work enqueued successfully")
        }

        fun stopPeriodicWork(context: Context) {
            Log.d(TAG, "Stopping periodic work")
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
        }
    }
}