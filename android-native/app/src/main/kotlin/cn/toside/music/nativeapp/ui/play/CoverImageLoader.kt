package cn.toside.music.nativeapp.ui.play

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

/** 封面位图：`blurSource` 是极小尺寸副本，低版本没有 RenderEffect 时靠它放大糊成背景。 */
data class CoverArt(
    val cover: ImageBitmap,
    val blurSource: ImageBitmap?,
)

/**
 * 播放页封面加载（B4 临时实现）。
 *
 * RN 侧 `getPicPath` 会校验/缓存封面地址；原生版先用 `meta.picUrl` 直接取，
 * 失败交给占位图。B5 接入列表与缓存模块时再补磁盘缓存。
 */
object CoverImageLoader {
    private const val MAX_COVER_SIZE = 1200
    private const val BLUR_SIZE = 32
    private const val TIMEOUT_MS = 10_000
    private val cache = LruCache<String, CoverArt>(6)

    suspend fun load(rawUrl: String?): CoverArt? {
        val url = normalizeUrl(rawUrl) ?: return null
        cache.get(url)?.let { return it }
        return withContext(Dispatchers.IO) {
            val bitmap = runCatching { fetchBitmap(url) }.getOrNull() ?: return@withContext null
            val art =
                CoverArt(
                    cover = bitmap.asImageBitmap(),
                    blurSource = runCatching { Bitmap.createScaledBitmap(bitmap, BLUR_SIZE, BLUR_SIZE, true).asImageBitmap() }.getOrNull(),
                )
            cache.put(url, art)
            art
        }
    }

    private fun normalizeUrl(rawUrl: String?): String? {
        val url = rawUrl?.trim().orEmpty()
        if (url.isEmpty()) return null
        return when {
            url.startsWith("//") -> "https:$url"
            url.startsWith("http://") || url.startsWith("https://") -> url
            else -> null
        }
    }

    private fun fetchBitmap(url: String): Bitmap {
        val connection =
            (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                instanceFollowRedirects = true
                setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36")
            }
        try {
            if (connection.responseCode !in 200..299) throw IllegalStateException("cover http ${connection.responseCode}")
            val bytes = connection.inputStream.use { it.readBytes() }
            val bounds =
                BitmapFactory.Options().apply {
                    inJustDecodeBounds = true
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, this)
                }
            val sample = calculateSampleSize(bounds.outWidth, bounds.outHeight)
            val options =
                BitmapFactory.Options().apply {
                    inSampleSize = sample
                    inPreferredConfig = Bitmap.Config.RGB_565
                }
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                ?: throw IllegalStateException("cover decode failed")
        } finally {
            connection.disconnect()
        }
    }

    private fun calculateSampleSize(
        width: Int,
        height: Int,
    ): Int {
        var sample = 1
        var longest = maxOf(width, height)
        while (longest / sample > MAX_COVER_SIZE) sample *= 2
        return sample.coerceAtLeast(1)
    }
}
