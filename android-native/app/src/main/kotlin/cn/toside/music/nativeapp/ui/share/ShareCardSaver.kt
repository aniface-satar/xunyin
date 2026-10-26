package cn.toside.music.nativeapp.ui.share

import android.content.ContentResolver
import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import cn.toside.music.core.share.uniqueCardFileName
import java.io.IOException

sealed interface ShareSaveResult {
    /**
     * 落盘成功。[uri] 是 MediaStore 返回的 `content://`，系统分享直接拿它当
     * `EXTRA_STREAM`（不需要 FileProvider：媒体库 Uri 本身可授权给收端）。
     */
    data class Saved(
        val fileName: String,
        val uri: Uri,
    ) : ShareSaveResult

    data class Failed(
        val message: String,
    ) : ShareSaveResult
}

/**
 * 分享卡落相册：MediaStore 写入 `Pictures/寻音`（任务书 §3）。
 *
 * 命名与去重照 RN：`cardFileName` 清非法字符 + 72 字符上限，同名追加 ` (n)`。
 * 约束：`minSdk = 26` 且 manifest 禁触（没有 `WRITE_EXTERNAL_STORAGE`），
 * 免权限写公共相册只有 29+ 可用；26–28 直接给出可读的版本提示（见 lane 报告遗留）。
 */
object ShareCardSaver {
    private val relativePath = "${Environment.DIRECTORY_PICTURES}/寻音/"

    fun save(
        context: Context,
        bitmap: Bitmap,
        baseName: String,
    ): ShareSaveResult {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return ShareSaveResult.Failed("当前系统版本不支持直接保存到相册（需要 Android 10 及以上）")
        }
        val resolver = context.contentResolver
        return try {
            val fileName = uniqueCardFileName(baseName) { it in existingNames(resolver) }
            val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, pendingValues(fileName))
            if (uri == null) {
                ShareSaveResult.Failed("保存失败，请稍后重试")
            } else {
                writeBitmap(resolver, uri, bitmap)
                ShareSaveResult.Saved(fileName, uri)
            }
        } catch (t: Throwable) {
            ShareSaveResult.Failed("保存失败，请稍后重试")
        }
    }

    private fun pendingValues(fileName: String): ContentValues =
        ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, fileName)
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(MediaStore.Images.Media.RELATIVE_PATH, relativePath)
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }

    private fun writeBitmap(
        resolver: ContentResolver,
        uri: Uri,
        bitmap: Bitmap,
    ) {
        try {
            val stream = resolver.openOutputStream(uri) ?: throw IOException("openOutputStream returned null")
            stream.use { out ->
                if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)) throw IOException("png compress failed")
            }
            val finished = ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }
            resolver.update(uri, finished, null, null)
        } catch (t: Throwable) {
            runCatching { resolver.delete(uri, null, null) }
            throw t
        }
    }

    private fun existingNames(resolver: ContentResolver): Set<String> {
        val names = mutableSetOf<String>()
        val projection = arrayOf(MediaStore.Images.Media.DISPLAY_NAME)
        val selection = "${MediaStore.Images.Media.RELATIVE_PATH}=?"
        resolver
            .query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, projection, selection, arrayOf(relativePath), null)
            ?.use { cursor ->
                val index = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
                while (cursor.moveToNext()) {
                    cursor.getString(index)?.let { names += it }
                }
            }
        return names
    }
}
