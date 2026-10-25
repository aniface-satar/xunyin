package cn.toside.music.core.music.search

/**
 * 在线歌单搜索结果项（RN `store/search/songlist` 的 `ListInfoItem`）。
 *
 * 字段与 RN 各源 `songlist.search()` 的返回一一对应；`img`/`time`/`grade` 允许缺失。
 * 与单曲搜索不同，歌单搜索**不去重**（RN 聚合直接拼接），且排序只看歌单名。
 */
data class SonglistSearchItem(
    val id: String,
    val name: String,
    val author: String = "",
    val playCount: String = "",
    val total: Int = 0,
    val img: String? = null,
    val desc: String = "",
    val time: String = "",
    val source: String,
    val grade: String? = null,
)

/** 单源/聚合的歌单搜索一页结果（RN `SearchResult` + 累计后的 ListInfo）。 */
data class SonglistSearchPage(
    val list: List<SonglistSearchItem>,
    val total: Int,
    val allPage: Int,
    val limit: Int,
    val source: String,
)

/**
 * 歌单搜索累计规则（对照 RN `store/search/songlist/action.ts`）。
 *
 * 与单曲聚合的差异（均为 RN 现状，不是遗漏）：
 * - 拼接时**不按 id 去重**（RN 的 `deduplicationList` 被注释掉）；
 * - 单源不做相似度重排；
 * - 「全部」按 `similar(keyword, name)` 仅用歌单名排序，`sortInsert` 后整体反转。
 */
object SonglistSearchAggregator {
    /** RN `store/search/songlist/state.ts`：单源每页 18。 */
    const val SOURCE_LIMIT = 18

    /** RN `store/search/songlist/state.ts`：聚合页 15（作为各源的请求条数）。 */
    const val ALL_LIMIT = 15

    fun emptyPage(
        source: String,
        limit: Int = ALL_LIMIT,
    ): SonglistSearchPage = SonglistSearchPage(emptyList(), total = 0, allPage = 1, limit = limit, source = source)

    fun single(
        current: SonglistSearchPage,
        page: Int,
        previous: SonglistSearchPage? = null,
    ): SonglistSearchPage {
        val combined = if (page == 1) current.list else previous?.list.orEmpty() + current.list
        val total =
            if (page == 1 || (current.total != 0 && current.list.isNotEmpty())) {
                current.total
            } else {
                current.limit * page
            }
        return current.copy(list = combined, total = total, allPage = allPage(total, current.limit))
    }

    fun all(
        keyword: String,
        results: List<SonglistSearchPage>,
        page: Int,
        previous: SonglistSearchPage? = null,
    ): SonglistSearchPage {
        val current = mutableListOf<SonglistSearchItem>()
        val totals = mutableListOf<Int>()
        var maxLimit = 0
        var maxPage = 0
        results.forEach { result ->
            current.addAll(result.list)
            totals.add(result.total)
            maxLimit = maxOf(maxLimit, result.limit)
            maxPage = maxOf(maxPage, result.allPage)
        }
        val sorted = sortBySimilarity(current, keyword)
        val combined = if (page == 1) sorted else previous?.list.orEmpty() + sorted
        val maxTotal = totals.maxOrNull() ?: 0
        val total =
            if (page == 1 || (maxTotal != 0 && sorted.isNotEmpty())) {
                maxTotal
            } else {
                maxLimit * page
            }
        return SonglistSearchPage(
            list = combined,
            total = total,
            allPage = maxPage,
            limit = previous?.limit ?: ALL_LIMIT,
            source = "all",
        )
    }

    private fun allPage(
        total: Int,
        limit: Int,
    ): Int = if (total == 0 || limit <= 0) 0 else (total + limit - 1) / limit

    /** RN `handleSortList`：按歌单名相似度升序插入后整体反转（高分在前）。 */
    private fun sortBySimilarity(
        list: List<SonglistSearchItem>,
        keyword: String,
    ): List<SonglistSearchItem> {
        val sorted = mutableListOf<Scored>()
        list.forEach { item ->
            sortInsert(sorted, Scored(similar(keyword, item.name), item))
        }
        return sorted.asReversed().map { it.data }
    }

    private fun sortInsert(
        list: MutableList<Scored>,
        data: Scored,
    ) {
        val key = data.score
        var left = 0
        var right = list.lastIndex
        while (left <= right) {
            val middle = (left + right) / 2
            when {
                key == list[middle].score -> {
                    left = middle
                    break
                }

                key < list[middle].score -> right = middle - 1
                else -> left = middle + 1
            }
        }
        while (left > 0 && list[left - 1].score == key) left--
        list.add(left, data)
    }

    /** 与 `utils/common.ts#similar` 相同的 Levenshtein 相似度。 */
    internal fun similar(
        a: String,
        b: String,
    ): Double {
        if (a.isEmpty() || b.isEmpty()) return 0.0
        val first = if (a.length > b.length) b else a
        val second = if (a.length > b.length) a else b
        val distances = IntArray(second.length + 1) { it }
        for (i in 1..first.length) {
            val char = first[i - 1]
            var diagonal = distances[0]
            distances[0]++
            for (j in 1..second.length) {
                val next =
                    minOf(
                        distances[j] + 1,
                        distances[j - 1] + 1,
                        diagonal + if (char == second[j - 1]) 0 else 1,
                    )
                diagonal = distances[j]
                distances[j] = next
            }
        }
        return 1 - distances[second.length].toDouble() / second.length
    }

    private data class Scored(
        val score: Double,
        val data: SonglistSearchItem,
    )
}
