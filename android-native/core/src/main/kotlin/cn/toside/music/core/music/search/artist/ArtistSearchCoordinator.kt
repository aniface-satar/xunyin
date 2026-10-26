package cn.toside.music.core.music.search.artist

import cn.toside.music.core.music.search.album.AlbumSearchCoordinator
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope

/**
 * 歌手搜索编排（照抄 [AlbumSearchCoordinator] / SonglistSearchCoordinator 的范式）。
 *
 * 与专辑编排相同的差异：kw/kg 歌手搜索响应没有 total，`maxPage` 用解析器的
 * 「整页 → page+1」启发式；total>0 的源（wy/mg）按 `ceil(total/limit)`。
 */
class ArtistSearchCoordinator(
    private val sources: Map<String, suspend (keyword: String, page: Int, limit: Int) -> ArtistSearchPage>,
) {
    data class ListInfo(
        val list: List<ArtistItem>,
        val total: Int = 0,
        val maxPage: Int = 0,
        val page: Int = 0,
        val limit: Int = ArtistSearchAggregator.SOURCE_LIMIT,
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
    ): ArtistSearchPage? {
        if (keyword.isEmpty()) return ArtistSearchAggregator.emptyPage(source)
        if (source != ALL) checkNotNull(sources[source]) { "source not found: $source" }
        val info = listInfos[source]
        val key = "${page}__${source}__$keyword"
        if (info != null && info.key == key && info.list.isNotEmpty()) return info.toPage(source)

        val gen = ++generation
        val limit = if (source == ALL) ArtistSearchAggregator.ALL_LIMIT else ArtistSearchAggregator.SOURCE_LIMIT
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
                                        .getOrElse { ArtistSearchAggregator.emptyPage(id, limit) }
                                }
                            }.awaitAll()
                    }
                results.forEach { result -> maxPages[result.source] = maxPageOf(result) }
                ArtistSearchAggregator.all(keyword, results, page, previous)
            } else {
                val searched = checkNotNull(sources[source])(keyword, page, limit)
                ArtistSearchAggregator.single(searched, page, previous)
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

    private fun maxPageOf(result: ArtistSearchPage): Int =
        if (result.total > 0 && result.limit > 0) {
            (result.total + result.limit - 1) / result.limit
        } else {
            result.allPage
        }

    private fun defaultLimit(source: String): Int =
        if (source == ALL) ArtistSearchAggregator.ALL_LIMIT else ArtistSearchAggregator.SOURCE_LIMIT

    private fun ListInfo.toPage(source: String): ArtistSearchPage = ArtistSearchPage(list, total, maxPage, limit, source)

    private companion object {
        const val ALL = "all"
    }
}
