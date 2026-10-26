package cn.toside.music.core.recommend.radio

import cn.toside.music.core.recommend.ArtistPrior
import cn.toside.music.core.recommend.NameTokenFeedback
import cn.toside.music.core.recommend.ThemePreference
import cn.toside.music.core.recommend.m3.LangBucket
import kotlinx.serialization.json.JsonObject
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * 候选池与打分 —— RN `core/recommend/candidatePool.ts` 移植。
 *
 * 【M3 退化】RN 依赖 `similarity.ts`（本波禁触）的三块全部降级：
 * - `computeProfileAffinity` → 种子重合按种子数归一 + 弱主题小幅加成；
 * - `computePlaylistScore` → 用配置里的 affinity/feedback/exploration 权重做简化线性组合；
 * - 会话共现 / 音频品味 / 时段画像 / 语种桶 → 整体缺席（对应权重项删除）。
 * 这些退化只影响排序精细度，不改变候选准入与排除规则。
 */
data class CreatePoolCandidateInput(
    val musicInfo: JsonObject,
    val channel: ChannelId,
    val sourceId: String,
    val now: Long,
    val channels: List<ChannelId> = emptyList(),
    val playlistIds: List<String> = emptyList(),
    val seedTrackKeys: List<String> = emptyList(),
    val groupIds: List<String> = emptyList(),
    val chartId: String? = null,
    val chartRank: Int? = null,
    val publishedTime: Long? = null,
    val playCount: Long? = null,
    val affinity: Double = 0.0,
    val coOccurrence: Double = 0.0,
    val exploration: Double = 0.0,
    val confirmedSeedPlaylist: Boolean = false,
    val reason: String? = null,
    /** L2 语种桶批次提示（桶召回/歌单标签）；L1 由 `musicInfo.meta.lang` 自动判定。 */
    val langHint: LangBucket? = null,
    /** L3 歌手语言表查询；缺省即跳过 L3，直接落到 L4 字面统计。 */
    val artistLang: ArtistLangLookup? = null,
)

/** 池子裁剪的语种约束：`limits` 缺席的桶不受淘汰约束，`resolveBucket` 缺省只认已存的 lang/langHint。 */
data class PoolCapOptions(
    val limits: Map<LangBucket, Int> = emptyMap(),
    val resolveBucket: ((PoolCandidate) -> LangBucket)? = null,
)

data class FinalQueueBuildOptions(
    val playlistPreferences: Map<String, PlaylistPreference> = emptyMap(),
    val observedPlaylists: Map<String, ObservedPlaylist> = emptyMap(),
    val exposureCounts: Map<String, Long> = emptyMap(),
    /** 画像种子数，用于把歌单种子重合数归一化为亲和度。 */
    val seedCount: Int = 0,
    val now: Long,
    /** radio 模式给 C/D 候选加亲和度闸门，explore 模式保持纯新颖度排序。 */
    val mode: RadioMode = RadioMode.RADIO,
    /** 近期负反馈命中的歌手/歌单，用于打分降权。 */
    val sessionPenalties: SessionPenalties? = null,
    /** 歌名 token 学习权重（DJ版/Live/风格词），全通道乘性修正。 */
    val tokenWeights: Map<String, ThemePreference>? = null,
    /** 长期歌手先验（完播/切歌统计），全通道乘性修正。 */
    val artistStats: Map<String, ThemePreference>? = null,
    /** L3 歌手语言表查询；缺省时老池子里没有 `lang` 的候选只能落到 L4。 */
    val artistLang: ArtistLangLookup? = null,
)

object RadioPool {
    private const val FEEDBACK_HALF_LIFE_DAYS = 30.0
    private const val DAY_MS = 86_400_000.0

    private fun clamp01(value: Double): Double = max(0.0, min(1.0, value))

