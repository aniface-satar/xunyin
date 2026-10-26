package cn.toside.music.core.recommend.m3

import cn.toside.music.core.recommend.radio.ChannelId
import cn.toside.music.core.recommend.radio.ChannelQuotaPlan
import cn.toside.music.core.recommend.radio.Channels
import cn.toside.music.core.recommend.radio.FinalQueueItem
import cn.toside.music.core.recommend.radio.RadioConfig
import cn.toside.music.core.recommend.radio.SelectedItem
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min

/**
 * 最终队列选曲 —— M3 版，对照 RN `core/recommend/diversity.ts` 的 `selectFinalQueue`。
 *
 * 与 M2 的 `RadioSelection` 的差别（三处，都是 M3 任务书点名要的）：
 * 1. **语种硬配额**：`langCaps` 生效时逐首扣额度，且「配额放开档」会把 `lang_quota_relaxed`
 *    记进原因——宁可日志难看，也不假装满足；
 * 2. **MMR**：抽样分不再只看相关性，减去「与已选曲目的最大相似度 × (1-λ)」，
 *    同时用 `workKey` 对同作品不同版本做软降频（只降权不排除）；
 * 3. **时段权重**：`timeSlotFactor` 乘进权重，由调用方按 `TimeSlot.computeAffinity` 注入。
 *
 * 【注入】随机源一律 `rng: () -> Double`，本文件不出现 `Random` / `System.currentTimeMillis()`，
 * 单测可以锁种子；时钟若需要由调用方算好传进来。
 * 本函数是纯函数：`langCaps.caps` 会被克隆后再扣，绝不会吃掉调用方的额度。
 */
object Diversity {
    /** MMR 的 λ：1.0 = 只看相关性（等价 M2 行为），0 = 只看多样性。 */
    const val DEFAULT_MMR_LAMBDA = 0.85

    /** 同一作品（Live/Remix 等）在最近 20 首出现过时的软降频系数。 */
    const val VARIANT_SOFT_FACTOR = 0.4

    private object AntiRepeat {
        const val ARTIST_GAP = 8
        const val SAME_ARTIST_IN_LAST_30 = 2
        const val SAME_PLAYLIST_IN_LAST_20 = 2
        const val SAME_ALBUM_IN_LAST_20 = 2
        const val SAME_SEED_IN_LAST_20 = 2
        const val SAME_CHART_IN_LAST_20 = 3
        const val SIMILAR_GROUP_RATIO_IN_20 = 0.4
        val RELAX_ARTIST_GAPS = intArrayOf(8, 6, 4)
        const val MIN_ARTIST_GAP = 2
        const val RECENT_ARTIST_WINDOW = 6
        const val RECENT_ARTIST_FACTOR = 0.35
        const val MID_ARTIST_WINDOW = 12
        const val MID_ARTIST_FACTOR = 0.6
        const val RELAX_SAME_ARTIST_IN_LAST_30 = 6
        const val RELAX_SAME_PLAYLIST_IN_LAST_20 = 4
        const val RELAX_SAME_ALBUM_IN_LAST_20 = 4
        const val RELAX_SIMILAR_GROUP_RATIO_IN_20 = 0.7
    }

    /** 一档放宽的参数集。放开档只放开配额，连播与纯音乐上限恒守。 */
    private data class RelaxConfig(
        val artistGap: Int,
        val sameArtistInLast30: Int,
        val samePlaylistInLast20: Int,
        val sameAlbumInLast20: Int,
        val similarGroupRatioIn20: Double,
        val sameSeedInLast20: Int,
        val sameChartInLast20: Int,
        val langQuotaEnforced: Boolean,
    )

