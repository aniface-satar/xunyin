package cn.toside.music.core.music.search

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope

/**
 * 歌单搜索编排（对照 RN `src/core/search/songlist.ts` + `store/search/songlist/action.ts`）。
 *
 * - 每源一槽缓存，key = `page__source__keyword`；命中同 key 且列表非空直接复用；
 * - 单源 limit 18，聚合 limit 15（聚合时把这个 15 传给每个源）；
 * - 聚合模式下并发请求；page > 1 时跳过上一页算出 `maxPage < page` 的源；
 * - 失败源转空页（RN `catch` 返回 `{list: [], total: 0}`），单源失败仍向调用方抛出；
 * - 旧关键词的迟到响应返回 null（与单曲 [SearchCoordinator] 相同的代次守卫）。
 *
 * RN 原版单源路径从不写 `maxPages`（只有聚合写），因此单源永远显示不了「到底」；
 * 这里按 `total/limit` 计算每源 allPage，行为更一致（见 lane 报告语义修正）。
 */
class SonglistSearchCoordinator(
    private val sources: Map<String, suspend (keyword: String, page: Int, limit: Int) -> SonglistSearchPage>,
) {
    data class ListInfo(
        val list: List<SonglistSearchItem>,
        val total: Int = 0,
        val maxPage: Int = 0,
        val page: Int = 0,
        val limit: Int = SonglistSearchAggregator.SOURCE_LIMIT,
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
    ): SonglistSearchPage? {
        if (keyword.isEmpty()) return SonglistSearchAggregator.emptyPage(source)
        if (source != ALL) checkNotNull(sources[source]) { "source not found: $source" }
        val info = listInfos[source]
        val key = "${page}__${source}__$keyword"
        if (info != null && info.key == key && info.list.isNotEmpty()) return info.toPage(source)

        val gen = ++generation
        val limit = if (source == ALL) SonglistSearchAggregator.ALL_LIMIT else SonglistSearchAggregator.SOURCE_LIMIT
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
                                        .getOrElse { SonglistSearchAggregator.emptyPage(id, limit) }
                                }
                            }.awaitAll()
                    }
                results.forEach { result ->
                    maxPages[result.source] = if (result.limit <= 0) 0 else (result.total + result.limit - 1) / result.limit
                }
                SonglistSearchAggregator.all(keyword, results, page, previous)
            } else {
                val searched = checkNotNull(sources[source])(keyword, page, limit)
                SonglistSearchAggregator.single(searched, page, previous)
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

    private fun defaultLimit(source: String): Int =
        if (source == ALL) SonglistSearchAggregator.ALL_LIMIT else SonglistSearchAggregator.SOURCE_LIMIT

    private fun ListInfo.toPage(source: String): SonglistSearchPage = SonglistSearchPage(list, total, maxPage, limit, source)

    private companion object {
        const val ALL = "all"
    }
}