    fun createCandidate(input: CreatePoolCandidateInput): PoolCandidate {
        val trackKey = RadioTrackKeys.buildTrackKey(input.musicInfo)
        val channels = (listOf(input.channel) + input.channels).distinct()
        val channelSourceId = channels.associate { it.name to input.sourceId }
        val playlistIds = input.playlistIds.distinct()
        // 语种在创建时就落位（L1~L4 全跑一遍）：候选池与历史项都要能读到 lang，
        // 否则 MMR 的语言项与连播/配额规则全是瞎的
        val lang = CandidateLang.resolve(input.musicInfo, input.langHint, input.artistLang)
        return PoolCandidate(
            trackKey = trackKey,
            musicInfo = input.musicInfo,
            channels = channels,
            channelSourceId = channelSourceId,
            playlistIds = playlistIds,
            seedTrackKeys = input.seedTrackKeys.distinct(),
            groupIds = input.groupIds.distinct(),
            chartId = input.chartId,
            chartRank = input.chartRank,
            publishedTime = input.publishedTime,
            playCount = input.playCount,
            affinity = clamp01(input.affinity),
            coOccurrence = clamp01(input.coOccurrence),
            exploration = clamp01(input.exploration),
            localFrequency = 1,
            observedPlaylistFrequency = playlistIds.size,
            exposureCount = 0,
            albumKey = RadioTrackKeys.normalizeText(RadioTrackKeys.getAlbumName(input.musicInfo)),
            artistKeys = RadioTrackKeys.getArtistKeys(input.musicInfo),
            primaryArtist = RadioTrackKeys.getPrimaryArtist(input.musicInfo),
            addedAt = input.now,
            confirmedSeedPlaylist = input.confirmedSeedPlaylist,
            reasons = input.reason?.let { listOf(it) } ?: emptyList(),
            lang = lang.bucket,
            langLevel = lang.level,
            langHint = input.langHint,
        )
    }

    /** 合并来自多路/多歌单的同一首歌：通道、来源和种子合并，评分取较强者，不做无上限叠加。 */
    fun mergeCandidates(
        existing: List<PoolCandidate>,
        incoming: List<PoolCandidate>,
        maxSize: Int = RadioConfig.CandidatePool.MAX_SIZE,
        capOptions: PoolCapOptions? = null,
    ): List<PoolCandidate> {
        val byKey = LinkedHashMap<String, PoolCandidate>()
        for (candidate in existing) byKey[candidate.trackKey] = candidate
        for (candidate in incoming) {
            val prev = byKey[candidate.trackKey]
            if (prev == null) {
                byKey[candidate.trackKey] = candidate
                continue
            }
            val mergedChannels = (prev.channels + candidate.channels).distinct()
            val channelSourceId = prev.channelSourceId.toMutableMap()
            for (channel in mergedChannels) {
                val value = candidate.channelSourceId[channel.name] ?: prev.channelSourceId[channel.name]
                if (value != null) channelSourceId[channel.name] = value
            }
            byKey[candidate.trackKey] =
                prev.copy(
                    channels = mergedChannels,
                    channelSourceId = channelSourceId,
                    playlistIds = (prev.playlistIds + candidate.playlistIds).distinct(),
                    seedTrackKeys = (prev.seedTrackKeys + candidate.seedTrackKeys).distinct(),
                    groupIds = (prev.groupIds + candidate.groupIds).distinct(),
                    chartId = prev.chartId ?: candidate.chartId,
                    chartRank = prev.chartRank ?: candidate.chartRank,
                    publishedTime = prev.publishedTime ?: candidate.publishedTime,
                    playCount = prev.playCount ?: candidate.playCount,
                    affinity = max(prev.affinity, candidate.affinity),
                    coOccurrence = max(prev.coOccurrence, candidate.coOccurrence),
                    exploration = max(prev.exploration, candidate.exploration),
                    localFrequency = prev.localFrequency + 1,
                    observedPlaylistFrequency = max(prev.observedPlaylistFrequency, candidate.observedPlaylistFrequency),
                    confirmedSeedPlaylist = prev.confirmedSeedPlaylist || candidate.confirmedSeedPlaylist,
                    reasons = (prev.reasons + candidate.reasons).distinct(),
                    // 语种事实以较新的一份为准（同 RN `mergePoolCandidates`）：后到的候选通常是重新拉取的现值；
                    // 旧的一边有值就保留，两边的 langHint 取先出现的那个（提示来自更可信的批次）。
                    lang = candidate.lang ?: prev.lang,
                    langLevel = if (candidate.lang != null) candidate.langLevel else prev.langLevel,
                    langHint = prev.langHint ?: candidate.langHint,
                    workKey = prev.workKey ?: candidate.workKey,
                    addedAt = min(prev.addedAt, candidate.addedAt),
                )
        }
        return capPoolSize(byKey.values.toList(), maxSize, capOptions)
    }

