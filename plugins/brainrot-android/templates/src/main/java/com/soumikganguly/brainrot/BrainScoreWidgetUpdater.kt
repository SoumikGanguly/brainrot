package com.soumikganguly.brainrot

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object BrainScoreWidgetUpdater {
    fun updateAll(context: Context) {
        val appWidgetManager = AppWidgetManager.getInstance(context)
        val componentName = ComponentName(context, BrainScoreWidgetProvider::class.java)
        val appWidgetIds = appWidgetManager.getAppWidgetIds(componentName)
        if (appWidgetIds.isEmpty()) {
            return
        }

        appWidgetIds.forEach { appWidgetId ->
            appWidgetManager.updateAppWidget(appWidgetId, buildRemoteViews(context))
        }
    }

    fun buildRemoteViews(context: Context): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.brain_score_widget)
        val state = readWidgetState(context)
        views.setTextViewText(R.id.widget_title, "Brain Score")
        views.setTextViewText(R.id.widget_score, state.scoreLabel)
        views.setTextColor(R.id.widget_score, Color.parseColor(state.scoreColor))
        views.setImageViewResource(R.id.widget_image, R.drawable.widget_illustration)

        val launchIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val pendingIntent = PendingIntent.getActivity(context, 1002, launchIntent, flags)
        views.setOnClickPendingIntent(R.id.widget_root, pendingIntent)

        return views
    }

    private fun readWidgetState(context: Context): WidgetState {
        val prefs = context.getSharedPreferences("brainrot_prefs", Context.MODE_PRIVATE)
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        val summaryDate = prefs.getString("daily_summary_date", null)

        if (summaryDate == today) {
            val summaryScore = prefs.getInt("daily_summary_brain_score", -1)
            if (summaryScore >= 0) {
                return WidgetState(
                    scoreLabel = summaryScore.toString(),
                    scoreColor = getScoreColor(summaryScore)
                )
            }
        }

        val fallbackScore = prefs.getInt("brain_score_value", -1)
        return WidgetState(
            scoreLabel = if (fallbackScore >= 0) fallbackScore.toString() else "--",
            scoreColor = if (fallbackScore >= 0) getScoreColor(fallbackScore) else "#5D3DF0"
        )
    }

    private fun getScoreColor(score: Int): String {
        return when {
            score >= 90 -> "#16A34A"
            score >= 70 -> "#F59E0B"
            score >= 50 -> "#F97316"
            else -> "#EF4444"
        }
    }

    private data class WidgetState(
        val scoreLabel: String,
        val scoreColor: String
    )
}
