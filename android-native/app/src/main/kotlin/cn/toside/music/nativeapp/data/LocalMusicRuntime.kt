package cn.toside.music.nativeapp.data

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Log
import cn.toside.music.core.data.DataRepository
import cn.toside.music.core.data.MusicUrlCache
import cn.toside.music.core.local.EmbeddedLyric
import cn.toside.music.core.local.LocalAudio
import cn.toside.music.core.local.LocalFallbackConfirm
import cn.toside.music.core.local.LocalImportPlan
import cn.toside.music.core.local.LocalImportProgress
import cn.toside.music.core.local.LocalLyric
import cn.toside.music.core.local.LocalRelink
import cn.toside.music.core.local.LocalStaleScan
import cn.toside.music.core.local.LocalTrack
import cn.toside.music.core.storage.ShardedKvStore
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
import kotlinx.coroutines.withContext
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

    /**
     * 本地曲目歌词（供 `PlayerRuntime.observeLyrics` 用），三级顺序与 RN 一致：
     * **同名 `.lrc` → 内嵌歌词（ID3 USLT / MP4 ©lyr）** → 在线兜底由 PlayerRuntime 接。
     * 产出 `{lyric, tlyric?, rlyric?}` JSON 形状不变。
     */
    suspend fun readLyricJson(
        context: Context,
        info: JsonObject,
    ): JsonObject? {
        val filePath = info.localMetaText("filePath") ?: info.localText("id") ?: return null
        val uri = runCatching { Uri.parse(filePath) }.getOrNull() ?: return null
        // 1) 同名 .lrc（RN getMusicFileLyric 的文件歌词优先）
        val lyricUri = SafDocuments.siblingLyricUri(context, uri)
        if (lyricUri != null) {
            val text = SafDocuments.readText(context, lyricUri).getOrNull()
            if (text != null) {
                val parsed = LocalLyric.parse(text)
                if (parsed.hasLyric) {
                    return buildJsonObject {
                        put("lyric", parsed.lyric)
                        parsed.tlyric?.let { put("tlyric", it) }
                        parsed.rlyric?.let { put("rlyric", it) }
                    }
                }
            }
        }
        // 2) 内嵌歌词：只读文件头 1 MB（RN 走原生 readLyric 直出 USLT 文本）
        return embeddedLyricJson(context, uri)
    }

    /**
     * 从音频文件头解析内嵌歌词（`EmbeddedLyric` 只做纯字节解析，SAF 读头在这里）。
     *
     * 流式 m4a（`moov` 在文件尾）头里没有歌词原子，这时回读文件尾再探一次（W6-4）；
     * 只有 MP4 容器才回读，mp3/flac/ogg 不为它多花一次 IO。
     */
    suspend fun embeddedLyricJson(
        context: Context,
        uri: Uri,
    ): JsonObject? {
        val bytes =
            SafDocuments.readHeader(context, uri, EmbeddedLyric.MAX_INPUT_BYTES).getOrNull()
                ?: return null
        if (!EmbeddedLyric.isMp4Container(bytes)) {
            val text = EmbeddedLyric.parse(bytes) ?: return null
            return buildJsonObject { put("lyric", text) }
        }
        val tail = readTail(context, uri, EmbeddedLyric.TAIL_PROBE_BYTES)
        val text = EmbeddedLyric.parseWithTail(bytes, tail) ?: return null
        return buildJsonObject { put("lyric", text) }
    }

    /** 回读文件尾 [limit] 字节（流式 m4a 的 `moov` 在尾；读不动时返回空数组，等价于没探到）。 */
    private suspend fun readTail(
        context: Context,
        uri: Uri,
        limit: Int,
    ): ByteArray =
        withContext(Dispatchers.IO) {
            runCatching {
                val descriptor = context.contentResolver.openFileDescriptor(uri, "r") ?: return@runCatching ByteArray(0)
                descriptor.use { file ->
                    val size = file.statSize
                    if (size <= 0) return@runCatching ByteArray(0)
                    val skip = (size - limit).coerceAtLeast(0L)
                    java.io.FileInputStream(file.fileDescriptor).use { input ->
                        if (skip > 0 && input.skip(skip) < skip) return@runCatching ByteArray(0)
                        val buffer = ByteArray(limit)
                        var read = 0
                        while (read < limit) {
                            val n = input.read(buffer, read, limit - read)
                            if (n < 0) break
                            read += n
                        }
                        buffer.copyOf(read)
                    }
                }
            }.getOrDefault(ByteArray(0))
        }

    // ---------- 兜底取链缓存 + 人工确认（W6-1 / W6-2） ----------

    /** 兜底直链缓存开关（默认开；关掉就回到 Wave6 的「每次兜底重新搜索取链」）。 */
    var fallbackCacheEnabled: () -> Boolean = { true }

    /** 兜底人工确认开关（默认开；关掉 == RN 静默语义）。 */
    var fallbackConfirmEnabled: () -> Boolean = { true }

    /** 缓存新鲜度的时间源（默认系统时钟，测试可换）。 */
    var nowProvider: () -> Long = { System.currentTimeMillis() }

    /** 一个兜底候选项（弹层展示用；[info] 是候选的完整在线曲目，选中后直接拿它取链）。 */
    data class FallbackOption(
        val name: String,
        val singer: String,
        val source: String,
        val interval: String,
        val info: JsonObject,
    )

    /** 弹层请求：本地曲目的期望标识 + 排好序的候选。 */
    data class FallbackConfirmRequest(
        val localName: String,
        val localSinger: String,
        val options: List<FallbackOption>,
    )

    private val confirmHosts = mutableListOf<Pair<Any, suspend (FallbackConfirmRequest) -> JsonObject?>>()
    private val confirmLock = Any()

    /**
     * 注册兜底确认宿主（后注册优先）—— 弹层必须活在某个界面里，运行时自己弹不出来。
     *
     * 没有宿主时按 **RN 静默语义**放行（`getOtherSourceByLocal` 就是静默的），
     * 所以这层弹层是体验增强而不是必需路径。
     */
    fun registerFallbackConfirm(
        owner: Any,
        handler: suspend (FallbackConfirmRequest) -> JsonObject?,
    ) {
        synchronized(confirmLock) {
            confirmHosts.removeAll { it.first === owner }
            confirmHosts.add(owner to handler)
        }
    }

    fun unregisterFallbackConfirm(owner: Any) {
        synchronized(confirmLock) { confirmHosts.removeAll { it.first === owner } }
    }

    /**
     * 本地曲目的在线兜底取链（W6-1 / W6-2）—— RN `core/music/local.ts#getMusicUrl` 等价物：
     *
     * 1. 先读本地 id 的缓存直链（键 `<localId>_128k`，RN `getOnlineOtherSourceMusicUrlByLocal`
     *    同口径）——命中就直接返回，**不再五源搜索、不再取链**；
     * 2. 未命中：需要人工确认（同名不同歌手 / 歌手为空）时先让用户挑候选；
     * 3. 逐级取链，每次成功命中写回本地 id 缓存（在线目标那份由 `UserApiRuntime` 自己写）。
     */
    suspend fun fallbackUrl(
        context: Context,
        info: JsonObject,
        targets: List<JsonObject>,
        fetch: suspend (JsonObject) -> String?,
    ): String? {
        if (targets.isEmpty()) return null
        val localId = info.localText("id") ?: return null
        val cacheEnabled = fallbackCacheEnabled()
        if (cacheEnabled) {
            val cached =
                MusicUrlCache.pick(
                    runCatching {
                        repository(context).getMusicUrlEntry(localId, MusicUrlCache.LOCAL_FALLBACK_QUALITY)
                    }.getOrNull(),
                    nowProvider(),
                )
            if (cached != null) {
                Log.d(TAG, "本地兜底走缓存直链：${info.localText("name").orEmpty()}")
                return cached
            }
        }
        val ordered = confirmFallback(info, targets)
        for (target in ordered) {
            val url = runCatching { fetch(target) }.getOrNull()
            if (!url.isNullOrEmpty()) {
                if (cacheEnabled) {
                    runCatching {
                        repository(context)
                            .saveMusicUrlEntry(localId, MusicUrlCache.LOCAL_FALLBACK_QUALITY, url, nowProvider())
                    }
                }
                return url
            }
        }
        return null
    }

    /**
     * 人工确认：规则判「不需要确认」/没宿主/开关关掉 都按 RN 静默语义原样返回；
     * 用户挑完把选中项排到最前（取链失败会继续往下试，RN 同）。
     */
    private suspend fun confirmFallback(
        info: JsonObject,
        targets: List<JsonObject>,
    ): List<JsonObject> {
        if (!fallbackConfirmEnabled()) return targets
        val host = synchronized(confirmLock) { confirmHosts.lastOrNull()?.second } ?: return targets
        val expect =
            LocalFallbackConfirm.Expectation(
                name = info.localText("name").orEmpty(),
                singer = info.localText("singer").orEmpty(),
            )
        val pairs =
            targets.map { target ->
                target to
                    LocalFallbackConfirm.Option(
                        name = target.localText("name").orEmpty(),
                        singer = target.localText("singer").orEmpty(),
                        source = target.localText("source").orEmpty(),
                        interval = target.localMetaText("interval").orEmpty(),
                    )
            }
        if (!LocalFallbackConfirm.needsConfirm(expect, pairs.map { it.second })) return targets
        val ordered = pairs.sortedBy { if (LocalFallbackConfirm.verdict(expect, it.second) == LocalFallbackConfirm.Verdict.OK) 0 else 1 }
        val options =
            ordered.map { (target, option) -> FallbackOption(option.name, option.singer, option.source, option.interval, target) }
        val chosen =
            runCatching {
                host(FallbackConfirmRequest(expect.name, expect.singer, options))
            }.getOrNull() ?: return ordered.map { it.first }
        return listOf(chosen) + ordered.map { it.first }.filter { it !== chosen }
    }

    private fun repository(context: Context): DataRepository = DataRepository(ShardedKvStore(DataStoreKvStore(context.applicationContext)))

    // ---------- 重定位（W5-7：失效曲目重扫持久授权树根找回新 URI） ----------

    /**
     * 重定位结果（UI 弹提示用）。
     *
     * 歧义/未命中**不删**只计数：删曲是破坏性操作（用户可能只是暂时拔了 U 盘），
     * 本波保持曲目原样留在列表里。
     */
    data class RelinkOutcome(
        val stale: Int,
        val matched: Int,
        val unmatched: Int,
        val ambiguous: Int,
        val noPermission: Boolean,
    )

    private val _relinkingListId = MutableStateFlow<String?>(null)

    /** 正在重定位的列表 id（UI 用来禁用重复触发）；空闲为 null。 */
    val relinkingListId: StateFlow<String?> = _relinkingListId.asStateFlow()

    private val _relinkOutcome = MutableStateFlow<RelinkOutcome?>(null)

    /** 最近一次重定位结果（新一次重定位开始时清空）。 */
    val relinkOutcome: StateFlow<RelinkOutcome?> = _relinkOutcome.asStateFlow()

    /**
     * 当前列表里 document URI 已失效的曲目数（弹层按钮的 N；0 时不渲染入口）。
     *
     * W6-5：从「逐曲 `DocumentFile` query」改成「每个授权树根列一次 children + documentId
     * 集合比对」（[LocalStaleScan]），1000 首量级的 query 次数从 N 降到树根数。
     * 一次都没列出来（授权全失效）或 documentId 解不出的曲目，退回逐曲 query ——
     * 宁可多查几首，也不把「查不动」误判成失效。
     */
    suspend fun countStale(
        context: Context,
        listId: String,
    ): Int =
        withContext(Dispatchers.IO) {
            val lists = ListRuntime.get(context)
            lists.ensureLoaded()
            val localTracks = lists.musics(listId).filter { it.isLocalTrackInfo() }
            val tracks =
                localTracks.mapNotNull { track ->
                    val uriString = track.localMetaText("filePath") ?: track.localText("id")
                    if (uriString.isNullOrEmpty()) {
                        null
                    } else {
                        LocalStaleScan.Track(id = uriString, documentId = documentIdOf(uriString))
                    }
                }
            val listedIds = mutableSetOf<String>()
            var listedAny = false
            for (treeUri in persistedTreeUris(context)) {
                val children = SafDocuments.listChildren(context, treeUri).getOrNull().orEmpty()
                if (children.isNotEmpty()) listedAny = true
                for (entry in children) {
                    documentIdOf(entry.uri.toString())?.let { listedIds.add(it) }
                }
            }
            if (!listedAny) return@withContext localTracks.count { !it.documentExistsSafe(context) }
            val result = LocalStaleScan.scan(tracks, listedIds)
            val unresolvedIds = result.unresolved.toSet()
            val unresolvedStale =
                localTracks.count { track ->
                    val uriString = track.localMetaText("filePath") ?: track.localText("id")
                    uriString != null && uriString in unresolvedIds && !track.documentExistsSafe(context)
                }
            val noUri = localTracks.size - tracks.size
            result.stale.size + unresolvedStale + noUri
        }

    /** 一条歧义候选（重定位不敢猜时列给用户挑）。 */
    data class RelinkOption(
        val uri: String,
        val displayName: String,
    )

    /** 一条待人工挑候选的失效曲目。 */
    data class AmbiguousChoice(
        val listId: String,
        val oldId: String,
        val name: String,
        val singer: String,
        val options: List<RelinkOption>,
    )

    private val _pendingAmbiguous = MutableStateFlow<List<AmbiguousChoice>?>(null)

    /** 待人工挑选的歧义候选（null = 没有；挑完一个就少一个）。 */
    val pendingAmbiguous: StateFlow<List<AmbiguousChoice>?> = _pendingAmbiguous.asStateFlow()

    /** 最近一轮重定位的现场（用户挑候选时按 oldId 找回原曲目与位置）。 */
    private var lastRelink: RelinkSession? = null

    private data class RelinkSession(
        val context: Context,
        val listId: String,
        val stale: List<StaleTrack>,
        val expectations: List<LocalRelink.Expectation>,
        val candidates: List<LocalRelink.Candidate>,
        val takenUris: Set<String>,
    )

    /**
     * 用户挑完歧义候选：走既有换键路径（`id` / `meta.filePath` / `meta.songId` 三处一起换，
     * 再按原索引 move 回位），挑完从待办里划掉。
     */
    fun resolveAmbiguous(
        choice: AmbiguousChoice,
        uri: String,
    ) {
        val session = lastRelink ?: return
        scope.launch {
            val lists = ListRuntime.get(session.context)
            val player = PlayerRuntime.get(session.context)
            applyRelinkPlan(
                lists,
                player,
                session.listId,
                session.stale,
                LocalRelink.Plan(matched = mapOf(choice.oldId to uri), unmatched = emptyList(), ambiguous = emptyList()),
            )
            _pendingAmbiguous.value = _pendingAmbiguous.value?.filterNot { it.oldId == choice.oldId }?.takeIf { it.isNotEmpty() }
            Log.d(TAG, "歧义候选人工选定：${choice.name} -> ${choice.options.firstOrNull { it.uri == uri }?.displayName}")
        }
    }

    /** 放弃这一批歧义候选（保持失效原样，RN/Wave6 语义：不删不猜）。 */
    fun dismissAmbiguous() {
        _pendingAmbiguous.value = null
    }

    fun isRelinking(): Boolean = _relinkingListId.value != null

    /** 起后台协程对 [listId] 做一轮重定位（同列表重入直接忽略）。 */
    fun relink(
        context: Context,
        listId: String,
    ) {
        if (isRelinking()) return
        scope.launch { runRelink(context.applicationContext, listId) }
    }

    private suspend fun runRelink(
        context: Context,
        listId: String,
    ) {
        val lists = ListRuntime.get(context)
        val player = PlayerRuntime.get(context)
        lists.ensureLoaded()
        _relinkOutcome.value = null
        _relinkingListId.value = listId
        try {
            val tracks = lists.musics(listId)
            val stale = mutableListOf<StaleTrack>()
            val takenUris = mutableSetOf<String>()
            for ((index, track) in tracks.withIndex()) {
                val uriString = track.localMetaText("filePath") ?: track.localText("id")
                if (!track.isLocalTrackInfo() || uriString.isNullOrEmpty()) continue
                if (track.documentExistsSafe(context)) {
                    takenUris.add(uriString)
                } else {
                    stale.add(StaleTrack(oldId = uriString, info = track, position = index))
                }
            }
            if (stale.isEmpty()) {
                _relinkOutcome.value = RelinkOutcome(0, 0, 0, 0, noPermission = false)
                return
            }

            // 与导入同口径：持久授权的树根逐个单层扫描（不递归，递归是 W5-16）
            val treeUris = persistedTreeUris(context)
            val candidates = mutableListOf<LocalRelink.Candidate>()
            for (treeUri in treeUris) {
                SafDocuments
                    .listChildren(context, treeUri)
                    .getOrNull()
                    .orEmpty()
                    .filter { LocalAudio.isAudio(it.name, it.mimeType) }
                    .forEach { entry ->
                        candidates.add(
                            LocalRelink.Candidate(
                                stem = LocalTrack.splitNameAndExtension(entry.name).first,
                                uri = entry.uri.toString(),
                            ),
                        )
                    }
            }

            val expectations =
                stale.map { s ->
                    LocalRelink.Expectation(
                        oldId = s.oldId,
                        name = s.info.localText("name").orEmpty(),
                        singer = s.info.localText("singer").orEmpty(),
                        originalStem = stemFromUriString(s.oldId),
                    )
                }
            val plan = LocalRelink.plan(expectations = expectations, candidates = candidates, takenUris = takenUris)
            applyRelinkPlan(lists, player, listId, stale, plan)
            // W6-3：不敢猜的留给 UI 让用户挑（挑完走同一条换键路径）
            lastRelink =
                RelinkSession(
                    context = context,
                    listId = listId,
                    stale = stale,
                    expectations = expectations,
                    candidates = candidates,
                    takenUris = takenUris,
                )
            _pendingAmbiguous.value = ambiguousChoices(context, lastRelink!!, plan.ambiguous.toSet())
            _relinkOutcome.value =
                RelinkOutcome(
                    stale = stale.size,
                    matched = plan.matched.size,
                    unmatched = plan.unmatched.size,
                    ambiguous = plan.ambiguous.size,
                    noPermission = treeUris.isEmpty(),
                )
            Log.d(
                TAG,
                "重定位结束：list=$listId stale=${stale.size} matched=${plan.matched.size} " +
                    "unmatched=${plan.unmatched.size} ambiguous=${plan.ambiguous.size}",
            )
        } finally {
            _relinkingListId.value = null
        }
    }

    /**
     * 把命中的曲目换成新 URI。`id` / `meta.filePath` / `meta.songId` 三处必须一起换
     * （Wave5 的语义是三者同键）；`listMusicUpdateInfo` 以 id 定位、不换 id，
     * 所以走「remove → add(bottom) → 按原索引逐个 move 回位」恢复原布局。
     */
    private suspend fun applyRelinkPlan(
        lists: ListRuntime,
        player: PlayerRuntime,
        listId: String,
        stale: List<StaleTrack>,
        plan: LocalRelink.Plan,
    ) {
        if (plan.matched.isEmpty()) return
        val infoByOldId = stale.associateBy { it.oldId }
        val moves =
            plan.matched.entries
                .mapNotNull { (oldId, newUri) ->
                    infoByOldId[oldId]?.let { Triple(it.position, oldId, newUri) }
                }.sortedBy { it.first }
        lists.store.listMusicRemove(listId, moves.map { it.second })
        lists.store.listMusicAdd(listId, moves.map { relinkedInfo(infoByOldId[it.second]!!.info, it.third) }, "bottom")
        for ((position, _, newUri) in moves) {
            lists.store.listMusicUpdatePosition(listId, position, listOf(newUri))
        }
        player.core.handleListMusicsUpdated(listOf(listId))
    }

    /** 曲目副本：换 `id` 与 `meta.filePath` / `meta.songId`，其余字段（含封面、标签）原样保留。 */
    private fun relinkedInfo(
        old: JsonObject,
        newUri: String,
    ): JsonObject =
        buildJsonObject {
            old.forEach { (key, value) -> put(key, value) }
            put("id", JsonPrimitive(newUri))
            put(
                "meta",
                buildJsonObject {
                    (old["meta"] as? JsonObject)?.forEach { (key, value) -> put(key, value) }
                    put("filePath", JsonPrimitive(newUri))
                    put("songId", JsonPrimitive(newUri))
                },
            )
        }

    private data class StaleTrack(
        val oldId: String,
        val info: JsonObject,
        val position: Int,
    )

    /** 持久授权的读权限树根（重定位与批量失效扫描共用同一份口径）。 */
    private fun persistedTreeUris(context: Context): List<Uri> =
        context.contentResolver.persistedUriPermissions
            .filter { it.isReadPermission }
            .map { it.uri }
            .distinct()

    /**
     * document URI → documentId（`DocumentsContract` 优先，解不动退回纯字符串解析）。
     * 批量失效判定用 documentId 比对，URI 字符串会随 provider 的编码变化。
     */
    private fun documentIdOf(uriString: String): String? {
        val uri = runCatching { Uri.parse(uriString) }.getOrNull() ?: return null
        return runCatching { DocumentsContract.getDocumentId(uri) }.getOrNull()
            ?: LocalStaleScan.documentIdOf(uriString)
    }

    /** 把 `ambiguous` 的 oldId 翻成「候选列表」交给 UI（[LocalRelink.candidatesFor] 纯规则）。 */
    private fun ambiguousChoices(
        context: Context,
        session: RelinkSession,
        ambiguousIds: Set<String>,
    ): List<AmbiguousChoice>? {
        if (ambiguousIds.isEmpty()) return null
        val choices =
            session.expectations
                .filter { it.oldId in ambiguousIds }
                .mapNotNull { expectation ->
                    val options =
                        LocalRelink
                            .candidatesFor(expectation, session.candidates, session.takenUris)
                            .map { candidate -> RelinkOption(uri = candidate.uri, displayName = displayNameOf(context, candidate.uri)) }
                    if (options.isEmpty()) {
                        null
                    } else {
                        AmbiguousChoice(
                            listId = session.listId,
                            oldId = expectation.oldId,
                            name = expectation.name,
                            singer = expectation.singer,
                            options = options,
                        )
                    }
                }
        return choices.takeIf { it.isNotEmpty() }
    }

    /** 候选的显示名（SAF query 拿不到时退回 documentId 的文件名段）。 */
    private fun displayNameOf(
        context: Context,
        uriString: String,
    ): String {
        val uri = runCatching { Uri.parse(uriString) }.getOrNull() ?: return uriString
        val name = SafDocuments.displayName(context, uri)
        if (!name.isNullOrEmpty()) return name
        val documentId = runCatching { DocumentsContract.getDocumentId(uri) }.getOrNull() ?: uriString
        return documentId.substringAfterLast('/').ifEmpty { uriString }
    }

    // ---------- 单文件 / 多文件导入（W6-3 公开入口：deeplink 打开音频用） ----------

    /**
     * 读单个**已授权**音频文件的标签，不落库（deeplink「用本应用打开音频」用）。
     *
     * 与目录导入同一套读法（[readEntry]）：歌名/歌手/专辑/时长/内嵌封面一个不落。
     * 读不到或不是音频返回 null，调用方自行退化成占位曲目。
     */
    suspend fun readFileInfo(
        context: Context,
        uri: Uri,
    ): JsonObject? =
        withContext(Dispatchers.IO) {
            val name = SafDocuments.displayName(context.applicationContext, uri) ?: return@withContext null
            if (!LocalAudio.isAudio(name, null)) return@withContext null
            readEntry(
                context.applicationContext,
                SafDocuments.DocumentEntry(uri = uri, name = name, mimeType = null),
            )
        }

    /**
     * 导入若干**已授权**的音频文件（deeplink「用本应用打开音频」入口，Lane C 用）。
     *
     * 与目录导入同口径：读标签失败的不入库；返回导入成功的曲目 info
     * （调用方可直接拿去 `PlayerRuntime` 起播）。空列表表示没有一个能读。
     */
    suspend fun importFiles(
        context: Context,
        listId: String,
        uris: List<Uri>,
        locationType: String = "top",
    ): List<JsonObject> {
        if (uris.isEmpty()) return emptyList()
        return withContext(Dispatchers.IO) {
            val lists = ListRuntime.get(context.applicationContext)
            val player = PlayerRuntime.get(context.applicationContext)
            lists.ensureLoaded()
            val infos = mutableListOf<JsonObject>()
            for (uri in uris) {
                val name = SafDocuments.displayName(context.applicationContext, uri) ?: continue
                val entry = SafDocuments.DocumentEntry(uri = uri, name = name, mimeType = null)
                if (!LocalAudio.isAudio(name, null)) continue
                val info = readEntry(context.applicationContext, entry) ?: continue
                infos.add(info)
            }
            if (infos.isNotEmpty()) {
                lists.store.listMusicAdd(listId, infos, locationType)
                player.core.handleListMusicsUpdated(listOf(listId))
            }
            Log.d(TAG, "文件导入：list=$listId 请求 ${uris.size} 个、入库 ${infos.size} 个")
            infos
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

/** 是否本地曲目（`source == "local"`）。 */
private fun JsonObject.isLocalTrackInfo(): Boolean = localText("source") == LocalTrack.SOURCE

/** 本地曲目的 document URI 是否仍存在（query 一次；解析不出按失效处理）。 */
private fun JsonObject.documentExistsSafe(context: Context): Boolean {
    val uriString = localMetaText("filePath") ?: localText("id") ?: return false
    val uri = runCatching { Uri.parse(uriString) }.getOrNull() ?: return false
    return SafDocuments.documentExists(context, uri)
}

/**
 * 从 document URI 字符串里抠出原文件名 stem（`…/歌名 - 歌手.mp3` → `歌名 - 歌手`）。
 * document URI 里的 document id 是百分号编码的，先经 [DocumentsContract] 解出真名；
 * 解不出退回字符串截取（导入生成的 id 一定能解出）。
 */
private fun stemFromUriString(uriString: String): String {
    val uri = runCatching { Uri.parse(uriString) }.getOrNull()
    val documentId =
        uri?.let { runCatching { DocumentsContract.getDocumentId(it) }.getOrNull() }
            ?: uriString.substringAfterLast('/')
    val fileName = documentId.substringAfterLast('/').substringAfterLast(':')
    return LocalTrack.splitNameAndExtension(fileName).first
}