    /**
     * 五档阶梯。字面值读法：档 0/1 用 `ARTIST_GAP`，档 2/3 用 `RELAX_ARTIST_GAPS[1]` / `[2]`，
     * 末档直读 `MIN_ARTIST_GAP`。
     * 末档的取舍：连「同歌手隔 4 首」都满足不了时才走到这里，但间隔不归零——
     * 同歌手连推是用户明确投诉过的观感问题。候选枯竭的契约是宁可少出几首
     * （并记 `no_candidate_after_relaxation`），不靠把间隔归零把队列凑满。
     */
    private val RELAX_LADDER: List<RelaxConfig> =
        listOf(
            RelaxConfig(
                artistGap = AntiRepeat.ARTIST_GAP,
                sameArtistInLast30 = AntiRepeat.SAME_ARTIST_IN_LAST_30,
                samePlaylistInLast20 = AntiRepeat.SAME_PLAYLIST_IN_LAST_20,
                sameAlbumInLast20 = AntiRepeat.SAME_ALBUM_IN_LAST_20,
                similarGroupRatioIn20 = AntiRepeat.SIMILAR_GROUP_RATIO_IN_20,
                sameSeedInLast20 = AntiRepeat.SAME_SEED_IN_LAST_20,
                sameChartInLast20 = AntiRepeat.SAME_CHART_IN_LAST_20,
                langQuotaEnforced = true,
            ),
            RelaxConfig(
                artistGap = AntiRepeat.ARTIST_GAP,
                sameArtistInLast30 = AntiRepeat.SAME_ARTIST_IN_LAST_30,
                samePlaylistInLast20 = AntiRepeat.RELAX_SAME_PLAYLIST_IN_LAST_20,
                sameAlbumInLast20 = AntiRepeat.RELAX_SAME_ALBUM_IN_LAST_20,
                similarGroupRatioIn20 = AntiRepeat.RELAX_SIMILAR_GROUP_RATIO_IN_20,
                sameSeedInLast20 = AntiRepeat.SAME_SEED_IN_LAST_20 + 1,
                sameChartInLast20 = AntiRepeat.SAME_CHART_IN_LAST_20 + 1,
                langQuotaEnforced = true,
            ),
            RelaxConfig(
                artistGap = AntiRepeat.RELAX_ARTIST_GAPS[1],
                sameArtistInLast30 = AntiRepeat.SAME_ARTIST_IN_LAST_30,
                samePlaylistInLast20 = AntiRepeat.RELAX_SAME_PLAYLIST_IN_LAST_20,
                sameAlbumInLast20 = AntiRepeat.RELAX_SAME_ALBUM_IN_LAST_20,
                similarGroupRatioIn20 = AntiRepeat.RELAX_SIMILAR_GROUP_RATIO_IN_20,
                sameSeedInLast20 = AntiRepeat.SAME_SEED_IN_LAST_20 + 1,
                sameChartInLast20 = AntiRepeat.SAME_CHART_IN_LAST_20 + 1,
                langQuotaEnforced = true,
            ),
            RelaxConfig(
                artistGap = AntiRepeat.RELAX_ARTIST_GAPS[2],
                sameArtistInLast30 = AntiRepeat.SAME_ARTIST_IN_LAST_30,
                samePlaylistInLast20 = AntiRepeat.RELAX_SAME_PLAYLIST_IN_LAST_20,
                sameAlbumInLast20 = AntiRepeat.RELAX_SAME_ALBUM_IN_LAST_20,
                similarGroupRatioIn20 = AntiRepeat.RELAX_SIMILAR_GROUP_RATIO_IN_20,
                sameSeedInLast20 = AntiRepeat.SAME_SEED_IN_LAST_20 + 1,
                sameChartInLast20 = AntiRepeat.SAME_CHART_IN_LAST_20 + 1,
                langQuotaEnforced = false,
            ),
            RelaxConfig(
                artistGap = AntiRepeat.MIN_ARTIST_GAP,
                sameArtistInLast30 = AntiRepeat.RELAX_SAME_ARTIST_IN_LAST_30,
                samePlaylistInLast20 = AntiRepeat.RELAX_SAME_PLAYLIST_IN_LAST_20,
                sameAlbumInLast20 = AntiRepeat.RELAX_SAME_ALBUM_IN_LAST_20,
                similarGroupRatioIn20 = AntiRepeat.RELAX_SIMILAR_GROUP_RATIO_IN_20,
                sameSeedInLast20 = AntiRepeat.SAME_SEED_IN_LAST_20 + 2,
                sameChartInLast20 = AntiRepeat.SAME_CHART_IN_LAST_20 + 2,
                langQuotaEnforced = false,
            ),
        )

