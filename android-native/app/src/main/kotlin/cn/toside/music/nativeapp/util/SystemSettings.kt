package cn.toside.music.nativeapp.util

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings

/**
 * 电池优化豁免 / 通知权限 —— RN `utils/BatteryOptimizationUtil.java` +
 * `NotificationPermissionUtil.java` 的等价物。
 *
 * minSdk 26 全部落在 Android 8+，Java 版里 M/O 的版本分支不再保留。
 * 设置页入口按 B5 接线，届时直接调用本对象。
 */
object SystemSettings {
    fun isIgnoringBatteryOptimization(context: Context): Boolean {
        val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
        return pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    /** true：已忽略或成功拉起系统页；false：ROM 不支持或拉起失败。 */
    fun requestIgnoreBatteryOptimization(context: Context): Boolean {
        if (isIgnoringBatteryOptimization(context)) return true
        val intent =
            Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                .setData(Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return startIfResolvable(context, intent)
    }

    /** 与 RN 版一致：应用总开关打开且所有通知通道都不是 IMPORTANCE_NONE。 */
    fun isNotificationsEnabled(context: Context): Boolean {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return false
        if (!manager.areNotificationsEnabled()) return false
        val channels =
            runCatching { manager.notificationChannels }.getOrNull()
                ?: return true
        return channels.none { it.importance == NotificationManager.IMPORTANCE_NONE }
    }

    /** true：系统设置页已拉起；false：ROM 没有对应页面或拉起失败。 */
    fun openNotificationSettings(context: Context): Boolean {
        val intent =
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return startIfResolvable(context, intent)
    }

    private fun startIfResolvable(
        context: Context,
        intent: Intent,
    ): Boolean {
        // 有些 ROM 不实现这两个设置页，先探活再启动，避免无响应
        val resolvable =
            context.packageManager
                .queryIntentActivities(intent, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY)
                .isNotEmpty()
        if (!resolvable) return false
        return runCatching { context.startActivity(intent) }.isSuccess
    }
}
