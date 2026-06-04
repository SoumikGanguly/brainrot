package com.soumikganguly.brainrot

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (
            action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            return
        }

        try {
            val prefs = context.getSharedPreferences("brainrot_prefs", Context.MODE_PRIVATE)
            val monitoringEnabled = prefs.getBoolean("monitoring_enabled", false)
            val backgroundChecksEnabled = prefs.getBoolean("background_checks_enabled", true)

            if (!monitoringEnabled) {
                return
            }

            ForegroundMonitoringService.start(context)
            if (backgroundChecksEnabled) {
                BackgroundUsageWorker.startPeriodicWork(context, 15)
            }

            Log.d("BootReceiver", "Restored monitoring after $action")
        } catch (error: Exception) {
            Log.e("BootReceiver", "Failed to restore monitoring after boot", error)
        }
    }
}
