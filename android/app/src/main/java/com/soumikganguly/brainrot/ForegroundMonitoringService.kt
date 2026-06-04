package com.soumikganguly.brainrot

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
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
    private val REFRESH_INTERVAL_MS = 15_000L
    
    private var notificationHandler: Handler? = null
    private var notificationRunnable: Runnable? = null
    private var usageChecker: UsageChecker? = null
    private var hasStartedForeground = false

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "ForegroundMonitoringService created")
        isStartingOrRunning = true
        createNotificationChannel()
        startForegroundSafely()
        usageChecker = UsageChecker(this)
        Log.d(TAG, "ForegroundMonitoringService onCreate completed")
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand received startId=$startId flags=$flags")
        startForegroundSafely()
        startNotificationLoop()
        Log.d(TAG, "onStartCommand finished startId=$startId")
        
        return START_STICKY
    }

    private fun startForegroundSafely() {
        if (hasStartedForeground) {
            Log.d(TAG, "startForegroundSafely skipped because foreground is already active")
            return
        }

        Log.d(TAG, "Promoting service to foreground")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                buildStartupNotification(),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            startForeground(NOTIFICATION_ID, buildStartupNotification())
        }
        hasStartedForeground = true
        Log.d(TAG, "Service is now in foreground")
    }

    private fun buildStartupNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Brainrot is protecting your focus")
            .setContentText("Preparing your focus status")
            .setSmallIcon(R.drawable.ic_notification)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setAutoCancel(false)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setShowWhen(false)
            .build()
    }

    private fun buildNotification(): Notification {
        val brainState = usageChecker?.getCurrentBrainState(forceRefresh = true)
            ?: UsageChecker.BrainState(100, "Focused", 0L)
        val title = "${brainState.status} brain • ${brainState.score}"
        val contentText = "Screen time ${formatDuration(brainState.totalUsageMs)}"
        val publicNotification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(contentText)
            .setSmallIcon(R.drawable.ic_notification)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setAutoCancel(false)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setShowWhen(false)
            .build()

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(contentText)
            .setStyle(NotificationCompat.BigTextStyle().bigText(contentText))
            .setSmallIcon(R.drawable.ic_notification)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setAutoCancel(false)
            .setPublicVersion(publicNotification)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setShowWhen(false)
            .build()
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
                    val notification = buildNotification()
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        startForeground(
                            NOTIFICATION_ID,
                            notification,
                            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
                        )
                    } else {
                        startForeground(NOTIFICATION_ID, notification)
                    }
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
            val importance = NotificationManager.IMPORTANCE_DEFAULT
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
        stopNotificationLoop()
        hasStartedForeground = false
        isStartingOrRunning = false
    }
    
    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        @Volatile
        private var isStartingOrRunning = false

        fun start(context: Context, reason: String = "unspecified") {
            Log.d("ForegroundMonitoringService", "Start requested. reason=$reason alreadyStartingOrRunning=$isStartingOrRunning")
            if (isStartingOrRunning) {
                Log.d("ForegroundMonitoringService", "Start ignored because service is already starting or running. reason=$reason")
                return
            }

            isStartingOrRunning = true
            val intent = Intent(context, ForegroundMonitoringService::class.java)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    Log.d("ForegroundMonitoringService", "Calling startForegroundService. reason=$reason")
                    context.startForegroundService(intent)
                } else {
                    Log.d("ForegroundMonitoringService", "Calling startService. reason=$reason")
                    context.startService(intent)
                }
            } catch (error: Exception) {
                isStartingOrRunning = false
                Log.e("ForegroundMonitoringService", "Failed to start service. reason=$reason", error)
                throw error
            }
        }

        fun stop(context: Context, reason: String = "unspecified") {
            Log.d("ForegroundMonitoringService", "Stop requested. reason=$reason")
            val intent = Intent(context, ForegroundMonitoringService::class.java)
            context.stopService(intent)
        }
    }
}
