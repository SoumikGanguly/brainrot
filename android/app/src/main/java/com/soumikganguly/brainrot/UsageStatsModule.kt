package com.brainrot

import android.app.usage.UsageStats
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.*
import java.util.*

class UsageStatsModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "UsageStatsModule"

    @ReactMethod
    fun isUsageAccessGranted(promise: Promise) {
        try {
            val usageStatsManager = reactApplicationContext.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val time = System.currentTimeMillis()
            val stats = usageStatsManager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, time - 1000 * 60, time)
            promise.resolve(!stats.isEmpty())
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun openUsageAccessSettings() {
        val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
        reactApplicationContext.startActivity(intent)
    }

    @ReactMethod
    fun getInstalledMonitoredApps(promise: Promise) {
        try {
            val packageManager = reactApplicationContext.packageManager
            val installedApps = packageManager.getInstalledApplications(PackageManager.GET_META_DATA)
            
            val monitoredApps = arrayOf("com.google.android.youtube", "com.instagram.android", 
                                      "com.whatsapp", "com.facebook.katana", "com.ss.android.ugc.tiktok")
            
            val result = WritableNativeArray()
            
            for (app in installedApps) {
                if ((app.flags and ApplicationInfo.FLAG_SYSTEM) == 0 || monitoredApps.contains(app.packageName)) {
                    val appInfo = WritableNativeMap()
                    appInfo.putString("packageName", app.packageName)
                    appInfo.putString("appName", packageManager.getApplicationLabel(app).toString())
                    appInfo.putBoolean("isRecommended", monitoredApps.contains(app.packageName))
                    result.pushMap(appInfo)
                }
            }
            
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("GET_APPS_ERROR", e.message)
        }
    }

    @ReactMethod
    fun getUsageSince(startTimeMs: Double, promise: Promise) {
        try {
            val usageStatsManager = reactApplicationContext.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val endTime = System.currentTimeMillis()
            val startTime = startTimeMs.toLong()
            
            val stats = usageStatsManager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, startTime, endTime)
            val packageManager = reactApplicationContext.packageManager
            
            val result = WritableNativeArray()
            
            for (usageStats in stats) {
                if (usageStats.totalTimeInForeground > 0) {
                    try {
                        val appInfo = packageManager.getApplicationInfo(usageStats.packageName, 0)
                        val appName = packageManager.getApplicationLabel(appInfo).toString()
                        
                        val usageMap = WritableNativeMap()
                        usageMap.putString("packageName", usageStats.packageName)
                        usageMap.putString("appName", appName)
                        usageMap.putDouble("totalTimeMs", usageStats.totalTimeInForeground.toDouble())
                        usageMap.putDouble("lastTimeUsed", usageStats.lastTimeUsed.toDouble())
                        
                        result.pushMap(usageMap)
                    } catch (e: PackageManager.NameNotFoundException) {
                        // App might have been uninstalled
                        continue
                    }
                }
            }
            
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("GET_USAGE_ERROR", e.message)
        }
    }
}