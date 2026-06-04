package com.soumikganguly.brainrot

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.view.Gravity
import android.util.Log
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

class BlockingOverlayService : Service() {
    companion object {
        private const val TAG = "BlockingOverlayService"
    }

    private var windowManager: WindowManager? = null
    private var overlayView: View? = null
    private val uiHandler = Handler(Looper.getMainLooper())
    private val notificationId = 2001
    private val channelId = "blocking_overlay_channel"

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(notificationId, createNotification())
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
                channelId,
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
        return NotificationCompat.Builder(this, channelId)
            .setContentTitle("Focus protection active")
            .setContentText("Protecting your attention")
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build()
    }

    private fun showBlockingOverlay(appName: String, mode: String, packageName: String) {
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        removeOverlay()

        val layoutParams = WindowManager.LayoutParams().apply {
            width = WindowManager.LayoutParams.MATCH_PARENT
            height = WindowManager.LayoutParams.MATCH_PARENT
            type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            } else {
                @Suppress("DEPRECATION")
                WindowManager.LayoutParams.TYPE_SYSTEM_ALERT
            }
            flags = WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_FULLSCREEN
            format = PixelFormat.TRANSLUCENT
            gravity = Gravity.CENTER

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                blurBehindRadius = dp(28)
                flags = flags or WindowManager.LayoutParams.FLAG_BLUR_BEHIND
            }
        }

        overlayView = createOverlayView(appName, mode, packageName)

        try {
            windowManager?.addView(overlayView, layoutParams)
        } catch (e: Exception) {
            e.printStackTrace()
            stopSelf()
        }
    }

    private fun createOverlayView(appName: String, mode: String, packageName: String): View {
        val snapshot = getUsageSnapshot(packageName)
        val remainingBypasses = getRemainingBypasses(packageName)
        val brainState = getBrainState()
        logBlockEvent(
            packageName = packageName,
            appName = appName,
            blockType = if (mode == "hard") "hard_block" else "soft_block",
            limitMs = if (mode == "soft") getSoftBlockIntervalMinutes() * 60 * 1000L else null,
            usageAtTriggerMs = snapshot.totalTodayMs,
            action = "blocked",
            resolvedAt = null
        )
        val overlay = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#99000000"))
            isClickable = true
            isFocusable = true
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
            contentDescription = if (mode == "hard") "Lock mode active for $appName" else "Pause screen active for $appName"
        }

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(24), dp(24), dp(24))
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp(28).toFloat()
                setColor(Color.parseColor("#E61B1F28"))
                setStroke(dp(1), Color.parseColor("#33FFFFFF"))
            }
            elevation = dp(16).toFloat()
            clipToOutline = true
            outlineProvider = ViewOutlineProvider.BACKGROUND
        }

        val cardParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = Gravity.CENTER
            leftMargin = dp(24)
            rightMargin = dp(24)
        }

        val accentColor = if (mode == "hard") Color.parseColor("#B85C5C") else Color.parseColor("#B8864A")
        val ghostColor = Color.parseColor("#1FFFFFFF")
        val secondaryText = Color.parseColor("#D7DEE7")
        val tertiaryText = Color.parseColor("#B7C1CB")

        val iconView = ImageView(this).apply {
            setImageResource(android.R.drawable.ic_lock_lock)
            setColorFilter(Color.WHITE)
            layoutParams = LinearLayout.LayoutParams(dp(44), dp(44)).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                bottomMargin = dp(16)
            }
        }
        card.addView(iconView)

        val statusPill = createStatusPill(brainState.status, brainState.score)
        card.addView(statusPill)

        val titleText = buildText(
            text = if (mode == "hard") "Locked" else "Pause",
            sizeSp = 28f,
            color = Color.WHITE,
            bold = true,
            bottomMarginDp = 10,
            gravity = Gravity.CENTER
        )
        card.addView(titleText)

        val subtitleText = buildText(
            text = if (mode == "hard") {
                "You opened $appName again."
            } else {
                "You opened $appName again."
            },
            sizeSp = 18f,
            color = Color.WHITE,
            bold = true,
            bottomMarginDp = 10,
            gravity = Gravity.CENTER
        )
        card.addView(subtitleText)

        val messageText = buildText(
            text = if (mode == "hard") getHardMessage(appName) else getSoftMessage(appName),
            sizeSp = 16f,
            color = secondaryText,
            bottomMarginDp = 14,
            gravity = Gravity.CENTER
        )
        card.addView(messageText)

        val statsText = buildText(
            text = "Opened ${snapshot.opensToday} times today  |  Last session: ${snapshot.lastSessionMinutes} mins",
            sizeSp = 14f,
            color = tertiaryText,
            bottomMarginDp = 10,
            gravity = Gravity.CENTER
        )
        card.addView(statsText)

        if (mode == "hard") {
            val lockInfo = buildText(
                text = getLockEndText(),
                sizeSp = 14f,
                color = tertiaryText,
                bottomMarginDp = 22,
                gravity = Gravity.CENTER
            )
            card.addView(lockInfo)
        } else {
            val sessionInfo = buildText(
                text = "Tap open and we'll throw this screen back at you in ${getSoftBlockIntervalMinutes()} min.",
                sizeSp = 14f,
                color = tertiaryText,
                bottomMarginDp = 22,
                gravity = Gravity.CENTER
            )
            card.addView(sessionInfo)
        }

        if (mode == "soft") {
            val softPrimary = createCountdownButton(appName, packageName, accentColor) {
                startSoftCooldown(packageName)
                logBlockEvent(
                    packageName = packageName,
                    appName = appName,
                    blockType = "soft_block",
                    limitMs = getSoftBlockIntervalMinutes() * 60 * 1000L,
                    usageAtTriggerMs = snapshot.totalTodayMs,
                    action = "cooldown_started",
                    resolvedAt = nowIso()
                )
                launchBlockedApp(packageName)
                removeOverlay()
                stopSelf()
            }
            card.addView(softPrimary)

            card.addView(
                createGhostButton(
                    text = "Actually, Never Mind",
                    textColor = secondaryText,
                    backgroundColor = ghostColor,
                    topMarginDp = 12,
                    minHeightDp = 54
                ) {
                    logBlockEvent(
                        packageName = packageName,
                        appName = appName,
                        blockType = "soft_block",
                        limitMs = getSoftBlockIntervalMinutes() * 60 * 1000L,
                        usageAtTriggerMs = snapshot.totalTodayMs,
                        action = "abandoned",
                        resolvedAt = nowIso()
                    )
                    goHomeAndClose()
                }
            )
        } else {
            card.addView(
                createPrimaryButton(
                    text = "Go Back",
                    backgroundColor = accentColor,
                    topMarginDp = 0,
                    minHeightDp = 56
                ) {
                    logBlockEvent(
                        packageName = packageName,
                        appName = appName,
                        blockType = "hard_block",
                        limitMs = null,
                        usageAtTriggerMs = snapshot.totalTodayMs,
                        action = "abandoned",
                        resolvedAt = nowIso()
                    )
                    goHomeAndClose()
                }
            )

            if (remainingBypasses > 0) {
                card.addView(
                    createGhostButton(
                        text = "Emergency Pass ($remainingBypasses left)",
                        textColor = tertiaryText,
                    backgroundColor = ghostColor,
                    topMarginDp = 12,
                    minHeightDp = 46
                ) {
                    activateEmergencyPass(packageName)
                    logBlockEvent(
                        packageName = packageName,
                        appName = appName,
                        blockType = "hard_block",
                        limitMs = null,
                        usageAtTriggerMs = snapshot.totalTodayMs,
                        action = "bypassed",
                        resolvedAt = nowIso()
                    )
                    launchBlockedApp(packageName)
                    removeOverlay()
                    stopSelf()
                }
            )
            }

            card.addView(
                createTextAction(
                    text = "Open Brainrot",
                    textColor = secondaryText,
                    topMarginDp = 12
                ) {
                    logBlockEvent(
                        packageName = packageName,
                        appName = appName,
                        blockType = "hard_block",
                        limitMs = null,
                        usageAtTriggerMs = snapshot.totalTodayMs,
                        action = "accountability_requested",
                        resolvedAt = nowIso()
                    )
                    val launchIntent = packageManager.getLaunchIntentForPackage(applicationContext.packageName)
                    launchIntent?.let {
                        it.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                        startActivity(it)
                    }
                    removeOverlay()
                    stopSelf()
                }
            )
        }

        overlay.addView(card, cardParams)

        overlay.setOnTouchListener { _, _ ->
            if (mode == "hard") {
                overlay.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
            }
            true
        }

        if (animationsEnabled()) {
            overlay.alpha = 0f
            card.scaleX = 0.96f
            card.scaleY = 0.96f
            overlay.animate().alpha(1f).setDuration(180).start()
            card.animate().scaleX(1f).scaleY(1f).setDuration(220).start()
            startBreathingAnimation(iconView)
        }

        return overlay
    }

    private fun createStatusPill(status: String, score: Int): View {
        return TextView(this).apply {
            text = "$status $score"
            setTextColor(Color.WHITE)
            textSize = 16f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp(999).toFloat()
                setColor(Color.parseColor("#1FFFFFFF"))
                setStroke(dp(1), Color.parseColor("#2FFFFFFF"))
            }
            setPadding(dp(14), dp(8), dp(14), dp(8))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                bottomMargin = dp(16)
            }
        }
    }

    private fun createPrimaryButton(
        text: String,
        backgroundColor: Int,
        topMarginDp: Int,
        minHeightDp: Int,
        onClick: () -> Unit
    ): TextView {
        return TextView(this).apply {
            this.text = text
            setTextColor(Color.WHITE)
            textSize = 16f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            minHeight = dp(minHeightDp)
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp(20).toFloat()
                setColor(backgroundColor)
            }
            setPadding(dp(18), dp(14), dp(18), dp(14))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = dp(topMarginDp)
            }
            setOnClickListener { onClick() }
        }
    }

    private fun createCountdownButton(
        appName: String,
        packageName: String,
        accentColor: Int,
        onFinishedPress: () -> Unit
    ): View {
        val container = FrameLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(56)
            )
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp(20).toFloat()
                setColor(Color.parseColor("#14FFFFFF"))
                setStroke(dp(1), Color.parseColor("#33FFFFFF"))
            }
            isClickable = true
            isFocusable = true
        }

        val progress = View(this).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp(20).toFloat()
                setColor(adjustAlpha(accentColor, 0.42f))
            }
        }
        container.addView(progress, FrameLayout.LayoutParams(0, FrameLayout.LayoutParams.MATCH_PARENT))

        val label = TextView(this).apply {
            text = "Sit with that urge for 8s"
            setTextColor(Color.WHITE)
            textSize = 16f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        }
        container.addView(label)

        val durationMs = 8_000L
        val startedAt = System.currentTimeMillis()
        var unlocked = false
        Log.d(TAG, "Soft block countdown started for $packageName")

        val runnable = object : Runnable {
            override fun run() {
                val elapsed = System.currentTimeMillis() - startedAt
                val progressValue = (elapsed.coerceAtMost(durationMs)).toFloat() / durationMs.toFloat()
                val remainingSeconds = ((durationMs - elapsed).coerceAtLeast(0) / 1000L).toInt()

                container.post {
                    val width = container.width
                    if (width > 0) {
                        progress.layoutParams = (progress.layoutParams as FrameLayout.LayoutParams).apply {
                            this.width = (width * progressValue).toInt()
                        }
                        progress.requestLayout()
                    }
                }

                if (elapsed >= durationMs) {
                    unlocked = true
                    label.text = "Fine. Open App"
                    container.background = GradientDrawable().apply {
                        shape = GradientDrawable.RECTANGLE
                        cornerRadius = dp(20).toFloat()
                        setColor(accentColor)
                    }
                    container.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                    return
                }

                label.text = if (remainingSeconds >= 8) {
                    "Sit with that urge for 8s"
                } else {
                    "Still want it? ${remainingSeconds + 1}s"
                }
                uiHandler.postDelayed(this, 100L)
            }
        }

        uiHandler.post(runnable)

        container.setOnClickListener {
            if (unlocked) {
                onFinishedPress()
            } else {
                container.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
            }
        }

        return container
    }

    private fun createGhostButton(
        text: String,
        textColor: Int,
        backgroundColor: Int,
        topMarginDp: Int,
        minHeightDp: Int,
        onClick: () -> Unit
    ): TextView {
        return TextView(this).apply {
            this.text = text
            setTextColor(textColor)
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            minHeight = dp(minHeightDp)
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp(18).toFloat()
                setColor(backgroundColor)
                setStroke(dp(1), Color.parseColor("#26FFFFFF"))
            }
            setPadding(dp(16), dp(12), dp(16), dp(12))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = dp(topMarginDp)
            }
            setOnClickListener { onClick() }
        }
    }

    private fun createTextAction(
        text: String,
        textColor: Int,
        topMarginDp: Int,
        onClick: () -> Unit
    ): TextView {
        return TextView(this).apply {
            this.text = text
            setTextColor(textColor)
            textSize = 13f
            gravity = Gravity.CENTER
            setPadding(dp(8), dp(6), dp(8), dp(6))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = dp(topMarginDp)
            }
            setOnClickListener { onClick() }
        }
    }

    private fun buildText(
        text: String,
        sizeSp: Float,
        color: Int,
        bold: Boolean = false,
        bottomMarginDp: Int = 0,
        gravity: Int = Gravity.START
    ): TextView {
        return TextView(this).apply {
            this.text = text
            textSize = sizeSp
            setTextColor(color)
            this.gravity = gravity
            if (bold) {
                typeface = Typeface.DEFAULT_BOLD
            }
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dp(bottomMarginDp)
            }
        }
    }

    private fun getSoftMessage(appName: String): String {
        val options = listOf(
            "Oh nice, we're doing the little relapse thing again.",
            "You fought this hard just to open $appName again. Inspiring.",
            "This was definitely urgent and not just a bored thumb.",
            "Go ahead. Pretend this one tap won't turn into a scroll spiral."
        )
        return options[(appName.length + Calendar.getInstance().get(Calendar.MINUTE)) % options.size]
    }

    private fun getHardMessage(appName: String): String {
        val options = listOf(
            "Nope. You set a boundary. Try respecting your own decisions.",
            "Emergency means emergency, not 'I miss doomscrolling.'",
            "Distraction denied. Humiliating, but necessary."
        )
        return options[(appName.length + Calendar.getInstance().get(Calendar.DAY_OF_YEAR)) % options.size]
    }

    private fun getSoftBlockIntervalMinutes(): Int {
        val prefs = getSharedPreferences("brainrot_prefs", MODE_PRIVATE)
        val configString = prefs.getString("blocking_config", "{}") ?: "{}"
        return runCatching { JSONObject(configString).optInt("softBlockIntervalMinutes", 15) }
            .getOrDefault(15)
            .coerceAtLeast(1)
    }

    private fun getLockEndText(): String {
        val prefs = getSharedPreferences("brainrot_prefs", MODE_PRIVATE)
        val configString = prefs.getString("blocking_config", "{}") ?: "{}"
        val config = runCatching { JSONObject(configString) }.getOrNull() ?: return "Locked until you change your settings"

        if (!config.optBoolean("scheduleEnabled", false)) {
            return "Locked until you change your settings"
        }

        val end = config.optString("scheduleEnd", "06:00")
        return "Locked until ${formatClockTime(end)}"
    }

    private fun formatClockTime(value: String): String {
        return runCatching {
            val parser = SimpleDateFormat("HH:mm", Locale.US)
            val formatter = SimpleDateFormat("h:mm a", Locale.US)
            formatter.format(parser.parse(value) ?: Date())
        }.getOrDefault(value)
    }

    private data class UsageSnapshot(
        val opensToday: Int,
        val lastSessionMinutes: Long,
        val currentSessionMinutes: Long,
        val totalTodayMs: Long
    )

    private fun getUsageSnapshot(packageName: String): UsageSnapshot {
        return try {
            val usageStatsManager = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val now = System.currentTimeMillis()
            val startOfDay = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }.timeInMillis

            val events = usageStatsManager.queryEvents(startOfDay, now)
            val event = UsageEvents.Event()
            var opens = 0
            var currentStart: Long? = null
            var lastSessionMs = 0L

            while (events.hasNextEvent()) {
                events.getNextEvent(event)
                if (event.packageName != packageName) {
                    continue
                }

                when (event.eventType) {
                    UsageEvents.Event.MOVE_TO_FOREGROUND -> {
                        opens += 1
                        currentStart = event.timeStamp
                    }

                    UsageEvents.Event.MOVE_TO_BACKGROUND -> {
                        currentStart?.let { start ->
                            if (event.timeStamp > start) {
                                lastSessionMs = event.timeStamp - start
                            }
                        }
                        currentStart = null
                    }
                }
            }

            val currentSessionMs = currentStart?.let { now - it } ?: 0L

            UsageSnapshot(
                opensToday = opens.coerceAtLeast(1),
                lastSessionMinutes = (lastSessionMs / 60000L).coerceAtLeast(1),
                currentSessionMinutes = (currentSessionMs / 60000L).coerceAtLeast(1),
                totalTodayMs = getTotalUsageToday(packageName)
            )
        } catch (_: Exception) {
            UsageSnapshot(1, 5, 1, 0L)
        }
    }

    private fun getTotalUsageToday(packageName: String): Long {
        return try {
            val usageStatsManager = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val startOfDay = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }.timeInMillis
            val stats = usageStatsManager.queryUsageStats(
                UsageStatsManager.INTERVAL_DAILY,
                startOfDay,
                System.currentTimeMillis()
            )
            stats?.firstOrNull { it.packageName == packageName }?.totalTimeInForeground ?: 0L
        } catch (_: Exception) {
            0L
        }
    }

    private fun getRemainingBypasses(packageName: String): Int {
        val prefs = getSharedPreferences("brainrot_prefs", MODE_PRIVATE)
        val configString = prefs.getString("blocking_config", "{}") ?: "{}"
        val bypassLimit = runCatching { JSONObject(configString).optInt("bypassLimit", 0) }.getOrDefault(0)
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        val currentCount = prefs.getInt("bypass_count_${packageName}_$today", 0)
        return (bypassLimit - currentCount).coerceAtLeast(0)
    }

    private fun getBrainState(): UsageChecker.BrainState {
        return try {
            UsageChecker(this).getCurrentBrainState(forceRefresh = true)
        } catch (_: Exception) {
            UsageChecker.BrainState(100, "Focused")
        }
    }

    private fun activateEmergencyPass(packageName: String) {
        val prefs = getSharedPreferences("brainrot_prefs", MODE_PRIVATE)
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        val key = "bypass_count_${packageName}_$today"
        val currentCount = prefs.getInt(key, 0)
        prefs.edit()
            .putInt(key, currentCount + 1)
            .putString("emergency_pass_pending_package", packageName)
            .remove("emergency_pass_active_package")
            .apply()
        Log.d(TAG, "Emergency pass armed for $packageName")
    }

    private fun startSoftCooldown(packageName: String) {
        val intervalMinutes = getSoftBlockIntervalMinutes()
        val cooldownUntil = System.currentTimeMillis() + intervalMinutes * 60 * 1000L
        getSharedPreferences("brainrot_prefs", MODE_PRIVATE)
            .edit()
            .putLong("soft_block_cooldown_until_$packageName", cooldownUntil)
            .apply()
        Log.d(TAG, "Soft block cooldown started for $packageName for $intervalMinutes minutes")
    }

    private fun logBlockEvent(
        packageName: String,
        appName: String,
        blockType: String,
        limitMs: Long?,
        usageAtTriggerMs: Long?,
        action: String,
        resolvedAt: String?
    ) {
        try {
            val prefs = getSharedPreferences("brainrot_prefs", MODE_PRIVATE)
            val existing = prefs.getString("pending_block_events", "[]") ?: "[]"
            val events = runCatching { JSONArray(existing) }.getOrElse { JSONArray() }
            val event = JSONObject().apply {
                put("date", SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date()))
                put("packageName", packageName)
                put("appName", appName)
                put("triggeredAt", nowIso())
                put("blockType", blockType)
                if (limitMs != null) put("limitMs", limitMs) else put("limitMs", JSONObject.NULL)
                if (usageAtTriggerMs != null) put("usageAtTriggerMs", usageAtTriggerMs) else put("usageAtTriggerMs", JSONObject.NULL)
                put("action", action)
                if (resolvedAt != null) put("resolvedAt", resolvedAt) else put("resolvedAt", JSONObject.NULL)
                put("source", "native_overlay")
            }
            events.put(event)
            val dateKey = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
            val counterKey = "block_event_count_${action}_$dateKey"
            val currentCount = prefs.getInt(counterKey, 0)
            prefs.edit()
                .putString("pending_block_events", events.toString())
                .putInt(counterKey, currentCount + 1)
                .apply()
        } catch (error: Exception) {
            Log.e(TAG, "Failed to queue block event", error)
        }
    }

    private fun nowIso(): String {
        return SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US).format(Date())
    }

    private fun launchBlockedApp(packageName: String) {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        launchIntent?.let {
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            it.addFlags(Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
            startActivity(it)
        }
    }

    private fun goHomeAndClose() {
        val homeIntent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        startActivity(homeIntent)
        removeOverlay()
        stopSelf()
    }

    private fun startBreathingAnimation(view: View) {
        if (!animationsEnabled()) {
            return
        }

        view.animate()
            .scaleX(1.06f)
            .scaleY(1.06f)
            .setDuration(1200)
            .withEndAction {
                view.animate()
                    .scaleX(1f)
                    .scaleY(1f)
                    .setDuration(1200)
                    .withEndAction { startBreathingAnimation(view) }
                    .start()
            }
            .start()
    }

    private fun animationsEnabled(): Boolean = true

    private fun adjustAlpha(color: Int, factor: Float): Int {
        val alpha = (Color.alpha(color) * factor).toInt()
        return Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color))
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }

    private fun removeOverlay() {
        uiHandler.removeCallbacksAndMessages(null)
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
