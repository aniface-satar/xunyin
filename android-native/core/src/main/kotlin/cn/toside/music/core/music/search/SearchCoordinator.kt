package cn.toside.music.core.music.search

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.json.JsonObject

/**
 * 搜索编排（对照 RN `src/core/search/music.ts` + `store/search/music/action.ts`）：
 *
 * 把“缓存槽 + 关键词代次 + 单源/聚合累计”这些可测规则放在 `:core`，
 * 传输（HTTP）与五源解析器实例由调用方注入，app 层只做组装。
 *
 * - `listInfos[source]`：每源一槽，存跨页累计的整份列表与 total/maxPage/page/key
 *   （RN `store/search/music/state.ts` 的 ListInfo）；
 * - 同 `key`（`page__text`）且列表非空 → 直接复用缓存，不发请求；
 * - 「全部」聚合：五源**并发**（对照 RN `Promise.all(task)`），
 *   失败源转 `emptyPage` 后交给 [SearchAggregator.all]；
 * - 代次（generation）：`search` 返回前校验，旧关键词的迟到响应返回 null；
 * - limit 固定 30（RN 各源与 all 的初始 limit）。
 */
class SearchCoordinator(
    private val sources: Map<String, suspend (keyword: String, page: Int, limit: Int) -> SearchPage>,
) {
    /** RN `listInfos[source]` 的 Kotlin 形态。 */
    data class ListInfo(
        val list: List<JsonObject>,
        val total: Int = 0,
        val maxPage: Int = 0,
        val page: Int = 0,
        val key: String? = null,
    )

    private val listInfos = mutableMapOf<String, ListInfo>()
    private var generation = 0

    /** 当前源缓存快照（测试/调试用）。 */
    fun listInfo(source: String): ListInfo? = listInfos[source]

    /**
     * 搜索（对照 RN `search(text, page, sourceId)`）。
     *
     * @param source "all" 走五源聚合；否则必须存在于 [sources]
     * @return 累计后的整份列表；旧关键词的迟到响应返回 null
     */
    suspend fun search(
        keyword: String,
        page: Int,
        source: String,
    ): SearchPage? {
        if (keyword.isEmpty()) return SearchAggregator.emptyPage(source)
        val gen = ++generation
        val key = "${page}__$keyword"
        val info = listInfos[source]
        // RN：同 key 且已有列表 → 直接复用缓存，不发请求
        if (info != null && info.key == key && info.list.isNotEmpty()) {
            return info.toPage(source)
        }
        // RN 在发请求前就抢占 key：并发重复提交同 key 时由首个完成者写缓存
        listInfos[source] = ListInfo(emptyList(), key = key)
        // 翻页且缓存仍属同一关键词（`<page>__<keyword>` 后缀匹配）→ 作为累计基线
        val previous =
            info
                ?.takeIf { page > 1 && it.list.isNotEmpty() && it.key?.endsWith("__$keyword") == true }
                ?.toPage(source)
        val fresh: SearchPage =
            if (source == "all") {
                val results =
                    coroutineScope {
                        sources
                            .map { (id, search) ->
                                async {
                                    runCatching { search(keyword, page, LIMIT) }
                                        .getOrElse { SearchAggregator.emptyPage(id) }
                                }
                            }.awaitAll()
                    }
                SearchAggregator.all(keyword, results, page, previous)
            } else {
                val searched =
                    checkNotNull(sources[source]) { "source not found: $source" }(keyword, page, LIMIT)
                SearchAggregator.single(searched, page, previous)
            }
        if (gen != generation) {
            // 迟到响应不落缓存（listInfos[source] 保留抢占的 key，
            // 让相同 keyword+page 的后续请求重新发起，而不是吃到半旧结果）
            return null
        }
        listInfos[source] =
            ListInfo(
                list = fresh.list,
                total = fresh.total,
                maxPage = fresh.allPage,
                page = page,
                key = key,
            )
        return fresh
    }

    /** 当前源是否已到底（RN `listInfos[source].maxPage <= page`）。 */
    fun reachedEnd(
        source: String,
        page: Int,
    ): Boolean = (listInfos[source]?.maxPage ?: 0) <= page

    /** 清空某源缓存（RN `clearListInfo`：list 清空、page/maxPage/total 归零）。 */
    fun clear(source: String) {
        listInfos[source] = ListInfo(emptyList())
    }

    /** 测试注入：清空全部状态。 */
    fun reset() {
        listInfos.clear()
        generation = 0
    }

    private fun ListInfo.toPage(source: String): SearchPage = SearchPage(list, total, maxPage, LIMIT, source)

    companion object {
        /** RN `store/search/music/state.ts`：各源与 all 的初始 limit 均为 30。 */
        const val LIMIT = 30
    }
}
