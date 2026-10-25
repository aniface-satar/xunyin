package cn.toside.music.nativeapp.util

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.FileNotFoundException

/**
 * SAF（存储访问框架）读写辅助 —— 原生侧对应 RN 的 ChoosePath + handleReadFile/handleSaveFile。
 *
 * RN 桌面/移动版直接写用户选的目录路径；Android 上路径已不可直接写，改用系统文档选择器：
 * - 导入走 `ACTION_OPEN_DOCUMENT`（可读任意位置的 .lxmc/.json/.bin）；
 * - 导出走 `ACTION_CREATE_DOCUMENT`（系统自带重名处理，见 [exportFileName] 注释）。
 */
object SafDocuments {
    /** RN `utils/common.ts#fileNameRxp`：删除非法文件名字符后再拼扩展名。 */
    private val ILLEGAL_FILE_NAME_CHARS = Regex("""[\\/:*?#"<>|]""")

    /** RN `config/constant.ts#LXM_FILE_EXT_RXP`。 */
    private val SUPPORTED_EXTENSIONS = setOf("json", "lxmc", "bin")

    /**
     * 单列表导出文件名（RN `lx_list_part_${filterFileName(name)}.lxmc`）。
     *
     * RN 直接按固定文件名写入用户选择的目录，不做重名检测；目标已存在时由写入实现覆盖。
     * SAF 的 CreateDocument 遇到同名文件会自动改名追加「(1)」而不覆盖，因此调用方
     * 在拉取导出器前要提示这一差异（见 laneC 报告「语义修正」）。
     */
    fun exportFileName(listName: String): String = "lx_list_part_${listName.replace(ILLEGAL_FILE_NAME_CHARS, "")}.lxmc"

    /** 小写扩展名；无扩展名返回空串。 */
    fun extensionOf(displayName: String?): String = displayName?.substringAfterLast('.', "")?.lowercase().orEmpty()

    fun isSupportedImport(displayName: String?): Boolean = extensionOf(displayName) in SUPPORTED_EXTENSIONS

    fun isPlainJson(displayName: String?): Boolean = extensionOf(displayName) == "json"

    /** 文档显示名（SAF 不提供真实路径；判断扩展名/回显用）。 */
    fun displayName(
        context: Context,
        uri: Uri,
    ): String? =
        runCatching {
            context.contentResolver
                .query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
        }.getOrNull()

    suspend fun readBytes(
        context: Context,
        uri: Uri,
    ): Result<ByteArray> =
        withContext(Dispatchers.IO) {
            runCatching {
                context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    ?: throw FileNotFoundException("无法读取所选文件")
            }
        }

    suspend fun writeBytes(
        context: Context,
        uri: Uri,
        bytes: ByteArray,
    ): Result<Unit> =
        withContext(Dispatchers.IO) {
            runCatching {
                context.contentResolver.openOutputStream(uri, "wt")?.use { it.write(bytes) }
                    ?: throw FileNotFoundException("无法写入所选位置")
            }
        }
}
