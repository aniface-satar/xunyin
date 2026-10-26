package cn.toside.music.core.recommend.m3

import cn.toside.music.core.songlist.SonglistSort
import kotlin.math.roundToInt

/**
 * 探索通道 C 的纯选择规则 —— RN `candidate.ts` 里「分类歌单列表轮换」那一支的等价物。
 *
 * RN 的 C 只有一条来源：按学习到的分类权重抽一个标签，用 `最新` 排序拉列表页，
 * 拿到的新鲜歌单就归 C；命中主题净权时同时叠 A。本章只做「怎么选排序」与
 * 「语种缺口用什么关键词补货」两件事，URL 与分页交给 app 侧。
 *
 * 与 RN 的差异：RN 还有「相似曲（audio embedding / 会话共现）」一条来源，
 * 原生 M3 没有音频特征也没有跨歌单共现索引，这条**不做**（lane 报告已记）；
 * 取而代之的是「问卷语种补货」——用用户明确表态过的语种关键词去搜歌，
 * 这是唯一一条不依赖音频信号的「不撞熟歌」来源。
 */
object Discovery {
    /** RN `candidatePool.newestListRatio`：每 10 轮里有 3 轮用「最新」排序。 */
    const val NEWEST_RATIO = 0.3

    private val NEWEST_PATTERN = Regex("最新|新歌|新品|new", RegexOption.IGNORE_CASE)

    data class SortPick(
        val sortId: String,
        /** true = 本轮走「最新」排序，产出的歌单归 C；false = 沿用热门排序（归 D/B）。 */
        val useNew: Boolean,
    )

    fun isNewestSort(sort: SonglistSort): Boolean = NEWEST_PATTERN.containsMatchIn("${sort.name} ${sort.tid}")

    fun newestSort(sorts: List<SonglistSort>): SonglistSort? = sorts.firstOrNull { isNewestSort(it) }

    /**
     * RN `pickListSort`：按 [rotation] 决定这一轮要不要走「最新」。
     *
     * 轮次模 10 落在 `NEWEST_RATIO × 10` 以内、且源提供了最新排序时才算数；
     * 否则退回调用方给的热门排序 id（没给就取目录首档）。
     * 「最新」不是每轮都刷——全站都在推最新歌单等于没有个性化。
     */
    fun pickSort(
        sorts: List<SonglistSort>,
        rotation: Int,
        hotSortId: String? = null,
        ratio: Double = NEWEST_RATIO,
    ): SortPick {
        val newest = newestSort(sorts)
        val threshold = (ratio.coerceIn(0.0, 1.0) * 10).roundToInt()
        val useNew = newest != null && Math.floorMod(rotation, 10) < threshold
        val sortId =
            when {
                useNew && newest != null -> newest.id
                hotSortId != null -> hotSortId
                else -> sorts.firstOrNull()?.id.orEmpty()
            }
        return SortPick(sortId, useNew)
    }

    /**
     * 语种缺口补货关键词：问卷里**明确想要**（> 中性点 50%）的语言项，按百分比降序。
     *
     * 低于中性点的语言项是「不想听」，绝不能拿来补货——那会把用户明明降权的
     * 语种当成缺口反复推。`unknown`/`other` 这类没进问卷的桶在这里天然不出现。
     */
    fun restockPicks(weights: Map<String, Double>): List<RestockPick> =
        Onboarding.OPTIONS
            .filter { it.question == Onboarding.Question.LANGUAGE }
            .mapNotNull { option ->
                val percent = weights[option.id] ?: return@mapNotNull null
                if (percent <= Onboarding.NEUTRAL_PERCENT) null else option to percent
            }.sortedByDescending { it.second }
            .mapNotNull { (option, _) ->
                val keyword = option.aliases.firstOrNull()?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
                // 这一批搜索就是为该语种桶发的：L2 提示直接来自问卷选项 id（比关键词精确，
                // 「欧美」「小语种」这类词不在 kg 语种词表里，靠关键词反查会漏）
                RestockPick(keyword, LanguageQuota.OPTION_TO_BUCKET[option.id])
            }

    /** 一条语种补货任务：关键词 + 该批候选的 L2 语种提示（问卷没表态时第二项为 null）。 */
    data class RestockPick(
        val keyword: String,
        val langHint: LangBucket?,
    )

    /** 只要关键词的旧入口（保留给既有调用方与用例）。 */
    fun restockKeywords(weights: Map<String, Double>): List<String> = restockPicks(weights).map { it.keyword }

    /** 按轮次在补货关键词里游走（没有问卷表态时返回 null，调用方回退到分类轮换）。 */
    fun pickRestockKeyword(
        weights: Map<String, Double>,
        rotation: Int,
    ): String? = pickRestock(weights, rotation)?.keyword

    fun pickRestock(
        weights: Map<String, Double>,
        rotation: Int,
    ): RestockPick? {
        val picks = restockPicks(weights)
        if (picks.isEmpty()) return null
        return picks[Math.floorMod(rotation, picks.size)]
    }
}
