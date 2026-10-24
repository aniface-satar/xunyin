package cn.toside.music.core.music.leaderboard

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * 榜单详情的本地分页缓存 —— 对照 RN `core/leaderboard.ts#getListLimit/getListDetail`。
 *
 * RN 把源的“源分页”（kw/kg 100 条/页）按 `LIST_LOAD_LIMIT = 30` 切成展示分页：
 * - 每次请求一个源分页，把结果 `splice` 成 30 条的展示页落缓存；
 * - 不足 30 且源还有下一页时，剩余全部存为 `tempList`，与下一源页拼满；
 * - `sourcePage` 记账：展示页缓存里存“填满它的那次源页号”，翻页时取
 *   上一展示页的 sourcePage + 1 作为下一源页（RN prevPageKey 语义）；
 * - `getListDetail(id, page, isRefresh)`：命中展示页缓存直接返回，否则请求；
 * - `getListDetailAll(id)`：逐页拉完整表（RN 递归 loadDetail 的迭代版）。
 *
 * 请求由调用方注入（`getList(bangid, sourcePage)`），本类纯规则可在 JVM 测。
 */
class BoardPager(
    private val getList: suspend (bangid: String, sourcePage: Int) -> BoardList,
) {
    /** 展示分页大小（RN LIST_LOAD_LIMIT）。 */
    val loadLimit: Int = 30

    private data class PageCache(
        val data: BoardList,
        val sourcePage: Int,
    )

    /** listKey → (pageKey|tempKey → PageCache 或 List)。 */
    private val cache = HashMap<String, MutableMap<String, Any>>()

    /** RN getListLimit：拉一个源分页，切分/暂存并返回目标展示页。 */
    private suspend fun getPageLimit(
        source: String,
        bangid: String,
        page: Int,
    ): BoardList {
        val listKey = "${source}__$bangid"
        val prevPageKey = "${source}__${bangid}__${page - 1}"
        val tempListKey = "${source}__${bangid}__temp"
        val listCache = cache.getOrPut(listKey) { mutableMapOf() }

        var sourcePage = (listCache[prevPageKey] as? PageCache)?.sourcePage ?: 0
        val result = getList(bangid, sourcePage + 1)
        // RN：切分前先 deduplicationList
        val remaining = deduplicationList(result.list).toMutableList()

        var p = page
        val tempList = listCache.remove(tempListKey) as? List<*>
        if (tempList != null) {
            val head = tempList.filterIsInstance<JsonObject>()
            val take = remaining.subList(0, minOf(loadLimit - head.size, remaining.size)).toList()
            if (take.isNotEmpty()) repeat(take.size) { remaining.removeAt(0) }
            listCache["${source}__${bangid}__$p"] =
                PageCache(
                    data =
                        result.copy(
                            list = head + take,
                            page = p,
                            limit = loadLimit,
                        ),
                    sourcePage = sourcePage,
                )
            p++
        }
        sourcePage++
        do {
            if (remaining.size < loadLimit && sourcePage < maxSourcePage(result)) {
                listCache[tempListKey] = remaining.toList()
                remaining.clear()
                break
            }
            val take = remaining.subList(0, minOf(loadLimit, remaining.size)).toList()
            repeat(take.size) { remaining.removeAt(0) }
            listCache["${source}__${bangid}__$p"] =
                PageCache(
                    data =
                        result.copy(
                            list = take,
                            page = p,
                            limit = loadLimit,
                        ),
                    sourcePage = sourcePage,
                )
            p++
        } while (remaining.isNotEmpty())
        return (listCache["${source}__${bangid}__$page"] as? PageCache)?.data
            ?: result.copy(list = emptyList(), page = page, limit = loadLimit)
    }

    /** RN getListDetail：展示页缓存命中直接返回；isRefresh 清整榜缓存重拉。 */
    suspend fun getListDetail(
        id: String,
        page: Int,
        isRefresh: Boolean = false,
    ): BoardList {
        val (source, bangid) = splitId(id)
        val listKey = "${source}__$bangid"
        if (isRefresh) cache.remove(listKey)
        val listCache = cache.getOrPut(listKey) { mutableMapOf() }
        (listCache["${source}__${bangid}__$page"] as? PageCache)?.let { return it.data }
        return getPageLimit(source, bangid, page)
    }

    /** RN getListDetailAll：拉全部展示页拼整表（「播放全部」用）。 */
    suspend fun getListDetailAll(id: String): List<JsonObject> {
        val first = getListDetail(id, 1)
        val list = first.list.toMutableList()
        val maxPage = (first.total + first.limit - 1) / first.limit
        var page = 2
        while (page <= maxPage) {
            val result = getListDetail(id, page)
            if (result.list.isEmpty()) break
            list.addAll(result.list)
            page++
        }
        return deduplicationList(list)
    }

    /** 当前榜单展示分页是否到底（RN `maxPage <= page`）。maxPage 需先拉过第 1 页。 */
    fun reachedEnd(
        id: String,
        page: Int,
    ): Boolean {
        val (source, bangid) = splitId(id)
        val first = (cache["${source}__$bangid"]?.get("${source}__${bangid}__1") as? PageCache)?.data ?: return true
        val maxPage = (first.total + first.limit - 1) / first.limit
        return maxPage <= page
    }

    /** 测试注入：清空全部缓存。 */
    fun resetForTest() {
        cache.clear()
    }

    private fun splitId(id: String): Pair<String, String> = id.split("__", limit = 2).let { it[0] to it.getOrElse(1) { "" } }

    private fun maxSourcePage(result: BoardList): Int = if (result.limit <= 0) 1 else (result.total + result.limit - 1) / result.limit

    /** RN deduplicationList：按 id 去重保序。 */
    private fun deduplicationList(list: List<JsonObject>): List<JsonObject> {
        val ids = mutableSetOf<String>()
        return list.filter { info ->
            val id = (info["id"] as? JsonPrimitive)?.content.orEmpty()
            ids.add(id)
        }
    }
}
