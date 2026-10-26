package cn.toside.music.nativeapp.ui.share

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast

/**
 * 系统分享一张已落盘的分享卡（对照 RN `UtilsModule#shareImage`）。
 *
 * 与 RN 原生的三处差异，都是有意的：
 * 1. RN 走 FileProvider（`file://` 在 API 24+ 会抛 `FileUriExposedException`）；
 *    这里已经拿到 MediaStore 的 `content://`，直接当 `EXTRA_STREAM` 用，不需要 provider
 *    （Manifest 本波只许动 intent-filter / launchMode）。
 * 2. 额外挂 `ClipData`：只给 `FLAG_GRANT_READ_URI_PERMISSION` 而不给 clipData 时，
 *    少数 ROM 的 chooser 不会把授权透给收端，微信会拿到一个读不了的 Uri。
 * 3. 分享目标为空/启动失败要给出可读提示（RN 只 reject，界面侧看不出发生了什么）。
 */
object ShareImageSender {
    private const val MIME_PNG = "image/png"

    enum class Result {
        SENT,
        NO_TARGET,
        FAILED,
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
}
