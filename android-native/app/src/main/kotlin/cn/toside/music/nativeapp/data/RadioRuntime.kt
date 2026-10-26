package cn.toside.music.nativeapp.data

import android.content.Context
import cn.toside.music.core.player.DislikeInfo
import cn.toside.music.core.player.PlayMusicInfo
import cn.toside.music.core.recommend.DislikeRules
import cn.toside.music.core.recommend.PlaylistRank
import cn.toside.music.core.recommend.m3.Discovery
import cn.toside.music.core.recommend.m3.Onboarding
import cn.toside.music.core.recommend.radio.CandidateBuildParams
import cn.toside.music.core.recommend.radio.ChannelId
import cn.toside.music.core.recommend.radio.ExclusionContext
import cn.toside.music.core.recommend.radio.ObservedPlaylist
import cn.toside.music.core.recommend.radio.PoolCandidate
import cn.toside.music.core.recommend.radio.RadioArtist
import cn.toside.music.core.recommend.radio.RadioBehavior
import cn.toside.music.core.recommend.radio.RadioCandidates
import cn.toside.music.core.recommend.radio.RadioConfig
import cn.toside.music.core.recommend.radio.RadioEngine
import cn.toside.music.core.recommend.radio.RadioFetchResult
import cn.toside.music.core.recommend.radio.RadioMode
import cn.toside.music.core.recommend.radio.RadioPlatform
import cn.toside.music.core.recommend.radio.RadioPool
import cn.toside.music.core.recommend.radio.RadioProfile
import cn.toside.music.core.recommend.radio.RadioSeed
import cn.toside.music.core.recommend.radio.RadioState
import cn.toside.music.core.recommend.radio.RadioTrackKeys
import cn.toside.music.core.recommend.radio.RecommendQueueItem
import cn.toside.music.core.recommend.radio.SimilarArtistContribution
import cn.toside.music.core.recommend.radio.TempQueueOrder
import cn.toside.music.core.songlist.RecommendSelection
import cn.toside.music.core.storage.StorageKeys
import cn.toside.music.nativeapp.player.PlayerRuntime
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.random.Random

/** 电台面板展示用的状态快照（UI 只读这个，不碰引擎内部）。 */
data class RadioStatus(
    val active: Boolean = false,
    val starting: Boolean = false,
    val mode: RadioMode = RadioMode.RADIO,
    val pending: Int = 0,
    val committed: Int = 0,
    val upcoming: List<String> = emptyList(),
    val poolSize: Int = 0,
    val queueSize: Int = 0,
    val channelShare: Map<ChannelId, Double> = emptyMap(),
    val safeMode: Boolean = false,
    val negativeStreak: Int = 0,
    val sampleSize: Int = 0,
    val error: String? = null,
)

/**
 * 个性电台编排 —— RN `core/recommend/radio.ts` 的原生等价物。
 *
 * 职责只有「把引擎、播放器队列、踩雷持久化缝在一起」：
 * - 引擎取曲（[RadioEngine]）→ `pending` 缓冲 → 提前提交 [RADIO_COMMIT_AHEAD] 首到临时列表；
 * - 提交前复检排除集（候选入池后用户可能刚收藏同名曲）；
 * - 电台补位曲永远排在用户「稍后播放」的曲子之后（`TempQueueOrder`）；
 * - `playedList` **只在这里写入**（RN `radio.ts:151`，B2 语义修正表第一条）；
 * - 不喜欢 = 写 `@dislike_list` + 引擎负反馈 + 从队列撤下并跳下一首。
 *
 * 与 RN 的差异（降级，已记 lane 报告）：
 * - 相似歌手（E）只做「后台刷新 + 缓冲取货」，首批队列拿不到 E 的曲子（宁可晚到，不加首屏延迟）；
 * - 语种桶（L1~L4）已移植纯规则，但候选流的 `lang` 字段只有 kg/tx 逐曲字段才填得上，
 *   配额在实际选曲里仍是「缺席即不限」；音频相似未移植；
 * - 导入归因（[RadioPlatform.importedOrigins]）返回空，M1 未保存导入来源映射。
 */
