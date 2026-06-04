package com.soumikganguly.brainrot

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context

class BrainScoreWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        super.onUpdate(context, appWidgetManager, appWidgetIds)
        BrainScoreWidgetUpdater.updateAll(context)
    }

    override fun onEnabled(context: Context) {
        super.onEnabled(context)
        BrainScoreWidgetUpdater.updateAll(context)
    }
}
