package cn.toside.music.core.recommend.radio

import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * 滚动窗口通道配额 —— RN `core/recommend/channels.ts` 原样移植。
 *
 * - 电台每 20 首 A7/B5/C4/D2/E2，探索模式改 A3/B1/C9/D7（E 不供货）；
 * - 按最近窗口的实际通道计数补缺口，再按目标占比填充剩余额度；
 * - explorationFactor < 1 收缩 C/D（会话负反馈），> 1 放大（正反馈连击，上限 bandit.maxBoost）；
 * - 某通道没有合格候选时把额度让给其他通道并记录降级原因；
 * - 冷启动没有 B 反馈时，B 额度临时分给 C/D/A。
 */
object Channels {
    fun emptyCounts(): MutableMap<ChannelId, Int> = CHANNEL_IDS.associateWith { 0 }.toMutableMap()

    fun countChannels(channels: List<ChannelId?>): MutableMap<ChannelId, Int> {
        val counts = emptyCounts()
        for (channel in channels) {
            if (channel != null) counts[channel] = counts.getValue(channel) + 1
        }
        return counts
    }

    fun allocateByWeights(
        total: Int,
        weights: Map<ChannelId, Double>,
    ): Map<ChannelId, Int> {
        val result = emptyCounts()
        val sum = CHANNEL_IDS.sumOf { max(0.0, weights[it] ?: 0.0) }
        if (sum <= 0.0 || total <= 0) return result
        val remainders = mutableListOf<Pair<ChannelId, Double>>()
        var allocated = 0
        for (channel in CHANNEL_IDS) {
            val exact = total * max(0.0, weights[channel] ?: 0.0) / sum
            val floor = floor(exact).toInt()
            result[channel] = floor
            allocated += floor
            remainders.add(channel to (exact - floor))
        }
        remainders.sortByDescending { it.second }
        var index = allocated
        while (index < total) {
            val channel = remainders[(index - allocated) % remainders.size].first
            result[channel] = result.getValue(channel) + 1
            index += 1
        }
        return result
    }

    data class PlanOptions(
        val coldStart: Boolean = false,
        val mode: RadioMode = RadioMode.RADIO,
        val explorationFactor: Double = 1.0,
        val bandit: Map<String, ChannelBanditArm>? = null,
        val rng: () -> Double = { kotlin.random.Random.nextDouble() },
        val now: Long = System.currentTimeMillis(),
    )

    fun plan(
        target: Int,
        recentChannels: List<ChannelId?>,
        availability: Map<ChannelId, Int>,
        options: PlanOptions = PlanOptions(),
    ): ChannelQuotaPlan {
        val explore = options.mode == RadioMode.EXPLORE
        val base = if (explore) RadioConfig.Channels.EXPLORE_TARGET_PER_WINDOW else RadioConfig.Channels.TARGET_PER_WINDOW
        val totalTarget = max(0, target)
        val explorationFactor =
            max(0.0, min(RadioConfig.Bandit.MAX_BOOST, options.explorationFactor))
        val weights = CHANNEL_IDS.associateWith { (base[it] ?: 0).toDouble() }.toMutableMap()
        if (explorationFactor != 1.0) {
            weights[ChannelId.C] = (base[ChannelId.C] ?: 0) * explorationFactor
            weights[ChannelId.D] = (base[ChannelId.D] ?: 0) * explorationFactor
        }
        options.bandit?.let { bandit ->
            for (channel in CHANNEL_IDS) {
                weights[channel] =
                    max(0.0, (weights[channel] ?: 0.0) * ChannelBandit.thompsonMultiplier(bandit, channel, options.now, options.rng))
            }
        }
        val baseAllocation = allocateByWeights(totalTarget, weights)
        val recent = recentChannels.takeLast(RadioConfig.Channels.WINDOW_SIZE)
        val counts = countChannels(recent)
        val quotas = emptyCounts()
        val reasons = mutableMapOf<ChannelId, String>()

        fun available(channel: ChannelId): Int = max(0, availability[channel] ?: 0)

        for (channel in CHANNEL_IDS) {
            quotas[channel] = max(0, (baseAllocation[channel] ?: 0) - (counts[channel] ?: 0))
        }
        for (channel in CHANNEL_IDS) {
            if (quotas.getValue(channel) <= available(channel)) continue
            quotas[channel] = available(channel)
            reasons[channel] =
                when {
                    available(channel) <= 0 && channel == ChannelId.B && options.coldStart -> "cold_start"
                    available(channel) <= 0 -> "no_candidate"
                    else -> "insufficient_candidate"
                }
        }

        var remaining = totalTarget - CHANNEL_IDS.sumOf { quotas.getValue(it) }
        val fallbackOrder =
            when {
                explore -> RadioConfig.Channels.EXPLORE_FALLBACK_ORDER
                options.coldStart && available(ChannelId.B) <= 0 -> RadioConfig.Channels.COLD_START_FALLBACK_ORDER
                else -> RadioConfig.Channels.FALLBACK_ORDER
            }
        var guard = 0
        while (remaining > 0 && guard < totalTarget * 4) {
            guard += 1
            var best: ChannelId? = null
            var bestScore = Double.NEGATIVE_INFINITY
            val after = emptyCounts()
            for (channel in CHANNEL_IDS) after[channel] = (counts[channel] ?: 0) + quotas.getValue(channel)
            val afterTotal = recent.size + CHANNEL_IDS.sumOf { quotas.getValue(it) }
            val weightsSum = CHANNEL_IDS.sumOf { weights[it] ?: 0.0 }
            for (channel in fallbackOrder) {
                if (available(channel) <= quotas.getValue(channel)) continue
                if (options.coldStart && channel == ChannelId.B && available(ChannelId.B) <= 0) continue
                val desiredShare = if (weightsSum > 0) (weights[channel] ?: 0.0) / weightsSum else 0.0
                val currentShare = if (afterTotal > 0) after.getValue(channel).toDouble() / afterTotal else 0.0
                val score = desiredShare - currentShare
                if (score > bestScore) {
                    bestScore = score
                    best = channel
                }
            }
            if (best == null) {
                for (channel in CHANNEL_IDS) {
                    if (available(channel) > 0) continue
                    reasons[channel] =
                        if (channel == ChannelId.B && options.coldStart) "cold_start" else "no_candidate"
                }
                break
            }
            quotas[best] = quotas.getValue(best) + 1
            remaining -= 1
        }

        return ChannelQuotaPlan(
            quotas = quotas,
            total = CHANNEL_IDS.sumOf { quotas.getValue(it) },
            reasons = reasons,
        )
    }
}