class RadioRuntime(
    private val player: PlayerRuntime,
    context: Context,
) {
    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val lists = ListRuntime.get(appContext)
    private val dislikes = DislikeStore(appContext)
    private val stateStore = RadioStateStore(appContext)

    /** 可注入随机源：种子固定后可复现（项目教训：不可注入的随机源会让用例抖动）。 */
    private val random = Random(System.currentTimeMillis())

    private val engine =
        RadioEngine(
            platform = Platform(),
            rng = { random.nextDouble() },
            now = { System.currentTimeMillis() },
            scope = scope,
        )

    private val pending = ArrayDeque<RecommendQueueItem>()
    private val committedKeys = mutableSetOf<String>()
    private val radioTrackKeys = mutableSetOf<String>()

    private var active = false
    private var starting = false
    private var mode = RadioMode.RADIO
    private var lastError: String? = null
    private var refilling = false
    private var reordering = false
    private var persistJob: Job? = null

    /** 读盘完成信号：播种与开播都要等它，避免被 `restoreState` 覆盖。 */
    private val stateRestored = CompletableDeferred<Unit>()

    /** 通道 E 的后台刷新（单飞）：产物进缓存/缓冲，不进取曲路径。 */
    private var similarRefreshJob: Job? = null

    @Volatile
    private var dislikeInfoCache = DislikeInfo()

    @Volatile
    private var blockedRules = DislikeRules.EMPTY

    private val _status = MutableStateFlow(RadioStatus())

    /** 面板订阅的状态（队列预览、会话健康、错误）。 */
    val status: StateFlow<RadioStatus> = _status.asStateFlow()

    init {
        engine.onStateChanged = { state -> schedulePersist(state) }
        scope.launch {
            runCatching { stateStore.read()?.let { engine.restoreState(it) } }
            stateRestored.complete(Unit)
            // 问卷播种必须在读盘之后：先恢复 themeWeights 再补播，否则读盘会把新播种覆盖回去
            runCatching { applyOnboardingSeeds() }
            refreshDislikeCache()
            publish()
        }
        scope.launch {
            player.core.state
                .map { it.tempPlayList }
                .distinctUntilChanged()
                .collect {
                    if (!active || reordering) return@collect
                    moveRadioTracksAfterUserTracks()
                    ensureCommitted()
                }
        }
    }

    // ---------- 只读查询 ----------

    fun isActive(): Boolean = active

    fun getMode(): RadioMode = mode

    fun isRadioTrack(musicInfo: JsonObject): Boolean = radioTrackKeys.contains(RadioTrackKeys.buildTrackKey(musicInfo))

    /** PlayerCore 的 `dislikeInfoProvider`：同步读缓存，切歌判定不能等 IO。 */
    fun dislikeInfo(): DislikeInfo = dislikeInfoCache

    fun statusOf(): RadioStatus = _status.value

    // ---------- 生命周期 ----------

    /**
     * 开播（RN `startRadio`）：清旧队 → 预热 → 取首批 → 提交 → 起播。
     * @return 失败原因；成功返回 null
     */
    suspend fun start(targetMode: RadioMode = RadioMode.RADIO): String? {
        if (starting) return "radio_starting"
        if (active && mode == targetMode) return null
        starting = true
        publish()
        try {
            stateRestored.await()
            refreshDislikeCache()
            if (active) stop()
            removeCommittedFromPlayerQueue()
            clearRadioPlayHistory()
            committedKeys.clear()
            radioTrackKeys.clear()
            pending.clear()
            active = true
            mode = targetMode
            lastError = null
            engine.startSession(targetMode)
            try {
                engine.warmUp(RadioConfig.Queue.TARGET_SIZE)
                pending.addAll(engine.getRecommendations(RadioConfig.Queue.TARGET_SIZE))
            } catch (error: Throwable) {
                active = false
                lastError = error.message ?: "no_candidates"
                publish()
                return lastError
            }
            ensureCommitted()
            if (committedKeys.isEmpty()) {
                active = false
                lastError = lastError ?: "no_candidates"
                publish()
                return lastError
            }
            // RN：已有当前曲就 playNext（补位曲排在队首），否则从头播临时列表；
            // 原生侧两条路径都是 playNext —— 临时列表非空时它优先消费队首。
            if (player.core.state.value.tempPlayList
                    .isNotEmpty()
            ) {
                player.core.playNext()
            }
            publish()
            scope.launch { refillPending(force = true) }
            return null
        } finally {
            starting = false
            publish()
        }
    }

    /** 停播（RN `stopRadio`）：撤掉所有未播的电台曲，并清掉电台写入的播放历史。 */
    suspend fun stop() {
        active = false
        pending.clear()
        removeCommittedFromPlayerQueue()
        clearRadioPlayHistory()
        committedKeys.clear()
        radioTrackKeys.clear()
        engine.endSession()
        lastError = null
        publish()
    }

    suspend fun toggle(targetMode: RadioMode = mode): String? {
        if (active) {
            stop()
            return null
        }
        return start(targetMode)
    }

    // ---------- 播放事件 ----------

    /**
     * 切歌事件（[cn.toside.music.core.player.PlayerCore.onMusicToggled]）。
     *
     * 两条 RN 语义：
     * 1. 用户切到某个具体列表（非临时曲且 listId 非空）→ 电台让位停播（`radio.ts:146`）；
     * 2. 临时曲且属于电台队列 → **写 playedList**（`radio.ts:151`，唯一写入点）。
     */
    suspend fun onMusicToggled(info: PlayMusicInfo) {
        if (!active) return
        val musicInfo = info.musicInfo ?: return
        if (!info.isTempPlay && !info.listId.isNullOrEmpty()) {
            stop()
            return
        }
        val key = RadioTrackKeys.buildTrackKey(musicInfo)
        if (info.isTempPlay && radioTrackKeys.contains(key)) {
            player.core.addPlayedList(PlayMusicInfo(info.listId, musicInfo, isTempPlay = true))
            engine.onMusicToggled(musicInfo)
            publish()
        }
    }

    // ---------- 偏好问卷 ----------

    /** 当前问卷答案（选项 id → 百分比），供问卷 UI 回填滑条；没答过返回空表。 */
    suspend fun onboardingAnswers(): Map<String, Double> = runCatching { RecommendStores.onboarding.weights() }.getOrElse { emptyMap() }

    /** 是否答过卷（决定推荐面板顶部的入口卡片是「去设置偏好」还是「已设置，可修改」）。 */
    suspend fun hasOnboardingAnswer(): Boolean = onboardingAnswers().isNotEmpty()

    /**
     * 提交问卷（RN `submitOnboarding`）：落盘 → 引擎播种 → 队列下次刷新吃到新净权。
     * 空表＝跳过问卷，此时只回退旧播种，不写入新分量。
     */
    suspend fun submitOnboarding(answers: Map<String, Double>): Map<String, Double> {
        val sanitized = runCatching { RecommendStores.onboarding.save(answers) }.getOrElse { answers }
        stateRestored.await()
        val applied = engine.applyOnboarding(sanitized, System.currentTimeMillis())
        publish()
        return applied
    }

    /** 把已落盘的问卷补播进分类净权（幂等；读盘完成前调用会等待）。 */
    suspend fun applyOnboardingSeeds() {
        stateRestored.await()
        val weights = runCatching { RecommendStores.onboarding.weights() }.getOrElse { emptyMap() }
        engine.applyOnboarding(weights, System.currentTimeMillis())
    }

    /** 播放进度采样（供引擎算收听区间；面板每秒调用即可）。 */
    fun observePlayback(
        positionMs: Long,
        playing: Boolean,
        durationMs: Long?,
    ) = engine.observePlayback(positionMs, playing, durationMs)

    fun onTrackEnded() = engine.onTrackEnded()

    fun onManualSkip() = engine.onManualSkip()

    fun onPlayError() = engine.onPlayError()

    // ---------- 反馈闭环 ----------

    suspend fun like(musicInfo: JsonObject) {
        engine.onLiked(musicInfo)
        refreshDislikeCache()
        publish()
    }

    suspend fun unlike(musicInfo: JsonObject) {
        engine.onUnliked(musicInfo)
        publish()
    }

    suspend fun addedToPlaylist(
        musicInfo: JsonObject,
        listId: String,
    ) {
        engine.onAddedToPlaylist(musicInfo, listId)
        publish()
    }

    /**
     * 「不感兴趣」闭环：持久化屏蔽（`@dislike_list`）+ 引擎显式负反馈 +
     * 从 pending/播放队列撤下；正在播这首歌时直接跳下一首。
     */
    suspend fun dislike(musicInfo: JsonObject): String? {
        val name = musicInfo.text("name")
        val singer = musicInfo.text("singer")
        val key = RadioTrackKeys.buildTrackKey(musicInfo)
        runCatching { dislikes.add(name, singer) }
            .onSuccess {
                dislikeInfoCache = it.toDislikeInfo()
                blockedRules = it
            }.onFailure { return "dislike_save_failed" }
        engine.onDislikedInfo(name.orEmpty(), singer.orEmpty())
        pending.removeAll { RadioTrackKeys.buildTrackKey(it.musicInfo) == key }
        val current = player.core.state.value.playMusicInfo
        val isCurrent = current.musicInfo?.let { RadioTrackKeys.buildTrackKey(it) == key } == true
        publish()
        if (isCurrent) player.core.playNext()
        return null
    }

    // ---------- 提交与补位 ----------

    private fun countCommitted(): Int {
        val present =
            player.core.state.value.tempPlayList.mapNotNullTo(mutableSetOf()) { item ->
                item.musicInfo?.let { RadioTrackKeys.buildTrackKey(it) }
            }
        committedKeys.retainAll(present)
        return committedKeys.size
    }

    private suspend fun ensureCommitted() {
        if (!active) return
        var ahead = countCommitted()
        while (ahead < RADIO_COMMIT_AHEAD && pending.isNotEmpty()) {
            val item = pending.removeFirst()
            val key = RadioTrackKeys.buildTrackKey(item.musicInfo)
            if (radioTrackKeys.contains(key)) continue
            // 补位前复检：入池后用户可能刚收藏/踩雷了同曲
            if (engine.isTrackExcluded(item.musicInfo)) continue
            committedKeys.add(key)
            radioTrackKeys.add(key)
            player.core.addTempPlayList(listOf(Triple<String?, JsonObject?, Boolean>(null, item.musicInfo, false)))
            ahead += 1
        }
        if (pending.size <= PENDING_LOW_WATER) refillPending()
        publish()
    }

    private suspend fun refillPending(force: Boolean = false) {
        if (refilling) return
        if (!active && !force) return
        if (!force && pending.size > PENDING_LOW_WATER) return
        refilling = true
        try {
            pending.addAll(engine.getRecommendations(PENDING_REFILL))
            lastError = null
        } catch (error: Throwable) {
            lastError = error.message
        } finally {
            refilling = false
        }
        ensureCommitted()
    }

    private suspend fun removeCommittedFromPlayerQueue(trackKey: String? = null) {
        val temp = player.core.state.value.tempPlayList
        val indexes = mutableListOf<Int>()
        temp.forEachIndexed { index, item ->
            val musicInfo = item.musicInfo ?: return@forEachIndexed
            val key = RadioTrackKeys.buildTrackKey(musicInfo)
            if (!radioTrackKeys.contains(key)) return@forEachIndexed
            if (trackKey != null && key != trackKey) return@forEachIndexed
            indexes.add(index)
        }
        for (index in indexes.asReversed()) player.core.removeTempPlayList(index)
        if (trackKey != null) {
            committedKeys.remove(trackKey)
            radioTrackKeys.remove(trackKey)
        }
    }

    private suspend fun clearRadioPlayHistory() {
        val played = player.core.state.value.playedList
        for (index in played.indices.reversed()) {
            val item = played[index]
            val musicInfo = item.musicInfo ?: continue
            if (!item.isTempPlay) continue
            if (!radioTrackKeys.contains(RadioTrackKeys.buildTrackKey(musicInfo))) continue
            player.core.removePlayedList(index)
        }
    }

    /** 电台补位曲必须排在用户手动「稍后播放」的歌之后（RN `moveRadioTracksAfterUserTracks`）。 */
    private suspend fun moveRadioTracksAfterUserTracks() {
        val temp = player.core.state.value.tempPlayList
        val flags = mutableListOf<Boolean>()
        val entries = mutableListOf<JsonObject>()
        for (item in temp) {
            val musicInfo = item.musicInfo
            val isRadio = musicInfo != null && radioTrackKeys.contains(RadioTrackKeys.buildTrackKey(musicInfo))
            flags.add(isRadio)
            if (isRadio && musicInfo != null) entries.add(musicInfo)
        }
        if (!TempQueueOrder.hasUserTrackAfterRadio(flags)) return
        reordering = true
        try {
            for (index in flags.indices.reversed()) {
                if (flags[index]) player.core.removeTempPlayList(index)
            }
            if (entries.isNotEmpty()) {
                player.core.addTempPlayList(entries.map { Triple<String?, JsonObject?, Boolean>(null, it, false) })
            }
        } finally {
            reordering = false
        }
    }

    // ---------- 状态与持久化 ----------

    private fun publish() {
        val summary = runCatching { engine.getSummary() }.getOrNull()
        _status.value =
            RadioStatus(
                active = active,
                starting = starting,
                mode = mode,
                pending = pending.size,
                committed = committedKeys.size,
                upcoming = engine.peekQueue(6).map { it.musicInfo.text("name").orEmpty() },
                poolSize = summary?.poolSize ?: 0,
                queueSize = summary?.queueSize ?: 0,
                channelShare = summary?.channelShare ?: emptyMap(),
                safeMode = summary?.sessionHealth?.safeMode ?: false,
                negativeStreak = summary?.sessionHealth?.negativeStreak ?: 0,
                sampleSize = summary?.sessionHealth?.sampleSize ?: 0,
                error = lastError,
            )
    }

    /** RN 的 1500ms 存储防抖：逐笔结算不逐笔落盘。 */
    private fun schedulePersist(state: RadioState) {
        persistJob?.cancel()
        persistJob =
            scope.launch {
                delay(PERSIST_DEBOUNCE_MS)
                stateStore.write(state)
            }
    }

    private suspend fun refreshDislikeCache() {
        val rules = runCatching { dislikes.rules() }.getOrNull() ?: return
        blockedRules = rules
        dislikeInfoCache = rules.toDislikeInfo()
    }

    // ---------- 平台实现 ----------

    private inner class Platform : RadioPlatform {
        override suspend fun buildProfile(): RadioProfile = buildRadioProfile()

        override suspend fun buildExclusion(): ExclusionContext = buildRadioExclusion()

        override suspend fun fetchCandidates(
            reason: String,
            budget: Int,
            rotation: Int,
            now: Long,
        ): RadioFetchResult = fetchPool(reason, budget, rotation, now)

        override fun pendingItems(): List<RecommendQueueItem> = pending.toList()

        override fun onTrackRemoved(trackKey: String) {
            pending.removeAll { RadioTrackKeys.buildTrackKey(it.musicInfo) == trackKey }
            scope.launch { removeCommittedFromPlayerQueue(trackKey) }
        }

        override suspend fun importedOrigins(trackKey: String): List<String> = emptyList()
    }

    /** 画像：M1 的歌手先验 + 「我喜欢的/播放历史」作为种子（M1 未存种子曲目表）。 */
    private suspend fun buildRadioProfile(): RadioProfile {
        val now = System.currentTimeMillis()
        val learned = runCatching { RecommendProfileRuntime.load(now) }.getOrNull()
        val topArtists =
            learned
                ?.artistStats
                .orEmpty()
                .mapNotNull { (artist, pref) ->
                    val weight = pref.positiveWeight - pref.negativeWeight
                    if (weight > 0) RadioArtist(artist, weight) else null
                }.sortedByDescending { it.weight }
                .take(MAX_PROFILE_ARTISTS)
        val seeds =
            seedTracks().mapNotNull { info ->
                val key = RadioTrackKeys.buildTrackKey(info)
                if (key.isEmpty()) return@mapNotNull null
                RadioSeed(
                    trackKey = key,
                    score = 1.0,
                    musicInfo = info,
                    primaryArtist = RadioTrackKeys.getPrimaryArtist(info),
                )
            }
        return RadioProfile(
            seedKeys = seeds.mapTo(mutableSetOf()) { it.trackKey },
            seeds = seeds,
            topArtists = topArtists,
        )
    }

    /** 种子曲目：收藏 + 播放历史 + 内存 playedList（与 M1 画像的信号同源）。 */
    private suspend fun seedTracks(): List<JsonObject> {
        val result = mutableListOf<JsonObject>()
        runCatching { lists.musics(StorageKeys.ListIds.LOVE) }.getOrNull()?.let { result.addAll(it.take(MAX_PROFILE_SEEDS)) }
        player.core.state.value.playedList
            .mapNotNullTo(result) { it.musicInfo }
        return result.distinctBy { RadioTrackKeys.buildTrackKey(it) }.take(MAX_PROFILE_SEEDS)
    }

    private suspend fun buildRadioExclusion(): ExclusionContext {
        val now = System.currentTimeMillis()
        val libraryKeys = mutableSetOf<String>()
        val pairKeys = mutableSetOf<String>()
        val localTrackLists =
            buildList {
                runCatching { lists.musics(StorageKeys.ListIds.LOVE) }.getOrNull()?.let { add(it) }
                player.core.state.value.playedList
                    .mapNotNull { it.musicInfo }
                    .let { add(it) }
            }
        for (tracks in localTrackLists) {
            for (info in tracks) {
                libraryKeys.add(RadioFilterIdentity.trackKey(info))
                pairKeys.add(RadioFilterIdentity.pairKey(info))
            }
        }
        return ExclusionContext(
            libraryKeys = libraryKeys,
            libraryPairKeys = pairKeys,
            dislikedTrackKeys = engine.state.dislikedTracks.keys,
            sessionTrackKeys =
                engine.state.session.recentTracks
                    .mapTo(mutableSetOf()) { it.trackKey },
            recentRadioTrackKeys = RadioBehavior.getRecentRadioTrackKeys(engine.state, RadioConfig.Exclusions.RECENT_RADIO_DAYS, now),
            blocked = blockedRules,
        )
    }

    /**
     * 候选抓取（RN `refreshExternalCandidates` 的四路版）：
     * 画像歌手直采（A）、榜单轮换（D/A）、推荐歌单（B）、相似歌手（E）。
     *
     * 通道 E 是**异步供货**：这里只顺手踢一轮后台刷新，再从缓冲取上一轮的货。
     * 刷新本身（MB/LB 全局限 1 req/s）绝不占取曲路径的延迟预算；
     * 缓冲空 = 本轮 E 让位，配额自动分给有货的通道。
     */
    private suspend fun fetchPool(
        reason: String,
        budget: Int,
        rotation: Int,
        now: Long,
    ): RadioFetchResult {
        val profile = buildRadioProfile()
        val params = CandidateBuildParams(profile, now, buildRadioExclusion(), engine.state.themeWeights)
        val candidates = mutableListOf<PoolCandidate>()
        val observed = mutableListOf<ObservedPlaylist>()
        val reasons = mutableListOf<String>()
        var requests = 0
        kickSimilarArtistRefresh(profile, now)
        val steps = if (reason.endsWith("_supplement")) 1 else (budget / 4).coerceIn(1, 3)
        for (offset in 0 until steps) {
            val step = (rotation + offset) % FETCH_STEPS
            requests +=
                when (step) {
                    0 -> fetchArtistHits(params, rotation, candidates, reasons)
                    1 -> fetchChart(params, rotation, candidates, reasons)
                    2 -> fetchPlaylist(params, rotation, candidates, observed, reasons)
                    3 -> fetchSimilarArtist(params, rotation, candidates, reasons)
                    else -> fetchDiscovery(params, rotation, candidates, observed, reasons)
                }
        }
        val merged = RadioPool.mergeCandidates(emptyList(), candidates)
        if (merged.isEmpty()) reasons.add("no_candidates:$reason")
        return RadioFetchResult(candidates = merged, observedPlaylists = observed, requests = requests, reasons = reasons)
    }

    private suspend fun fetchArtistHits(
        params: CandidateBuildParams,
        rotation: Int,
        candidates: MutableList<PoolCandidate>,
        reasons: MutableList<String>,
    ): Int {
        val artists =
            params.profile.topArtists
                .map { it.artist }
                .take(MAX_ARTIST_HITS)
        if (artists.isEmpty()) return 0
        val artist = artists[rotation % artists.size]
        val page = runCatching { SearchRuntime.search(artist, 1, SEARCH_SOURCE) }.getOrNull() ?: return 1
        val hits = RadioCandidates.createArtistHitCandidates(page.list.take(TRACKS_PER_SOURCE), artist, params)
        candidates.addAll(hits)
        reasons.add("artist_hits:$artist:${hits.size}")
        return 1
    }

    private suspend fun fetchChart(
        params: CandidateBuildParams,
        rotation: Int,
        candidates: MutableList<PoolCandidate>,
        reasons: MutableList<String>,
    ): Int {
        val source = CHART_SOURCES[rotation % CHART_SOURCES.size]
        val boards = LeaderboardRuntime.boards(source)
        if (boards.isEmpty()) return 0
        val board = boards[rotation % boards.size]
        val list = runCatching { LeaderboardRuntime.getListDetailAll(board.id) }.getOrNull() ?: return 1
        val tracks = list.take(TRACKS_PER_SOURCE).mapIndexed { index, info -> info to index + 1 }
        val chartCandidates = RadioCandidates.createChartCandidates(tracks, board.id, params)
        candidates.addAll(chartCandidates)
        reasons.add("chart:${board.id}:${chartCandidates.size}")
        return 1
    }

    private suspend fun fetchPlaylist(
        params: CandidateBuildParams,
        rotation: Int,
        candidates: MutableList<PoolCandidate>,
        observed: MutableList<ObservedPlaylist>,
        reasons: MutableList<String>,
    ): Int {
        val curated = runCatching { RecommendRuntime.getCuratedPlaylists(count = 3) }.getOrNull() ?: return 1
        val item = curated.list.getOrNull(rotation % maxOf(1, curated.list.size)) ?: return 1
        val tracks = runCatching { SonglistRuntime.getListDetailAll(item.source, item.id) }.getOrNull() ?: return 1
        if (tracks.isEmpty()) return 1
        val observedPlaylist =
            ObservedPlaylist(
                id = "${item.source}__${item.id}",
                source = item.source,
                name = item.name,
                author = item.author,
                desc = item.desc,
                category = curated.tagName,
                totalTracks = item.total ?: tracks.size,
                trackKeys = tracks.take(TRACKS_PER_SOURCE).map { RadioTrackKeys.buildTrackKey(it) },
                pagesFetched = 1,
                seedTrackKeys = params.profile.seedKeys.filter { key -> tracks.any { RadioTrackKeys.buildTrackKey(it) == key } },
                fetchedAt = params.now,
                confidence =
                    RadioCandidates.playlistCoverageConfidence(
                        tracks.size.toDouble() / maxOf(1, item.total ?: tracks.size),
                        1,
                    ),
                confirmed = false,
            )
        observed.add(observedPlaylist)
        val playlistCandidates =
            RadioCandidates.createPlaylistCandidates(
                observedPlaylist,
                tracks.take(TRACKS_PER_SOURCE),
                params,
                ChannelId.B,
            )
        candidates.addAll(playlistCandidates)
        reasons.add("playlist:${observedPlaylist.id}:${playlistCandidates.size}")
        return 1
    }

    /**
     * 通道 E 取货：只读缓冲，**不发请求**（返回 0 表示本轮没有占用取曲预算）。
     * 缓冲由 [kickSimilarArtistRefresh] 拉起的后台任务填充。
     */
    private fun fetchSimilarArtist(
        params: CandidateBuildParams,
        rotation: Int,
        candidates: MutableList<PoolCandidate>,
        reasons: MutableList<String>,
    ): Int {
        val runtime = runCatching { RecommendStores.similarArtist }.getOrNull() ?: return 0
        val songs = runCatching { runtime.drainBuffered() }.getOrNull().orEmpty()
        if (songs.isEmpty()) {
            reasons.add("similar_artist:empty")
            return 0
        }
        // 轮换起点按 rotation 错开，避免每次都先吃同一批种子歌手
        val ordered = songs.sortedBy { it.seedArtist }
        val start = rotation % ordered.size
        val picked = (ordered.drop(start) + ordered.take(start)).take(MAX_SIMILAR_SEEDS)
        val contributions = picked.map { SimilarArtistContribution(it.seedArtist, it.artistName, it.tracks) }
        val created = RadioCandidates.createSimilarArtistCandidates(contributions, params)
        candidates.addAll(created)
        reasons.add("similar_artist:${created.size}")
        return 0
    }

    /**
     * 踢一轮通道 E 的后台刷新（单飞）：一次仅一位种子歌手推进一格阶段，
     * 所以这行不会堆积任务，只会在电台活跃时慢慢把 E 的缓存铺满。
     */
    private fun kickSimilarArtistRefresh(
        profile: RadioProfile,
        now: Long,
    ) {
        if (similarRefreshJob?.isActive == true) return
        val seeds =
            profile.topArtists
                .sortedByDescending { it.weight }
                .map { it.artist }
                .take(MAX_SIMILAR_SEEDS)
        if (seeds.isEmpty()) return
        val runtime = runCatching { RecommendStores.similarArtist }.getOrNull() ?: return
        similarRefreshJob =
            scope.launch(Dispatchers.IO) {
                runCatching { runtime.refresh(seeds, now) }
                // MB 艺人事实 / kg 搜歌结果回灌的歌手语言表统一落盘
                runCatching { RecommendStores.artistLang.flush() }
            }
    }

    /**
     * 探索通道 C（任务 8）：原生侧没有音频特征也没有跨歌单共现索引，
     * 所以 RN 的「相似曲」这条来源**不做**，改用两条不依赖音频信号的来源：
     *
     * 1. 语种缺口补货 —— 问卷里**明确想要**（> 50%）的语言关键词去搜歌。
     *    低于中性点的语言项是「不想听」，拿来补货等于逆着用户表态推歌，必须排除；
     * 2. 新鲜歌单 —— 分类目录里按画像关键词挑标签，用「最新」排序取一张没见过的歌单。
     *
     * 两条都是「撞新」性质，产出统一归 C；配额由 `Channels.plan` 的 A7/B5/C4/D2/E2 约束，
     * 本函数不额外限量。
     */
    private suspend fun fetchDiscovery(
        params: CandidateBuildParams,
        rotation: Int,
        candidates: MutableList<PoolCandidate>,
        observed: MutableList<ObservedPlaylist>,
        reasons: MutableList<String>,
    ): Int {
        var requests = 0
        requests += fetchDiscoveryRestock(params, rotation, candidates, reasons)
        requests += fetchDiscoveryPlaylist(params, rotation, candidates, observed, reasons)
        return requests
    }

    /** 语种缺口补货：搜歌而不是搜歌单 —— 原生没有「按关键词搜歌单」这条通道。 */
    private suspend fun fetchDiscoveryRestock(
        params: CandidateBuildParams,
        rotation: Int,
        candidates: MutableList<PoolCandidate>,
        reasons: MutableList<String>,
    ): Int {
        val weights = runCatching { RecommendStores.onboarding.weights() }.getOrNull().orEmpty()
        val keyword = Discovery.pickRestockKeyword(weights, rotation)
        if (keyword == null) {
            reasons.add("discovery_restock:no_language_preference")
            return 0
        }
        val page = runCatching { SearchRuntime.search(keyword, 1, SEARCH_SOURCE) }.getOrNull() ?: return 1
        val tracks = page.list.take(TRACKS_PER_SOURCE)
        if (tracks.isEmpty()) return 1
        val created = RadioCandidates.createDiscoveryCandidates(tracks, keyword, params)
        candidates.addAll(created)
        reasons.add("discovery_restock:$keyword:${created.size}")
        return 1
    }

    /** 新鲜歌单：标签轮换 + 最新排序，取一张歌单的曲目归 C（并记进 observedPlaylists）。 */
    private suspend fun fetchDiscoveryPlaylist(
        params: CandidateBuildParams,
        rotation: Int,
        candidates: MutableList<PoolCandidate>,
        observed: MutableList<ObservedPlaylist>,
        reasons: MutableList<String>,
    ): Int {
        val source = DISCOVERY_SOURCES[Math.floorMod(rotation, DISCOVERY_SOURCES.size)]
        val sorts = runCatching { SonglistRuntime.sorts(source) }.getOrNull().orEmpty()
        if (sorts.isEmpty()) return 0
        // 成新率固定 1.0：RN 的 0.3 是给「一次刷新跑十几次发现请求」设计的，
        // 原生一次只跑 1-3 步，按 0.3 算 C 几乎永远没货（详见 lane 报告的降级清单）。
        val pick = Discovery.pickSort(sorts, rotation, RecommendSelection.pickHotSort(sorts)?.id, ratio = 1.0)
        val tags = runCatching { SonglistRuntime.getTags(source) }.getOrNull() ?: return 1
        val catalogue = RecommendSelection.flattenTags(tags)
        if (catalogue.isEmpty()) return 1
        val prefKeywords =
            runCatching { RecommendStores.onboarding.weights() }
                .getOrNull()
                ?.let { Onboarding.computePreferenceKeywords(it) }
                .orEmpty()
        val tag =
            if (prefKeywords.isEmpty()) {
                RecommendSelection.pickTag(catalogue, rotation)
            } else {
                PlaylistRank.pickPlaylistTag(catalogue, { it.name }, engine.state.themeWeights, prefKeywords, rotation, params.now)
            }
        if (tag == null) return 1
        val pageNum = 1 + Math.floorMod(rotation, 3)
        val page = runCatching { SonglistRuntime.getList(source, pick.sortId, tag.id, pageNum) }.getOrNull() ?: return 2
        if (page.list.isEmpty()) return 2
        val item = page.list[Math.floorMod(rotation, page.list.size)]
        val tracks = runCatching { SonglistRuntime.getListDetailAll(item.source, item.id) }.getOrNull() ?: return 3
        if (tracks.isEmpty()) return 3
        val observedPlaylist =
            ObservedPlaylist(
                id = "${item.source}__${item.id}",
                source = item.source,
                name = item.name,
                author = item.author,
                desc = item.desc,
                category = tag.name,
                totalTracks = item.total ?: tracks.size,
                trackKeys = tracks.take(TRACKS_PER_SOURCE).map { RadioTrackKeys.buildTrackKey(it) },
                pagesFetched = 1,
                seedTrackKeys = emptyList(),
                fetchedAt = params.now,
                confidence = RadioCandidates.playlistCoverageConfidence(1.0, 1),
                confirmed = false,
            )
        observed.add(observedPlaylist)
        val created =
            RadioCandidates.createPlaylistCandidates(
                observedPlaylist,
                tracks.take(TRACKS_PER_SOURCE),
                params,
                ChannelId.C,
            )
        candidates.addAll(created)
        reasons.add("discovery_playlist:${item.id}${if (pick.useNew) ":newest" else ":hot"}:${created.size}")
        return 3
    }

    companion object {
        private const val RADIO_COMMIT_AHEAD = 2
        private const val PENDING_LOW_WATER = 4
        private const val PENDING_REFILL = 10
        private const val PERSIST_DEBOUNCE_MS = 1500L
        private const val MAX_PROFILE_ARTISTS = 12
        private const val MAX_PROFILE_SEEDS = 40
        private const val MAX_ARTIST_HITS = 3
        private const val MAX_SIMILAR_SEEDS = 4
        private const val TRACKS_PER_SOURCE = 20
        private const val FETCH_STEPS = 5
        private const val SEARCH_SOURCE = "kw"

        private val CHART_SOURCES = listOf("kw", "kg", "tx", "wy", "mg")

        /** 探索通道只用目录结构稳定的源（kg/kw/tx 的分类目录覆盖最全）。 */
        private val DISCOVERY_SOURCES = listOf("kw", "kg", "tx")
    }
}

/** 排除集判定用的曲目身份（与 `RadioFilter` 的 key 形状保持一致）。 */
internal object RadioFilterIdentity {
    fun trackKey(musicInfo: JsonObject): String = RadioTrackKeys.buildTrackKey(musicInfo)

    fun pairKey(musicInfo: JsonObject): String = RadioTrackKeys.exactPairKey(musicInfo.text("name"), musicInfo.text("singer"))
}

internal fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
