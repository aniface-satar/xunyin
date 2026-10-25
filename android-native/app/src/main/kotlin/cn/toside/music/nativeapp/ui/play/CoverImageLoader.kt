package cn.toside.music.nativeapp.ui.play

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** 封面位图：`blurSource` 是极小尺寸副本，低版本没有 RenderEffect 时靠它放大糊成背景。 */
data class CoverArt(
    val cover: ImageBitmap,
    val blurSource: ImageBitmap?,
)

/**
 * 播放页封面加载（B4 临时的纯网络实现 → Wave4 Lane C 补磁盘缓存/校验）。
 *
 * RN 侧 `getPicPath` 只负责按歌曲来源解析封面地址，图片缓存由 Fresco 内部完成，
 * 没有显式的缓存目录规则；原生自建同级能力：
 * - 内存 LRU 6 张（保持 B4 既有行为）；
 * - 磁盘缓存 `cacheDir/cover_images/<sha1(url)>.cover`，存下载到的原始字节，
 *   解码仍按最长边 1200 / `RGB_565` 采样；
 * - 磁盘文件解不出图视为损坏，删除后回源重下；写入用临时文件 + rename，避免半截文件；
 * - 超过 [MAX_DISK_FILES] 张按最后修改时间淘汰最旧。
 *
 * [init] 未调用时退化为纯内存 + 网络（与 B4 等价）。任何失败都返回 null，由界面显示占位图。
 */
object CoverImageLoader {
    private const val MAX_COVER_SIZE = 1200
    private const val BLUR_SIZE = 32
    private const val TIMEOUT_MS = 10_000
    private const val DISK_DIR = "cover_images"
    private const val MAX_DISK_FILES = 300
    private val cache = LruCache<String, CoverArt>(6)

    @Volatile
    private var appContext: Context? = null

    /** 应用启动时调用一次；只需 applicationContext，不会持有 Activity。 */
    fun init(context: Context) {
        appContext = context.applicationContext
    }

    suspend fun load(rawUrl: String?): CoverArt? {
        val url = normalizeUrl(rawUrl) ?: return null
        cache.get(url)?.let { return it }
        return withContext(Dispatchers.IO) {
            val bitmap = readFromDisk(url) ?: fetchAndCacheBytes(url)?.let { decodeBitmap(it) } ?: return@withContext null
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

    /** 磁盘命中：解码失败说明文件损坏，删掉并返回 null 让调用方回源。 */
    private fun readFromDisk(url: String): Bitmap? {
        val file = diskFile(url) ?: return null
        if (!file.exists()) return null
        val bitmap = runCatching { decodeBitmap(file.readBytes()) }.getOrNull()
        if (bitmap == null) {
            file.delete()
            return null
        }
        // 刷新 mtime：淘汰按最后使用时间近似
        file.setLastModified(System.currentTimeMillis())
        return bitmap
    }

    private fun fetchAndCacheBytes(url: String): ByteArray? = runCatching { fetchBytes(url) }.getOrNull()?.also { writeDisk(url, it) }

    private fun fetchBytes(url: String): ByteArray {
        val connection =
            (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                instanceFollowRedirects = true
                setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36")
            }
        try {
            if (connection.responseCode !in 200..299) throw IllegalStateException("cover http ${connection.responseCode}")
            return connection.inputStream.use { it.readBytes() }
        } finally {
            connection.disconnect()
        }
    }

    private fun decodeBitmap(bytes: ByteArray): Bitmap? {
        if (bytes.isEmpty()) return null
        val bounds =
            BitmapFactory.Options().apply {
                inJustDecodeBounds = true
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, this)
            }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        val options =
            BitmapFactory.Options().apply {
                inSampleSize = calculateSampleSize(bounds.outWidth, bounds.outHeight)
                inPreferredConfig = Bitmap.Config.RGB_565
            }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
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

    private fun diskFile(url: String): File? {
        val context = appContext ?: return null
        val dir = File(context.cacheDir, DISK_DIR)
        if (!dir.isDirectory && !dir.mkdirs()) return null
        return File(dir, "${sha1(url)}.cover")
    }

    private fun writeDisk(
        url: String,
        bytes: ByteArray,
    ) {
        val file = diskFile(url) ?: return
        val dir = file.parentFile ?: return
        runCatching {
            val tmp = File(dir, "${file.name}.${System.nanoTime()}.tmp")
            tmp.writeBytes(bytes)
            if (!tmp.renameTo(file)) {
                file.delete()
                if (!tmp.renameTo(file)) tmp.delete()
            }
            pruneDisk(dir)
        }
    }

    private fun pruneDisk(dir: File) {
        val files = dir.listFiles()?.filter { it.isFile } ?: return
        if (files.size <= MAX_DISK_FILES) return
        files.sortedBy { it.lastModified() }.take(files.size - MAX_DISK_FILES).forEach { it.delete() }
    }

    private fun sha1(value: String): String =
        MessageDigest
            .getInstance("SHA-1")
            .digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
}
