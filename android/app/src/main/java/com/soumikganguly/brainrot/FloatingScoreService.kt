package com.soumikganguly.brainrot

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.*
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import kotlin.math.min

class FloatingScoreService : Service() {
    
    private var windowManager: WindowManager? = null
    private var floatingView: View? = null
    private var scoreTextView: TextView? = null
    private var timerTextView: TextView? = null
    private var circleView: ScoreCircleView? = null
    
    private var currentScore: Int = 100
    private var timeInApp: Long = 0
    private var startTime: Long = 0
    private var appName: String = ""
    
    private val updateHandler = Handler(Looper.getMainLooper())
    private val updateRunnable = object : Runnable {
        override fun run() {
            updateScore()
            updateHandler.postDelayed(this, 1000) // Update every second
        }
    }
    
    companion object {
        private const val TAG = "FloatingScoreService"
        private const val NOTIFICATION_ID = 2001
        private const val CHANNEL_ID = "floating_score"
        
        const val ACTION_UPDATE_SCORE = "com.soumikganguly.brainrot.UPDATE_SCORE"
        const val EXTRA_SCORE = "score"
        const val EXTRA_APP_NAME = "app_name"
        const val EXTRA_TIME_MS = "time_ms"
    }
    
    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "FloatingScoreService created")
        createNotificationChannel()
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_UPDATE_SCORE -> {
                currentScore = intent.getIntExtra(EXTRA_SCORE, 100)
                appName = intent.getStringExtra(EXTRA_APP_NAME) ?: ""
                timeInApp = intent.getLongExtra(EXTRA_TIME_MS, 0)
                updateFloatingView()
            }
            else -> {
                startTime = System.currentTimeMillis()
                showFloatingView()
                startForeground(NOTIFICATION_ID, createNotification())
                updateHandler.post(updateRunnable)
            }
        }
        
        return START_STICKY
    }
    
    private fun showFloatingView() {
        if (floatingView != null) return
        
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        
        floatingView = LayoutInflater.from(this).inflate(
            R.layout.floating_score_view,
            null
        )
        
        scoreTextView = floatingView?.findViewById(R.id.scoreText)
        timerTextView = floatingView?.findViewById(R.id.timerText)
        circleView = floatingView?.findViewById(R.id.circleView)
        
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else
                WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        )
        
        params.gravity = Gravity.TOP or Gravity.END
        params.x = 20
        params.y = 100
        // Make it draggable
        floatingView?.setOnTouchListener(object : View.OnTouchListener {
            private var initialX = 0
            private var initialY = 0
            private var initialTouchX = 0f
            private var initialTouchY = 0f
            
            override fun onTouch(v: View, event: MotionEvent): Boolean {
                when (event.action) {
                    MotionEvent.ACTION_DOWN -> {
                        initialX = params.x
                        initialY = params.y
                        initialTouchX = event.rawX
                        initialTouchY = event.rawY
                        return true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        params.x = initialX + (initialTouchX - event.rawX).toInt()
                        params.y = initialY + (event.rawY - initialTouchY).toInt()
                        windowManager?.updateViewLayout(floatingView, params)
                        return true
                    }
                }
                return false
            }
        })
        
        windowManager?.addView(floatingView, params)
        updateFloatingView()
    }
    
    private fun updateScore() {
        timeInApp = System.currentTimeMillis() - startTime
        
        // Calculate score degradation (example formula)
        // Every 15 minutes reduces score
        val minutesInApp = timeInApp / (1000 * 60)
        val scoreLoss = (minutesInApp / 15) * 10
        currentScore = (100 - scoreLoss).coerceIn(0, 100)
        
        updateFloatingView()
    }
    
    private fun updateFloatingView() {
        scoreTextView?.text = currentScore.toString()
        timerTextView?.text = formatTime(timeInApp)
        circleView?.updateScore(currentScore, timeInApp)
    }
    
    private fun formatTime(ms: Long): String {
        val minutes = (ms / 1000) / 60
        val seconds = (ms / 1000) % 60
        return String.format("%02d:%02d", minutes, seconds)
    }
    
    private fun removeFloatingView() {
        floatingView?.let {
            windowManager?.removeView(it)
        }
        floatingView = null
    }
    
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Brain Score Monitor",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows your current brain health score"
                setShowBadge(false)
            }
            
            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
        }
    }
    
    private fun createNotification(): Notification {
        val intent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_IMMUTABLE
        )
        
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Monitoring: $appName")
            .setContentText("Brain Score: $currentScore")
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }
    
    override fun onDestroy() {
        super.onDestroy()
        updateHandler.removeCallbacks(updateRunnable)
        removeFloatingView()
    }
    
    override fun onBind(intent: Intent?): IBinder? = null
}

// Custom View for animated score circle
class ScoreCircleView @JvmOverloads constructor(
    context: Context,
    attrs: android.util.AttributeSet? = null,
    defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {
    
    private var currentScore = 100
    private var timeInAppMs = 0L
    private var animationProgress = 0f
    
    private val backgroundPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 12f
        color = Color.parseColor("#E5E7EB")
    }
    
    private val scorePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 12f
        strokeCap = Paint.Cap.ROUND
    }
    
    private val brainPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = 36f
        textAlign = Paint.Align.CENTER
    }
    
    private val rect = RectF()
    
    fun updateScore(score: Int, timeMs: Long) {
        currentScore = score
        timeInAppMs = timeMs
        
        // Update color based on score
        scorePaint.color = when {
            score >= 80 -> Color.parseColor("#10B981") // Green
            score >= 60 -> Color.parseColor("#F59E0B") // Orange
            score >= 40 -> Color.parseColor("#EF4444") // Red
            else -> Color.parseColor("#DC2626") // Dark red
        }
        
        invalidate()
    }
    
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        
        val size = min(width, height).toFloat()
        val padding = 16f
        rect.set(padding, padding, size - padding, size - padding)
        
        // Draw background circle
        canvas.drawArc(rect, 0f, 360f, false, backgroundPaint)
        
        // Draw score arc (from top, clockwise)
        val sweepAngle = (currentScore / 100f) * 360f
        canvas.drawArc(rect, -90f, sweepAngle, false, scorePaint)
        
        // Draw brain emoji with animation
        val minutes = (timeInAppMs / 1000 / 60).toInt()
        val brainEmoji = when {
            minutes < 15 -> "🧠"
            minutes < 30 -> "😐"
            minutes < 45 -> "😟"
            minutes < 60 -> "😣"
            else -> "🤯"
        }
        
        canvas.drawText(
            brainEmoji,
            size / 2,
            size / 2 + brainPaint.textSize / 3,
            brainPaint
        )
    }
    
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val size = 120 // dp
        val px = (size * resources.displayMetrics.density).toInt()
        setMeasuredDimension(px, px)
    }
}