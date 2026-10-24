package cn.toside.music.core.music.leaderboard

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * BoardPager 测试 —— 对照 RN `core/leaderboard.ts#getListLimit/getListDetail/getListDetailAll`：
 *
 * 1. 源页 100 条按 30 切成 3 个展示页 + 尾段暂存与下一源页拼接；
 * 2. 展示页缓存命中不重发请求；
 * 3. getListDetailAll 拼完整表；
 * 4. isRefresh 清缓存；
 * 5. 去重发生在切分之前。
 */
class BoardPagerTest {
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
    fun `splits source page of 100 into display pages of 30 and carries remainder`() =
        runBlocking {
            val requested = mutableListOf<Int>()
            val pager =
                BoardPager { _, sourcePage ->
                    requested.add(sourcePage)
                    BoardList(
                        list = List(100) { index -> music("s$sourcePage.$index") },
                        total = 100,
                        limit = 100,
                        page = sourcePage,
                        source = "kw",
                    )
                }

            val page1 = pager.getListDetail("kw__16", 1)
            assertEquals((0 until 30).map { "s1.$it" }, ids(page1.list))
            assertEquals(1, requested.size)

            val page2 = pager.getListDetail("kw__16", 2)
            assertEquals((30 until 60).map { "s1.$it" }, ids(page2.list))
            // 第 2 展示页来自第 1 源页的切分缓存，没发新请求
            assertEquals(1, requested.size)

            val page3 = pager.getListDetail("kw__16", 3)
            assertEquals((60 until 90).map { "s1.$it" }, ids(page3.list))
            assertEquals(1, requested.size)

            // 第 4 展示页：剩余 10 条不足 30，但源已到底（ceil(100/100)=1）→ 不再发请求，
            // 尾段直接作为第 4 页
            val page4 = pager.getListDetail("kw__16", 4)
            assertEquals(1, requested.size)
            assertEquals((90 until 100).map { "s1.$it" }, ids(page4.list))
        }

    @Test
    fun `cache hit does not refetch and refresh clears`() =
        runBlocking {
            var calls = 0
            val pager =
                BoardPager { _, _ ->
                    calls++
                    BoardList(listOf(music("a"), music("b"), music("c")), total = 3, limit = 100, page = 1, source = "kw")
                }

            val first = pager.getListDetail("kw__16", 1)
            assertEquals(listOf("a", "b", "c"), ids(first.list))
            pager.getListDetail("kw__16", 1)
            assertEquals(1, calls)

            pager.getListDetail("kw__16", 1, isRefresh = true)
            assertEquals(2, calls)
        }

    @Test
    fun `reached end reflects total over display limit`() =
        runBlocking {
            val pager =
                BoardPager { _, _ ->
                    BoardList(List(100) { music("x$it") }, total = 100, limit = 100, page = 1, source = "kw")
                }
            pager.getListDetail("kw__16", 1)
            assertTrue(!pager.reachedEnd("kw__16", 3))
            assertTrue(pager.reachedEnd("kw__16", 4))
        }

    @Test
    fun `getListDetailAll walks every display page across source pages`() =
        runBlocking {
            val pager =
                BoardPager { _, sourcePage ->
                    val count = if (sourcePage < 3) 100 else 50
                    BoardList(
                        list = List(count) { index -> music("p$sourcePage.$index") },
                        total = 250,
                        limit = 100,
                        page = sourcePage,
                        source = "kw",
                    )
                }
            val all = pager.getListDetailAll("kw__16")
            assertEquals(250, all.size)
            val expected =
                (0 until 100).map { "p1.$it" } +
                    (0 until 100).map { "p2.$it" } +
                    (0 until 50).map { "p3.$it" }
            assertEquals(expected, ids(all))
        }

    @Test
    fun `dedup happens before splitting`() =
        runBlocking {
            val pager =
                BoardPager { _, _ ->
                    BoardList(
                        list = List(40) { index -> music("dup${index % 20}") },
                        total = 20,
                        limit = 100,
                        page = 1,
                        source = "kw",
                    )
                }
            val page1 = pager.getListDetail("kw__16", 1)
            assertEquals(20, page1.list.size)
            assertEquals((0 until 20).map { "dup$it" }, ids(page1.list))
        }
}
