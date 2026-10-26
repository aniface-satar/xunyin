package cn.toside.music.nativeapp.ui.share

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.widget.Toast
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream

/**
 * 系统分享一张已落盘的分享卡（对照 RN `UtilsModule#shareImage`）。
 *
 * 与 RN 原生的三处差异，都是有意的：
 * 1. RN 走 FileProvider；Wave6 起这里同样走 FileProvider——分享卡先写
 *    `cacheDir/share_cache/<name>.png` 再以 `content://` 分享（W5-11：之前复用
 *    MediaStore 的 `content://`，分享一次相册就多一张图）。保存到相册仍走
 *    [ShareCardSaver]（MediaStore），那是用户明确要落相册的场景。
 * 2. 额外挂 `ClipData`：只给 `FLAG_GRANT_READ_URI_PERMISSION` 而不给 clipData 时，
 *    少数 ROM 的 chooser 不会把授权透给收端，微信会拿到一个读不了的 Uri。
 * 3. 分享目标为空/启动失败要给出可读提示（RN 只 reject，界面侧看不出发生了什么）。
 */
object ShareImageSender {
    private const val MIME_PNG = "image/png"

    /** 分享卡专用 cache 子目录（file_paths.xml 只暴露这一层）。 */
    private const val CACHE_DIR = "share_cache"

    /** 分享前清掉超过 24h 的旧缓存（分享目录自清理，不攒垃圾）。 */
    private const val CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000L

    enum class Result {
        SENT,
        NO_TARGET,
        FAILED,
    }

    /** 分享一张位图：写 `cacheDir/share_cache` → FileProvider `content://` → 系统分享。 */
    fun sendCard(
        context: Context,
        bitmap: Bitmap,
        baseName: String,
        chooserTitle: String,
        subject: String,
        text: String,
    ): Result =
        try {
            val dir = File(context.cacheDir, CACHE_DIR).apply { mkdirs() }
            cleanStaleCache(dir)
            val file = File(dir, "${baseName}_${System.currentTimeMillis()}.png")
            FileOutputStream(file).use { out ->
                if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)) {
                    throw IllegalStateException("png compress failed")
                }
            }
            val uri =
                FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            send(context, uri, chooserTitle, subject, text)
        } catch (t: Throwable) {
            Result.FAILED
        }

    private fun cleanStaleCache(dir: File) {
        val now = System.currentTimeMillis()
        dir.listFiles()?.forEach { file ->
            if (now - file.lastModified() > CACHE_MAX_AGE_MS) runCatching { file.delete() }
        }
    }

    /**
     * @param chooserTitle chooser 标题（RN `share_card_title_music`：`将「歌名」分享到...`）
     * @param subject `EXTRA_SUBJECT`（RN `share_title_music`：`歌曲分享`）
     * @param text `EXTRA_TEXT`（RN `歌名 - 歌手`）
     */
    fun send(
        context: Context,
        uri: Uri,
        chooserTitle: String,
        subject: String,
        text: String,
    ): Result {
        val send =
            Intent(Intent.ACTION_SEND).apply {
                type = MIME_PNG
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, subject)
                putExtra(Intent.EXTRA_TEXT, text)
                clipData = ClipData.newRawUri(subject, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        val chooser =
            Intent.createChooser(send, chooserTitle).apply {
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                // 从 Compose 里拿到的可能是 Application Context
                if (context !is Activity) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        return try {
            context.startActivity(chooser)
            Result.SENT
        } catch (e: ActivityNotFoundException) {
            Result.NO_TARGET
        } catch (t: Throwable) {
            Result.FAILED
        }
    }

    /** 结果 → 可读提示；[SENT] 不提示（系统 chooser 已经接管）。 */
    fun message(result: Result): String? =
        when (result) {
            Result.SENT -> null
            Result.NO_TARGET -> "没有找到可以分享的应用"
            Result.FAILED -> "分享失败，请稍后重试"
        }

    /** 便捷入口：发送并提示失败原因。 */
    fun sendWithToast(
        context: Context,
        uri: Uri,
        chooserTitle: String,
        subject: String,
        text: String,
    ): Result {
        val result = send(context, uri, chooserTitle, subject, text)
        message(result)?.let { Toast.makeText(context, it, Toast.LENGTH_SHORT).show() }
        return result
    }

    /** [sendCard] 的便捷入口：写 cache、经 FileProvider 分享并提示失败原因。 */
    fun sendCardWithToast(
        context: Context,
        bitmap: Bitmap,
        baseName: String,
        chooserTitle: String,
        subject: String,
        text: String,
    ): Result {
        val result = sendCard(context, bitmap, baseName, chooserTitle, subject, text)
        message(result)?.let { Toast.makeText(context, it, Toast.LENGTH_SHORT).show() }
        return result
    }
}
