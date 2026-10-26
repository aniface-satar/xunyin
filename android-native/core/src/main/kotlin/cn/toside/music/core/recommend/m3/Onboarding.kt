package cn.toside.music.core.recommend.m3

import cn.toside.music.core.recommend.RecommendConfig
import cn.toside.music.core.recommend.ThemeFeedback
import cn.toside.music.core.recommend.ThemePreference
import cn.toside.music.core.recommend.TrackKeys
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * 首次进入推荐页的偏好问卷 —— RN `core/recommend/onboarding.ts` 原样移植（纯数据 + 纯函数）。
 *
 * 选项 id 就是持久化键（`onboarding.weights`），标签文案在 i18n
 * （`recommend_onboarding_opt_<id>`）。`aliases[0]` 是规范词（进关键词池做包含匹配），
 * 全量 aliases 归一化后作为 themeWeights 的精确键——各音源分类目录叫法不一
 * （欧美/英文/西洋），多别名各占一键，同名 tag 才会吃到净权。
 *
 * 本文件的百分比同时被两个消费方读：语种配额（[LanguageQuota.computeLangTargets]）
 * 与分类净权播种（[computeSeedWeights]）。0% 因此有两层含义——
 * 「最强负播种」与「配额 0 首」，是同一个数字的两个侧面，不是冲突。
 */
object Onboarding {
    enum class Question { LANGUAGE, GENRE }

    data class Option(
        val id: String,
        val question: Question,
        val aliases: List<String>,
    )

    /** 语言类 6 项 + 分类类 16 项；顺序即 UI 顺序与 `allocateByPercents` 的同余数次序。 */
    val OPTIONS: List<Option> =
        listOf(
            Option("zh", Question.LANGUAGE, listOf("华语", "国语", "中文", "内地")),
            Option("cantonese", Question.LANGUAGE, listOf("粤语", "广东歌")),
            Option("western", Question.LANGUAGE, listOf("欧美", "英文", "英语", "西洋")),
            Option("ja", Question.LANGUAGE, listOf("日语", "日文", "日本")),
            Option("ko", Question.LANGUAGE, listOf("韩语", "韩国", "KPOP")),
            Option("other", Question.LANGUAGE, listOf("小语种", "俄语", "法语", "德语")),
            Option("pop", Question.GENRE, listOf("流行")),
            Option("rock", Question.GENRE, listOf("摇滚", "ROCK")),
            Option("folk", Question.GENRE, listOf("民谣")),
            Option("rnb", Question.GENRE, listOf("R&B", "节奏布鲁斯", "灵魂")),
            Option("hiphop", Question.GENRE, listOf("说唱", "嘻哈", "HIPHOP", "RAP")),
            Option("electronic", Question.GENRE, listOf("电子", "EDM", "舞曲", "DJ")),
            Option("gufeng", Question.GENRE, listOf("古风", "国风", "中国风")),
            Option("acg", Question.GENRE, listOf("二次元", "ACG", "动漫")),
            Option("light", Question.GENRE, listOf("轻音乐", "纯音乐")),
            Option("jazz", Question.GENRE, listOf("爵士", "JAZZ")),
            Option("blues", Question.GENRE, listOf("蓝调", "布鲁斯", "BLUES")),
            Option("metal", Question.GENRE, listOf("金属", "METAL")),
            Option("punk", Question.GENRE, listOf("朋克", "PUNK")),
            Option("country", Question.GENRE, listOf("乡村", "COUNTRY")),
            Option("latin", Question.GENRE, listOf("拉丁", "LATIN")),
            Option("dj", Question.GENRE, listOf("DJ", "REMIX", "串烧")),
        )

    /** 问卷选项 id 集合（写侧白名单）。 */
    val OPTION_IDS: Set<String> = OPTIONS.map { it.id }.toSet()

    /**
     * 问卷百分比的中性点：50% = 没意见。
     * UI 拿它当「没滑过」的显示值，[sanitizeWeights] 把停在这里的项当「没表态」丢弃——
     * 别再写第二个字面量 50。
     */
    const val NEUTRAL_PERCENT = 50

    /**
     * 只留合法 id，钳到 0-100 并取整到 10 的倍数。
     * 0 值保留（键存在 = 明确不要），滑在中性点 50% 按「没表态」丢弃
     * （播种分量为 0，留着只会让它冒充一条有效配额声明）。
     */
    fun sanitizeWeights(weights: Map<String, Double>): Map<String, Double> {
        val result = mutableMapOf<String, Double>()
        for (option in OPTIONS) {
            val raw = weights[option.id] ?: continue
            if (!raw.isFinite()) continue
            val percent = (max(0.0, min(100.0, raw)) / 10.0).roundToInt() * 10
            if (percent == NEUTRAL_PERCENT) continue
            result[option.id] = percent.toDouble()
        }
        return result
    }

