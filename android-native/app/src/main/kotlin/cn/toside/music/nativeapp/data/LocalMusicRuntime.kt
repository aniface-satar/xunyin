package cn.toside.music.nativeapp.data

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.util.Log
import cn.toside.music.core.local.LocalAudio
import cn.toside.music.core.local.LocalImportPlan
import cn.toside.music.core.local.LocalImportProgress
import cn.toside.music.core.local.LocalLyric
import cn.toside.music.core.local.LocalTrack
import cn.toside.music.nativeapp.player.PlayerRuntime
import cn.toside.music.nativeapp.ui.play.CoverImageLoader
import cn.toside.music.nativeapp.util.SafDocuments
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * 本地曲库运行时（B5 遗留 B5 / S17）—— RN `listAction.ts#handleImportMediaFile` 的等价物。
 *
 * 导入时序**逐条对齐 RN**：
 * 1. 扫目录（单层、`audio/` mime 前缀或 ogg 扩展名）；
 * 2. 空目录 → 直接给空结果（RN `list_select_local_file_empty_tip`）；
 * 3. 先用**文件名**构造占位曲目整批入库（按 `list.addMusicLocationType` 落 top/bottom），
 *    界面立刻能看到歌；
 * 4. 每 10 条一批、批内并发 5 读标签，读到的按同 `id` 覆盖（`listMusicUpdateInfo`）；
 * 5. 读失败的路径从列表移除（RN `removeListMusics(listId, errorPath)`），
 *    成功的计数交给 UI 弹提示。
 *
 * 与 RN 的**关键差异**：RN 的 `id`/`filePath` 是真实路径，SAF 下没有路径，
 * 统一用 **document URI 字符串**（`content://…/document/…`）当 `id` 与 `filePath`。
 * 去重、覆盖、删除都靠这个 id，语义与「路径」一致。
 */
object LocalMusicRuntime {
    private const val TAG = "LocalMusic"

    /**
     * 导入全程在 IO 线程：读目录、读标签、写列表都是阻塞 IO，
     * 放主线程会在 1000 首目录时卡住界面（进度只靠 StateFlow 回传）。
     */
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** 导入结果（UI 弹提示用）。 */
    data class Outcome(
        val total: Int,
        val added: Int,
        val failed: Int,
        val cancelled: Boolean,
    ) {
        val isEmptyDir: Boolean get() = total == 0
    }

    private val _progress = MutableStateFlow<LocalImportProgress?>(null)

    /** 当前导入进度；无导入时为 null。 */
    val progress: StateFlow<LocalImportProgress?> = _progress.asStateFlow()

    private val _outcome = MutableStateFlow<Outcome?>(null)

    /** 最近一次导入结果（新一次导入开始时清空）。 */
    val outcome: StateFlow<Outcome?> = _outcome.asStateFlow()

    private val _importingListId = MutableStateFlow<String?>(null)

    /** 正在导入的列表 id（UI 用来禁用重复触发）；空闲为 null。 */
    val importingListId: StateFlow<String?> = _importingListId.asStateFlow()

    private val currentImportingListId: String? get() = _importingListId.value

    @Volatile
    private var cancelRequested = false

    /**
     * 目录选择器宿主栈（后注册的优先）。
     *
     * 首页常驻注册一个，列表详情页在屏时再压一个（它要自己弹进度层）；
     * 单槽实现会在详情页退场时把首页那一份一起清掉，导致首页长按菜单的
     * 「添加本地歌曲」永久置灰 —— 所以这里按栈管理，退场只弹自己那一层。
     */
    private val pickers = mutableListOf<Pair<Any, (listId: String, listTitle: String) -> Unit>>()
    private val pickerLock = Any()

    // ---------- 对外公开 API（Lane C 的首页长按菜单只许用这几个） ----------