    /**
     * 按分数裁剪到 maxSize；池子没满就不淘汰。
     *
     * [capOptions] 给了语种上限时（RN `capPoolSize` 的同一分支），先按综合分降序，
     * 再逐首收集：某桶已到上限的候选进 overflow，其余照收；最后用 overflow 按分数补满——
     * 限额卡不住时宁可让池子多几首超配额语种，也不让池子空着。
     *
     * 淘汰顺序是**综合分最低的先出**（同分才比 `addedAt`，新的优先保留），不是 FIFO：
     * 池子要留的是「下次生成队列最可能用得上」的候选，而不是最后抓回来的那批。
     */
    fun capPoolSize(
        candidates: List<PoolCandidate>,
        maxSize: Int = RadioConfig.CandidatePool.MAX_SIZE,
        capOptions: PoolCapOptions? = null,
    ): List<PoolCandidate> {
        if (candidates.size <= maxSize) return candidates.toList()
        val sorted =
            candidates.sortedWith(
                compareByDescending<PoolCandidate> { it.affinity + it.coOccurrence + it.exploration - it.exposureCount * 0.1 }
                    .thenByDescending { it.addedAt },
            )
        val limits = capOptions?.limits.orEmpty()
        if (limits.isEmpty()) return sorted.take(maxSize)
        val bucketOf: (PoolCandidate) -> LangBucket =
            capOptions?.resolveBucket ?: { candidate ->
                candidate.lang ?: candidate.langHint ?: LangBucket.UNKNOWN
            }
        val kept = mutableListOf<PoolCandidate>()
        val overflow = mutableListOf<PoolCandidate>()
        val used = mutableMapOf<LangBucket, Int>()
        for (candidate in sorted) {
            val bucket = bucketOf(candidate)
            val limit = limits[bucket]
            val count = used[bucket] ?: 0
            if (limit != null && count >= limit) {
                overflow.add(candidate)
                continue
            }
            used[bucket] = count + 1
            kept.add(candidate)
            if (kept.size >= maxSize) break
        }
        for (candidate in overflow) {
            if (kept.size >= maxSize) break
            kept.add(candidate)
        }
        return kept
    }

    fun filterPoolCandidates(
        candidates: List<PoolCandidate>,
        ctx: ExclusionContext,
    ): List<PoolCandidate> = candidates.filter { candidate -> RadioFilter.getExclusionReason(candidate.musicInfo, ctx) == null }

    /** 抓取预算分区：详情读取先留固定份额，剩下的才给发现型请求。 */
    fun planRefreshBudget(
        budget: Int,
        detailFetches: Int,
    ): Pair<Int, Int> {
        val baseBudget = max(1, RadioConfig.Request.MAX_REQUESTS_PER_REFRESH)
        val scaled = Math.ceil(max(0, budget) * max(0, detailFetches).toDouble() / baseBudget).toInt()
        val detailBudget = min(max(detailFetches, scaled), max(1, budget / 2))
        return detailBudget to max(0, budget - detailBudget)
    }

