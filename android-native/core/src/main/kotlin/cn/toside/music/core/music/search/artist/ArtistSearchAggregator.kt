package cn.toside.music.core.music.search.artist

import cn.toside.music.core.music.search.SonglistSearchAggregator
import cn.toside.music.core.music.search.album.AlbumSearchAggregator

/**
 * 歌手搜索累计规则（照 [cn.toside.music.core.music.search.album.AlbumSearchAggregator]
 * 的形状；RN 无歌手搜索可对照，聚合语义与歌单/专辑保持一致）：
 * - 拼接不去重；
 * - 单源无 total（kw/kg 歌手搜索响应没有总数）时沿用解析器的「整页 → 下一页」启发式；
 * - 「全部」按歌手名 `similar()` 排序。
 */
object ArtistSearchAggregator {
    /** 单源每页 18（任务书：RN 歌手搜索 limit 18；RN 无此实现，取值见 lane 报告）。 */
    const val SOURCE_LIMIT = 18

    /** 聚合时传给各源的条数。 */
    const val ALL_LIMIT = 15

    fun emptyPage(
        source: String,
        limit: Int = ALL_LIMIT,
    ): ArtistSearchPage = ArtistSearchPage(emptyList(), total = 0, allPage = 1, limit = limit, source = source)

    fun single(
        current: ArtistSearchPage,
        page: Int,
        previous: ArtistSearchPage? = null,
    ): ArtistSearchPage {
        val combined = if (page == 1) current.list else previous?.list.orEmpty() + current.list
        val total =
            if (page == 1 || (current.total != 0 && current.list.isNotEmpty())) {
                current.total
            } else {
                current.limit * page
            }
        val allPage = if (current.total == 0) current.allPage else AlbumSearchAggregator.pages(total, current.limit)
        return current.copy(list = combined, total = total, allPage = allPage)
    }

    fun all(
        keyword: String,
        results: List<ArtistSearchPage>,
        page: Int,
        previous: ArtistSearchPage? = null,
    ): ArtistSearchPage {
        val current = mutableListOf<ArtistItem>()
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
        return ArtistSearchPage(
            list = combined,
            total = total,
            allPage = maxPage,
            limit = previous?.limit ?: ALL_LIMIT,
            source = "all",
        )
    }

    /** 按歌手名相似度升序插入后整体反转（高分在前），与歌单/专辑聚合一致。 */
    private fun sortBySimilarity(
        list: List<ArtistItem>,
        keyword: String,
    ): List<ArtistItem> {
        val sorted = mutableListOf<Pair<Double, ArtistItem>>()
        list.forEach { item ->
            val score = SonglistSearchAggregator.similar(keyword, item.name)
            var index = sorted.indexOfFirst { it.first > score }
            if (index < 0) index = sorted.size
            sorted.add(index, score to item)
        }
        return sorted.asReversed().map { it.second }
    }
}
