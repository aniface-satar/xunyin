package cn.toside.music.core.recommend.m3

import cn.toside.music.core.recommend.radio.RadioConfig
import kotlin.math.abs
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sqrt

/**
 * 相似度与画像分的纯算术 —— RN `core/recommend/similarity.ts` 的可移植子集 + M3 新增的
 * 「普通 Map 相似度」四件套（任务书要求歌手/标签/语种/年代各一路）。
 *
 * 降级说明（理由见 lane 报告映射表）：依赖「已观察歌单」倒排索引的四个函数
 * （`computeCandidateCoOccurrence` / `buildSessionCoOccurrence` / `groupSimilarPlaylists` /
 * `buildTrackPlaylistIndex`）不移植——原生 M2 的候选池没有多歌单观察链路，
 * 照搬会得到一组恒 0 的函数。共现分的两个小件（[computeCoOccurrence] /
 * [computePlaylistAffinity]）仍保留，它们本身就是纯算术，Wave6 接观察链路时直接可用。
 */
object Similarity {
    /** 共现系数：`common / sqrt(a * b)`。任一侧为 0 返回 0。 */
    fun computeCoOccurrence(
        commonPlaylistCount: Int,
        playlistCountA: Int,
        playlistCountB: Int,
    ): Double {
        if (playlistCountA <= 0 || playlistCountB <= 0) return 0.0
        return commonPlaylistCount.toDouble() / sqrt(playlistCountA.toDouble() * playlistCountB.toDouble())
    }

    fun computePlaylistAffinity(
        overlap: Double,
        profileSize: Int,
        playlistSize: Int,
    ): Double {
        if (profileSize <= 0 || playlistSize <= 0) return 0.0
        return overlap / sqrt(profileSize.toDouble() * playlistSize.toDouble())
    }

    /** 半衰期衰减：`value × 0.5^(elapsed / halfLife)`。halfLife ≤ 0 时按 1 天处理。 */
    fun decayWeight(
        value: Double,
        elapsedMs: Long,
        halfLifeDays: Double,
    ): Double {
        if (value == 0.0) return 0.0
        val halfLifeMs = max(1.0, halfLifeDays) * 86_400_000.0
        return value * 0.5.pow(max(0L, elapsedMs) / halfLifeMs)
    }

    /** 歌单反馈质量：初始 0.5，`(2+P)/(4+P+N)`。 */
    fun computeFeedbackQuality(
        positiveWeight: Double,
        negativeWeight: Double,
    ): Double {
        val p = max(0.0, positiveWeight)
        val n = max(0.0, negativeWeight)
        return (2.0 + p) / (4.0 + p + n)
    }

    fun computeExposureScore(
        exposureCount: Int,
        scale: Double = 4.0,
    ): Double = 1.0 / (1.0 + max(0, exposureCount) / max(1.0, scale))

    data class PlaylistScoreParts(
        val affinity: Double,
        val feedback: Double,
        val exploration: Double,
    )

    data class PlaylistScore(
        val score: Double,
        val parts: PlaylistScoreParts,
    )

    /** 歌单分 = 亲和力/反馈质量/探索度三项加权，三项各自钳到 [0,1]。 */
    fun computePlaylistScore(
        affinity: Double,
        positiveWeight: Double,
        negativeWeight: Double,
        exposureCount: Int,
    ): PlaylistScore {
        val parts =
            PlaylistScoreParts(
                affinity = max(0.0, min(1.0, affinity)),
                feedback = max(0.0, min(1.0, computeFeedbackQuality(positiveWeight, negativeWeight))),
                exploration = computeExposureScore(exposureCount),
            )
        return PlaylistScore(
            score = 0.5 * parts.affinity + 0.3 * parts.feedback + 0.2 * parts.exploration,
            parts = parts,
        )
    }

    /** Jaccard：`|A∩B| / |A∪B|`，双空返回 0（不是 1——两首都没有标签不代表相似）。 */
    fun jaccard(
        a: Set<String>,
        b: Set<String>,
    ): Double {
        if (a.isEmpty() || b.isEmpty()) return 0.0
        var intersection = 0
        for (key in a) {
            if (b.contains(key)) intersection += 1
        }
        val union = a.size + b.size - intersection
        return if (union > 0) intersection.toDouble() / union else 0.0
    }

    /** 热门歌曲按观察频次降权：`1 / (1 + ln(1+f))^exponent`。 */
    fun computePopularityDamping(
        observedFrequency: Int,
        exponent: Double = 1.0,
    ): Double = 1.0 / (1.0 + ln(1.0 + max(0, observedFrequency))).pow(exponent)

    /**
     * 余弦相似度，输入普通权重 Map（歌手→权重 / 分类→权重都走这里）。
     * 范数取绝对值：权重可以是负数（负反馈），负属同一方向的两个量不该互相抵消成 0 范数。
     */
    fun cosine(
        a: Map<String, Double>,
        b: Map<String, Double>,
    ): Double {
        if (a.isEmpty() || b.isEmpty()) return 0.0
        var dot = 0.0
        for ((key, value) in a) {
            val other = b[key] ?: continue
            dot += value * other
        }
        if (dot <= 0.0) return 0.0
        val normA = sqrt(a.values.sumOf { it * it })
        val normB = sqrt(b.values.sumOf { it * it })
        if (normA <= 0.0 || normB <= 0.0) return 0.0
        return max(0.0, min(1.0, dot / (normA * normB)))
    }

