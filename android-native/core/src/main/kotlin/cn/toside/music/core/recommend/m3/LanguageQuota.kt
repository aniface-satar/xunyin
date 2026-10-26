package cn.toside.music.core.recommend.m3

import cn.toside.music.core.recommend.radio.RadioConfig
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * 语种硬配额的纯算术层 —— RN `core/recommend/languageQuota.ts` 原样移植。
 *
 * 链路：问卷百分比 → 窗口目标首数（[computeLangTargets]）→ 扣掉窗口已用量
 * → 本轮可选上限（[computeLangCaps] / [computeLangCapsForBatch]）。
 * 执行点在选曲筛子里（[langWithinCap] / [consecutiveLangAllowed]），供给侧读缺口（[countPoolLang]）。
 */
object LanguageQuota {
    /** 问卷选项 id → 语种桶。genre 类选项（pop/rock/…）不在这张表里，天然不参与配额。 */
    val OPTION_TO_BUCKET: Map<String, LangBucket> =
        mapOf(
            "zh" to LangBucket.ZH,
            "cantonese" to LangBucket.YUE,
            "western" to LangBucket.EN,
            "ja" to LangBucket.JA,
            "ko" to LangBucket.KO,
            "other" to LangBucket.OTHER,
        )

    /** 本轮上限相对缺口多给的余量（首）。只允许向下收紧，不回溯删除已排进队列的曲目。 */
    const val CAP_TOLERANCE = 1

    /** 同一种语言最多连播几首（硬规则，配额放开档也守）。 */
    const val MAX_CONSECUTIVE_SAME_LANG = 2

    /** 纯音乐在同一窗口里的上限；不占语言名额。 */
    const val INSTRUMENTAL_PER_WINDOW = 2

    /**
     * 取队列尾部 windowSize 首。
     *
     * RN 的注释点出过 `arr.slice(-0) === arr.slice(0)`（整个数组）这个坑；Kotlin 的
     * `takeLast(0)` 本身返回空列表不会踩，但负数会抛 `IllegalArgumentException`，
     * 所以仍然显式夹紧——两条语言的语义差异不该靠「恰好没踩到」维持。
     */
    fun <T> windowSlice(
        items: List<T>,
        windowSize: Int,
    ): List<T> {
        val size = max(0, windowSize)
        return if (size == 0) emptyList() else items.takeLast(size)
    }

    data class LangTargets(
        /** 已声明桶的目标首数；滑到 0% 也算声明，目标是 0 首。没滑过的桶不在这里。 */
        val targets: Map<LangBucket, Int>,
        /** 窗口里没被任何声明桶占走的名额。 */
        val free: Int,
        /** 问卷没滑过任何语言时为 false，本轮不设配额。 */
        val enforced: Boolean,
    )

    /** 最大余数法：按占比把 total 首分给声明桶，同余数按声明顺序排前。 */
    private fun allocateByPercents(
        total: Int,
        percents: Map<LangBucket, Double>,
    ): Map<LangBucket, Int> {
        val result = linkedMapOf<LangBucket, Int>()
        // 声明过的桶（含 0%）先各占一位 0：0% 桶必须留在结果里，否则 caps 查不到它、按「缺席即不限」放行
        val declared = QUOTA_LANG_BUCKETS.filter { percents.containsKey(it) }
        for (bucket in declared) result[bucket] = 0
        // 余数补位只在正 percent 的桶里轮：0% 桶吃进一个名额就是替用户改口
        val buckets = declared.filter { (percents[it] ?: 0.0) > 0.0 }
        val sum = buckets.sumOf { percents[it] ?: 0.0 }
        if (sum <= 0.0 || total <= 0) return result
        val remainders = mutableListOf<Pair<LangBucket, Double>>()
        var allocated = 0
        for (bucket in buckets) {
            val exact = total * (percents[bucket] ?: 0.0) / sum
            val floorValue = floor(exact).toInt()
            result[bucket] = floorValue
            allocated += floorValue
            remainders.add(bucket to (exact - floorValue))
        }
        remainders.sortByDescending { it.second }
        var index = allocated
        while (index < total) {
            val bucket = remainders[(index - allocated) % remainders.size].first
            result[bucket] = result.getValue(bucket) + 1
            index += 1
        }
        return result
    }

