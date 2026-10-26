package cn.toside.music.core.recommend.radio

import cn.toside.music.core.recommend.m3.Onboarding
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.serialization.json.JsonObject
import kotlin.math.max
import kotlin.math.min

/** 外部候选抓取结果：抓取由 app 的 RadioRuntime 完成，core 只消费候选。 */
data class RadioFetchResult(
    val candidates: List<PoolCandidate> = emptyList(),
    val observedPlaylists: List<ObservedPlaylist> = emptyList(),
    val requests: Int = 0,
    val reasons: List<String> = emptyList(),
)

/**
 * 电台平台接口 —— app 侧实现：
 * 画像（M1）、排除集（歌库/踩雷/队列）、外部候选抓取、已移交待播队列。
 */
interface RadioPlatform {
    suspend fun buildProfile(): RadioProfile?

    suspend fun buildExclusion(): ExclusionContext

    suspend fun fetchCandidates(
        reason: String,
        budget: Int,
        rotation: Int,
        now: Long,
    ): RadioFetchResult

    /** 已移交给播放器但尚未播出的电台曲目。 */
    fun pendingItems(): List<RecommendQueueItem> = emptyList()

    /** 安全模式/不喜欢时通知 app 从播放器待播队列移除。 */
    fun onTrackRemoved(trackKey: String) = Unit

    /** 本地库中该曲来自哪些网络歌单（导入归因用）。 */
    suspend fun importedOrigins(trackKey: String): List<String> = emptyList()
}

data class RadioSummary(
    val mode: RadioMode,
    val queueSize: Int,
    val poolSize: Int,
    val channels: Map<ChannelId, Int>,
    val channelShare: Map<ChannelId, Double>,
    val sessionTracks: Int,
    val sessionHealth: SessionHealth,
    val lastRefreshAt: Long,
    val reasons: List<String>,
)

/**
 * 个性电台引擎 —— RN `core/recommend/index.ts` 的 M2 子集。
 *
 * 负责：候选池刷新单飞、队列生成（画像打分 → 通道配额 → 降级选曲）、
 * 播放追踪与结算、显式反馈、安全模式撤队、画像反馈补池。
 * 网络抓取、持久化与播放器队列由 app 侧通过 [RadioPlatform] 与回调接入。
 */