    /**
     * 带权 Jaccard（重叠系数）：`Σ min(a_i, b_i) / Σ max(a_i, b_i)`。
     * 标签集是「有没有」而非「多少」时 Jaccard 更合适，但画像侧标签有净权，
     * 所以取这个折中版本；两边都为空返回 0。
     */
    fun weightedJaccard(
        a: Map<String, Double>,
        b: Map<String, Double>,
    ): Double {
        if (a.isEmpty() && b.isEmpty()) return 0.0
        val keys = a.keys + b.keys
        var overlap = 0.0
        var union = 0.0
        for (key in keys) {
            val left = abs(a[key] ?: 0.0)
            val right = abs(b[key] ?: 0.0)
            overlap += min(left, right)
            union += max(left, right)
        }
        return if (union > 0.0) max(0.0, min(1.0, overlap / union)) else 0.0
    }

    /**
     * 歌手画像相似度：画像侧是「歌手→净权」，候选侧是歌手名集合。
     * 命中权重和 / 画像总权重（收敛到 [0,1]），是余弦在不带方向时的稳定退化。
     */
    fun artistAffinity(
        profileArtists: Map<String, Double>,
        candidateArtists: List<String>,
    ): Double {
        if (profileArtists.isEmpty() || candidateArtists.isEmpty()) return 0.0
        var hit = 0.0
        for (artist in candidateArtists) {
            hit = max(hit, abs(profileArtists[artist] ?: 0.0))
        }
        val total = profileArtists.values.sumOf { abs(it) }
        if (total <= 0.0) return 0.0
        return max(0.0, min(1.0, hit / total))
    }

    /** 标签相似度：画像标签净权 vs 候选标签集合，用带权 Jaccard。 */
    fun tagSimilarity(
        profileTags: Map<String, Double>,
        candidateTags: List<String>,
    ): Double {
        if (profileTags.isEmpty() || candidateTags.isEmpty()) return 0.0
        val candidate = candidateTags.associateWith { 1.0 }
        return weightedJaccard(profileTags, candidate)
    }

    /**
     * 语种相似度：画像各桶占比 vs 候选桶。
     * 判不出语种（null / unknown）返回中性 0.5——既不奖励也不惩罚，
     * 与配额侧「unknown 放行」保持同一个态度。
     */
    fun langSimilarity(
        profileShare: Map<LangBucket, Double>,
        candidateLang: LangBucket?,
    ): Double {
        if (candidateLang == null || candidateLang == LangBucket.UNKNOWN) return 0.5
        if (profileShare.isEmpty()) return 0.5
        val total = profileShare.values.sumOf { max(0.0, it) }
        if (total <= 0.0) return 0.5
        val share = max(0.0, profileShare[candidateLang] ?: 0.0) / total
        // 占比 1.0 时给 1.0，占比 0 时给 0；中间线性
        return max(0.0, min(1.0, share))
    }

    /**
     * 年代相似度：画像年代分布（年份→权重）算加权质心，候选年份离质心越远越低。
     * 窗口默认 ±15 年；缺年份返回中性 0.5。
     */
    fun eraSimilarity(
        profileEras: Map<Int, Double>,
        candidateYear: Int?,
        windowYears: Int = 15,
    ): Double {
        if (candidateYear == null) return 0.5
        val weightSum = profileEras.values.sumOf { max(0.0, it) }
        if (weightSum <= 0.0) return 0.5
        var centroid = 0.0
        for ((year, weight) in profileEras) {
            centroid += year * max(0.0, weight)
        }
        centroid /= weightSum
        val distance = abs(candidateYear - centroid)
        val window = max(1, windowYears).toDouble()
        return max(0.0, min(1.0, 1.0 - distance / window))
    }

    /**
     * 多路相似度加权合成。`parts` 是 (权重, 相似度) 对；权重和 ≤ 0 时返回 0。
     * 权重不必归一化，本函数会自己归一。
     */
    fun combine(parts: List<Pair<Double, Double>>): Double {
        var weightSum = 0.0
        var total = 0.0
        for ((weight, value) in parts) {
            if (weight <= 0.0) continue
            weightSum += weight
            total += weight * max(0.0, min(1.0, value))
        }
        if (weightSum <= 0.0) return 0.0
        return max(0.0, min(1.0, total / weightSum))
    }

    /** M3 综合画像相似度：歌手 0.4 / 标签 0.3 / 语种 0.15 / 年代 0.15。 */
    fun profileSimilarity(
        profileArtists: Map<String, Double>,
        profileTags: Map<String, Double>,
        profileLangShare: Map<LangBucket, Double>,
        profileEras: Map<Int, Double>,
        candidate: CandidateProfile,
    ): Double =
        combine(
            listOf(
                0.4 to artistAffinity(profileArtists, candidate.artistKeys),
                0.3 to tagSimilarity(profileTags, candidate.tags),
                0.15 to langSimilarity(profileLangShare, candidate.lang),
                0.15 to eraSimilarity(profileEras, candidate.year),
            ),
        )

    data class CandidateProfile(
        val artistKeys: List<String> = emptyList(),
        val tags: List<String> = emptyList(),
        val lang: LangBucket? = null,
        val year: Int? = null,
    )

    /** 静音/空候选的兜底权重：与 [RadioConfig.Softmax.MIN_WEIGHT] 同源，避免两处各写一个字面量。 */
    val MIN_WEIGHT: Double get() = RadioConfig.Softmax.MIN_WEIGHT
}