    fun computeLangTargets(
        weights: Map<String, Double>,
        windowSize: Int = RadioConfig.Channels.WINDOW_SIZE,
    ): LangTargets {
        val percents = mutableMapOf<LangBucket, Double>()
        for ((optionId, raw) in weights) {
            val bucket = OPTION_TO_BUCKET[optionId] ?: continue
            if (!raw.isFinite()) continue
            // 中性点不是声明。写侧 sanitizeWeights 会丢掉它，但存量数据里可能带着 {zh: 50}，
            // 读侧不挡就等于让一条历史中性值冒充「华语占窗口一半」。
            if (raw == Onboarding.NEUTRAL_PERCENT.toDouble()) continue
            percents[bucket] = (percents[bucket] ?: 0.0) + max(0.0, min(100.0, raw))
        }
        // 「有没有滑过语言桶」要看声明集合，不能看 percent 之和：全滑到 0% 时和为 0，但用户明明表过态
        val declared = QUOTA_LANG_BUCKETS.filter { percents.containsKey(it) }
        if (declared.isEmpty()) return LangTargets(emptyMap(), max(0, windowSize), enforced = false)

        val window = max(0, windowSize)
        val sum = declared.sumOf { percents[it] ?: 0.0 }
        // 合计 >100 时全部名额都给声明桶；<100 时只给占比对应的那一段，剩下算自由名额
        val declaredCount = min(window, (window * min(sum, 100.0) / 100.0).roundToInt())
        val targets = allocateByPercents(declaredCount, percents)
        val given = QUOTA_LANG_BUCKETS.sumOf { targets[it] ?: 0 }
        return LangTargets(targets, max(0, window - given), enforced = true)
    }

    fun countLangUsed(
        recentLangs: List<LangBucket?>,
        windowSize: Int = RadioConfig.Channels.WINDOW_SIZE,
    ): Map<LangBucket, Int> {
        val counts = mutableMapOf<LangBucket, Int>()
        for (lang in windowSlice(recentLangs, windowSize)) {
            if (lang == null || lang == LangBucket.UNKNOWN) continue
            counts[lang] = (counts[lang] ?: 0) + 1
        }
        return counts
    }

    data class LangCaps(
        val enforced: Boolean,
        /** 只包含已声明桶；缺席即代表该桶不受配额约束。 */
        val caps: Map<LangBucket, Int>,
    ) {
        companion object {
            val UNENFORCED = LangCaps(enforced = false, caps = emptyMap())
        }
    }

    fun computeLangCaps(
        targets: LangTargets,
        used: Map<LangBucket, Int>,
        tolerance: Int = CAP_TOLERANCE,
    ): LangCaps {
        if (!targets.enforced) return LangCaps.UNENFORCED
        val caps = mutableMapOf<LangBucket, Int>()
        for (bucket in QUOTA_LANG_BUCKETS) {
            val target = targets.targets[bucket] ?: continue
            // 容差是给非零配额的四舍五入留的余地；0% 是「明确不要」，加容差等于替用户改口
            caps[bucket] =
                if (target == 0) 0 else max(0, target - (used[bucket] ?: 0)) + max(0, tolerance)
        }
        return LangCaps(enforced = true, caps = caps)
    }

    /**
     * 按「这一批播完后的窗口」算上限：新队列会顶掉窗口尾部 batchSize 首，
     * 上一批里还会留在窗口中的只有最近 `windowSize - batchSize` 首。
     * 若直接按最近 windowSize 首扣已用量，整批 20 首补货时会把已经滑出的上一批也算进来，
     * 配额只能靠 1 首容差兑现（10% 目标 2 首，稳态掉到约 1.5 首/20）。
     */
    fun computeLangCapsForBatch(
        targets: LangTargets,
        recentLangs: List<LangBucket?>,
        batchSize: Int,
        windowSize: Int = RadioConfig.Channels.WINDOW_SIZE,
        tolerance: Int = CAP_TOLERANCE,
    ): LangCaps {
        val window = max(0, windowSize)
        val overlap = max(0, window - max(0, batchSize))
        return computeLangCaps(targets, countLangUsed(recentLangs, overlap), tolerance)
    }

