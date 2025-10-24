package com.soumikganguly.brainrot

import android.app.*
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.view.*
import android.widget.*
import androidx.core.app.NotificationCompat

class BlockingOverlayService : Service() {
    private var windowManager: WindowManager? = null
    private var overlayView: View? = null
    private val NOTIFICATION_ID = 2001
    private val CHANNEL_ID = "blocking_overlay_channel"
    
    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, createNotification())
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val blockedApp = intent?.getStringExtra("blocked_app") ?: "App"
        val blockMode = intent?.getStringExtra("block_mode") ?: "soft"
        val packageName = intent?.getStringExtra("package_name") ?: ""
        
        showBlockingOverlay(blockedApp, blockMode, packageName)
        
        return START_NOT_STICKY
    }
    
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "App Blocking Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows when an app is being blocked"
                setShowBadge(false)
            }
            
            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager?.createNotificationChannel(channel)
        }
    }
    
    private fun createNotification(): Notification {
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("App Blocking Active")
            .setContentText("Protecting your focus")
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
        
        return builder.build()
    }
    
    private fun showBlockingOverlay(appName: String, mode: String, packageName: String) {
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        
        // Remove any existing overlay first
        removeOverlay()
        
        // Create layout parameters for overlay
        val layoutParams = WindowManager.LayoutParams().apply {
            width = WindowManager.LayoutParams.MATCH_PARENT
            height = WindowManager.LayoutParams.MATCH_PARENT
            
            type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            } else {
                @Suppress("DEPRECATION")
                WindowManager.LayoutParams.TYPE_SYSTEM_ALERT
            }
            
            // For hard block: Make it interactive and block all touches
            // For soft block: Allow some interaction
            flags = if (mode == "hard") {
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_FULLSCREEN
            } else {
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
            }
            
            format = PixelFormat.TRANSLUCENT
            gravity = Gravity.CENTER
        }
        
        // Create the overlay view
        overlayView = createOverlayView(appName, mode, packageName)
        
        try {
            windowManager?.addView(overlayView, layoutParams)
            
            // For soft block, auto-remove after 5 seconds
            if (mode == "soft") {
                overlayView?.postDelayed({
                    removeOverlay()
                    stopSelf()
                }, 5000)
            }
        } catch (e: Exception) {
            e.printStackTrace()
            stopSelf()
        }
    }
    
    private fun createOverlayView(appName: String, mode: String, packageName: String): View {
        val frameLayout = FrameLayout(this).apply {
            setBackgroundColor(
                if (mode == "hard") 
                    Color.parseColor("#E6000000") // 90% opacity black for hard block
                else 
                    Color.parseColor("#CC000000") // 80% opacity black for soft block
            )
        }
        
        // Create content container
        val contentLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(48, 48, 48, 48)
        }
        
        // Add lock icon (you can replace with custom icon)
        val iconView = ImageView(this).apply {
            setImageResource(android.R.drawable.ic_lock_lock)
            layoutParams = LinearLayout.LayoutParams(120, 120).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                bottomMargin = 32
            }
            setColorFilter(Color.WHITE)
        }
        contentLayout.addView(iconView)
        
        // Add title
        val titleText = TextView(this).apply {
            text = if (mode == "hard") "🚫 App Blocked" else "⚠️ Time to Focus"
            textSize = 24f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = 16
            }
        }
        contentLayout.addView(titleText)
        
        // Add app name
        val appNameText = TextView(this).apply {
            text = "$appName is currently blocked"
            textSize = 18f
            setTextColor(Color.parseColor("#CCCCCC"))
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = 24
            }
        }
        contentLayout.addView(appNameText)
        
        // Add message
        val messageText = TextView(this).apply {
            text = if (mode == "hard") {
                "This app is blocked to help you maintain focus.\nTry again later or adjust your settings."
            } else {
                "You've been using $appName for a while.\nConsider taking a break!"
            }
            textSize = 16f
            setTextColor(Color.parseColor("#AAAAAA"))
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = 32
            }
        }
        contentLayout.addView(messageText)
        
        // Add buttons based on mode
        if (mode == "hard") {
            // For hard block, add "Go Back" button
            val goBackButton = Button(this).apply {
                text = "Go Back"
                setBackgroundColor(Color.parseColor("#FF6B6B"))
                setTextColor(Color.WHITE)
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    topMargin = 16
                }
                
                setOnClickListener {
                    // Go back to home screen
                    val homeIntent = Intent(Intent.ACTION_MAIN).apply {
                        addCategory(Intent.CATEGORY_HOME)
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                    startActivity(homeIntent)
                    removeOverlay()
                    stopSelf()
                }
            }
            contentLayout.addView(goBackButton)
            
            // Add "Open BrainRot" button
            val openAppButton = Button(this).apply {
                text = "Open BrainRot Settings"
                setBackgroundColor(Color.parseColor("#4CAF50"))
                setTextColor(Color.WHITE)
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    topMargin = 8
                }
                
                setOnClickListener {
                    // Open the BrainRot app
                    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
                        ?: packageManager.getLaunchIntentForPackage("com.soumikganguly.brainrot")
                    
                    launchIntent?.let {
                        it.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                        startActivity(it)
                    }
                    removeOverlay()
                    stopSelf()
                }
            }
            contentLayout.addView(openAppButton)
            
        } else {
            // For soft block, add dismiss button
            val dismissButton = Button(this).apply {
                text = "I Understand"
                setBackgroundColor(Color.parseColor("#FFA726"))
                setTextColor(Color.WHITE)
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                )
                
                setOnClickListener {
                    removeOverlay()
                    stopSelf()
                }
            }
            contentLayout.addView(dismissButton)
        }
        
        // Add content to frame
        frameLayout.addView(contentLayout, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = Gravity.CENTER
        })
        
        return frameLayout
    }
    
    private fun removeOverlay() {
        try {
            overlayView?.let {
                windowManager?.removeView(it)
                overlayView = null
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
    
    override fun onDestroy() {
        super.onDestroy()
        removeOverlay()
    }
    
    override fun onBind(intent: Intent?): IBinder? = null
}