    /**
     * 注册目录选择器宿主 —— 目录选择必须由带 Activity 的界面用
     * `ActivityResultContracts.OpenDocumentTree` 拉起，运行时本身起不了 picker。
     * 用 [owner] 做归属判断，避免多个入口互相覆盖/误清。
     */
    fun registerPicker(
        owner: Any,
        handler: (listId: String, listTitle: String) -> Unit,
    ) {
        synchronized(pickerLock) {
            pickers.removeAll { it.first === owner }
            pickers.add(owner to handler)
        }
    }

    fun unregisterPicker(owner: Any) {
        synchronized(pickerLock) { pickers.removeAll { it.first === owner } }
    }

    /** 当前是否有界面能拉起目录选择（没有时调用方应置灰）。 */
    fun canStartImport(): Boolean = synchronized(pickerLock) { pickers.isNotEmpty() }

    /** 发起导入：拉起目录选择器。返回 false 表示当前没有任何宿主注册选择器。 */
    fun importTo(
        listId: String,
        listTitle: String,
    ): Boolean {
        val handler = synchronized(pickerLock) { pickers.lastOrNull()?.second } ?: return false
        handler(listId, listTitle)
        return true
    }

    fun isImporting(listId: String): Boolean = currentImportingListId == listId

    fun isImporting(): Boolean = currentImportingListId != null

    /** 请求中止（当前条处理完就停，已入库的占位曲保留）。 */
    fun cancel() {
        cancelRequested = true
    }

    /**
     * 宿主拿到目录树授权后调用：起后台协程走完整导入。
     *
     * 调用方负责先去 [SafDocuments.takePersistablePermission]（否则重启后全变哑巴）。
     */
    fun importTree(
        context: Context,
        listId: String,
        listTitle: String,
        treeUri: Uri,
    ) {
        if (isImporting()) return
        scope.launch { runImport(context.applicationContext, listId, listTitle, treeUri) }
    }

    /** 本地曲目的同名 `.lrc` 歌词（供 `PlayerRuntime.observeLyrics` 用）；无则 null。 */
    suspend fun readLyricJson(
        context: Context,
        info: JsonObject,
    ): JsonObject? {
        val filePath = info.localMetaText("filePath") ?: info.localText("id") ?: return null
        val uri = runCatching { Uri.parse(filePath) }.getOrNull() ?: return null
        val lyricUri = SafDocuments.siblingLyricUri(context, uri) ?: return null
        val text = SafDocuments.readText(context, lyricUri).getOrNull() ?: return null
        val parsed = LocalLyric.parse(text)
        if (!parsed.hasLyric) return null
        return buildJsonObject {
            put("lyric", parsed.lyric)
            parsed.tlyric?.let { put("tlyric", it) }
            parsed.rlyric?.let { put("rlyric", it) }
        }
    }

    // ---------- 导入主流程 ----------

