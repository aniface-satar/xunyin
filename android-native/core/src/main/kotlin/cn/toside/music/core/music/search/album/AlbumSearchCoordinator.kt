package cn.toside.music.core.music.search.album

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope

/**
 * 专辑搜索编排（照抄 [cn.toside.music.core.music.search.SonglistSearchCoordinator] 的
 * 响应代次 / 缓存 / 分页 / 全源聚合规则）。
 *
 * 与歌单编排的唯一差异：kw/tx 的专辑搜索响应**没有 total**（RN 无专辑搜索可对照），
 * `maxPage` 无法按 `total/limit` 计算，改用解析器给的启发式（整页 → page+1，
 * 见 [AlbumSearchPage.allPage]）钉住；total>0 的源仍按 `ceil(total/limit)`。
 */
class AlbumSearchCoordinator(
    private val sources: Map<String, suspend (keyword: String, page: Int, limit: Int) -> AlbumSearchPage>,
) {
    data class ListInfo(
        val list: List<AlbumItem>,
        val total: Int = 0,
        val maxPage: Int = 0,
        val page: Int = 0,
        val limit: Int = AlbumSearchAggregator.SOURCE_LIMIT,
        val key: String? = null,
    )

    private val listInfos = mutableMapOf<String, ListInfo>()
    private val maxPages = mutableMapOf<String, Int>()
    private var generation = 0

    fun listInfo(source: String): ListInfo? = listInfos[source]

    fun maxPage(source: String): Int = maxPages[source] ?: 0

    suspend fun search(
        keyword: String,
        page: Int,
        source: String,
    ): AlbumSearchPage? {
        if (keyword.isEmpty()) return AlbumSearchAggregator.emptyPage(source)
        if (source != ALL) checkNotNull(sources[source]) { "source not found: $source" }
        val info = listInfos[source]
        val key = "${page}__${source}__$keyword"
        if (info != null && info.key == key && info.list.isNotEmpty()) return info.toPage(source)

        val gen = ++generation
        val limit = if (source == ALL) AlbumSearchAggregator.ALL_LIMIT else AlbumSearchAggregator.SOURCE_LIMIT
        // RN 在发请求前就占住 key
        listInfos[source] = ListInfo(emptyList(), limit = limit, key = key)
        val previous =
            info
                ?.takeIf { page > 1 && it.list.isNotEmpty() && it.key?.endsWith("__$keyword") == true }
                ?.toPage(source)
        val fresh =
            if (source == ALL) {
                val results =
                    coroutineScope {
                        sources
                            .filter { (id, _) -> !(page > 1 && page > (maxPages[id] ?: 0)) }
                            .map { (id, search) ->
                                async {
                                    runCatching { search(keyword, page, limit) }
                                        .getOrElse { AlbumSearchAggregator.emptyPage(id, limit) }
                                }
                            }.awaitAll()
                    }
                results.forEach { result -> maxPages[result.source] = maxPageOf(result) }
                AlbumSearchAggregator.all(keyword, results, page, previous)
            } else {
                val searched = checkNotNull(sources[source])(keyword, page, limit)
                AlbumSearchAggregator.single(searched, page, previous)
            }
        if (gen != generation) return null
        listInfos[source] =
            ListInfo(
                list = fresh.list,
                total = fresh.total,
                maxPage = fresh.allPage,
                page = page,
                limit = fresh.limit,
                key = key,
            )
        return fresh
    }

    fun reachedEnd(
        source: String,
        page: Int,
    ): Boolean = (listInfos[source]?.maxPage ?: 0) <= page

    fun clear(source: String) {
        listInfos[source] = ListInfo(emptyList(), limit = defaultLimit(source))
    }

    fun reset() {
        listInfos.clear()
        maxPages.clear()
        generation = 0
    }

    /** total 已知按 ceil(total/limit)；total 未知（kw/tx）用解析器启发式的 allPage。 */
    private fun maxPageOf(result: AlbumSearchPage): Int =
        if (result.total > 0 && result.limit > 0) {
            (result.total + result.limit - 1) / result.limit
        } else {
            result.allPage
        }

    private fun defaultLimit(source: String): Int =
        if (source == ALL) AlbumSearchAggregator.ALL_LIMIT else AlbumSearchAggregator.SOURCE_LIMIT

    private fun ListInfo.toPage(source: String): AlbumSearchPage = AlbumSearchPage(list, total, maxPage, limit, source)

    private companion object {
        const val ALL = "all"
    }
}
