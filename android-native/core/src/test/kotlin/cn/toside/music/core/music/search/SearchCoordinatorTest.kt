package cn.toside.music.core.music.search

import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * SearchCoordinator 规则测试 —— 对照 RN `src/core/search/music.ts` +
 * `store/search/music/action.ts`：
 *
 * 1. 单源缓存：同 `page__text` 复用不发请求；
 * 2. 单源翻页：同关键词跨页累计、id 去重、total 回退；
 * 3. 换关键词：旧累计不串页；
 * 4. 全部聚合：失败源转空页、allPage 过滤、相似度排序；
 * 5. 关键词代次：旧关键词的迟到响应被丢弃（返回 null 且不落缓存）。
 */
class SearchCoordinatorTest {
    @Test
    fun `single source caches by page and keyword`() =
        runBlocking {
            var calls = 0
            val coordinator =
                SearchCoordinator(
                    sources =
                        mapOf(
                            "kw" to { _, _, _ ->
                                calls++
                                page(10, 5, listOf(music("kw_a"), music("kw_b")))
                            },
                        ),
                )

            val first = coordinator.search("晴天", 1, "kw")!!
            assertEquals(2, first.list.size)
            val second = coordinator.search("晴天", 1, "kw")!!
            assertEquals(1, calls)
            assertSame(first.list, second.list)

            val info = coordinator.listInfo("kw")!!
            assertEquals("1__晴天", info.key)
            assertEquals(10, info.maxPage)
        }

    @Test
    fun `single source appends pages within the same keyword`() =
        runBlocking {
            val coordinator =
                SearchCoordinator(
                    sources =
                        mapOf(
                            "kw" to { _, page, _ ->
                                page(
                                    allPage = 3,
                                    total = if (page == 1) 90 else 0,
                                    list = listOf(music("kw_p${page}_1"), music("kw_p${page}_2")),
                                )
                            },
                        ),
                )

            val first = coordinator.search("晴天", 1, "kw")!!
            assertEquals(listOf("kw_p1_1", "kw_p1_2"), first.list.ids())
            assertEquals(90, first.total)

            val second = coordinator.search("晴天", 2, "kw")!!
            // RN setList 的 total 规则：page==1 或（total 非零且列表非空）用响应 total，
            // 否则回退 limit*page；这里第二页 total=0 → 回退 30*2=60
            assertEquals(60, second.total)
            assertEquals(listOf("kw_p1_1", "kw_p1_2", "kw_p2_1", "kw_p2_2"), second.list.ids())
        }

    @Test
    fun `switching keyword restarts accumulation`() =
        runBlocking {
            var keywordSeen = ""
            val coordinator =
                SearchCoordinator(
                    sources =
                        mapOf(
                            "kw" to { keyword, _, _ ->
                                keywordSeen = keyword
                                page(10, 5, listOf(music("kw_$keyword")))
                            },
                        ),
                )

            coordinator.search("晴天", 1, "kw")!!
            val second = coordinator.search("七里香", 1, "kw")!!
            assertEquals("七里香", keywordSeen)
            assertEquals(listOf("kw_七里香"), second.list.ids())
            // 旧关键词的第 2 页不串入新关键词
            val page2 = coordinator.search("七里香", 2, "kw")!!
            assertTrue(page2.list.none { it["id"].text() == "kw_晴天" })
        }

    @Test
    fun `all aggregates five sources and turns failures into empty pages`() =
        runBlocking {
            val coordinator =
                SearchCoordinator(
                    sources =
                        mapOf(
                            "kw" to { _, _, _ -> page(3, 30, listOf(music("kw_hit", name = "晴天"), music("kw_other", name = "别的"))) },
                            "kg" to { _, _, _ -> page(8, 80, listOf(music("kg_hit", name = "晴天"))) },
                            "tx" to { _, _, _ -> throw IllegalStateException("network down") },
                            "wy" to { _, _, _ -> page(2, 20, listOf(music("wy_hit", name = "晴天"))) },
                            "mg" to { _, _, _ -> page(1, 10, listOf(music("mg_hit", name = "晴天"))) },
                        ),
                )

            val merged = coordinator.search("晴天", 1, "all")!!

            // 失败源转空页后不贡献结果，但 maxPage 取各成功源最大值
            assertEquals(listOf("kw_hit", "kg_hit", "wy_hit", "mg_hit", "kw_other").sorted(), merged.list.ids().sorted())
            assertEquals(8, merged.allPage)
            assertEquals(80, merged.total)
            assertEquals("all", merged.source)
        }

