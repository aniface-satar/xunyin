package cn.toside.music.core.music.search.album

import cn.toside.music.core.music.search.SonglistSearchAggregator

/**
 * 专辑搜索累计规则。
 *
 * RN **没有**专辑搜索（`SearchType` 只有 music/songlist），这里照 `SonglistSearchAggregator`
 * 的形状实现，让专辑/歌单两个类型有相同的分页手感：
 * - 拼接不去重；
 * - 单源按 `total/limit` 算 `allPage`；源本身没有 `total`（kw 专辑搜索）时沿用解析器给的
 *   「本页装满就还有下一页」判断；
 * - 「全部」按专辑名 `similar()` 排序（复用歌单的 Levenshtein 打分）。
 */
object AlbumSearchAggregator {
    /** 单源每页 20（RN 无专辑搜索，取值理由见 lane 报告「语义修正」）。 */
    const val SOURCE_LIMIT = 20

    /** 聚合时传给各源的条数。 */
    const val ALL_LIMIT = 15

    fun emptyPage(
        source: String,
        limit: Int = ALL_LIMIT,
    ): AlbumSearchPage = AlbumSearchPage(emptyList(), total = 0, allPage = 1, limit = limit, source = source)

    fun single(
        current: AlbumSearchPage,
        page: Int,
        previous: AlbumSearchPage? = null,
    ): AlbumSearchPage {
        val combined = if (page == 1) current.list else previous?.list.orEmpty() + current.list
        val total =
            if (page == 1 || (current.total != 0 && current.list.isNotEmpty())) {
                current.total
            } else {
                current.limit * page
            }
        val allPage = if (current.total == 0) current.allPage else pages(total, current.limit)
        return current.copy(list = combined, total = total, allPage = allPage)
    }

    fun all(
        keyword: String,
        results: List<AlbumSearchPage>,
        page: Int,
        previous: AlbumSearchPage? = null,
    ): AlbumSearchPage {
        val current = mutableListOf<AlbumItem>()
        var maxLimit = 0
        var maxPage = 0
        var maxTotal = 0
        results.forEach { result ->
            current.addAll(result.list)
            maxLimit = maxOf(maxLimit, result.limit)
            maxPage = maxOf(maxPage, result.allPage)
            maxTotal = maxOf(maxTotal, result.total)
        }
        val sorted = sortBySimilarity(current, keyword)
        val combined = if (page == 1) sorted else previous?.list.orEmpty() + sorted
        val total = if (page == 1 || (maxTotal != 0 && sorted.isNotEmpty())) maxTotal else maxLimit * page
        return AlbumSearchPage(
            list = combined,
            total = total,
            allPage = maxPage,
            limit = previous?.limit ?: ALL_LIMIT,
            source = "all",
        )
    }

    /** `total/limit` 上取整；`total == 0` 视为 0 页（RN `Math.ceil` 同义）。 */
    fun pages(
        total: Int,
        limit: Int,
    ): Int = if (total == 0 || limit <= 0) 0 else (total + limit - 1) / limit

    /** 按专辑名相似度升序插入后整体反转（高分在前），与歌单聚合一致。 */
    private fun sortBySimilarity(
        list: List<AlbumItem>,
        keyword: String,
    ): List<AlbumItem> {
        val sorted = mutableListOf<Pair<Double, AlbumItem>>()
        list.forEach { item ->
            val score = SonglistSearchAggregator.similar(keyword, item.name)
            var index = sorted.indexOfFirst { it.first > score }
            if (index < 0) index = sorted.size
            sorted.add(index, score to item)
        }
        return sorted.asReversed().map { it.second }
    }
}