class RadioEngine(
    private val platform: RadioPlatform,
    private val rng: () -> Double,
    private val now: () -> Long,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) {
    var state: RadioState = RadioState()
        private set

    var onStateChanged: ((RadioState) -> Unit)? = null

    private val queue = RadioQueue()
    private val served = LinkedHashMap<String, RecommendQueueItem>()
    private val refreshMutex = Mutex()
    private var currentItem: RecommendQueueItem? = null
    private var currentPlayId: String? = null
    private var currentTrackKey: String? = null
    private var currentTracker: PlaybackTrackerState? = null
    private var batchId = 0
    private var lastRefreshAt = 0L
    private var lastRefreshReasons: List<String> = emptyList()
    private var radioMode: RadioMode = RadioMode.RADIO
    private var lastSafeModeAt = 0L
    private var lastIdleCrawlAt = 0L
    private var profileRevision = 0
    private var lastRefreshRevision = 0
    private var lastProfileRefreshAt = 0L
    private var rotation = 0
    private var stateReady = false
    private val recentPlayed = ArrayDeque<RecentPlayed>()

    private data class RecentPlayed(
        val musicInfo: JsonObject,
        val channel: ChannelId?,
        val playlistId: String?,
        val seedKey: String?,
        val groupId: String?,
        val chartId: String?,
    )

    fun restoreState(loaded: RadioState) {
        state = loaded
        stateReady = true
        emitState()
    }

    fun getMode(): RadioMode = radioMode

    fun getProfileRevision(): Int = profileRevision

    fun getPoolSize(): Int = state.candidateCache.size

    fun getQueueSize(): Int = queue.size()

    fun peekQueue(count: Int = 5): List<RecommendQueueItem> = queue.peek(count)

    fun getSummary(): RadioSummary {
        val counts = Channels.emptyCounts()
        for (item in queue.snapshot().items) counts[item.channel] = counts.getValue(item.channel) + 1
        val total = counts.values.sum().toDouble()
        val disliked = state.dislikedTracks.keys
        return RadioSummary(
            mode = radioMode,
            queueSize = queue.size(),
            poolSize = state.candidateCache.size,
            channels = counts,
            channelShare = counts.mapValues { if (total > 0) it.value / total else 0.0 },
            sessionTracks = state.session.recentTracks.size,
            sessionHealth = SessionHealthLogic.compute(state.session, disliked),
            lastRefreshAt = lastRefreshAt,
            reasons = lastRefreshReasons,
        )
    }

    fun startSession(mode: RadioMode) {
        queue.invalidate()
        served.clear()
        lastSafeModeAt = 0
        if (radioMode != mode) {
            state = state.copy(session = SessionPreference())
            emitState()
        }
        radioMode = mode
    }

    fun endSession() {
        queue.invalidate()
        served.clear()
    }

    /**
     * 问卷播种（RN `submitOnboarding` 的等价物，同时兼作启动补播）：
     * 先按 [RadioState.onboardingSeeded] 对称回退旧初值，再按新百分比播种。
     *
     * 幂等：同一份答案重放两次净变化为零，所以启动时无条件调用一次是安全的。
     * 空答案＝跳过问卷（只回退、不播种），完成后 `onboardingWeights` 为空表示「没表态」。
     *
     * @return 归一化后的答案（UI 拿它回填滑条，别再自己 sanitize 一遍）
     */
    fun applyOnboarding(
        answers: Map<String, Double>,
        now: Long = now(),
    ): Map<String, Double> {
        val sanitized = Onboarding.sanitizeWeights(answers)
        // 答案没变就不动状态：播种分量是答案的纯函数，重退重播本就净变化为零
        if (sanitized == state.onboardingWeights) return sanitized
        val themes = state.themeWeights.toMutableMap()
        if (state.onboardingSeeded.isNotEmpty()) Onboarding.revokeSeedWeights(themes, state.onboardingSeeded)
        val seeds = Onboarding.computeSeedWeights(sanitized)
        if (seeds.isNotEmpty()) Onboarding.applySeedWeights(themes, seeds, now)
        state =
            state
                .copy(
                    themeWeights = themes,
                    onboardingWeights = sanitized,
                    onboardingSeeded = seeds,
                ).trim(now)
        markProfileLearned()
        emitState()
        return sanitized
    }

    suspend fun warmUp(target: Int = RadioConfig.Queue.TARGET_SIZE): Int {
        ensurePoolAvailable()
        if (queue.size() < target) generateQueue(target)
        if (queue.size() == 0) throw IllegalStateException("no_candidates")
        return queue.size()
    }

    suspend fun getRecommendations(count: Int): List<RecommendQueueItem> {
        if (queue.size() < count) generateQueue(max(count, RadioConfig.Queue.TARGET_SIZE))
        var token = queue.version
        var items = queue.shift(count, token)
        if (items.isEmpty()) {
            runCatching { triggerRefresh("empty_queue", 4) }
            generateQueue(max(count, RadioConfig.Queue.TARGET_SIZE))
            token = queue.version
            items = queue.shift(count, token)
        }
        items = filterServedItems(items)
        for (item in items) rememberServed(item)
        return items
    }

    private suspend fun buildExclusion(): ExclusionContext {
        val base = platform.buildExclusion()
        // RN 把电台自身的踩雷表与已移交待播曲目并进排除集；platform 只能看到 app 侧数据
        val disliked = state.dislikedTracks.keys
        val queued = platform.pendingItems().mapTo(mutableSetOf()) { RadioTrackKeys.buildTrackKey(it.musicInfo) }
        return base.copy(
            dislikedTrackKeys = base.dislikedTrackKeys + disliked,
            queuedTrackKeys = base.queuedTrackKeys + queued,
        )
    }

    suspend fun triggerRefresh(
        reason: String,
        budget: Int = RadioConfig.Request.MAX_REQUESTS_PER_REFRESH,
    ): Boolean {
        if (!refreshMutex.tryLock()) return false
        return try {
            refreshPool(reason, budget)
        } finally {
            refreshMutex.unlock()
        }
    }

    private suspend fun refreshPool(
        reason: String,
        budget: Int,
    ): Boolean {
        val nowMs = now()
        return try {
            val result = platform.fetchCandidates(reason, budget, rotation, nowMs)
            rotation += 1
            var observed = state.observedPlaylists
            for (playlist in result.observedPlaylists) observed = observed + (playlist.id to playlist)
            var cache = RadioPool.mergeCandidates(state.candidateCache, result.candidates, RadioConfig.CandidatePool.MAX_SIZE)
            cache = RadioPool.filterPoolCandidates(cache, buildExclusion())
            state =
                state
                    .copy(
                        candidateCache = cache,
                        observedPlaylists = observed,
                        candidateCacheFetchedAt = nowMs,
                    ).trim(nowMs)
            lastRefreshAt = nowMs
            lastRefreshReasons = result.reasons
            if (result.candidates.isNotEmpty()) lastRefreshRevision = profileRevision
            emitState()
            result.candidates.isNotEmpty() ||
                state.candidateCache.size >= RadioConfig.CandidatePool.MIN_CACHE_FOR_INSTANT_START
        } catch (error: Throwable) {
            lastRefreshReasons = listOf("refresh_error:${error.message}")
            false
        }
    }

    private suspend fun ensurePoolAvailable() {
        if (state.candidateCache.isNotEmpty()) {
            if (now() - state.candidateCacheFetchedAt > RadioConfig.CandidatePool.CANDIDATE_TTL_MS) {
                launchRefresh("ttl", RadioConfig.Request.MAX_REQUESTS_PER_REFRESH)
            }
            return
        }
        triggerRefresh("initial", RadioConfig.Request.MAX_REQUESTS_PER_REFRESH)
        if (state.candidateCache.isEmpty()) throw IllegalStateException("no_candidates")
    }

    private fun launchRefresh(
        reason: String,
        budget: Int,
    ) {
        scope.launch {
            runCatching { triggerRefresh(reason, budget) }
        }
    }

    private fun maybeIdleCrawl() {
        if (state.candidateCache.size >= RadioConfig.CandidatePool.TARGET_SIZE) return
        val nowMs = now()
        if (nowMs - lastRefreshAt < RadioConfig.IdleCrawl.MIN_INTERVAL_MS) return
        if (nowMs - lastIdleCrawlAt < RadioConfig.IdleCrawl.MIN_INTERVAL_MS) return
        lastIdleCrawlAt = nowMs
        launchRefresh("idle_crawl", RadioConfig.Request.MAX_REQUESTS_PER_REFRESH * RadioConfig.IdleCrawl.BUDGET_MULTIPLIER)
    }

    private fun isColdStart(profile: RadioProfile): Boolean {
        if (profile.seeds.size >= RadioConfig.Profile.MIN_PROFILE_SEEDS) return false
        val topWeight = profile.topArtists.firstOrNull()?.weight ?: 0.0
        val strongArtists =
            profile.topArtists.count { it.weight >= topWeight * RadioConfig.Profile.STRONG_ARTIST_WEIGHT_RATIO }
        return strongArtists < RadioConfig.Profile.MIN_STRONG_ARTISTS
    }

    private suspend fun generateQueue(count: Int): Boolean {
        val token = queue.version
        ensurePoolAvailable()
        val exclusion = buildExclusion()
        state = state.copy(candidateCache = RadioPool.filterPoolCandidates(state.candidateCache, exclusion))
        val target = max(1, min(count, RadioConfig.Queue.TARGET_SIZE))
        if (state.candidateCache.size < RadioConfig.CandidatePool.TARGET_SIZE && now() - lastRefreshAt > 30_000) {
            launchRefresh("pool_below_target", RadioConfig.Request.MAX_REQUESTS_PER_REFRESH)
        }
        val profile = platform.buildProfile() ?: RadioProfile()
        val dislikedTrackKeys = state.dislikedTracks.keys.toSet()
        val health = SessionHealthLogic.compute(state.session, dislikedTrackKeys)
        val penalties = SessionHealthLogic.buildPenalties(state.session, dislikedTrackKeys)
        val nowMs = now()
        val finalItems =
            RadioPool.buildFinalQueueItems(
                state.candidateCache,
                FinalQueueBuildOptions(
                    playlistPreferences = state.playlists,
                    observedPlaylists = state.observedPlaylists,
                    exposureCounts = state.exposureCounts,
                    seedCount = profile.seeds.size,
                    now = nowMs,
                    mode = radioMode,
                    sessionPenalties = penalties,
                    tokenWeights = state.tokenWeights,
                    artistStats = state.artistStats,
                ),
            )
        if (finalItems.isEmpty()) return false
        val availability = Channels.emptyCounts()
        for (item in finalItems) {
            for (channel in item.channels) availability[channel] = availability.getValue(channel) + 1
        }
        val recentChannels = state.session.recentChannels + queue.snapshot().items.map { it.channel }
        val coldStart = isColdStart(profile)
        val exploration =
            SessionHealthLogic.resolveExploration(
                radioMode,
                health.explorationFactor,
                RadioConfig.RadioExploration.GAP,
            )
        val plan =
            Channels.plan(
                target,
                recentChannels,
                availability,
                Channels.PlanOptions(
                    coldStart = coldStart,
                    mode = radioMode,
                    explorationFactor = exploration.explorationFactor,
                    bandit = state.channelBandit,
                    rng = rng,
                    now = nowMs,
                ),
            )
        val temperature =
            if (health.safeMode) RadioConfig.Softmax.SAFE_MODE_TEMPERATURE else RadioConfig.Softmax.TEMPERATURE
        val selection =
            RadioSelection.select(
                finalItems,
                SelectionOptions(
                    target = target,
                    recent = buildRecentSelectionItems(),
                    channelPlan = plan,
                    rng = rng,
                    temperature = temperature,
                    explorationGap = exploration.explorationGap,
                ),
            )
        if (selection.items.isEmpty()) return false
        val byKey = state.candidateCache.associateBy { it.trackKey }
        batchId += 1
        val queueItems =
            selection.items.mapNotNull { selected ->
                val candidate = byKey[selected.item.key] ?: return@mapNotNull null
                toQueueItem(candidate, selected.channel, batchId)
            }
        if (token != queue.version) return false
        val accepted = queue.enqueue(queueItems, token)
        if (accepted) maybeIdleCrawl()
        return accepted
    }

    private fun toQueueItem(
        candidate: PoolCandidate,
        channel: ChannelId,
        batchId: Int,
    ): RecommendQueueItem =
        RecommendQueueItem(
            musicInfo = candidate.musicInfo,
            source = if (channel == ChannelId.C || channel == ChannelId.D) CandidateSource.CHART else CandidateSource.RELATED,
            channel = channel,
            sourcePlaylistId = candidate.playlistIds.firstOrNull(),
            sourceSeedTrackKey = candidate.seedTrackKeys.firstOrNull(),
            sourceClusterId = null,
            sourceChartId = candidate.chartId,
            batchId = batchId,
            reason = pickReason(candidate.reasons),
        )

    /** 入选线索：优先歌手直采 > 相似歌手 > 歌单来源 > 榜单。 */
    private fun pickReason(reasons: List<String>): String? =
        reasons.firstOrNull { it.startsWith("artist_hits:") }
            ?: reasons.firstOrNull { it.startsWith("similar_artist:") }
            ?: reasons.firstOrNull { it.startsWith("playlist:") }
            ?: reasons.firstOrNull { it.startsWith("chart") }

    private fun buildRecentSelectionItems(limit: Int = 60): List<FinalQueueItem> {
        val items = mutableListOf<FinalQueueItem>()
        val recentPlayedKeys = recentPlayed.mapTo(mutableSetOf()) { RadioTrackKeys.buildTrackKey(it.musicInfo) }

        fun push(
            musicInfo: JsonObject,
            channel: ChannelId?,
            playlistId: String?,
            seedKey: String?,
            groupId: String?,
            chartId: String?,
        ) {
            val key = RadioTrackKeys.buildTrackKey(musicInfo)
            val artistKeys = RadioTrackKeys.getArtistKeys(musicInfo)
            items.add(
                FinalQueueItem(
                    key = key,
                    channels = listOfNotNull(channel),
                    channelWeights = channel?.let { mapOf(it to 1.0) } ?: emptyMap(),
                    channelSourceIds = emptyMap(),
                    primaryArtist = RadioTrackKeys.getPrimaryArtist(musicInfo),
                    artistKeys = artistKeys,
                    albumKey = RadioTrackKeys.normalizeText(RadioTrackKeys.getAlbumName(musicInfo)),
                    sourcePlaylistId = playlistId,
                    sourceSeedTrackKey = seedKey,
                    sourceChartId = chartId,
                    groupIds = groupId?.let { listOf(it) } ?: emptyList(),
                    exposureCount = state.exposureCounts[key]?.toInt() ?: 0,
                    weight = 1.0,
                ),
            )
        }

        // 条目按真实播放顺序排列（旧→新）：窗口截断留下的才是紧邻新批次的曲目
        for (track in state.session.recentTracks.reversed()) {
            if (recentPlayedKeys.contains(track.trackKey)) continue
            val item =
                served[track.trackKey]
                    ?: queue.snapshot().items.firstOrNull { RadioTrackKeys.buildTrackKey(it.musicInfo) == track.trackKey }
            if (item != null) {
                push(
                    item.musicInfo,
                    track.channel ?: item.channel,
                    track.sourcePlaylistId ?: item.sourcePlaylistId,
                    track.sourceSeedTrackKey,
                    track.sourceClusterId,
                    track.sourceChartId,
                )
            }
        }
        for (entry in recentPlayed.reversed()) {
            push(entry.musicInfo, entry.channel, entry.playlistId, entry.seedKey, entry.groupId, entry.chartId)
        }
        currentItem?.let {
            push(it.musicInfo, it.channel, it.sourcePlaylistId, it.sourceSeedTrackKey, it.sourceClusterId, it.sourceChartId)
        }
        for (item in platform.pendingItems()) {
            push(item.musicInfo, item.channel, item.sourcePlaylistId, item.sourceSeedTrackKey, item.sourceClusterId, item.sourceChartId)
        }
        for (item in queue.snapshot().items) {
            push(item.musicInfo, item.channel, item.sourcePlaylistId, item.sourceSeedTrackKey, item.sourceClusterId, item.sourceChartId)
        }
        return items.takeLast(max(1, limit))
    }

    private fun rememberServed(item: RecommendQueueItem) {
        val key = RadioTrackKeys.buildTrackKey(item.musicInfo)
        served[key] = item
        if (served.size > 300) {
            val oldest = served.keys.firstOrNull()
            if (oldest != null) served.remove(oldest)
        }
    }

    private suspend fun filterServedItems(items: List<RecommendQueueItem>): List<RecommendQueueItem> {
        if (!stateReady || items.isEmpty()) return items
        val ctx = buildExclusion()
        return items.filter { RadioFilter.getExclusionReason(it.musicInfo, ctx) == null }
    }

    /** 出队/补位前的排除复检：候选入池时不在库内，用户之后可能刚收藏了同曲。 */
    suspend fun isTrackExcluded(musicInfo: JsonObject): Boolean = RadioFilter.getExclusionReason(musicInfo, buildExclusion()) != null

    suspend fun onMusicToggled(musicInfo: JsonObject?) {
        if (musicInfo == null) {
            if (currentPlayId != null) finishCurrent(PlayEndReason.RADIO_SWITCH)
            return
        }
        val trackKey = RadioTrackKeys.buildTrackKey(musicInfo)
        if (currentPlayId != null && currentTrackKey == trackKey) return
        if (currentPlayId != null) finishCurrent(PlayEndReason.RADIO_SWITCH)

        val servedItem = served[trackKey]
        val playId = "${now()}-${(rng() * 1_000_000_000).toLong().toString(36)}"
        currentItem = servedItem
        currentTrackKey = trackKey
        currentPlayId = playId
        currentTracker =
            RadioListening.createTracker(
                playId = playId,
                trackKey = trackKey,
                startedAt = now(),
                channel = servedItem?.channel,
                sourcePlaylistId = servedItem?.sourcePlaylistId,
                sourceSeedTrackKey = servedItem?.sourceSeedTrackKey,
                sourceClusterId = servedItem?.sourceClusterId,
                sourceChartId = servedItem?.sourceChartId,
                platform = musicInfo.stringField("source"),
            )
        val (nextState, _) =
            RadioBehavior.beginPlay(
                state,
                BeginPlayInput(
                    playId = playId,
                    trackKey = trackKey,
                    musicInfo = musicInfo,
                    startedAt = now(),
                    channel = servedItem?.channel,
                    sourcePlaylistId = servedItem?.sourcePlaylistId,
                    sourceSeedTrackKey = servedItem?.sourceSeedTrackKey,
                    sourceClusterId = servedItem?.sourceClusterId,
                    sourceChartId = servedItem?.sourceChartId,
                    platform = musicInfo.stringField("source"),
                ),
            )
        state = nextState
        recentPlayed.addFirst(
            RecentPlayed(
                musicInfo = musicInfo,
                channel = servedItem?.channel,
                playlistId = servedItem?.sourcePlaylistId,
                seedKey = servedItem?.sourceSeedTrackKey,
                groupId = servedItem?.sourceClusterId,
                chartId = servedItem?.sourceChartId,
            ),
        )
        while (recentPlayed.size > 60) recentPlayed.removeLast()
        emitState()
    }

    fun observePlayback(
        positionMs: Long,
        playing: Boolean,
        durationMs: Long? = null,
    ) {
        val tracker = currentTracker ?: return
        RadioListening.observeSample(tracker, positionMs, playing, now(), durationMs)
    }

    fun noteSeek(targetMs: Long) {
        val tracker = currentTracker ?: return
        RadioListening.noteSeek(tracker, targetMs, now())
    }

    fun onManualSkip() = finishIfPlaying(PlayEndReason.USER_NEXT)

    fun onTrackEnded() = finishIfPlaying(PlayEndReason.NATURAL_END)

    fun onPlayError(reason: PlayEndReason = PlayEndReason.PLAY_ERROR) = finishIfPlaying(reason)

    fun onAppDestroy() = finishIfPlaying(PlayEndReason.APP_DESTROY)

    private fun finishIfPlaying(reason: PlayEndReason): RadioPlayRecord? {
        if (!stateReady || currentPlayId == null) return null
        return finishCurrent(reason)
    }

    fun finishCurrent(
        reason: PlayEndReason,
        positionMs: Long? = null,
        durationMs: Long? = null,
    ): RadioPlayRecord? {
        val tracker = currentTracker
        val playId = currentPlayId
        if (tracker == null || playId == null) {
            currentItem = null
            currentTrackKey = null
            currentPlayId = null
            currentTracker = null
            return null
        }
        currentPlayId = null
        currentTrackKey = null
        currentItem = null
        currentTracker = null
        val record = RadioListening.finish(tracker, reason, now(), positionMs, durationMs)
        val result = RadioBehavior.finishPlay(state, record, reason, now())
        state = result.state
        markProfileLearned()
        maybeEnterSafeMode(record.trackKey)
        emitState()
        return result.record
    }

    /**
     * 安全模式熔断：连续多首不合胃口时，把引擎队列与已移交给播放器的待播曲目里
     * 命中近期负反馈歌手/歌单的那些撤下来（只撤曲目不删候选池）。
     */
    private fun maybeEnterSafeMode(excludeTrackKey: String?) {
        if (!stateReady) return
        val disliked = state.dislikedTracks.keys.toSet()
        val health = SessionHealthLogic.compute(state.session, disliked)
        if (!health.safeMode) return
        val nowMs = now()
        if (nowMs - lastSafeModeAt < RadioConfig.SessionHealth.SAFE_MODE_COOLDOWN_MS) return
        val penalties = SessionHealthLogic.buildPenalties(state.session, disliked)
        val token = queue.version
        val queued = queue.snapshot().items
        val handedOff = platform.pendingItems()
        val deferred =
            RadioDeferral.selectDeferredTrackKeys(
                queued + handedOff,
                penalties,
                RadioConfig.SessionHealth.MAX_DEFERRALS_PER_TRIGGER,
                excludeTrackKey,
            )
        if (deferred.isNotEmpty()) {
            val deferredKeys = deferred.toSet()
            queue.removeMany(deferredKeys, token)
            for (trackKey in deferredKeys) served.remove(trackKey)
            lastSafeModeAt = nowMs
            for (trackKey in deferred) platform.onTrackRemoved(trackKey)
        }
        launchRefresh("safe_mode_supplement", 4)
    }

    suspend fun onDislikedInfo(
        name: String,
        singer: String,
    ) {
        val trackKey = RadioTrackKeys.buildTrackKey(name, singer)
        val playId = if (currentTrackKey == trackKey) currentPlayId else null
        val result =
            RadioBehavior.applyExplicitFeedback(
                state,
                ExplicitFeedbackInput(
                    type = ExplicitFeedbackType.DISLIKE,
                    trackKey = trackKey,
                    timestamp = now(),
                    name = name,
                    singer = singer,
                    playId = playId,
                ),
            )
        state = result.state
        removeTrackEverywhere(trackKey)
        markProfileLearned()
        // 显式不喜欢是强负反馈，立即评估是否熔断清队
        maybeEnterSafeMode(trackKey)
        emitState()
    }

    suspend fun onLiked(musicInfo: JsonObject) {
        val trackKey = RadioTrackKeys.buildTrackKey(musicInfo)
        val playId = if (currentTrackKey == trackKey) currentPlayId else null
        val item = if (currentTrackKey == trackKey) currentItem else null
        val poolMeta = state.candidateCache.firstOrNull { it.trackKey == trackKey }
        val sourcePlaylistId =
            item?.sourcePlaylistId
                ?: poolMeta?.playlistIds?.firstOrNull()
                ?: playId?.let { id -> state.radioHistory.firstOrNull { it.playId == id }?.sourcePlaylistId }
        val result =
            RadioBehavior.applyExplicitFeedback(
                state,
                ExplicitFeedbackInput(
                    type = ExplicitFeedbackType.LIKE,
                    trackKey = trackKey,
                    timestamp = now(),
                    musicInfo = musicInfo,
                    playId = playId,
                    channel = item?.channel ?: poolMeta?.channels?.firstOrNull(),
                    sourcePlaylistId = sourcePlaylistId,
                ),
            )
        state = result.state
        val origins = platform.importedOrigins(trackKey)
        if (origins.isNotEmpty()) {
            val (credited, _) =
                RadioBehavior.creditImportedOrigins(
                    state,
                    origins,
                    ExplicitFeedbackType.LIKE,
                    sourcePlaylistId,
                    now(),
                )
            state = credited
        }
        markProfileLearned()
        // 喜欢后收藏索引即会排除该曲，异步补充少量不同歌手的新候选
        launchRefresh("liked_supplement", 4)
        removeTrackEverywhere(trackKey)
        emitState()
    }

    suspend fun onUnliked(musicInfo: JsonObject) {
        val trackKey = RadioTrackKeys.buildTrackKey(musicInfo)
        val playId = if (currentTrackKey == trackKey) currentPlayId else null
        val result =
            RadioBehavior.applyExplicitFeedback(
                state,
                ExplicitFeedbackInput(
                    type = ExplicitFeedbackType.UNLIKE,
                    trackKey = trackKey,
                    timestamp = now(),
                    playId = playId,
                ),
            )
        state = result.state
        markProfileLearned()
        emitState()
    }

    suspend fun onAddedToPlaylist(
        musicInfo: JsonObject,
        listId: String,
    ) {
        val trackKey = RadioTrackKeys.buildTrackKey(musicInfo)
        val playId = if (currentTrackKey == trackKey) currentPlayId else null
        val item = if (currentTrackKey == trackKey) currentItem else null
        val poolMeta = state.candidateCache.firstOrNull { it.trackKey == trackKey }
        val sourcePlaylistId = item?.sourcePlaylistId ?: poolMeta?.playlistIds?.firstOrNull()
        val result =
            RadioBehavior.applyExplicitFeedback(
                state,
                ExplicitFeedbackInput(
                    type = ExplicitFeedbackType.ADD_TO_PLAYLIST,
                    trackKey = trackKey,
                    timestamp = now(),
                    playId = playId,
                    channel = item?.channel ?: poolMeta?.channels?.firstOrNull(),
                    sourcePlaylistId = sourcePlaylistId,
                    listId = listId,
                ),
            )
        state = result.state
        val origins = platform.importedOrigins(trackKey)
        if (origins.isNotEmpty()) {
            val (credited, _) =
                RadioBehavior.creditImportedOrigins(
                    state,
                    origins,
                    ExplicitFeedbackType.ADD_TO_PLAYLIST,
                    sourcePlaylistId,
                    now(),
                )
            state = credited
        }
        markProfileLearned()
        removeTrackEverywhere(trackKey)
        emitState()
    }

    fun applyPlaylistNotInterested(
        playlistId: String,
        category: String? = null,
    ) {
        state = RadioBehavior.applyPlaylistNotInterested(state, playlistId, category, now())
        emitState()
    }

    fun removeTrackEverywhere(trackKey: String) {
        queue.removeTrackKey(trackKey)
        served.remove(trackKey)
        state = RadioBehavior.removeCandidate(state, trackKey)
        platform.onTrackRemoved(trackKey)
    }

    fun setSourceCooldown(source: String) {
        state = RadioBehavior.setSourceCooldown(state, source, now() + RadioConfig.Request.SOURCE_COOLDOWN_MS)
        emitState()
    }

    fun isSourceCoolingDown(source: String): Boolean = RadioBehavior.isSourceCoolingDown(state, source, now())

    private fun markProfileLearned() {
        profileRevision += 1
        maybeRefreshForProfileChange()
    }

    private fun maybeRefreshForProfileChange() {
        if (!stateReady) return
        val nowMs = now()
        val shouldRefresh =
            RadioPool.shouldRefreshForProfileChange(
                revision = profileRevision,
                lastRefreshRevision = lastRefreshRevision,
                lastRefreshAt = lastProfileRefreshAt,
                now = nowMs,
                inFlight = refreshMutex.isLocked,
                revisionThreshold = RadioConfig.ProfileRefresh.REVISION_THRESHOLD,
                minIntervalMs = RadioConfig.ProfileRefresh.MIN_INTERVAL_MS,
            )
        if (!shouldRefresh) return
        lastProfileRefreshAt = nowMs
        launchRefresh("profile_change", RadioConfig.ProfileRefresh.BUDGET)
    }

    private fun emitState() {
        onStateChanged?.invoke(state)
    }
}