    data class Options(
        val target: Int,
        val recent: List<FinalQueueItem>,
        val channelPlan: ChannelQuotaPlan,
        val rng: () -> Double,
        val temperature: Double = RadioConfig.Softmax.TEMPERATURE,
        /** 相邻两个探索通道（C/D）曲目之间至少要隔多少首非探索曲目；0 表示不限制。 */
        val explorationGap: Int = 0,
        /** 语种硬配额：由调用方按问卷 + 最近窗口算好传入；缺席即代表本轮不设配额。 */
        val langCaps: LanguageQuota.LangCaps = LanguageQuota.LangCaps.UNENFORCED,
        val mmrLambda: Double = DEFAULT_MMR_LAMBDA,
        /** 时段因子注入点（`TimeSlotProfile.computeAffinity(...).factorFor`）；不注入即恒 1。 */
        val timeSlotFactor: (List<String>) -> Double = { 1.0 },
    )

    data class Result(
        val items: List<SelectedItem>,
        val reasons: List<String>,
        val pickedByChannel: Map<ChannelId, Int>,
        val maxRelaxLevel: Int,
    )

    /** 语音配额状态：与 history 同步维护，选走一首即扣一格。 */
    private class LangGuard(
        val enforced: Boolean,
        val remaining: MutableMap<LangBucket, Int>,
        val langs: MutableList<LangBucket?>,
    )

    private fun isExplorationChannel(channel: ChannelId): Boolean = channel == ChannelId.C || channel == ChannelId.D

    private fun countInLast(
        history: List<FinalQueueItem>,
        window: Int,
        predicate: (FinalQueueItem) -> Boolean,
    ): Int {
        if (window <= 0) return 0
        var count = 0
        for (index in max(0, history.size - window) until history.size) {
            if (predicate(history[index])) count += 1
        }
        return count
    }

    /**
     * 软降频（只降权不排除）：满足最小间隔但仍离得很近的同歌手。
     * 只降不排除是为了避免「整池都是同一歌手」时把唯一候选也打死。
     */
    private fun recentArtistPenalty(
        item: FinalQueueItem,
        history: List<FinalQueueItem>,
    ): Double {
        if (item.artistKeys.isEmpty()) return 1.0
        val shares: (FinalQueueItem) -> Boolean = { entry -> entry.artistKeys.any { item.artistKeys.contains(it) } }
        if (countInLast(history, AntiRepeat.RECENT_ARTIST_WINDOW, shares) > 0) return AntiRepeat.RECENT_ARTIST_FACTOR
        if (countInLast(history, AntiRepeat.MID_ARTIST_WINDOW, shares) > 0) return AntiRepeat.MID_ARTIST_FACTOR
        return 1.0
    }

    /**
     * 同作品不同版本（Live/Remix 等）的软降频。`workKey` 缺席即不参与，不做任何猜测。
     */
    private fun variantPenalty(
        item: FinalQueueItem,
        history: List<FinalQueueItem>,
    ): Double {
        val workKey = item.workKey ?: return 1.0
        val hit = countInLast(history, 20) { entry -> entry.workKey != null && entry.workKey == workKey } > 0
        return if (hit) VARIANT_SOFT_FACTOR else 1.0
    }

    /** 抽样权重（含曝光/同版本/同歌手/时段四种软化）。 */
    private fun weightFor(
        item: FinalQueueItem,
        channel: ChannelId,
        history: List<FinalQueueItem>,
        options: Options,
    ): Double {
        val base = item.channelWeights[channel] ?: item.weight
        val exposurePenalty = 1.0 / (1.0 + max(0, item.exposureCount) * 0.35)
        val value = base * exposurePenalty * variantPenalty(item, history) * recentArtistPenalty(item, history)
        val withTimeSlot = value * options.timeSlotFactor(item.artistKeys)
        return max(RadioConfig.Softmax.MIN_WEIGHT, withTimeSlot)
    }

    /** 门槛只比较通道基础分（质量），不含三种软降频：否则软降频会被门槛放大成硬排除。 */
    private fun qualityWeightOf(
        item: FinalQueueItem,
        channel: ChannelId,
    ): Double = item.channelWeights[channel] ?: item.weight

