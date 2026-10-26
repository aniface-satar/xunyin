package cn.toside.music.core.music.search.artist

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** 歌手累计规则（与专辑/歌单聚合同形：拼接不去重 + similar 排序 + total 启发式）。 */
class ArtistSearchAggregatorTest {
    private fun item(
        id: String,
        name: String,
        source: String,
    ) = ArtistItem(id = id, name = name, source = source)

    @Test
    fun `single page 1 keeps current total`() {
        val page = ArtistSearchPage(listOf(item("a", "周杰伦", "wy")), total = 83, allPage = 5, limit = 18, source = "wy")
        val result = ArtistSearchAggregator.single(page, page = 1)
        assertEquals(83, result.total)
        assertEquals(5, result.allPage)
        assertEquals(1, result.list.size)
    }

    @Test
    fun `single page 2 combines with previous and keeps total from fresh page`() {
        val previous = ArtistSearchPage(listOf(item("a", "周杰伦", "wy")), total = 83, allPage = 5, limit = 18, source = "wy")
        val current = ArtistSearchPage(listOf(item("b", "周传雄", "wy")), total = 83, allPage = 5, limit = 18, source = "wy")
        val result = ArtistSearchAggregator.single(current, page = 2, previous = previous)
        assertEquals(listOf("a", "b"), result.list.map { it.id })
        assertEquals(83, result.total)
        assertEquals(5, result.allPage)
    }

    @Test
    fun `single without total estimates by limit times page`() {
        val current = ArtistSearchPage(listOf(item("a", "周杰伦", "kw")), total = 0, allPage = 2, limit = 18, source = "kw")
        val result = ArtistSearchAggregator.single(current, page = 2)
        assertEquals(18 * 2, result.total)
        assertEquals(2, result.allPage)
    }

    @Test
    fun `all combines sources and sorts by similarity`() {
        val results =
            listOf(
                ArtistSearchPage(listOf(item("kg", "周杰伦的歌单", "kg")), total = 0, allPage = 1, limit = 15, source = "kg"),
                ArtistSearchPage(listOf(item("wy", "周杰伦", "wy")), total = 83, allPage = 5, limit = 15, source = "wy"),
            )
        val all = ArtistSearchAggregator.all("周杰伦", results, page = 1)
        assertEquals("all", all.source)
        assertEquals(2, all.list.size)
        // 相似度更高（完全相等）的在前
        assertEquals("wy", all.list.first().id)
        assertEquals(83, all.total)
        assertEquals(5, all.allPage)
        assertEquals(15, all.limit)
    }

    @Test
    fun `all page 2 appends to previous list`() {
        val previous =
            ArtistSearchAggregator.all(
                "周杰伦",
                listOf(ArtistSearchPage(listOf(item("wy", "周杰伦", "wy")), total = 83, allPage = 5, limit = 15, source = "wy")),
                page = 1,
            )
        val next =
            ArtistSearchAggregator.all(
                "周杰伦",
                listOf(ArtistSearchPage(listOf(item("kg", "周杰伦", "kg")), total = 83, allPage = 5, limit = 15, source = "kg")),
                page = 2,
                previous = previous,
            )
        assertEquals(listOf("wy", "kg"), next.list.map { it.source })
    }

    @Test
    fun `empty page has one page and empty list`() {
        val page = ArtistSearchAggregator.emptyPage("wy")
        assertTrue(page.list.isEmpty())
        assertEquals(1, page.allPage)
        assertEquals(15, page.limit)
    }
}
