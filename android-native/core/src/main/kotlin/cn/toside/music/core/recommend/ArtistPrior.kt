package cn.toside.music.core.recommend

import kotlin.math.max
import kotlin.math.min

/**
 * 长期歌手先验 —— RN `core/recommend/artistPrior.ts` 原样移植。
 *
 * 与词面级学习（NameTokenFeedback）同构，但按歌手归因、半衰期更长。
 * 历史上总被切的歌手持续降权，总是听完的歌手小幅加分。软信号，不封禁。
 */
object ArtistPrior {
    private fun decayedWeights(
        pref: ThemePreference?,
        now: Long,
    ): Pair<Double, Double> {
        if (pref == null) return 0.0 to 0.0
        val elapsed = max(0L, now - (pref.lastDecayTime.takeIf { it != 0L } ?: now))
        val cfg = RecommendConfig.artistPrior
        return decayWeight(pref.positiveWeight, elapsed, cfg.halfLifeDays) to
            decayWeight(pref.negativeWeight, elapsed, cfg.halfLifeDays)
    }

    /** 结算/显式反馈按歌手归因记账；带半衰期衰减，品味漂移可被重新发现。 */
    fun applyArtistStatsFeedback(
        map: MutableMap<String, ThemePreference>,
        artistKeys: List<String>?,
        positiveDelta: Double,
        negativeDelta: Double,
        now: Long,
    ) {
        if ((positiveDelta == 0.0 && negativeDelta == 0.0) || artistKeys.isNullOrEmpty()) return
        val cfg = RecommendConfig.artistPrior
        for (artist in artistKeys) {
            if (artist.isEmpty()) continue
            val (pos, neg) = decayedWeights(map[artist], now)
            map[artist] =
                ThemePreference(
                    themeId = artist,
                    positiveWeight = min(cfg.maxWeight, pos + max(0.0, positiveDelta)),
                    negativeWeight = min(cfg.maxWeight, neg + max(0.0, negativeDelta)),
                    lastDecayTime = now,
                    lastUsedTime = now,
                )
        }
    }

    /**
     * 候选歌手与先验命中后的乘性因子：取各歌手衰减后正/负权重最大值，
     * 负向因子更重，钳位 [floor, ceiling]。无数据或无命中为 1。
     */
    fun artistPriorFactor(
        map: Map<String, ThemePreference>?,
        artistKeys: List<String>?,
        now: Long,
    ): Double {
        if (map == null || artistKeys.isNullOrEmpty()) return 1.0
        var maxPos = 0.0
        var maxNeg = 0.0
        for (artist in artistKeys) {
            val (pos, neg) = decayedWeights(map[artist], now)
            maxPos = max(maxPos, pos)
            maxNeg = max(maxNeg, neg)
        }
        val cfg = RecommendConfig.artistPrior
        val factor = 1.0 + maxPos * cfg.positiveFactor - maxNeg * cfg.negativeFactor
        return max(cfg.floor, min(cfg.ceiling, factor))
    }
}