    private fun applyQualityGate(
        pool: List<FinalQueueItem>,
        channel: ChannelId,
    ): List<FinalQueueItem> {
        val ratio = RadioConfig.Softmax.QUALITY_GATE_RATIO
        if (ratio <= 0.0 || ratio >= 1.0) return pool
        var best = 0.0
        for (item in pool) best = max(best, qualityWeightOf(item, channel))
        if (best <= 0.0) return pool
        val gated = pool.filter { qualityWeightOf(it, channel) >= best * ratio }
        return gated.ifEmpty { pool }
    }

    /**
     * 两首曲目的相似度（MMR 的「冗余度」）：歌手 Jaccard 0.5 / 同专辑 0.2 / 相似组 Jaccard 0.2 /
     * 同语种 0.1。语种同桶只算很小的冗余——「连续四首中文」已经被连播硬规则单独管了。
     */
    private fun similarity(
        a: FinalQueueItem,
        b: FinalQueueItem,
    ): Double {
        val artist = Similarity.jaccard(a.artistKeys.toSet(), b.artistKeys.toSet())
        val album = if (a.albumKey.isNotEmpty() && a.albumKey == b.albumKey) 1.0 else 0.0
        val group = Similarity.jaccard(a.groupIds.toSet(), b.groupIds.toSet())
        val lang = if (a.lang != null && a.lang == b.lang) 1.0 else 0.0
        return 0.5 * artist + 0.2 * album + 0.2 * group + 0.1 * lang
    }

    /**
     * MMR 抽样分（**未抽样的纯函数**）：`λ × relNorm − (1−λ) × maxSim(已选)`。
     *
     * 单独暴露出来是为了可测——抽样结果是随机的，但「同一批候选在给定已选集合下的相对次序」
     * 是确定的，单测直接钉这个次序；诊断日志也能看出多样性到底压了多少分。
     * 质量门槛在调用前已由 [applyQualityGate] 施加；本函数不再重复过滤。
     */
    fun mmrScores(
        pool: List<FinalQueueItem>,
        channel: ChannelId,
        history: List<FinalQueueItem>,
        picked: List<FinalQueueItem>,
        options: Options,
    ): Map<FinalQueueItem, Double> {
        if (pool.isEmpty()) return emptyMap()
        val lambda = max(0.0, min(1.0, options.mmrLambda))
        val raw = pool.associateWith { weightFor(it, channel, history, options) }
        val maxRaw = raw.values.maxOrNull() ?: 0.0
        return pool.associateWith { item ->
            val relevance = if (maxRaw > 0.0) raw.getValue(item) / maxRaw else 0.0
            var redundancy = 0.0
            for (chosen in picked) redundancy = max(redundancy, similarity(chosen, item))
            lambda * relevance - (1.0 - lambda) * redundancy
        }
    }

    /**
     * MMR + softmax 抽样：`score = λ × relNorm − (1−λ) × maxSim(已选)`，
     * 再按 RN 的 `exp((s − max)/T)` 归一化抽样。已选集合为空时退化为纯 softmax。
     */
    private fun pickFrom(
        pool: List<FinalQueueItem>,
        channel: ChannelId,
        history: List<FinalQueueItem>,
        picked: List<FinalQueueItem>,
        options: Options,
    ): FinalQueueItem? {
        if (pool.isEmpty()) return null
        val gated = applyQualityGate(pool, channel)
        val temperature = max(0.05, min(2.0, options.temperature))
        val scores = mmrScores(gated, channel, history, picked, options)
        val maxScore = scores.values.maxOrNull() ?: 0.0
        val weights = scores.mapValues { exp((it.value - maxScore) / temperature) }
        val total = weights.values.sum()
        if (total <= 0.0) return gated.first()
        var threshold = options.rng() * total
        for (item in gated) {
            threshold -= weights.getValue(item)
            if (threshold <= 0.0) return item
        }
        return gated.last()
    }

