package cn.toside.music.core.music.search.album

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** 专辑累计规则（RN 无专辑搜索；语义与歌单聚合对齐，这里钉住核心行为）。 */
class AlbumSearchAggregatorTest {
    private fun item(
        id: String,
        name: String,
        source: String,
    ) = AlbumItem(id = id, name = name, source = source)

    @Test
    fun `pages is ceil of total over limit and zero for empty`() {
        assertEquals(0, AlbumSearchAggregator.pages(0, 20))
        assertEquals(1, AlbumSearchAggregator.pages(1, 20))
        assertEquals(2, AlbumSearchAggregator.pages(21, 20))
        assertEquals(0, AlbumSearchAggregator.pages(100, 0))
    }

    @Test
    fun `single combines pages and recomputes all page from total`() {
        val previous = AlbumSearchPage(listOf(item("a", "范特西", "kg")), total = 435, allPage = 22, limit = 20, source = "kg")
        val current = AlbumSearchPage(listOf(item("b", "八度空间", "kg")), total = 435, allPage = 22, limit = 20, source = "kg")
        val result = AlbumSearchAggregator.single(current, page = 2, previous = previous)
        assertEquals(listOf("a", "b"), result.list.map { it.id })
        assertEquals(435, result.total)
        assertEquals(22, result.allPage)
    }

    @Test
    fun `single without total keeps parser heuristic all page`() {
        val current = AlbumSearchPage(listOf(item("a", "范特西", "kw")), total = 0, allPage = 2, limit = 20, source = "kw")
        val result = AlbumSearchAggregator.single(current, page = 2)
        assertEquals(20 * 2, result.total)
        assertEquals(2, result.allPage)
    }

    @Test
    fun `all sorts by similarity and merges totals`() {
        val results =
            listOf(
                AlbumSearchPage(listOf(item("kg", "周杰伦的专辑合集", "kg")), total = 0, allPage = 1, limit = 15, source = "kg"),
                AlbumSearchPage(listOf(item("wy", "范特西", "wy")), total = 215, allPage = 11, limit = 15, source = "wy"),
            )
        val all = AlbumSearchAggregator.all("范特西", results, page = 1)
        assertEquals("all", all.source)
        assertEquals("wy", all.list.first().id)
        assertEquals(215, all.total)
        assertEquals(11, all.allPage)
        assertEquals(15, all.limit)
    }

    @Test
    fun `empty page is one page of nothing`() {
        val page = AlbumSearchAggregator.emptyPage("wy")
        assertTrue(page.list.isEmpty())
        assertEquals(1, page.allPage)
    }
}
