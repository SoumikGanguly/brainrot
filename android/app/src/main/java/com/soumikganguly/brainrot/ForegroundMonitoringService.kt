package com.soumikganguly.brainrot

import android.app.*
import android.content.Context
import android.content.Intent
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

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "ForegroundMonitoringService created")
        usageChecker = UsageChecker(this)
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        createNotificationChannel()

        startForeground(NOTIFICATION_ID, buildNotification())
        startNotificationLoop()
        
        return START_STICKY
    }

    private fun buildNotification(): Notification {
        val brainState = usageChecker?.getCurrentBrainState(forceRefresh = true)
            ?: UsageChecker.BrainState(100, "Focused", 0L)
        val contentText = "Screen time ${formatDuration(brainState.totalUsageMs)}"

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("${brainState.status} brain • ${brainState.score}")
            .setContentText(contentText)
            .setStyle(NotificationCompat.BigTextStyle().bigText(contentText))
            .setSmallIcon(R.drawable.ic_notification)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
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
    }
    
    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        fun start(context: Context) {
            val intent = Intent(context, ForegroundMonitoringService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            val intent = Intent(context, ForegroundMonitoringService::class.java)
            context.stopService(intent)
        }
    }
}
