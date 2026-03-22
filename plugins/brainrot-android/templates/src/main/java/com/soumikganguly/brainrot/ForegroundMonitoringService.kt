package com.soumikganguly.brainrot

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat

class ForegroundMonitoringService : Service() {
    
    private val TAG = "ForegroundMonitoringService"
    private val CHANNEL_ID = "brainrot_monitoring"
    private val NOTIFICATION_ID = 1001
    
    private var monitoringHandler: Handler? = null
    private var monitoringRunnable: Runnable? = null
    private var usageChecker: UsageChecker? = null

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "ForegroundMonitoringService created")
        usageChecker = UsageChecker(this)
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        createNotificationChannel()
        
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Brainrot Monitoring")
            .setContentText("Protecting your brain health")
            .setSmallIcon(R.drawable.ic_notification)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build()
            
        startForeground(NOTIFICATION_ID, notification)
        
        // Start periodic checks
        startMonitoringLoop()
        
        return START_STICKY
    }
    
    private fun startMonitoringLoop() {
        if (monitoringHandler != null) {
            Log.d(TAG, "Monitoring already running")
            return
        }

        Log.d(TAG, "Starting monitoring loop")
        monitoringHandler = Handler(Looper.getMainLooper())
        
        monitoringRunnable = object : Runnable {
            override fun run() {
                try {
                    Log.d(TAG, "Running periodic usage check")
                    usageChecker?.checkUsageAndNotify()
                } catch (e: Exception) {
                    Log.e(TAG, "Error during monitoring check", e)
                }
                
                // Check every 5 minutes (300000 ms)
                monitoringHandler?.postDelayed(this, 5 * 60 * 1000)
            }
        }
        
        // Start the first check
        monitoringHandler?.post(monitoringRunnable!!)
    }

    private fun stopMonitoringLoop() {
        Log.d(TAG, "Stopping monitoring loop")
        monitoringRunnable?.let { 
            monitoringHandler?.removeCallbacks(it) 
        }
        monitoringHandler = null
        monitoringRunnable = null
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
        stopMonitoringLoop()
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