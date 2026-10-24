package cn.toside.music.core.songlist

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * SonglistDetailPager —— 与 RN `core/songlist.ts#getListDetailLimit` 同构：
 * 源页按 30 条切展示页、展示页缓存不重发、getDetailAll 拼整单、isRefresh 清缓存。
 */
class SonglistDetailPagerTest {
    private fun music(id: String): JsonObject =
        buildJsonObject {
            put("id", id)
            put("name", "歌$id")
            put("singer", "歌手")
            put("source", "kw")
            put("interval", "01:00")
        }

    private fun ids(list: List<JsonObject>): List<String> = list.map { (it["id"] as JsonPrimitive).content }

    @Test
    fun `splits a 100 item source page into 30 item display pages`() =
        runBlocking {
            val requested = mutableListOf<Int>()
            val pager =
                SonglistDetailPager { _, sourcePage ->
                    requested.add(sourcePage)
                    SonglistDetail(
                        list = List(100) { index -> music("s$sourcePage.$index") },
                        total = 100,
                        limit = 100,
                        page = sourcePage,
                        source = "kw",
                    )
                }

            val page1 = pager.getDetail("kw__1", 1)
            assertEquals((0 until 30).map { "s1.$it" }, ids(page1.list))
            assertEquals(1, requested.size)

            val page2 = pager.getDetail("kw__1", 2)
            assertEquals((30 until 60).map { "s1.$it" }, ids(page2.list))
            assertEquals(1, requested.size)

            val page4 = pager.getDetail("kw__1", 4)
            assertEquals((90 until 100).map { "s1.$it" }, ids(page4.list))
            assertEquals(1, requested.size)
            assertTrue(pager.reachedEnd("kw__1", 4))
            assertFalse(pager.reachedEnd("kw__1", 3))
        }

    @Test
    fun `fetches the next source page only when display pages run out`() =
        runBlocking {
            val requested = mutableListOf<Int>()
            val pager =
                SonglistDetailPager { _, sourcePage ->
                    requested.add(sourcePage)
                    SonglistDetail(
                        // 模拟 mg：源每页 30，总数 121
                        list =
                            List(minOf(30, 121 - (sourcePage - 1) * 30)) { index ->
                                music("m$sourcePage.$index")
                            },
                        total = 121,
                        limit = 30,
                        page = sourcePage,
                        source = "mg",
                    )
                }

            val page1 = pager.getDetail("mg__1", 1)
            assertEquals(30, page1.list.size)
            assertEquals(listOf(1), requested)

            val page4 = pager.getDetail("mg__1", 4)
            assertEquals(30, page4.list.size)
            assertEquals(listOf(1, 2, 3, 4), requested)

            val page5 = pager.getDetail("mg__1", 5)
            assertEquals(1, page5.list.size)
            assertEquals(listOf(1, 2, 3, 4, 5), requested)
        }

    @Test
    fun `cache hit does not refetch and refresh clears every page`() =
        runBlocking {
            var calls = 0
            val pager =
                SonglistDetailPager { _, sourcePage ->
                    calls++
                    SonglistDetail(
                        listOf(music("a"), music("b"), music("c")),
                        total = 3,
                        limit = 100,
                        page = sourcePage,
                        source = "kw",
                    )
                }
            pager.getDetail("kw__1", 1)
            pager.getDetail("kw__1", 1)
            assertEquals(1, calls)
            pager.getDetail("kw__1", 1, isRefresh = true)
            assertEquals(2, calls)
        }

    @Test
    fun `getDetailAll stitches every display page and dedupes`() =
        runBlocking {
            var calls = 0
            val pager =
                SonglistDetailPager { _, sourcePage ->
                    calls++
                    SonglistDetail(
                        List(50) { index -> music("x$index") },
                        total = 50,
                        limit = 100,
                        page = sourcePage,
                        source = "kw",
                    )
                }
            val all = pager.getDetailAll("kw__1")
            assertEquals(50, all.size)
            assertEquals(50, ids(all).distinct().size)
            assertEquals(1, calls)
        }
}
