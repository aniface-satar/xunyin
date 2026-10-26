package cn.toside.music.core.recommend.radio

import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * 最终选曲 —— M2 的降级版配额抽样器。
 *
 * RN 的 `diversity.ts` 属 M3（本波禁触），这里只保留电台主线真正依赖的部分：
 * 通道配额、同歌手间隔阶梯、20/30 首窗口内的重复上限、探索曲目间隔，
 * 以及按通道权重的 softmax 抽样。同作品版本软降频、分类轮换、语种硬配额等 M3 项缺席。
 */
data class SelectionOptions(
    val target: Int,
    val recent: List<FinalQueueItem>,
    val channelPlan: ChannelQuotaPlan,
    val rng: () -> Double,
    val temperature: Double,
    val explorationGap: Int,
)

data class SelectedItem(
    val item: FinalQueueItem,
    val channel: ChannelId,
)

data class SelectionResult(
    val items: List<SelectedItem>,
    val reasons: List<String>,
    val pickedByChannel: Map<ChannelId, Int>,
    val maxRelaxLevel: Int,
)

object RadioSelection {
    private const val ARTIST_GAP = 8
    private const val SAME_ARTIST_IN_LAST_30 = 2
    private const val SAME_PLAYLIST_IN_LAST_20 = 2
    private const val SAME_ALBUM_IN_LAST_20 = 2
    private const val SAME_SEED_IN_LAST_20 = 2
    private const val SAME_CHART_IN_LAST_20 = 3

    private data class RelaxLevel(
        val artistGap: Int,
        val sameArtistInLast30: Int,
    )

    private val RELAX_LADDER =
        listOf(
            RelaxLevel(ARTIST_GAP, SAME_ARTIST_IN_LAST_30),
            RelaxLevel(6, 4),
            RelaxLevel(4, 6),
            RelaxLevel(2, Int.MAX_VALUE),
        )

    private fun isExploration(channel: ChannelId): Boolean = channel == ChannelId.C || channel == ChannelId.D

    private fun passesConstraints(
        item: FinalQueueItem,
        history: List<FinalQueueItem>,
        level: RelaxLevel,
    ): Boolean {
        val artistWindow = history.takeLast(level.artistGap)
        if (item.artistKeys.any { artist -> artistWindow.any { it.artistKeys.contains(artist) } }) return false
        val last30 = history.takeLast(30)
        if (item.artistKeys.any { artist -> last30.count { it.artistKeys.contains(artist) } >= level.sameArtistInLast30 }) return false
        val last20 = history.takeLast(20)
        if (item.sourcePlaylistId != null &&
            last20.count { it.sourcePlaylistId == item.sourcePlaylistId } >= SAME_PLAYLIST_IN_LAST_20
        ) {
            return false
        }
        if (item.albumKey.isNotEmpty() && last20.count { it.albumKey == item.albumKey } >= SAME_ALBUM_IN_LAST_20) return false
        if (item.sourceSeedTrackKey != null &&
            last20.count { it.sourceSeedTrackKey == item.sourceSeedTrackKey } >= SAME_SEED_IN_LAST_20
        ) {
            return false
        }
        if (item.sourceChartId != null && last20.count { it.sourceChartId == item.sourceChartId } >= SAME_CHART_IN_LAST_20) {
            return false
        }
        return true
    }

    private fun weightedPick(
        pool: List<FinalQueueItem>,
        channel: ChannelId,
        temperature: Double,
        rng: () -> Double,
    ): FinalQueueItem? {
        if (pool.isEmpty()) return null
        val t = max(0.05, min(2.0, temperature))

        fun weightOf(item: FinalQueueItem): Double = max(RadioConfig.Softmax.MIN_WEIGHT, item.channelWeights[channel] ?: item.weight)
        val maxWeight = pool.maxOf(::weightOf)
        val gated = pool.filter { weightOf(it) >= maxWeight * RadioConfig.Softmax.QUALITY_GATE_RATIO }.ifEmpty { pool }
        val weights = gated.map { weightOf(it).pow(1.0 / t) }
        val total = weights.sum()
        if (total <= 0) return gated.first()
        var threshold = rng() * total
        for (index in gated.indices) {
            threshold -= weights[index]
            if (threshold <= 0) return gated[index]
        }
        return gated.last()
    }

    fun select(
        items: List<FinalQueueItem>,
        options: SelectionOptions,
    ): SelectionResult {
        val reasons = mutableListOf<String>()
        val selected = mutableListOf<SelectedItem>()
        val pickedKeys = mutableSetOf<String>()
        val remaining = options.channelPlan.quotas.toMutableMap()
        val pickedByChannel = Channels.emptyCounts()
        var levelIndex = 0
        var level = RELAX_LADDER[levelIndex]

        // 历史末尾的通道序列用于探索间隔判定；recent 按旧→新排列
        var history = options.recent.toList()
        var explorationStreak = 0
        for (item in history.takeLast(RadioConfig.Channels.WINDOW_SIZE)) {
            val exploration = item.channels.any(::isExploration)
            explorationStreak = if (exploration) 0 else explorationStreak + 1
        }

        var guard = 0
        while (selected.size < options.target && guard < options.target * 8) {
            guard += 1
            val openChannels =
                CHANNEL_IDS.filter { (remaining[it] ?: 0) > 0 }
            if (openChannels.isEmpty()) {
                reasons.add("quota_exhausted")
                break
            }
            // 通道选择按剩余额度加权，避免固定顺序让某一通道吃满
            val channelTotal = openChannels.sumOf { remaining.getValue(it) }.toDouble()
            var channelThreshold = options.rng() * channelTotal
            var channel = openChannels.last()
            for (candidate in openChannels) {
                channelThreshold -= remaining.getValue(candidate)
                if (channelThreshold <= 0) {
                    channel = candidate
                    break
                }
            }
            val pool =
                items.filter { item ->
                    !pickedKeys.contains(item.key) &&
                        item.channels.contains(channel) &&
                        passesConstraints(item, history, level)
                }
            val gapOk =
                !isExploration(channel) ||
                    options.explorationGap <= 0 ||
                    explorationStreak >= options.explorationGap
            val effectivePool = if (gapOk || levelIndex >= RELAX_LADDER.lastIndex) pool else emptyList()
            if (effectivePool.isEmpty()) {
                // 该通道在当前放宽档下抽不出来：额度转给别的通道；全空则放宽一档
                remaining[channel] = 0
                if (openChannels.size == 1 && levelIndex < RELAX_LADDER.lastIndex) {
                    levelIndex += 1
                    level = RELAX_LADDER[levelIndex]
                    reasons.add("relax:${level.artistGap}")
                    options.channelPlan.quotas.forEach { (c, quota) -> remaining[c] = quota }
                } else {
                    reasons.add("channel_exhausted:${channel.name}")
                }
                continue
            }
            val picked = weightedPick(effectivePool, channel, options.temperature, options.rng) ?: continue
            selected.add(SelectedItem(picked, channel))
            pickedKeys.add(picked.key)
            remaining[channel] = (remaining[channel] ?: 1) - 1
            pickedByChannel[channel] = pickedByChannel.getValue(channel) + 1
            history = history + picked
            explorationStreak = if (isExploration(channel)) 0 else explorationStreak + 1
        }

        return SelectionResult(
            items = selected,
            reasons = reasons.distinct(),
            pickedByChannel = pickedByChannel,
            maxRelaxLevel = levelIndex,
        )
    }
}