    private suspend fun runImport(
        context: Context,
        listId: String,
        listTitle: String,
        treeUri: Uri,
    ) {
        val lists = ListRuntime.get(context)
        val player = PlayerRuntime.get(context)
        lists.ensureLoaded()
        _importingListId.value = listId
        cancelRequested = false
        _outcome.value = null
        _progress.value = LocalImportProgress()
        Log.d(TAG, "开始导入本地曲库：list=$listTitle($listId) tree=$treeUri")

        val entries =
            SafDocuments
                .listChildren(context, treeUri)
                .getOrElse { error ->
                    Log.w(TAG, "读取目录失败", error)
                    finish(context, player, listId, Outcome(total = 0, added = 0, failed = 0, cancelled = false))
                    return
                }.filter { LocalAudio.isAudio(it.name, it.mimeType) }

        if (entries.isEmpty()) {
            finish(context, player, listId, Outcome(total = 0, added = 0, failed = 0, cancelled = false))
            return
        }

        val locationType =
            player.settings.store
                .string("list.addMusicLocationType")
                .ifEmpty { "top" }
        val placeholders = entries.map { LocalTrack.buildPlaceholder(it.uri.toString(), it.name) }
        // 3) 占位快速入库：与 RN 一致，先让用户看到「共找到 N 个文件」
        lists.store.listMusicAdd(listId, placeholders, locationType)
        player.core.handleListMusicsUpdated(listOf(listId))
        var progress = LocalImportProgress(total = entries.size, added = placeholders.size)
        _progress.value = progress

        val failedIds = mutableListOf<String>()
        var cancelled = false

        // 4) 分批读标签
        batches@ for (batch in LocalImportPlan.batches(entries)) {
            if (cancelRequested) {
                cancelled = true
                break@batches
            }
            val updates = mutableListOf<Pair<String, JsonObject>>()
            var processed = 0
            var failed = 0
            for (group in LocalImportPlan.chunks(batch, LocalImportPlan.METADATA_CONCURRENCY)) {
                if (cancelRequested) {
                    cancelled = true
                    break@batches
                }
                val results =
                    coroutineScope {
                        group
                            .map { entry -> async(Dispatchers.IO) { entry to readEntry(context, entry) } }
                            .awaitAll()
                    }
                for ((entry, info) in results) {
                    processed += 1
                    if (info == null) {
                        failed += 1
                        failedIds.add(entry.uri.toString())
                    } else {
                        updates.add(listId to info)
                    }
                }
            }
            // 每批落一次库（RN 用 1 秒节流合并，这里批就是节流窗口）
            if (updates.isNotEmpty()) lists.store.listMusicUpdateInfo(updates)
            progress = progress.advance(count = processed, failedCount = failed)
            _progress.value = progress
            player.core.handleListMusicsUpdated(listOf(listId))
        }

        // 5) 读失败的路径从列表移除
        if (failedIds.isNotEmpty()) {
            lists.store.listMusicRemove(listId, failedIds)
            player.core.handleListMusicsUpdated(listOf(listId))
        }

        finish(
            context,
            player,
            listId,
            Outcome(
                total = entries.size,
                added = entries.size - failedIds.size,
                failed = failedIds.size,
                cancelled = cancelled,
            ),
        )
    }

    private suspend fun finish(
        context: Context,
        player: PlayerRuntime,
        listId: String,
        outcome: Outcome,
    ) {
        _progress.value?.let { _progress.value = it.copy(processed = it.total) }
        _outcome.value = outcome
        _importingListId.value = null
        cancelRequested = false
        player.core.handleListMusicsUpdated(listOf(listId))
        Log.d(TAG, "导入结束：$outcome")
    }

    /**
     * 读一条的标签 + 内嵌封面。
     *
     * 「读失败」的判据：`setDataSource` 抛异常，或**拿不到时长**（正常的音频文件必然有时长）。
     * 单条失败只记进 `failedPath`，不中断整批（RN 同）。
     */
    private fun readEntry(
        context: Context,
        entry: SafDocuments.DocumentEntry,
    ): JsonObject? {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(context, entry.uri)
            val durationMs =
                retriever
                    .extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                    ?.toLongOrNull() ?: return null
            val metadata =
                LocalTrack.Metadata(
                    name = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE),
                    singer = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST),
                    albumName = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM),
                    durationSec = (durationMs / 1000).toInt(),
                    ext = LocalAudio.extensionOf(entry.name),
                )
            // 内嵌封面：RN 是播放时按需 readPic，这里导入时落一次盘（File 封面读不到时无副作用）
            val coverUri =
                runCatching { retriever.embeddedPicture }.getOrNull()?.let { bytes ->
                    CoverImageLoader.writeLocalCover(entry.uri.toString(), bytes)?.let { "file://$it" }
                }
            LocalTrack.buildInfo(entry.uri.toString(), entry.name, metadata, coverUri)
        } catch (t: Throwable) {
            Log.w(TAG, "读标签失败：${entry.name}", t)
            null
        } finally {
            runCatching { retriever.release() }
        }
    }
}

private fun JsonObject.localText(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

private fun JsonObject.localMetaText(key: String): String? =
    ((this["meta"] as? JsonObject)?.get(key) as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
