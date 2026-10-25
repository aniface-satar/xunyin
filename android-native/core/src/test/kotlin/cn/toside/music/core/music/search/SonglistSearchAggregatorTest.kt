package cn.toside.music.core.music.search

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 歌单搜索累计规则 —— 对照 RN `store/search/songlist/action.ts`：
 * 单源不排序不去重、翻页拼接；聚合只按歌单名相似度排序、同样不去重。
 */
class SonglistSearchAggregatorTest {
    @Test
    fun `single page one replaces list and keeps total`() {
        val current = page("kw", listOf(item("1", "周杰伦精选"), item("2", "华语流行")), total = 100, limit = 18)
        val result = SonglistSearchAggregator.single(current, page = 1)
        assertEquals(2, result.list.size)
        assertEquals(100, result.total)
        assertEquals((100 + 17) / 18, result.allPage)
    }

    @Test
    fun `single later page appends and falls back to limit times page`() {
        val previous = page("kw", listOf(item("1", "A")), total = 100, limit = 18)
        val current = page("kw", listOf(item("2", "B")), total = 0, limit = 18)
        val result = SonglistSearchAggregator.single(current, page = 2, previous = previous)
        assertEquals(listOf("1", "2"), result.list.map { it.id })
        // RN setList：page>1 且 total==0 → total = limit * page
        assertEquals(36, result.total)
        // RN 单源不写 maxPages；native 按 total/limit 推算，供 reachedEnd 使用
        assertEquals(2, result.allPage)
    }

    @Test
    fun `single does not deduplicate ids`() {
        val previous = page("kw", listOf(item("1", "A")), total = 100, limit = 18)
        val current = page("kw", listOf(item("1", "A")), total = 100, limit = 18)
        val result = SonglistSearchAggregator.single(current, page = 2, previous = previous)
        // RN 歌单搜索没有调用 deduplicationList
        assertEquals(listOf("1", "1"), result.list.map { it.id })
    }

    @Test
    fun `all sorts by playlist name similarity descending`() {
        val results =
            listOf(
                page("kw", listOf(item("k1", "完全无关的歌单")), total = 30, limit = 15),
                page("kg", listOf(item("g1", "周杰伦"), item("g2", "周杰伦合集")), total = 20, limit = 15),
            )
        val result = SonglistSearchAggregator.all("周杰伦", results, page = 1)
        assertEquals("all", result.source)
        assertEquals(30, result.total)
        assertEquals("g1", result.list.first().id)
        assertEquals(3, result.list.size)
    }

    @Test
    fun `all page two appends without deduplication`() {
        // all 模式下各源按 15 条请求（RN `limit: 15`）
        val previous =
            SonglistSearchAggregator.all(
                "周杰伦",
                listOf(page("kg", listOf(item("g1", "周杰伦")), total = 30, limit = 15)),
                1,
            )
        val current =
            SonglistSearchAggregator.all(
                "周杰伦",
                listOf(page("kg", listOf(item("g1", "周杰伦")), total = 0, limit = 15)),
                page = 2,
                previous = previous,
            )
        assertEquals(listOf("g1", "g1"), current.list.map { it.id })
        // page 2 且 total 为 0 → 回退 maxLimit * page = 15 * 2
        assertEquals(30, current.total)
    }

    @Test
    fun `all uses max limit for total fallback and keeps previous limit`() {
        val results = listOf(page("kw", emptyList(), total = 0, limit = 18), page("kg", emptyList(), total = 0, limit = 15))
        val result = SonglistSearchAggregator.all("x", results, page = 1)
        assertEquals(0, result.total)
        assertEquals(15, result.limit)
    }

    @Test
    fun `similarity prefers exact keyword`() {
        assertTrue(SonglistSearchAggregator.similar("周杰伦", "周杰伦") > SonglistSearchAggregator.similar("周杰伦", "周杰伦合集"))
        assertEquals(0.0, SonglistSearchAggregator.similar("", "x"), 0.0)
    }

    private fun item(
        id: String,
        name: String,
    ) = SonglistSearchItem(id = id, name = name, source = "kw")

    private fun page(
        source: String,
        list: List<SonglistSearchItem>,
        total: Int = 0,
        limit: Int = 18,
    ) = SonglistSearchPage(
        list = list,
        total = total,
        allPage = if (total == 0) 0 else (total + limit - 1) / limit,
        limit = limit,
        source = source,
    )
}
