class BackgroundUsageWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

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
        // Load blocked apps from SharedPreferences
        val prefs = applicationContext.getSharedPreferences("brainrot_prefs", Context.MODE_PRIVATE)
        val blockedAppsJson = prefs.getString("blocked_apps", "[]")
        // ... check if any blocked apps are currently in use
    }

    companion object {
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
        }
    }
}