    /**
     * 问卷百分比 → 分类净权初值，以 50% 为中轴：高于 50 给正分量，低于 50 给负分量。
     * 老写法是 `percent/100 × saturation`，「中文 10%」会被记成正偏好、把华语越推越多的锅有一半在这里。
     * 50% 恰为 0（不播种），负支幅度只取正支的一半——误伤比误爱便宜，
     * 但也别狠到把用户没听过的分类一棒打死。
     */
    private const val NEGATIVE_SEED_RATIO = 0.5

    private fun seedValueFor(
        percent: Double,
        saturation: Double,
    ): Double =
        if (percent >= NEUTRAL_PERCENT) {
            (percent - NEUTRAL_PERCENT) / (100.0 - NEUTRAL_PERCENT) * saturation
        } else {
            -((NEUTRAL_PERCENT - percent) / NEUTRAL_PERCENT * saturation * NEGATIVE_SEED_RATIO)
        }

    /**
     * optionId→百分比 映射成 themeWeights 键→初值分量（可正可负）；
     * 同键多选项命中取绝对值更大的一侧。键缺席才是「没滑过」，0% 是最强负分量。
     */
    fun computeSeedWeights(
        weights: Map<String, Double>,
        saturation: Double = RecommendConfig.themeFeedback.saturation,
    ): Map<String, Double> {
        val seeds = mutableMapOf<String, Double>()
        for (option in OPTIONS) {
            val percent = weights[option.id] ?: continue
            val value = seedValueFor(percent, saturation)
            if (value == 0.0) continue
            for (alias in option.aliases) {
                val key = TrackKeys.normalizeText(alias)
                if (key.isEmpty()) continue
                if (abs(value) > abs(seeds[key] ?: 0.0)) seeds[key] = value
            }
        }
        return seeds
    }

    /** 把初值分量按符号并进分类净权的正/负反馈侧；直接改动传入 map（与状态存储共享引用）。 */
    fun applySeedWeights(
        themes: MutableMap<String, ThemePreference>,
        seeds: Map<String, Double>,
        now: Long,
    ) {
        for ((key, seed) in seeds) {
            if (seed == 0.0) continue
            val base = themes[key] ?: ThemeFeedback.createThemePreference(key, now)
            themes[key] =
                if (seed > 0) {
                    base.copy(positiveWeight = base.positiveWeight + seed, lastUsedTime = now)
                } else {
                    base.copy(negativeWeight = base.negativeWeight - seed, lastUsedTime = now)
                }
        }
    }

    /** 只回退记录在案的初值分量：按符号分两支对称回退，减后钳 0，两侧皆 0 才删条目，用户反馈净权保留。 */
    fun revokeSeedWeights(
        themes: MutableMap<String, ThemePreference>,
        seeds: Map<String, Double>,
    ) {
        for ((key, seed) in seeds) {
            if (seed == 0.0) continue
            val pref = themes[key] ?: continue
            if (seed > 0) {
                val positiveWeight = max(0.0, pref.positiveWeight - seed)
                if (positiveWeight == 0.0 && pref.negativeWeight == 0.0) {
                    themes.remove(key)
                } else {
                    themes[key] = pref.copy(positiveWeight = positiveWeight)
                }
            } else {
                val negativeWeight = max(0.0, pref.negativeWeight + seed)
                if (negativeWeight == 0.0 && pref.positiveWeight == 0.0) {
                    themes.remove(key)
                } else {
                    themes[key] = pref.copy(negativeWeight = negativeWeight)
                }
            }
        }
    }

    private const val MIN_KEYWORD_PERCENT = 20.0

    /**
     * 进关键词池的规范词：≥20% 才贡献，按百分比降序（rotation 窗口从强偏好起滑）。
     * 停在 50% 不算表态。
     */
    fun computePreferenceKeywords(weights: Map<String, Double>): List<String> =
        OPTIONS
            .filter { option ->
                val percent = weights[option.id] ?: 0.0
                percent >= MIN_KEYWORD_PERCENT && percent != NEUTRAL_PERCENT.toDouble()
            }.sortedByDescending { weights[it.id] ?: 0.0 }
            .map { TrackKeys.normalizeText(it.aliases.first()) }
            .filter { it.isNotEmpty() }

    /** 问卷规范词排在画像关键词之前：rotation 从强偏好起滑。 */
    fun mergePreferenceKeywords(
        profileKeywords: List<String>,
        preferenceKeywords: List<String>,
    ): List<String> = (preferenceKeywords + profileKeywords).distinct()
}
