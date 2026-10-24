package cn.toside.music.nativeapp.cache

import android.content.Context
import java.io.File

/**
 * 应用缓存大小 / 清理 —— 对照 RN `android/.../cache/CacheModule.java`。
 *
 * 注意：这里的 cacheDir 与应用数据（filesDir，含 TrackPlayer 音频缓存、DataStore）无关，
 * 清缓存不会动播放器预热下来的音频字节。
 * 设置页入口按 B5 的列表接线，届时直接调用本对象。
 */
object AppCache {
    // 原生壳没有 WebView，但这几个库是 RN 侧历史清理项；保持同一份清理清单，双版本行为一致
    private val WEBVIEW_DATABASES =
        listOf(
            "webview.db",
            "webview.db-shm",
            "webview.db-wal",
            "webviewCache.db",
            "webviewCache.db-shm",
            "webviewCache.db-wal",
        )

    /** cacheDir + externalCacheDir 的字节数（RN getAppCacheSize 同口径）。 */
    fun getAppCacheSize(context: Context): Long {
        var size = directorySize(context.cacheDir)
        size += directorySize(context.externalCacheDir)
        return size
    }

    /** 清 WebView 库 + cacheDir / externalCacheDir 下的全部子项（RN clearAppCache 同口径）。 */
    fun clearAppCache(context: Context) {
        WEBVIEW_DATABASES.forEach { context.deleteDatabase(it) }
        clearCacheFolder(context.cacheDir)
        clearCacheFolder(context.externalCacheDir)
    }

    private fun directorySize(dir: File?): Long {
        if (dir == null || !dir.isDirectory) return 0L
        return dir.walkBottomUp().filter { it.isFile }.sumOf { it.length() }
    }

    private fun clearCacheFolder(dir: File?) {
        if (dir == null || !dir.isDirectory) return
        dir.listFiles()?.forEach { it.deleteRecursively() }
    }
}
