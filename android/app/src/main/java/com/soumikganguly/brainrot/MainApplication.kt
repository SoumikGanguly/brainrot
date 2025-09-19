package com.soumikganguly.brainrot

import android.app.Application
import android.content.res.Configuration
import android.util.Log
import androidx.work.Configuration as WorkConfiguration
import androidx.work.WorkManager

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ReactNativeHostWrapper

class MainApplication : Application(), ReactApplication, WorkConfiguration.Provider {

  override val reactNativeHost: ReactNativeHost = ReactNativeHostWrapper(
        this,
        object : DefaultReactNativeHost(this) {
          override fun getPackages(): List<ReactPackage> {
            val packages = PackageList(this).packages
            // Packages that cannot be autolinked yet can be added manually here, for example:
            // packages.add(MyReactNativePackage())
            packages.add(UsageStatsPackage())
            return packages
          }

          override fun getJSMainModuleName(): String = ".expo/.virtual-metro-entry"

          override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

          override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
          override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
      }
  )

  override val reactHost: ReactHost
    get() = ReactNativeHostWrapper.createReactHost(applicationContext, reactNativeHost)

  // WorkManager configuration
  override fun getWorkManagerConfiguration(): WorkConfiguration {
    return if (BuildConfig.DEBUG) {
      WorkConfiguration.Builder()
        .setMinimumLoggingLevel(Log.DEBUG)
        .build()
    } else {
      WorkConfiguration.Builder()
        .setMinimumLoggingLevel(Log.ERROR)
        .build()
    }
  }

  override fun onCreate() {
    super.onCreate()
    
    // Initialize SoLoader
    SoLoader.init(this, OpenSourceMergedSoMapping)
    
    // Initialize WorkManager manually
    try {
      WorkManager.initialize(this, workManagerConfiguration)
      Log.d("MainApplication", "WorkManager initialized successfully")
    } catch (e: Exception) {
      Log.e("MainApplication", "Failed to initialize WorkManager", e)
    }
    
    // New Architecture initialization
    if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
      // If you opted-in for the New Architecture, we load the native entry point for this app.
      load()
    }
    
    // Expo lifecycle
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}