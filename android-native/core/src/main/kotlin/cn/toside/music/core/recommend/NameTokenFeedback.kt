package cn.toside.music.core.recommend

import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * 半衰期衰减 —— RN `core/recommend/similarity.ts` 的 `decayWeight`（M1 唯一用到的函数）。
 */
fun decayWeight(
    value: Double,
    elapsedMs: Long,
    halfLifeDays: Double,
): Double {
    if (value == 0.0) return 0.0
    val halfLifeMs = max(1.0, halfLifeDays) * 86_400_000
    return value * 0.5.pow(max(0.0, elapsedMs.toDouble()) / halfLifeMs)
}

/**
 * 词面级学习 —— RN `core/recommend/tokenFeedback.ts` 原样移植（M1 子集：
 * `applyNameTokenFeedback` / `nameTokenFactor` / `getLearnedStyleTokens`）。
 *
 * 歌名 token 从歌名切出风格词与版本标记（DJ版/Live/翻唱/伴奏等），
 * 结算正/负反馈时记账，打分按 token 命中乘性调整。
 */
object NameTokenFeedback {
    private val STOP_TOKENS =
        setOf(
            "的",
            "了",
            "是",
            "在",
            "我",
            "你",
            "他",
            "她",
            "它",
            "们",
            "和",
            "与",
            "跟",
            "对",
            "被",
            "把",
            "吧",
            "吗",
            "呢",
            "啊",
            "呀",
            "哦",
            "嘛",
            "么",
            "啦",
            "哟",
            "喔",
            "嗯",
            "一个",
            "一些",
            "这个",
            "那个",
            "什么",
            "怎么",
            "没有",
            "不是",
            "feat",
            "the",
            "and",
            "of",
            "a",
            "an",
            "by",
            "from",
            "version",
            "ver",
        )

    private const val MAX_TOKENS = 12

    /**
     * 歌名 → 降噪 token 列表：去掉单字、纯数字、停用词，小写化，去重。
     *
     * 【数据底线：与 RN 的已知差异】RN 用 segmentit 中文分词（词典分词），
     * Kotlin/JVM 无等价纯 Java 分词库；这里退化为「按空白切分 + 同一套停用词过滤」。
     * 差异：中文连续书写的歌名（无空格）在 RN 会切出风格词（如「国风」），
     * 这里会保持整段为一个 token——**命不中已学 token** 时因子为 1，
     * 即该曲不获得词面加成，不会产生错误加成；学习侧记录的 token 若是
     * 由含空格歌名切出则两边一致。降级后果：中文无空格歌名的词面学习
     * 在 M1 基本不生效（歌手先验仍完整工作），待后续波次引入分词后对齐。
     */
    fun tokenizeTrackName(name: String?): List<String> {
        if (name == null) return emptyList()
        val trimmed = name.trim()
        if (trimmed.isEmpty()) return emptyList()
        val words = trimmed.split(Regex("\\s+"))
        val tokens = mutableListOf<String>()
        for (raw in words) {
            val token = raw.lowercase().trim()
            if (token.isEmpty()) continue
            if (Regex("^\\d+$").matches(token)) continue
            // 单字/单字母信息量低，直接过滤
            if (token.length < 2) continue
            if (token in STOP_TOKENS) continue
            if (token !in tokens) tokens.add(token)
            if (tokens.size >= MAX_TOKENS) break
        }
        return tokens
    }

    private fun decayedWeights(
        pref: ThemePreference?,
        now: Long,
    ): Pair<Double, Double> {
        if (pref == null) return 0.0 to 0.0
        val elapsed = max(0L, now - (pref.lastDecayTime.takeIf { it != 0L } ?: now))
        val cfg = RecommendConfig.nameToken
        return decayWeight(pref.positiveWeight, elapsed, cfg.halfLifeDays) to
            decayWeight(pref.negativeWeight, elapsed, cfg.halfLifeDays)
    }

    /** 结算出的正/负反馈记到歌名 token 上；带半衰期衰减。 */
    fun applyNameTokenFeedback(
        map: MutableMap<String, ThemePreference>,
        tokens: List<String>?,
        positiveDelta: Double,
        negativeDelta: Double,
        now: Long,
    ) {
        if ((positiveDelta == 0.0 && negativeDelta == 0.0) || tokens.isNullOrEmpty()) return
        val cfg = RecommendConfig.nameToken
        for (token in tokens) {
            if (token.isEmpty()) continue
            val (pos, neg) = decayedWeights(map[token], now)
            map[token] =
                ThemePreference(
                    themeId = token,
                    positiveWeight = min(cfg.maxWeight, pos + max(0.0, positiveDelta)),
                    negativeWeight = min(cfg.maxWeight, neg + max(0.0, negativeDelta)),
                    lastDecayTime = now,
                    lastUsedTime = now,
                )
        }
    }

    /**
     * 候选歌名与学习过的 token 命中后的乘性因子：取各 token 衰减后正/负权重
     * 最大值，负向因子更重（避开踩雷优先），钳位 [floor, ceiling]。
     * 无学习数据或无命中时为 1。
     */
    fun nameTokenFactor(
        map: Map<String, ThemePreference>?,
        name: String?,
        now: Long,
    ): Double {
        if (map == null || name.isNullOrEmpty()) return 1.0
        val tokens = tokenizeTrackName(name)
        if (tokens.isEmpty()) return 1.0
        var maxPos = 0.0
        var maxNeg = 0.0
        for (token in tokens) {
            val (pos, neg) = decayedWeights(map[token], now)
            maxPos = max(maxPos, pos)
            maxNeg = max(maxNeg, neg)
        }
        val cfg = RecommendConfig.nameToken
        val factor = 1.0 + maxPos * cfg.positiveFactor - maxNeg * cfg.negativeFactor
        return max(cfg.floor, min(cfg.ceiling, factor))
    }

    /**
     * 从词面学习提取「被验证过的好风格词」（衰减后正权排序、剔除带负权的坏标记），
     * 供发现搜索的关键词池使用。
     */
    fun getLearnedStyleTokens(
        map: Map<String, ThemePreference>?,
        limit: Int = 4,
        now: Long,
    ): List<String> {
        if (map == null) return emptyList()
        return map.entries
            .map { (token, pref) ->
                val (pos, neg) = decayedWeights(pref, now)
                Triple(token, pos, neg)
            }.filter { it.second > 0 && it.third <= 0 }
            .sortedByDescending { it.second }
            .take(limit)
            .map { it.first }
    }
}
