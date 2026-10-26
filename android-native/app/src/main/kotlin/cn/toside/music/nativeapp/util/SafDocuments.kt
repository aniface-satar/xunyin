package cn.toside.music.nativeapp.util

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import cn.toside.music.core.local.LocalSibling
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

    // ---------- 目录树与持久授权（Wave5 Lane B 新增；上面既有 API 语义未改） ----------

    /**
     * 目录树授权的持久化：`ACTION_OPEN_DOCUMENT_TREE` 给的授权默认只在本次进程有效，
     * 不 `takePersistableUriPermission` 的话**重启后全部变哑巴**（RN 用真实路径不存在这问题）。
     *
     * 注意任务书原写用 `DocumentFile`，但工程没有 `androidx.documentfile` 依赖且
     * gradle/版本目录禁触 —— 这里改用 `DocumentsContract` 原生 API，能力等价、零新依赖。
     */
    fun takePersistablePermission(
        context: Context,
        treeUri: Uri,
    ): Boolean =
        runCatching {
            context.contentResolver.takePersistableUriPermission(treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            true
        }.getOrDefault(false)

    /** 该目录树是否仍有持久读权限（重启后自检用）。 */
    fun hasPersistedPermission(
        context: Context,
        treeUri: Uri,
    ): Boolean =
        runCatching {
            context.contentResolver.persistedUriPermissions.any { it.uri == treeUri && it.isReadPermission }
        }.getOrDefault(false)

    /** 目录树里的一个文件（SAF 只有 document URI，没有真实路径）。 */
    data class DocumentEntry(
        val uri: Uri,
        val name: String,
        val mimeType: String?,
    )

    /**
     * 列出目录树的**直接子文件**（不进子目录）。
     *
     * 与 RN `scanAudioFiles` → `FileSystem.ls(path)` 同语义：单层，不递归；
     * 递归会改变「用户选的这一层」的含义，留作遗留项讨论（见 lane 报告）。
     */
    suspend fun listChildren(
        context: Context,
        treeUri: Uri,
    ): Result<List<DocumentEntry>> =
        withContext(Dispatchers.IO) {
            runCatching {
                val treeDocumentId = DocumentsContract.getTreeDocumentId(treeUri)
                val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, treeDocumentId)
                val projection =
                    arrayOf(
                        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                        DocumentsContract.Document.COLUMN_MIME_TYPE,
                    )
                val entries = mutableListOf<DocumentEntry>()
                context.contentResolver.query(childrenUri, projection, null, null, null)?.use { cursor ->
                    while (cursor.moveToNext()) {
                        val documentId = cursor.getString(0) ?: continue
                        val name = cursor.getString(1) ?: continue
                        val mimeType = cursor.getString(2)
                        if (mimeType == DocumentsContract.Document.MIME_TYPE_DIR) continue
                        entries.add(
                            DocumentEntry(
                                uri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId),
                                name = name,
                                mimeType = mimeType,
                            ),
                        )
                    }
                } ?: throw FileNotFoundException("无法读取所选目录")
                entries
            }
        }

    /** 整读为 UTF-8 文本（同名 `.lrc` 用）。 */
    suspend fun readText(
        context: Context,
        uri: Uri,
    ): Result<String> =
        withContext(Dispatchers.IO) {
            runCatching {
                context.contentResolver.openInputStream(uri)?.use { String(it.readBytes(), Charsets.UTF_8) }
                    ?: throw FileNotFoundException("无法读取所选文件")
            }
        }

    /**
     * 同目录同名 `.lrc` 的 document URI；不存在或推不出时 null。
     *
     * 算路在 `core/local/LocalSibling`（纯字符串），这里只负责 `DocumentsContract` 的构造与探测。
     */
    fun siblingLyricUri(
        context: Context,
        documentUri: Uri,
    ): Uri? {
        val lyricId =
            runCatching { LocalSibling.lyricDocumentId(DocumentsContract.getDocumentId(documentUri)) }
                .getOrNull() ?: return null
        val lyricUri =
            runCatching { DocumentsContract.buildDocumentUriUsingTree(documentUri, lyricId) }
                .getOrNull() ?: return null
        return lyricUri.takeIf { documentExists(context, it) }
    }

    /** 该 document 是否真的存在（query 一次拿 COLUMN_DOCUMENT_ID）。 */
    fun documentExists(
        context: Context,
        uri: Uri,
    ): Boolean =
        runCatching {
            context.contentResolver
                .query(uri, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID), null, null, null)
                ?.use { it.moveToFirst() } ?: false
        }.getOrDefault(false)

    /** 打开输入流做一次可读性探测（取链前的授权/文件存在性检查）。 */
    suspend fun canRead(
        context: Context,
        uri: Uri,
    ): Boolean =
        withContext(Dispatchers.IO) {
            runCatching {
                context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { true } ?: false
            }.getOrDefault(false)
        }
}