    private fun checkItemConstraints(
        item: FinalQueueItem,
        history: List<FinalQueueItem>,
        relax: RelaxConfig,
        langGuard: LangGuard,
        ignoreConsecutiveLang: Boolean = false,
    ): Boolean {
        // 语种判定排在最前：它最便宜，且「连三四首中文」是用户最直接的感受，不该被后面的间隔检查稀释
        if (relax.langQuotaEnforced && langGuard.enforced && !LanguageQuota.langWithinCap(item.lang, langGuard.remaining)) {
            return false
        }
        if (!ignoreConsecutiveLang && !LanguageQuota.consecutiveLangAllowed(langGuard.langs, item.lang)) return false
        // instrumentalAllowed 只在候选本身是纯音乐时调用：否则「池里已有 2 首纯音乐」会卡住所有歌
        if (item.lang == LangBucket.INSTR && !LanguageQuota.instrumentalAllowed(langGuard.langs)) return false
        for (artist in item.artistKeys) {
            if (countInLast(history, relax.artistGap) { it.artistKeys.contains(artist) } > 0) return false
            if (countInLast(history, 30) { it.artistKeys.contains(artist) } >= relax.sameArtistInLast30) return false
        }
        val playlistId = item.sourcePlaylistId
        if (playlistId != null &&
            countInLast(history, 20) { it.sourcePlaylistId == playlistId } >= relax.samePlaylistInLast20
        ) {
            return false
        }
        val albumKey = item.albumKey.ifEmpty { "album:unknown:${item.key}" }
        val albumHits =
            countInLast(history, 20) { entry ->
                entry.albumKey.ifEmpty { "album:unknown:${entry.key}" } == albumKey
            }
        if (albumHits >= relax.sameAlbumInLast20) return false
        val seedKey = item.sourceSeedTrackKey
        if (seedKey != null && countInLast(history, 20) { it.sourceSeedTrackKey == seedKey } >= relax.sameSeedInLast20) {
            return false
        }
        val chartId = item.sourceChartId
        if (chartId != null && countInLast(history, 20) { it.sourceChartId == chartId } >= relax.sameChartInLast20) {
            return false
        }
        if (item.groupIds.isNotEmpty()) {
            val window = min(20, history.size + 1)
            val maxGroupCount = max(1, kotlin.math.ceil(window * relax.similarGroupRatioIn20).toInt())
            for (groupId in item.groupIds) {
                if (countInLast(history, 20) { it.groupIds.contains(groupId) } >= maxGroupCount) return false
            }
        }
        return true
    }