    @Test
    fun `all filters sources whose allPage is below the requested page`() =
        runBlocking {
            val coordinator =
                SearchCoordinator(
                    sources =
                        mapOf(
                            // kw 没到第 3 页（allPage=2）→ RN setLists 过滤掉，不贡献列表也不算 maxPage
                            "kw" to { _, _, _ -> page(2, 60, listOf(music("kw_stale"))) },
                            "kg" to { _, _, _ -> page(5, 50, listOf(music("kg_p3"))) },
                        ),
                )

            val merged = coordinator.search("晴天", 3, "all")!!
            assertEquals(listOf("kg_p3"), merged.list.ids())
            assertEquals(5, merged.allPage)
            assertEquals(50, merged.total)
        }

    @Test
    fun `stale generation response is discarded`() =
        runBlocking {
            val coordinator =
                SearchCoordinator(
                    sources =
                        mapOf(
                            "kw" to { _, _, _ ->
                                delay(50)
                                page(10, 5, listOf(music("kw_slow")))
                            },
                            "kg" to { _, _, _ -> page(10, 5, listOf(music("kg_fast"))) },
                        ),
                )

            val slow = async { coordinator.search("晴天", 1, "kw") }
            delay(10)
            val fast = coordinator.search("七里香", 1, "kg")!!

            // 慢响应是旧关键词（晴天）发起的：代次已被新搜索超越 → 丢弃
            assertNull(slow.await())
            assertEquals(listOf("kg_fast"), fast.list.ids())
            // 迟到响应不落缓存：重发同 keyword+page 会重新请求
            val retry = coordinator.search("晴天", 1, "kw")!!
            assertEquals(listOf("kw_slow"), retry.list.ids())
        }

    @Test
    fun `reached end follows maxPage and clear resets the slot`() =
        runBlocking {
            val coordinator =
                SearchCoordinator(
                    sources =
                        mapOf(
                            "kw" to { _, _, _ -> page(2, 60, listOf(music("kw_a"))) },
                        ),
                )

            coordinator.search("晴天", 1, "kw")!!
            assertTrue(!coordinator.reachedEnd("kw", 1))
            assertTrue(coordinator.reachedEnd("kw", 2))

            coordinator.clear("kw")
            val info = coordinator.listInfo("kw")!!
            assertTrue(info.list.isEmpty())
            assertEquals(0, info.maxPage)
            assertTrue(coordinator.reachedEnd("kw", 1))
        }

    @Test
    fun `empty keyword returns empty page without touching sources`() =
        runBlocking {
            var calls = 0
            val coordinator =
                SearchCoordinator(
                    sources =
                        mapOf(
                            "kw" to { _, _, _ ->
                                calls++
                                page(10, 5, listOf(music("kw_a")))
                            },
                        ),
                )

            val result = coordinator.search("", 1, "kw")!!
            assertTrue(result.list.isEmpty())
            assertEquals(0, calls)
        }

    private fun page(
        allPage: Int,
        total: Int,
        list: List<JsonObject>,
    ): SearchPage = SearchPage(list, total, allPage, 30, list.firstOrNull()?.let { it["source"].text() } ?: "kw")

    private fun music(
        id: String,
        name: String = "歌",
        singer: String = "歌手",
    ): JsonObject =
        buildJsonObject {
            put("id", id)
            put("name", name)
            put("singer", singer)
            put("source", id.substringBefore('_'))
            put("interval", "01:00")
        }

    private fun List<JsonObject>.ids(): List<String> = map { it["id"].text() }

    private fun kotlinx.serialization.json.JsonElement?.text(): String = (this as? JsonPrimitive)?.content.orEmpty()
}
