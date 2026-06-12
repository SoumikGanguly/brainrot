package com.soumikganguly.brainrot

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context

object ForegroundAppResolver {
    private const val PREFS_NAME = "brainrot_prefs"
    private const val KEY_LAST_FOREGROUND_PACKAGE = "last_known_foreground_package"
    private const val KEY_LAST_FOREGROUND_AT = "last_known_foreground_at"
    private const val DEFAULT_RECENT_WINDOW_MS = 15_000L
    private const val DEFAULT_BOOTSTRAP_WINDOW_MS = 2 * 60 * 60 * 1000L

    data class Snapshot(
        val packageName: String?,
        val foregroundedAt: Long,
        val lastEventPackage: String?,
        val lastEventType: Int?,
        val lastEventAt: Long
    )

    fun recordForeground(
        context: Context,
        packageName: String,
        timestamp: Long = System.currentTimeMillis()
    ) {
        if (packageName.isBlank()) {
            return
        }

        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_LAST_FOREGROUND_PACKAGE, packageName)
            .putLong(KEY_LAST_FOREGROUND_AT, timestamp)
            .apply()
    }

    fun clearCachedForeground(context: Context, packageName: String? = null) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val cachedPackage = prefs.getString(KEY_LAST_FOREGROUND_PACKAGE, null)
        if (packageName != null && cachedPackage != packageName) {
            return
        }

        prefs.edit()
            .remove(KEY_LAST_FOREGROUND_PACKAGE)
            .remove(KEY_LAST_FOREGROUND_AT)
            .apply()
    }

    fun getCurrentForeground(
        context: Context,
        usageStatsManager: UsageStatsManager,
        recentWindowMs: Long = DEFAULT_RECENT_WINDOW_MS,
        bootstrapWindowMs: Long = DEFAULT_BOOTSTRAP_WINDOW_MS,
        ignoredPackages: Set<String> = setOf(context.packageName)
    ): Snapshot {
        val now = System.currentTimeMillis()
        val recentSnapshot = resolveFromEvents(
            usageStatsManager = usageStatsManager,
            startTime = now - recentWindowMs.coerceAtLeast(1L),
            endTime = now,
            ignoredPackages = ignoredPackages
        )
        if (recentSnapshot.packageName != null) {
            recordForeground(context, recentSnapshot.packageName, recentSnapshot.foregroundedAt)
            return recentSnapshot
        }

        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val cachedPackage = prefs.getString(KEY_LAST_FOREGROUND_PACKAGE, null)
        val cachedForegroundAt = prefs.getLong(KEY_LAST_FOREGROUND_AT, 0L)

        if (
            recentSnapshot.lastEventType == UsageEvents.Event.MOVE_TO_BACKGROUND &&
            recentSnapshot.lastEventPackage != null &&
            recentSnapshot.lastEventPackage == cachedPackage
        ) {
            clearCachedForeground(context, cachedPackage)
        } else if (cachedPackage != null && cachedForegroundAt > 0L) {
            return Snapshot(
                packageName = cachedPackage,
                foregroundedAt = cachedForegroundAt,
                lastEventPackage = recentSnapshot.lastEventPackage,
                lastEventType = recentSnapshot.lastEventType,
                lastEventAt = recentSnapshot.lastEventAt
            )
        }

        val bootstrapSnapshot = resolveFromEvents(
            usageStatsManager = usageStatsManager,
            startTime = now - bootstrapWindowMs.coerceAtLeast(recentWindowMs).coerceAtLeast(1L),
            endTime = now,
            ignoredPackages = ignoredPackages
        )
        if (bootstrapSnapshot.packageName != null) {
            recordForeground(context, bootstrapSnapshot.packageName, bootstrapSnapshot.foregroundedAt)
        }
        return bootstrapSnapshot
    }

    private fun resolveFromEvents(
        usageStatsManager: UsageStatsManager,
        startTime: Long,
        endTime: Long,
        ignoredPackages: Set<String>
    ): Snapshot {
        val events = usageStatsManager.queryEvents(startTime, endTime)
        val event = UsageEvents.Event()
        val lastForegroundByPackage = HashMap<String, Long>()
        val lastBackgroundByPackage = HashMap<String, Long>()
        var lastEventPackage: String? = null
        var lastEventType: Int? = null
        var lastEventAt = 0L

        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            val packageName = event.packageName ?: continue
            if (packageName in ignoredPackages) {
                continue
            }

            when (event.eventType) {
                UsageEvents.Event.MOVE_TO_FOREGROUND -> {
                    lastForegroundByPackage[packageName] = event.timeStamp
                }

                UsageEvents.Event.MOVE_TO_BACKGROUND -> {
                    lastBackgroundByPackage[packageName] = event.timeStamp
                }

                else -> continue
            }

            if (event.timeStamp >= lastEventAt) {
                lastEventAt = event.timeStamp
                lastEventPackage = packageName
                lastEventType = event.eventType
            }
        }

        val currentForeground = lastForegroundByPackage.entries
            .filter { (packageName, foregroundAt) ->
                foregroundAt > (lastBackgroundByPackage[packageName] ?: Long.MIN_VALUE)
            }
            .maxByOrNull { it.value }

        return Snapshot(
            packageName = currentForeground?.key,
            foregroundedAt = currentForeground?.value ?: 0L,
            lastEventPackage = lastEventPackage,
            lastEventType = lastEventType,
            lastEventAt = lastEventAt
        )
    }
}