    fun select(
        candidates: List<FinalQueueItem>,
        options: Options,
    ): Result {
        val target = max(0, options.target)
        val history = options.recent.takeLast(60).toMutableList()
        val picked = mutableListOf<SelectedItem>()
        val reasons = mutableListOf<String>()
        val unused = candidates.toMutableList()
        val pickedByChannel = Channels.emptyCounts()
        var maxRelaxLevel = 0
        if (candidates.isEmpty() && target > 0) reasons += "no_candidate_after_relaxation"

        // 必须克隆 caps：本函数是纯函数，直接扣 options.langCaps.caps 会把调用方的额度吃掉，
        // 第二次生成队列就少一批名额
        val langGuard =
            LangGuard(
                enforced = options.langCaps.enforced,
                remaining = options.langCaps.caps.toMutableMap(),
                langs = history.map { it.lang }.toMutableList(),
            )
        val baseQuotas = options.channelPlan.quotas
        val explorationGap = max(0, options.explorationGap)

        fun remainingChannels(): List<ChannelId> =
            CHANNEL_SORT
                .filter { (baseQuotas[it] ?: 0) - (pickedByChannel[it] ?: 0) > 0 }
                .sortedWith(
                    compareByDescending<ChannelId> { (baseQuotas[it] ?: 0) - (pickedByChannel[it] ?: 0) }
                        .thenByDescending { RadioConfig.Channels.TARGET_PER_WINDOW[it] ?: 0 },
                )

        fun explorationBlocked(): Boolean {
            if (explorationGap <= 0) return false
            for (index in history.size - 1 downTo max(0, history.size - explorationGap)) {
                if (history[index].channels.any(::isExplorationChannel)) return true
            }
            return false
        }

        fun runChannelLadder(
            channelList: List<ChannelId>,
            pickedItems: List<FinalQueueItem>,
        ): Triple<FinalQueueItem, ChannelId, Int>? {
            for (relaxLevel in RELAX_LADDER.indices) {
                val relax = RELAX_LADDER[relaxLevel]
                for (channel in channelList) {
                    val eligible =
                        unused.filter { item ->
                            item.channels.contains(channel) &&
                                checkItemConstraints(item, history, relax, langGuard)
                        }
                    if (eligible.isEmpty()) continue
                    val chosen = pickFrom(eligible, channel, history, pickedItems, options) ?: continue
                    return Triple(chosen, channel, relaxLevel)
                }
            }
            return null
        }

        var guard = 0
        while (picked.size < target && unused.isNotEmpty() && guard < target * 8) {
            guard += 1
            val allChannels = remainingChannels()
            if (allChannels.isEmpty()) {
                reasons += "quota_exhausted"
                break
            }
            val gapBlocked = explorationBlocked()
            var ladder: Triple<FinalQueueItem, ChannelId, Int>? = null
            var gapRelaxed = false
            if (gapBlocked) {
                val nonExploration = allChannels.filter { !isExplorationChannel(it) }
                if (nonExploration.isNotEmpty()) ladder = runChannelLadder(nonExploration, picked.map { it.item })
                // 只剩探索通道有额度时放宽间隔，保证配额不因间隔约束而饿死
                if (ladder == null) {
                    ladder = runChannelLadder(allChannels, picked.map { it.item })
                    gapRelaxed = ladder != null
                }
            } else {
                ladder = runChannelLadder(allChannels, picked.map { it.item })
            }

            if (ladder == null) {
                val fallback = RELAX_LADDER.last()
                var pool =
                    unused.filter { item ->
                        checkItemConstraints(item, history, fallback, langGuard)
                    }
                // 末档仍被连播规则卡死时，说明池里真的没有第二种语言可选。此时宁可连播同一语种
                // 也不要把队列截断；其余约束（配额/歌手/歌单等）照旧生效。
                var consecutiveRelaxed = false
                if (pool.isEmpty()) {
                    pool =
                        unused.filter { item ->
                            checkItemConstraints(item, history, fallback, langGuard, ignoreConsecutiveLang = true)
                        }
                    consecutiveRelaxed = pool.isNotEmpty()
                }
                if (pool.isEmpty()) {
                    reasons += "no_candidate_after_relaxation"
                    break
                }
                val channel = pool.first().channels.firstOrNull() ?: ChannelId.D
                val chosen = pickFrom(pool, channel, history, picked.map { it.item }, options) ?: break
                ladder = Triple(chosen, channel, RELAX_LADDER.lastIndex)
                reasons += "fallback_channel"
                if (consecutiveRelaxed) reasons += "lang_consecutive_relaxed"
            }

            val (chosen, chosenChannel, chosenRelax) = ladder
            if (gapRelaxed) reasons += "exploration_gap_relaxed"
            unused.remove(chosen)
            picked.add(SelectedItem(chosen, chosenChannel))
            pickedByChannel[chosenChannel] = pickedByChannel.getValue(chosenChannel) + 1
            history.add(chosen)
            if (history.size > 60) history.subList(0, history.size - 60).clear()
            langGuard.langs.add(chosen.lang)
            if (langGuard.langs.size > 60) langGuard.langs.subList(0, langGuard.langs.size - 60).clear()
            // 必须在扣额度**之前**读：langWithinCap 判的是 cap > 0，扣完之后「合法用掉最后一个名额」
            // 和「本来就超额」都是 0，两者就分不开了
            val langOverCapAtPickTime = langGuard.enforced && !LanguageQuota.langWithinCap(chosen.lang, langGuard.remaining)
            val bucket = chosen.lang
            if (bucket != null && bucket != LangBucket.UNKNOWN) {
                val remaining = langGuard.remaining[bucket]
                if (remaining != null) langGuard.remaining[bucket] = max(0, remaining - 1)
            }
            // 这首是在「语种配额已放开」的档位下才收下的：日志要能看出配额本轮没兑现
            if (langOverCapAtPickTime && !RELAX_LADDER[chosenRelax].langQuotaEnforced) reasons += "lang_quota_relaxed"
            if (chosenRelax > maxRelaxLevel) {
                maxRelaxLevel = chosenRelax
                if (chosenRelax > 0) reasons += "relax_level_$chosenRelax"
            }
        }

        return Result(
            items = picked,
            reasons = reasons.distinct(),
            pickedByChannel = pickedByChannel,
            maxRelaxLevel = maxRelaxLevel,
        )
    }

    private val CHANNEL_SORT: List<ChannelId> =
        listOf(ChannelId.A, ChannelId.B, ChannelId.C, ChannelId.D, ChannelId.E)
}
