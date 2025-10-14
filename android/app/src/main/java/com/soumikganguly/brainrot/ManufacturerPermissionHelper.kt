package com.soumikganguly.brainrot

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import com.facebook.react.bridge.*

class ManufacturerPermissionHelper(private val reactContext: ReactApplicationContext) {
    
    companion object {
        private const val TAG = "ManufacturerPermission"
        
        enum class Manufacturer {
            XIAOMI, OPPO, VIVO, REALME, SAMSUNG, HUAWEI, ONEPLUS, GENERIC
        }
    }
    
    fun getManufacturer(): Manufacturer {
        val manufacturer = Build.MANUFACTURER.lowercase()
        return when {
            manufacturer.contains("xiaomi") || manufacturer.contains("redmi") -> Manufacturer.XIAOMI
            manufacturer.contains("oppo") -> Manufacturer.OPPO
            manufacturer.contains("vivo") -> Manufacturer.VIVO
            manufacturer.contains("realme") -> Manufacturer.REALME
            manufacturer.contains("samsung") -> Manufacturer.SAMSUNG
            manufacturer.contains("huawei") || manufacturer.contains("honor") -> Manufacturer.HUAWEI
            manufacturer.contains("oneplus") -> Manufacturer.ONEPLUS
            else -> Manufacturer.GENERIC
        }
    }
    
    fun needsSpecialPermission(): Boolean {
        return when (getManufacturer()) {
            Manufacturer.XIAOMI, Manufacturer.OPPO, Manufacturer.VIVO, 
            Manufacturer.REALME, Manufacturer.HUAWEI -> true
            else -> false
        }
    }
    
    fun getPermissionInstructions(): WritableMap {
        val map = Arguments.createMap()
        val manufacturer = getManufacturer()
        
        map.putString("manufacturer", manufacturer.name)
        map.putBoolean("needsSpecialPermission", needsSpecialPermission())
        
        when (manufacturer) {
            Manufacturer.XIAOMI -> {
                map.putString("title", "Xiaomi/MIUI Special Permission Required")
                map.putString("instructions", 
                    "1. Go to Settings → Apps → Manage apps\n" +
                    "2. Find 'Brainrot' app\n" +
                    "3. Tap 'Other permissions'\n" +
                    "4. Enable 'Display pop-up windows while running in background'\n" +
                    "5. Enable 'Auto-start'\n" +
                    "6. Then grant Usage Access permission")
                map.putBoolean("canOpenDirectly", true)
            }
            Manufacturer.OPPO -> {
                map.putString("title", "Oppo/ColorOS Special Permission Required")
                map.putString("instructions",
                    "1. Go to Settings → App Management\n" +
                    "2. Find 'Brainrot' app\n" +
                    "3. Enable 'Allow display over other apps'\n" +
                    "4. Enable 'Startup manager'\n" +
                    "5. Then grant Usage Access permission")
                map.putBoolean("canOpenDirectly", true)
            }
            Manufacturer.VIVO -> {
                map.putString("title", "Vivo/FuntouchOS Special Permission Required")
                map.putString("instructions",
                    "1. Go to iManager → App Manager\n" +
                    "2. Find 'Brainrot' app\n" +
                    "3. Enable 'Background running'\n" +
                    "4. Enable 'Display pop-up window'\n" +
                    "5. Then grant Usage Access permission")
                map.putBoolean("canOpenDirectly", false)
            }
            Manufacturer.REALME -> {
                map.putString("title", "Realme Special Permission Required")
                map.putString("instructions",
                    "1. Go to Settings → App Management\n" +
                    "2. Find 'Brainrot' app\n" +
                    "3. Enable 'Allow display over other apps'\n" +
                    "4. Enable 'Auto-start'\n" +
                    "5. Then grant Usage Access permission")
                map.putBoolean("canOpenDirectly", true)
            }
            Manufacturer.HUAWEI -> {
                map.putString("title", "Huawei Special Permission Required")
                map.putString("instructions",
                    "1. Go to Settings → Apps\n" +
                    "2. Find 'Brainrot' app\n" +
                    "3. Enable 'Floating window'\n" +
                    "4. Enable 'AutoLaunch'\n" +
                    "5. Then grant Usage Access permission")
                map.putBoolean("canOpenDirectly", false)
            }
            else -> {
                map.putString("title", "Permissions Required")
                map.putString("instructions", "Please grant all necessary permissions")
                map.putBoolean("canOpenDirectly", false)
            }
        }
        
        return map
    }
    
    fun openManufacturerSettings(): Boolean {
        val manufacturer = getManufacturer()
        
        try {
            val intent = when (manufacturer) {
                Manufacturer.XIAOMI -> getXiaomiIntent()
                Manufacturer.OPPO -> getOppoIntent()
                Manufacturer.REALME -> getRealmeIntent()
                Manufacturer.SAMSUNG -> getSamsungIntent()
                else -> getGenericIntent()
            }
            
            intent?.let {
                it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                reactContext.startActivity(it)
                return true
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to open manufacturer settings", e)
            // Fallback to generic app settings
            openAppSettings()
        }
        
        return false
    }
    
    private fun getXiaomiIntent(): Intent? {
        val intent = Intent("miui.intent.action.APP_PERM_EDITOR")
        intent.setClassName(
            "com.miui.securitycenter",
            "com.miui.permcenter.permissions.PermissionsEditorActivity"
        )
        intent.putExtra("extra_pkgname", reactContext.packageName)
        
        return if (isIntentAvailable(intent)) intent else {
            // Fallback for newer MIUI versions
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.parse("package:${reactContext.packageName}")
            }
        }
    }
    
    private fun getOppoIntent(): Intent? {
        val intent = Intent().apply {
            putExtra("packageName", reactContext.packageName)
        }
        
        // Try different Oppo settings activities
        val components = listOf(
            ComponentName("com.color.safecenter", "com.color.safecenter.permission.PermissionManagerActivity"),
            ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.PermissionManagerActivity"),
            ComponentName("com.oppo.safe", "com.oppo.safe.permission.PermissionAppListActivity")
        )
        
        for (component in components) {
            intent.component = component
            if (isIntentAvailable(intent)) {
                return intent
            }
        }
        
        return null
    }
    
    private fun getRealmeIntent(): Intent? {
        val intent = Intent().apply {
            putExtra("packageName", reactContext.packageName)
        }
        
        intent.component = ComponentName(
            "com.coloros.safecenter",
            "com.coloros.safecenter.permission.PermissionManagerActivity"
        )
        
        return if (isIntentAvailable(intent)) intent else null
    }
    
    private fun getSamsungIntent(): Intent? {
        val intent = Intent().apply {
            action = "android.settings.APPLICATION_DETAILS_SETTINGS"
            data = Uri.parse("package:${reactContext.packageName}")
        }
        return intent
    }
    
    private fun getGenericIntent(): Intent {
        return Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.parse("package:${reactContext.packageName}")
        }
    }
    
    private fun isIntentAvailable(intent: Intent): Boolean {
        return reactContext.packageManager.queryIntentActivities(
            intent,
            PackageManager.MATCH_DEFAULT_ONLY
        ).isNotEmpty()
    }
    
    private fun openAppSettings() {
        try {
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            intent.data = Uri.parse("package:${reactContext.packageName}")
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactContext.startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to open app settings", e)
        }
    }
    
    fun requestIgnoreBatteryOptimization(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                intent.data = Uri.parse("package:${reactContext.packageName}")
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                reactContext.startActivity(intent)
                return true
            } catch (e: Exception) {
                Log.e(TAG, "Failed to request battery optimization", e)
            }
        }
        return false
    }
}