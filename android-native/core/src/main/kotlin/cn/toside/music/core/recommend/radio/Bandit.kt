package cn.toside.music.core.recommend.radio

import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.round

/**
 * 通道配额的 Thompson bandit —— RN `core/recommend/bandit.ts` 原样移植。
 *
 * 完播/喜欢记 alpha，早切/不喜欢记 beta；读取时按半衰期衰减（先验部分不衰减），
 * p 线性映射到 [minBoost, maxBoost]，先验均值 p=0.5 恰好中性。
 * 随机源全部经 [rng] 注入，测试可锁种子。
 */
object ChannelBandit {
    fun armOf(
        arms: Map<String, ChannelBanditArm>,
        channel: ChannelId,
    ): ChannelBanditArm =
        arms[channel.name] ?: ChannelBanditArm(
            alpha = RadioConfig.Bandit.PRIOR_ALPHA,
            beta = RadioConfig.Bandit.PRIOR_BETA,
            lastUpdatedAt = 0,
        )

    fun update(
        arms: MutableMap<String, ChannelBanditArm>,
        channel: ChannelId?,
        outcome: BanditOutcome,
        now: Long,
    ) {
        if (channel == null) return
        val arm = armOf(arms, channel)
        arms[channel.name] =
            when (outcome) {
                BanditOutcome.POSITIVE ->
                    ChannelBanditArm(
                        alpha = min(RadioConfig.Bandit.MAX_COUNT, arm.alpha + 1),
                        beta = arm.beta,
                        lastUpdatedAt = now,
                    )
                BanditOutcome.NEGATIVE ->
                    ChannelBanditArm(
                        alpha = arm.alpha,
                        beta = min(RadioConfig.Bandit.MAX_COUNT, arm.beta + 1),
                        lastUpdatedAt = now,
                    )
            }
    }

    /** Beta(alpha,beta) 用整数形状的 Gamma 之和近似：Gamma(k,1) = -Σln(u)。 */
    private fun sampleGamma(
        shape: Double,
        rng: () -> Double,
    ): Double {
        val k = max(1, round(shape).toInt())
        var sum = 0.0
        repeat(k) {
            sum += -ln(max(rng(), 1e-9))
        }
        return sum
    }

    private fun decayedArm(
        arms: Map<String, ChannelBanditArm>,
        channel: ChannelId,
        now: Long,
    ): ChannelBanditArm {
        val arm = armOf(arms, channel)
        if (arm.lastUpdatedAt == 0L) return arm
        val elapsed = max(0L, now - arm.lastUpdatedAt)
        val factor = 0.5.pow(elapsed / (max(1.0, RadioConfig.Bandit.HALF_LIFE_DAYS) * 86_400_000.0))
        return ChannelBanditArm(
            alpha = RadioConfig.Bandit.PRIOR_ALPHA + (arm.alpha - RadioConfig.Bandit.PRIOR_ALPHA) * factor,
            beta = RadioConfig.Bandit.PRIOR_BETA + (arm.beta - RadioConfig.Bandit.PRIOR_BETA) * factor,
            lastUpdatedAt = arm.lastUpdatedAt,
        )
    }

    private fun clampMultiplier(value: Double): Double = max(RadioConfig.Bandit.MIN_BOOST, min(RadioConfig.Bandit.MAX_BOOST, value))

    fun thompsonMultiplier(
        arms: Map<String, ChannelBanditArm>,
        channel: ChannelId,
        now: Long,
        rng: () -> Double,
    ): Double {
        val arm = decayedArm(arms, channel, now)
        val observations =
            (arm.alpha - RadioConfig.Bandit.PRIOR_ALPHA) + (arm.beta - RadioConfig.Bandit.PRIOR_BETA)
        if (observations < RadioConfig.Bandit.MIN_OBSERVATIONS) return 1.0
        val x = sampleGamma(arm.alpha, rng)
        val y = sampleGamma(arm.beta, rng)
        return clampMultiplier(
            RadioConfig.Bandit.MIN_BOOST +
                (x / (x + y)) * (RadioConfig.Bandit.MAX_BOOST - RadioConfig.Bandit.MIN_BOOST),
        )
    }
}

enum class BanditOutcome { POSITIVE, NEGATIVE }