    /** 判不出语言的歌（null / unknown）放行：它既不能凑配额也不该被当成另一种语言卡住。 */
    fun langWithinCap(
        lang: LangBucket?,
        caps: Map<LangBucket, Int>,
    ): Boolean {
        if (lang == null || lang == LangBucket.UNKNOWN) return true
        val cap = caps[lang] ?: return true
        return cap > 0
    }

    /** 连播硬规则：只看队列尾部的同语言连续段，与窗口配额无关。 */
    fun consecutiveLangAllowed(
        recentLangs: List<LangBucket?>,
        lang: LangBucket?,
        maxConsecutive: Int = MAX_CONSECUTIVE_SAME_LANG,
    ): Boolean {
        if (lang == null || lang == LangBucket.UNKNOWN) return true
        var run = 0
        for (index in recentLangs.indices.reversed()) {
            if (recentLangs[index] != lang) break
            run += 1
        }
        return run < max(1, maxConsecutive)
    }

    fun instrumentalAllowed(
        recentLangs: List<LangBucket?>,
        windowSize: Int = RadioConfig.Channels.WINDOW_SIZE,
        maxPerWindow: Int = INSTRUMENTAL_PER_WINDOW,
    ): Boolean {
        var count = 0
        for (lang in windowSlice(recentLangs, windowSize)) {
            if (lang == LangBucket.INSTR) count += 1
        }
        return count < max(0, maxPerWindow)
    }

    /** 池内各桶现有多少首：L1 的 lang 优先，判不出才退 L2 的桶召回提示。 */
    fun countPoolLang(candidates: List<PoolLangInput>): Map<LangBucket, Int> {
        val counts = mutableMapOf<LangBucket, Int>()
        for (candidate in candidates) {
            val bucket = candidate.lang ?: candidate.langHint ?: LangBucket.UNKNOWN
            counts[bucket] = (counts[bucket] ?: 0) + 1
        }
        return counts
    }

    data class PoolLangInput(
        val lang: LangBucket? = null,
        val langHint: LangBucket? = null,
    )

    data class DetailReserveOptions(
        val detailBudget: Int,
        val unknownShare: Double,
        val escalateAt: Double,
        val base: Int,
        val escalateTo: Int,
    )

    /**
     * 桶召回该占几格详情额度：unknown 占比过高时多给一格，但永远给常规摘要留至少一格，
     * 否则语种补齐会把画像通道（A/B）饿死。M3 只移植不接线（见报告映射表）。
     */
    fun computeBucketDetailReserve(options: DetailReserveOptions): Int {
        val want = if (options.unknownShare > options.escalateAt) options.escalateTo else options.base
        return max(0, min(want, max(0, options.detailBudget - 1)))
    }

    data class PoolBucketLimitOptions(
        val targets: LangTargets,
        val maxSize: Int,
        val windowSize: Int,
        val slack: Double,
    )

    /**
     * 把「20 首窗口里的目标首数」放大成「池里允许存在多少首」，再乘宽松系数：
     * 淘汰是慢变量（下次抓取才能补货），卡太死会让某语种突然断供。M3 只移植不接线。
     */
    fun computePoolBucketLimits(options: PoolBucketLimitOptions): Map<LangBucket, Int> {
        if (!options.targets.enforced) return emptyMap()
        val window = max(1, options.windowSize)
        val limits = mutableMapOf<LangBucket, Int>()
        for (bucket in QUOTA_LANG_BUCKETS) {
            val target = options.targets.targets[bucket] ?: continue
            limits[bucket] = kotlin.math.ceil(target * (max(0, options.maxSize).toDouble() / window) * max(1.0, options.slack)).toInt()
        }
        return limits
    }
}
