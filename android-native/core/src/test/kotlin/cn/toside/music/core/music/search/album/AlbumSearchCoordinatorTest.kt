package cn.toside.music.core.music.search.album

import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 专辑编排：响应代次 / 缓存 / 全源过滤（照 SonglistSearchCoordinatorTest 的形状）。 */
class AlbumSearchCoordinatorTest {
    private fun item(id: String) = AlbumItem(id = id, name = id, source = "kw")

    @Test
    fun `single source caches by keyword page source key`() =
        runBlocking {
            var calls = 0
            val coordinator =
                AlbumSearchCoordinator(
                    mapOf(
                        "wy" to { _, _, _ ->
                            calls++
                            AlbumSearchPage(listOf(item("a")), total = 25, allPage = 2, limit = 20, source = "wy")
                        },
                    ),
                )
            val page1 = coordinator.search("jay", 1, "wy")!!
            assertEquals(1, calls)
            assertEquals(25, page1.total)
            // 同 key 命中缓存
            coordinator.search("jay", 1, "wy")
            assertEquals(1, calls)
            // 换关键词重新发请求
            coordinator.search("other", 1, "wy")
            assertEquals(2, calls)
        }

    @Test
    fun `reachedEnd follows ceil of total over limit`() =
        runBlocking {
            val coordinator =
                AlbumSearchCoordinator(
                    mapOf(
                        "wy" to { _, _, _ ->
                            AlbumSearchPage(listOf(item("a")), total = 25, allPage = 2, limit = 20, source = "wy")
                        },
                    ),
                )
            coordinator.search("jay", 1, "wy")
            assertFalse(coordinator.reachedEnd("wy", 1))
            assertTrue(coordinator.reachedEnd("wy", 2))
        }

    @Test
    fun `all source skips exhausted sources on later pages`() =
        runBlocking {
            val requested = mutableListOf<String>()
            val coordinator =
                AlbumSearchCoordinator(
                    mapOf(
                        "wy" to { _, page, limit ->
                            requested.add("wy@$page")
                            AlbumSearchPage(listOf(item("wy$page")), total = 10, allPage = 1, limit = limit, source = "wy")
                        },
                        "kw" to { _, page, limit ->
                            requested.add("kw@$page")
                            AlbumSearchPage(listOf(item("kw$page")), total = 0, allPage = page + 1, limit = limit, source = "kw")
                        },
                    ),
                )
            val page1 = coordinator.search("jay", 1, "all")!!
            assertEquals("all", page1.source)
            assertEquals(2, page1.list.size)
            requested.clear()
            val page2 = coordinator.search("jay", 2, "all")!!
            // wy 的 maxPage=1 < 2 → 本页不再请求 wy
            assertEquals(listOf("kw@2"), requested)
            // 翻页累积语义（对照 SonglistSearchAggregator.all：page≥2 时 previous + 当前页）
            // 相似度等分经 asReversed 翻转，page1 实际顺序为 [kw1, wy1]
            assertEquals(listOf("kw1", "wy1", "kw2"), page2.list.map { it.id })
        }

    @Test
    fun `stale generation returns null`() =
        runBlocking {
            val coordinator =
                AlbumSearchCoordinator(
                    mapOf(
                        "wy" to { _, _, _ ->
                            delay(50)
                            AlbumSearchPage(listOf(item("a")), total = 0, allPage = 1, limit = 15, source = "wy")
                        },
                        "kw" to { _, _, _ ->
                            AlbumSearchPage(listOf(item("b")), total = 0, allPage = 1, limit = 15, source = "kw")
                        },
                    ),
                )
            // 照 SonglistSearchCoordinatorTest 的形状：stale 先占住 generation，fresh 换单源
            // 立即返回并推进 generation；stale 完成时 gen 已过期 → null。
            // 注意不能用 CompletableDeferred 门闩挡 ALL 源：第二次 search 走 ALL 分支会
            // awaitAll 同一个被门住的请求，runBlocking 单线程事件循环上互相等死。
            val stale = async { coordinator.search("jay", 1, "all") }
            delay(10)
            val fresh = coordinator.search("jay", 1, "kw")!!
            assertEquals("b", fresh.list.first().id)
            assertNull(stale.await())
        }

    @Test
    fun `empty keyword returns empty page without fetching`() =
        runBlocking {
            var calls = 0
            val coordinator =
                AlbumSearchCoordinator(
                    mapOf(
                        "wy" to { _, _, _ ->
                            calls++
                            AlbumSearchAggregator.emptyPage("wy")
                        },
                    ),
                )
            val page = coordinator.search("", 1, "wy")!!
            assertTrue(page.list.isEmpty())
            assertEquals(0, calls)
        }

    @Test
    fun `clear and reset restore defaults`() =
        runBlocking {
            val coordinator =
                AlbumSearchCoordinator(
                    mapOf("wy" to { _, _, _ -> AlbumSearchPage(listOf(item("a")), total = 5, allPage = 1, limit = 20, source = "wy") }),
                )
            coordinator.search("jay", 1, "wy")
            coordinator.clear("wy")
            assertEquals(0, coordinator.listInfo("wy")!!.list.size)
            coordinator.reset()
            assertNull(coordinator.listInfo("wy"))
        }
}
