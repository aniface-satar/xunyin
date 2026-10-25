package cn.toside.music.core.music.search

import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 歌单搜索编排 —— 对照 RN `core/search/songlist.ts`：
 * 缓存 key `page__source__text`、单源 18/聚合 15、聚合并发、
 * page>1 跳过 `maxPage < page` 的源、旧关键词迟到响应丢弃。
 */
class SonglistSearchCoordinatorTest {
    @Test
    fun `single source caches by key and requests 18 per page`() =
        runBlocking {
            var calls = 0
            var lastLimit = 0
            val coordinator =
                SonglistSearchCoordinator(
                    sources =
                        mapOf(
                            "kw" to { _, _, limit ->
                                calls++
                                lastLimit = limit
                                page("kw", listOf(item("k1")), total = 100, limit = limit)
                            },
                        ),
                )
            val first = coordinator.search("周杰伦", 1, "kw")!!
            val second = coordinator.search("周杰伦", 1, "kw")!!
            assertEquals(1, calls)
            assertEquals(18, lastLimit)
            assertEquals(first.list, second.list)
            assertEquals("1__kw__周杰伦", coordinator.listInfo("kw")!!.key)
            assertTrue(coordinator.reachedEnd("kw", 1).not())
        }

    @Test
    fun `all runs sources with 15 and sorts by playlist name`() =
        runBlocking {
            val limits = mutableMapOf<String, Int>()
            val coordinator =
                SonglistSearchCoordinator(
                    sources =
                        mapOf(
                            "kw" to { _, _, limit ->
                                limits["kw"] = limit
                                page("kw", listOf(item("远方的歌单", "kw")), total = 30, limit = limit)
                            },
                            "kg" to { _, _, limit ->
                                limits["kg"] = limit
                                page("kg", listOf(item("周杰伦", "kg")), total = 20, limit = limit)
                            },
                        ),
                )
            val result = coordinator.search("周杰伦", 1, "all")!!
            assertEquals(mapOf("kw" to 15, "kg" to 15), limits)
            assertEquals("kg", result.list.first().source)
            assertEquals(30, result.total)
            assertEquals(listOf("kg", "kw"), result.list.map { it.source })
        }

    @Test
    fun `failed source becomes empty page in all mode`() =
        runBlocking {
            val coordinator =
                SonglistSearchCoordinator(
                    sources =
                        mapOf(
                            "kw" to { _, _, _ -> error("network down") },
                            "kg" to { _, _, limit -> page("kg", listOf(item("g1")), total = 10, limit = limit) },
                        ),
                )
            val result = coordinator.search("周杰伦", 1, "all")!!
            assertEquals(listOf("g1"), result.list.map { it.id })
            assertEquals(10, result.total)
        }

    @Test
    fun `all page two skips sources that already ended`() =
        runBlocking {
            val calls = mutableMapOf<String, Int>()
            val coordinator =
                SonglistSearchCoordinator(
                    sources =
                        mapOf(
                            "kw" to { _, _, limit ->
                                calls["kw"] = (calls["kw"] ?: 0) + 1
                                page("kw", listOf(item("k$limit")), total = 15, limit = limit)
                            },
                            "kg" to { _, _, limit ->
                                calls["kg"] = (calls["kg"] ?: 0) + 1
                                page("kg", listOf(item("g$limit")), total = 150, limit = limit)
                            },
                        ),
                )
            coordinator.search("周杰伦", 1, "all")!!
            // kw: total 15 / limit 15 → maxPage 1；kg: 150 / 15 → 10
            assertEquals(1, coordinator.maxPage("kw"))
            assertEquals(10, coordinator.maxPage("kg"))
            coordinator.search("周杰伦", 2, "all")!!
            assertEquals(1, calls["kw"])
            assertEquals(2, calls["kg"])
        }

    @Test
    fun `late response from an old keyword is dropped`() =
        runBlocking {
            val coordinator =
                SonglistSearchCoordinator(
                    sources =
                        mapOf(
                            "kw" to { keyword, _, limit ->
                                if (keyword == "旧") delay(60)
                                page("kw", listOf(item(keyword)), total = 1, limit = limit)
                            },
                        ),
                )
            val stale = async { coordinator.search("旧", 1, "kw") }
            delay(10)
            val fresh = coordinator.search("新", 1, "kw")!!
            assertNull(stale.await())
            assertEquals("新", fresh.list.first().id)
        }

    private fun item(
        id: String,
        source: String = "kw",
    ) = SonglistSearchItem(id = id, name = id, source = source)

    private fun page(
        source: String,
        list: List<SonglistSearchItem>,
        total: Int,
        limit: Int,
    ) = SonglistSearchPage(
        list = list,
        total = total,
        allPage = if (total == 0) 0 else (total + limit - 1) / limit,
        limit = limit,
        source = source,
    )
}
