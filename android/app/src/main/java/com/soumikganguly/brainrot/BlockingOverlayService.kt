
package com.soumikganguly.brainrot

import android.app.Service
import android.content.Intent
import android.graphics.PixelFormat
import android.os.IBinder
import android.view.WindowManager
import android.view.Gravity
import android.widget.FrameLayout
import android.view.View
import android.os.Handler
import android.os.Looper

class BlockingOverlayService : Service() {
    private var windowManager: WindowManager? = null
    private var overlayView: View? = null
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val blockedApp = intent?.getStringExtra("blocked_app")
        val blockMode = intent?.getStringExtra("block_mode") ?: "soft"
        
        if (blockedApp != null) {
            showBlockingOverlay(blockedApp, blockMode)
        }
        
        return START_NOT_STICKY
    }
    
    private fun showBlockingOverlay(appName: String, mode: String) {
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        )
        
        params.gravity = Gravity.CENTER
        
        overlayView = FrameLayout(this).apply {
            // Add your blocking UI here
            setBackgroundColor(android.graphics.Color.parseColor("#CC000000"))
        }
        
        windowManager?.addView(overlayView, params)
        
        // Remove after delay for soft block
        if (mode == "soft") {
            Handler(Looper.getMainLooper()).postDelayed({
                removeOverlay()
            }, 5000) // 5 second warning
        }
    }
    
    private fun removeOverlay() {
        overlayView?.let {
            windowManager?.removeView(it)
        }
        stopSelf()
    }
    
    override fun onBind(intent: Intent?): IBinder? = null
}