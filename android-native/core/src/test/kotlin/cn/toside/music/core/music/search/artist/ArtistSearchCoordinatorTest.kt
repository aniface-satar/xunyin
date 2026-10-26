package cn.toside.music.core.music.search.artist

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 歌手编排：缓存 key / 全源过滤 / reachedEnd（照 AlbumSearchCoordinatorTest 的形状）。 */
class ArtistSearchCoordinatorTest {
    private fun item(id: String) = ArtistItem(id = id, name = id, source = "wy")

    @Test
    fun `single source caches and tracks max page`() =
        runBlocking {
            var calls = 0
            val coordinator =
                ArtistSearchCoordinator(
                    mapOf(
                        "wy" to { _, _, _ ->
                            calls++
                            ArtistSearchPage(listOf(item("a")), total = 40, allPage = 3, limit = 18, source = "wy")
                        },
                    ),
                )
            coordinator.search("jay", 1, "wy")
            assertEquals(1, calls)
            coordinator.search("jay", 1, "wy")
            assertEquals(1, calls)
            assertEquals(3, coordinator.maxPage("wy"))
            assertFalse(coordinator.reachedEnd("wy", 1))
            assertTrue(coordinator.reachedEnd("wy", 3))
        }

    @Test
    fun `all source filters exhausted sources`() =
        runBlocking {
            val requested = mutableListOf<String>()
            val coordinator =
                ArtistSearchCoordinator(
                    mapOf(
                        "wy" to { _, page, limit ->
                            requested.add("wy@$page")
                            ArtistSearchPage(listOf(item("wy$page")), total = 10, allPage = 1, limit = limit, source = "wy")
                        },
                        "kw" to { _, page, limit ->
                            requested.add("kw@$page")
                            ArtistSearchPage(listOf(item("kw$page")), total = 0, allPage = page + 1, limit = limit, source = "kw")
                        },
                    ),
                )
            val page1 = coordinator.search("jay", 1, "all")!!
            assertEquals(2, page1.list.size)
            requested.clear()
            val page2 = coordinator.search("jay", 2, "all")!!
            assertEquals(listOf("kw@2"), requested)
            // 翻页累积语义（对照 SonglistSearchAggregator.all：page≥2 时 previous + 当前页）
            // 相似度等分经 asReversed 翻转，page1 实际顺序为 [kw1, wy1]
            assertEquals(listOf("kw1", "wy1", "kw2"), page2.list.map { it.id })
        }

    @Test
    fun `empty keyword returns empty page`() =
        runBlocking {
            var calls = 0
            val coordinator =
                ArtistSearchCoordinator(
                    mapOf(
                        "wy" to { _, _, _ ->
                            calls++
                            ArtistSearchAggregator.emptyPage("wy")
                        },
                    ),
                )
            val page = coordinator.search("", 1, "wy")!!
            assertTrue(page.list.isEmpty())
            assertEquals(0, calls)
        }

    @Test
    fun `source failure degrades to empty page in all mode`() =
        runBlocking {
            val coordinator =
                ArtistSearchCoordinator(
                    mapOf(
                        "wy" to { _, _, _ -> error("boom") },
                        "kw" to { _, _, limit ->
                            ArtistSearchPage(
                                listOf(ArtistItem(id = "kw", name = "kw", source = "kw")),
                                total = 0,
                                allPage = 1,
                                limit = limit,
                                source = "kw",
                            )
                        },
                    ),
                )
            val page = coordinator.search("jay", 1, "all")!!
            assertEquals(listOf("kw"), page.list.map { it.source })
        }
}
