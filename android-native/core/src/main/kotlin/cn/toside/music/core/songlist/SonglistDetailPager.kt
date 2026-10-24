package cn.toside.music.core.songlist

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * 歌单详情本地分页 —— 对照 RN `core/songlist.ts#getListDetailLimit/getListDetail`。
 *
 * RN 把各源自己的“源分页”（kw 1000/页、tx 整单、wy 1000/页、mg 30/页、kg 整单）
 * 切成 30 条的展示页；不足 30 且源还有下一页时把余量存为 tempList，与下一源页拼满。
 * `sourcePage` 记账与 [cn.toside.music.core.music.leaderboard.BoardPager] 完全同构。
 *
 * 请求由调用方注入（`load(id, sourcePage)`），本类纯规则可 JVM 测。
 */
class SonglistDetailPager(
    private val load: suspend (id: String, sourcePage: Int) -> SonglistDetail,
) {
    /** 展示分页大小（RN LIST_LOAD_LIMIT）。 */
    val loadLimit: Int = Songlists.LIST_LOAD_LIMIT

    /** 跳页补齐时最多连拉多少个源页，防止源端异常空转。 */
    private val maxFillFetches: Int = 200

    private data class PageCache(
        val data: SonglistDetail,
        val sourcePage: Int,
    )

    /** id → (pageKey/tempKey → PageCache 或 List)。 */
    private val cache = HashMap<String, MutableMap<String, Any>>()

    private suspend fun getPageLimit(
        id: String,
        page: Int,
    ): SonglistDetail {
        val tempListKey = "${id}__temp"
        val listCache = cache.getOrPut(id) { mutableMapOf() }

        // RN 只在顺序翻页时成立；跳页（详情深链/首屏恢复）时把缺失的展示页从更早的页补起。
        var next = page
        while (next > 1 && listCache["${id}__${next - 1}"] !is PageCache) next--
        var sourcePage =
            if (next == 1) 0 else (listCache["${id}__${next - 1}"] as PageCache).sourcePage

        var lastResult: SonglistDetail? = null
        var guard = 0
        while (guard++ < maxFillFetches) {
            (listCache["${id}__$page"] as? PageCache)?.let { return it.data }
            val result = load(id, sourcePage + 1)
            lastResult = result
            val remaining = deduplicationList(result.list).toMutableList()
            var p = next
            var progressed = false

            val tempList = listCache.remove(tempListKey) as? List<*>
            if (tempList != null) {
                val head = tempList.filterIsInstance<JsonObject>()
                val take = remaining.subList(0, minOf(loadLimit - head.size, remaining.size)).toList()
                if (take.isNotEmpty()) repeat(take.size) { remaining.removeAt(0) }
                listCache["${id}__$p"] =
                    PageCache(
                        data =
                            result.copy(
                                list = head + take,
                                page = p,
                                limit = loadLimit,
                            ),
                        sourcePage = sourcePage + 1,
                    )
                p++
                progressed = true
            }

            if (!progressed && remaining.isEmpty()) break

            if (remaining.size < loadLimit && sourcePage + 1 < maxSourcePage(result)) {
                // 源还有下一页：余量留到下一源页拼满
                listCache[tempListKey] = remaining.toList()
                sourcePage++
                next = p
                continue
            }
            do {
                val take = remaining.subList(0, minOf(loadLimit, remaining.size)).toList()
                repeat(take.size) { remaining.removeAt(0) }
                listCache["${id}__$p"] =
                    PageCache(
                        data =
                            result.copy(
                                list = take,
                                page = p,
                                limit = loadLimit,
                            ),
                        sourcePage = sourcePage + 1,
                    )
                p++
                progressed = true
            } while (remaining.isNotEmpty())
            sourcePage++
            next = p
            // 空源页或没有切出任何展示页：再请求也是空转，结束
            if (!progressed) break
        }
        return (listCache["${id}__$page"] as? PageCache)?.data
            ?: lastResult?.copy(list = emptyList(), page = page, limit = loadLimit)
            ?: SonglistDetail(list = emptyList(), total = 0, limit = loadLimit, page = page, source = "")
    }

    /** RN getListDetail：命中展示页缓存直接返回；isRefresh 清整单缓存重拉。 */
    suspend fun getDetail(
        id: String,
        page: Int,
        isRefresh: Boolean = false,
    ): SonglistDetail {
        if (isRefresh) cache.remove(id)
        val listCache = cache.getOrPut(id) { mutableMapOf() }
        (listCache["${id}__$page"] as? PageCache)?.let { return it.data }
        return getPageLimit(id, page)
    }

    /** RN getListDetailAll：逐展示页拉全整单（播放后补全队列用）。 */
    suspend fun getDetailAll(id: String): List<JsonObject> {
        val first = getDetail(id, 1)
        val list = first.list.toMutableList()
        val maxPage = if (first.limit <= 0) 1 else (first.total + first.limit - 1) / first.limit
        var page = 2
        while (page <= maxPage) {
            val result = getDetail(id, page)
            if (result.list.isEmpty()) break
            list.addAll(result.list)
            page++
        }
        return deduplicationList(list)
    }

    /** 当前歌单展示分页是否到底（RN `maxPage <= page`）。需要先拉过第 1 页。 */
    fun reachedEnd(
        id: String,
        page: Int,
    ): Boolean {
        val first = (cache[id]?.get("${id}__1") as? PageCache)?.data ?: return true
        val maxPage = if (first.limit <= 0) 1 else (first.total + first.limit - 1) / first.limit
        return maxPage <= page
    }

    fun resetForTest() {
        cache.clear()
    }

    private fun maxSourcePage(result: SonglistDetail): Int = if (result.limit <= 0) 1 else (result.total + result.limit - 1) / result.limit

    /** RN deduplicationList：按 id 去重保序。 */
    private fun deduplicationList(list: List<JsonObject>): List<JsonObject> {
        val ids = mutableSetOf<String>()
        return list.filter { info ->
            val id = (info["id"] as? JsonPrimitive)?.content.orEmpty()
            ids.add(id)
        }
    }
}