    /**
     * 画像反馈攒够一批才补池：逐条反馈都重抓既费请求又拿不到新结果。
     */
    fun shouldRefreshForProfileChange(
        revision: Int,
        lastRefreshRevision: Int,
        lastRefreshAt: Long,
        now: Long,
        inFlight: Boolean,
        revisionThreshold: Int,
        minIntervalMs: Long,
    ): Boolean {
        if (inFlight) return false
        if (revision - lastRefreshRevision < revisionThreshold) return false
        return now - lastRefreshAt >= minIntervalMs
    }

    private fun decayFeedback(
        value: Double,
        elapsedMs: Long,
    ): Double {
        if (value == 0.0) return 0.0
        return value * 0.5.pow(elapsedMs / (FEEDBACK_HALF_LIFE_DAYS * DAY_MS))
    }

    /** 退化版歌单亲和度：种子重合按种子数归一，弱主题给小幅加成。 */
    fun observedAffinity(
        observed: ObservedPlaylist,
        seedCount: Int,
        fallback: Double,
    ): Double {
        if (seedCount <= 0) return fallback
        val overlap = clamp01(observed.seedOverlap.toDouble() / max(1, seedCount))
        val weak = clamp01(observed.weakThemeScore)
        return clamp01(overlap + weak * 0.2)
    }

    /** 退化版歌单分：affinity 0.5 / 反馈 0.3 / 新颖度 0.2 的线性组合。 */
    fun playlistScoreFor(
        candidate: PoolCandidate,
        options: FinalQueueBuildOptions,
    ): Double {
        var best = 0.0
        for (playlistId in candidate.playlistIds) {
            val pref = options.playlistPreferences[playlistId]
            val observed = options.observedPlaylists[playlistId]
            if (pref == null && observed == null) continue
            val elapsed = max(0L, options.now - (pref?.lastDecayTime ?: options.now))
            val positive = decayFeedback(pref?.positiveWeight ?: 0.0, elapsed)
            val negative = decayFeedback(pref?.negativeWeight ?: 0.0, elapsed)
            val exposure = pref?.exposureCount ?: 0
            val affinity =
                if (observed != null) {
                    observedAffinity(observed, options.seedCount, candidate.affinity)
                } else {
                    candidate.affinity
                }
            val feedbackSignal = (positive - negative) / (1.0 + positive + negative)
            val novelty = 1.0 / (1.0 + max(0.0, exposure.toDouble()) * 0.25)
            val score = 0.5 * affinity + 0.3 * (0.5 + 0.5 * feedbackSignal) + 0.2 * novelty
            best = max(best, clamp01(score))
        }
        return best
    }

