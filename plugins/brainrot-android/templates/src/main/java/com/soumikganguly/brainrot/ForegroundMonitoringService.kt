package com.soumikganguly.brainrot

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat

class ForegroundMonitoringService : Service() {
    
    private val TAG = "ForegroundMonitoringService"
    private val CHANNEL_ID = "brainrot_monitoring"
    private val NOTIFICATION_ID = 1001
    private val REFRESH_INTERVAL_MS = 60_000L
    
    private var notificationHandler: Handler? = null
    private var notificationRunnable: Runnable? = null
    private var usageChecker: UsageChecker? = null
    private var foregroundStarted = false

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "ForegroundMonitoringService created")
        createNotificationChannel()
        startForegroundSafely(buildBootstrapNotification())
        usageChecker = UsageChecker(this)
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_REFRESH_NOTIFICATION) {
            startForegroundSafely(buildNotification())
            return START_STICKY
        }

        startForegroundSafely(buildNotification())
        startNotificationLoop()
        
        return START_STICKY
    }

    private fun buildBootstrapNotification(): Notification {
        val prefs = getSharedPreferences("brainrot_prefs", Context.MODE_PRIVATE)
        val subscriptionStatus = prefs.getString("subscription_status", "trial") ?: "trial"
        if (subscriptionStatus == "expired") {
            return buildExpiredNotification(prefs)
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Brainrot is monitoring")
            .setContentText("Preparing your focus status")
            .setSmallIcon(R.drawable.ic_notification)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setShowWhen(false)
            .build()
    }

    private fun buildNotification(): Notification {
        val prefs = getSharedPreferences("brainrot_prefs", Context.MODE_PRIVATE)
        val subscriptionStatus = prefs.getString("subscription_status", "trial") ?: "trial"
        if (subscriptionStatus == "expired") {
            return buildExpiredNotification(prefs)
        }

        val summaryDate = prefs.getString("daily_summary_date", "") ?: ""
        val today = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
            .format(java.util.Date())
        val syncedSummaryAvailable = summaryDate == today
        val brainState = if (syncedSummaryAvailable) {
            UsageChecker.BrainState(
                prefs.getInt("daily_summary_brain_score", 100),
                prefs.getString("daily_summary_brain_status", "Focused") ?: "Focused",
                prefs.getLong("daily_summary_total_screen_time_ms", 0L)
            )
        } else {
            usageChecker?.getCurrentBrainState(forceRefresh = true)
                ?: UsageChecker.BrainState(100, "Focused", 0L)
        }
        val contentText = "Screen time ${formatDuration(brainState.totalUsageMs)}"

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("${brainState.status} brain • ${brainState.score}")
            .setContentText(contentText)
            .setStyle(NotificationCompat.BigTextStyle().bigText(contentText))
            .setSmallIcon(R.drawable.ic_notification)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setShowWhen(false)
            .build()
    }

    private fun buildExpiredNotification(prefs: SharedPreferences): Notification {
        val title =
            prefs.getString("expired_notification_title", "Brainrot trial has ended")
                ?: "Brainrot trial has ended"
        val body =
            prefs.getString(
                "expired_notification_body",
                "Open Brainrot to keep your momentum going."
            ) ?: "Open Brainrot to keep your momentum going."

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setSmallIcon(R.drawable.ic_notification)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setShowWhen(false)
            .build()
    }

    private fun startForegroundSafely(notification: Notification) {
        try {
            if (!foregroundStarted) {
                startForeground(NOTIFICATION_ID, notification)
                foregroundStarted = true
                startupInFlight = false
                return
            }

            val notificationManager =
                getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.notify(NOTIFICATION_ID, notification)
        } catch (error: Exception) {
            startupInFlight = false
            Log.e(TAG, "Failed to promote monitoring service to foreground", error)
            stopSelf()
        }
    }

    private fun formatDuration(durationMs: Long): String {
        val totalMinutes = durationMs / 60000
        val hours = totalMinutes / 60
        val minutes = totalMinutes % 60

        return if (hours > 0) {
            "${hours}h ${minutes}m"
        } else {
            "${minutes}m"
        }
    }

    private fun startNotificationLoop() {
        if (notificationHandler != null) {
            Log.d(TAG, "Focus status notification already running")
            return
        }

        Log.d(TAG, "Starting focus status notification loop")
        notificationHandler = Handler(Looper.getMainLooper())

        notificationRunnable = object : Runnable {
            override fun run() {
                try {
                    usageChecker?.checkUsageAndNotify()
                    val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    notificationManager.notify(NOTIFICATION_ID, buildNotification())
                } catch (e: Exception) {
                    Log.e(TAG, "Error refreshing focus status notification", e)
                }

                notificationHandler?.postDelayed(this, REFRESH_INTERVAL_MS)
            }
        }

        notificationHandler?.post(notificationRunnable!!)
    }

    private fun stopNotificationLoop() {
        Log.d(TAG, "Stopping focus status notification loop")
        notificationRunnable?.let {
            notificationHandler?.removeCallbacks(it)
        }
        notificationHandler = null
        notificationRunnable = null
    }
    
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val name = "Background Monitoring"
            val descriptionText = "Monitors your app usage to protect brain health"
            val importance = NotificationManager.IMPORTANCE_LOW
            val channel = NotificationChannel(CHANNEL_ID, name, importance).apply {
                description = descriptionText
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
            
            Log.d(TAG, "Notification channel created")
        }
    }
    
    override fun onDestroy() {
        super.onDestroy()
        Log.d(TAG, "Service destroyed")
        foregroundStarted = false
        startupInFlight = false
        stopNotificationLoop()
    }
    
    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val ACTION_REFRESH_NOTIFICATION = "ACTION_REFRESH_NOTIFICATION"
        @Volatile
        private var startupInFlight = false

        private fun isRunning(context: Context): Boolean {
            val activityManager =
                context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            return activityManager
                .getRunningServices(Int.MAX_VALUE)
                .any { it.service.className == ForegroundMonitoringService::class.java.name }
        }

        fun start(context: Context) {
            val intent = Intent(context, ForegroundMonitoringService::class.java)
            if (startupInFlight) {
                Log.d("ForegroundMonitoringService", "Ignoring duplicate start while foreground startup is in flight")
                return
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !isRunning(context)) {
                startupInFlight = true
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            startupInFlight = false
            val intent = Intent(context, ForegroundMonitoringService::class.java)
            context.stopService(intent)
        }

        fun refreshNotification(context: Context) {
            if (!isRunning(context)) {
                return
            }

            val intent = Intent(context, ForegroundMonitoringService::class.java).apply {
                action = ACTION_REFRESH_NOTIFICATION
            }
            context.startService(intent)
        }
    }
}
