package com.soumikganguly.brainrot

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

class UsageChecker(private val context: Context) {
    
    private val notificationManager = NotificationManagerCompat.from(context)
    
    init {
        createNotificationChannel()
    }
    
    fun checkUsageAndNotify() {
        // This would integrate with your React Native app's logic
        // For now, showing concept of background monitoring
        
        val currentUsage = getCurrentUsage()
        val brainScore = calculateBrainScore(currentUsage)
        
        when {
            brainScore < 25 -> sendNotification("CRITICAL", "🚨 APPS ARE ROTTING YOUR BRAIN")
            brainScore < 50 -> sendNotification("WARNING", "Your brain's fogging up")
            brainScore < 80 -> sendNotification("MILD", "Consider taking a break")
        }
    }
    
    private fun getCurrentUsage(): Long {
        // Implement actual usage checking logic
        return 0L
    }
    
    private fun calculateBrainScore(usage: Long): Int {
        // Implement brain score calculation
        return 100
    }
    
    private fun sendNotification(level: String, message: String) {
        val notification = NotificationCompat.Builder(context, "brainrot_alerts")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Brainrot Alert")
            .setContentText(message)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build()
            
        notificationManager.notify(System.currentTimeMillis().toInt(), notification)
    }
    
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                "brainrot_alerts",
                "Brainrot Alerts",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Usage alerts and brain health notifications"
            }
            
            val notificationManager = context.getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
        }
    }
}