    fun channelWeightsFor(
        candidate: PoolCandidate,
        options: FinalQueueBuildOptions,
    ): Map<ChannelId, Double> {
        val now = options.now
        val playlistScore = playlistScoreFor(candidate, options)
        val exposure = options.exposureCounts[candidate.trackKey] ?: candidate.exposureCount.toLong()
        val lowExposure = 1.0 / (1.0 + max(0L, exposure) * 0.5)
        val chartNovelty =
            candidate.chartRank?.let { max(0.1, 1.0 - it / 100.0) } ?: 0.5
        val playCountNovelty =
            candidate.playCount?.let { 1.0 / (1.0 + Math.log(1.0 + it / 100_000.0)) } ?: 0.6
        val localNovelty = 1.0 / (1.0 + max(0, candidate.localFrequency - 1) * 0.25)
        val tokenFactor = NameTokenFeedback.nameTokenFactor(options.tokenWeights, candidate.musicInfo.stringField("name"), now)
        val artistFactor = ArtistPrior.artistPriorFactor(options.artistStats, candidate.artistKeys, now)
        val penaltyFactor =
            SessionHealthLogic.penaltyFactor(
                SessionHealthLogic.penaltyScore(candidate.artistKeys, candidate.playlistIds, options.sessionPenalties),
            )
        var cooldownFactor = 1.0
        for (playlistId in candidate.playlistIds) {
            val pref = options.playlistPreferences[playlistId]
            if (pref != null && (pref.cooldownUntil ?: 0L) > now) {
                cooldownFactor = min(cooldownFactor, pref.cooldownFactor ?: RadioConfig.PlaylistFeedback.LEGACY_COOLDOWN_FACTOR)
            }
        }
        val weights = mutableMapOf<ChannelId, Double>()
        for (channel in candidate.channels) {
            var raw =
                when (channel) {
                    ChannelId.A -> candidate.affinity * 0.4 + playlistScore * 0.22 + candidate.coOccurrence * 0.14
                    ChannelId.B -> playlistScore * 0.6 + candidate.affinity * 0.25 + 0.15
                    ChannelId.C ->
                        candidate.exploration * 0.4 + lowExposure * 0.25 + playCountNovelty * 0.2 + localNovelty * 0.15
                    ChannelId.D ->
                        candidate.exploration * 0.35 + chartNovelty * 0.3 + lowExposure * 0.2 + candidate.affinity * 0.15
                    ChannelId.E -> candidate.affinity * 0.55 + candidate.exploration * 0.15 + candidate.coOccurrence * 0.08
                }
            // radio 模式下探索通道不做纯盲推：亲和度闸门让画像内候选优先于完全陌生的歌
            if ((channel == ChannelId.C || channel == ChannelId.D) && options.mode != RadioMode.EXPLORE) {
                val floor = RadioConfig.Channels.EXPLORATION_AFFINITY_FLOOR
                raw *= floor + (1 - floor) * candidate.affinity
            }
            raw *= penaltyFactor
            raw *= tokenFactor
            raw *= artistFactor
            raw *= cooldownFactor
            weights[channel] = max(0.01, min(1.0, raw))
        }
        return weights
    }

    fun buildFinalQueueItems(
        candidates: List<PoolCandidate>,
        options: FinalQueueBuildOptions,
    ): List<FinalQueueItem> =
        candidates.map { candidate ->
            val channelWeights = channelWeightsFor(candidate, options)
            val channels = if (channelWeights.isEmpty()) candidate.channels else channelWeights.keys.toList()
            val exposureCount = options.exposureCounts[candidate.trackKey] ?: candidate.exposureCount.toLong()
            val maxWeight = channelWeights.values.maxOrNull() ?: 0.0
            // 读时再解析一次：老池子的候选没有 lang（创建时 M3 供给还没接），不能当成「永远判不出」
            val lang = CandidateLang.resolve(candidate, options.artistLang)
            FinalQueueItem(
                key = candidate.trackKey,
                channels = channels,
                channelWeights = channelWeights,
                channelSourceIds = candidate.channelSourceId,
                primaryArtist = candidate.primaryArtist,
                artistKeys = candidate.artistKeys,
                albumKey = candidate.albumKey,
                sourcePlaylistId = candidate.playlistIds.firstOrNull(),
                sourceSeedTrackKey = candidate.seedTrackKeys.firstOrNull(),
                sourceChartId = candidate.chartId,
                groupIds = candidate.groupIds,
                exposureCount = exposureCount.toInt(),
                weight = if (maxWeight > 0) maxWeight else max(candidate.affinity, 0.1),
                lang = lang.bucket,
                langLevel = lang.level,
                langHint = candidate.langHint,
                // 同作品不同版本（Live/Remix 等）软降频用；RN 只在建最终队列时算，不落池
                workKey =
                    RadioTrackKeys.canonicalWorkKey(
                        candidate.musicInfo.stringField("name"),
                        candidate.musicInfo.stringField("singer"),
                    ),
            )
        }

    data class PoolStats(
        val total: Int,
        val byChannel: Map<ChannelId, Int>,
        val confirmed: Int,
    )

    fun poolStats(candidates: List<PoolCandidate>): PoolStats {
        val byChannel = Channels.emptyCounts()
        for (candidate in candidates) {
            for (channel in candidate.channels) byChannel[channel] = byChannel.getValue(channel) + 1
        }
        return PoolStats(candidates.size, byChannel, candidates.count { it.confirmedSeedPlaylist })
    }
}
