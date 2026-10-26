package cn.toside.music.core.music.search.artist

import cn.toside.music.core.music.search.arr
import cn.toside.music.core.music.search.str
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 酷我歌手黄金测试：fixture 为 2026-10-26 真实响应（关键词「周杰伦」）。
 * 分页/total 语义：`TOTAL` 真实存在，allPage = ceil(TOTAL/limit)；
 * 歌手简介接口（www API，需 kw_token）不实现 → 详情头部用搜索行数据兜底。
 */
class KwArtistSearchTest {
    private fun fixture(name: String): String = javaClass.getResource(name)!!.readText(Charsets.UTF_8)

    @Test
    fun `parse live search fixture with total`() {
        val page = KwArtistSearch.parseSearch(fixture("/artist-kw-search.txt"), page = 1, limit = 18)!!
        assertEquals(58, page.total)
        assertEquals((58 + 17) / 18, page.allPage)
        // fixture 实际返回 2 条（RN:'3' 是请求条数，非结果数）
        assertEquals(2, page.list.size)

        val first = page.list.first()
        assertEquals("336", first.id)
        assertEquals("周杰伦", first.name)
        assertEquals(45, first.albumCount)
        assertTrue(first.alias.startsWith("Jay"))
        assertEquals("kw", first.source)
    }

    @Test
    fun `parse songs fixture with formats quality table`() {
        val songs = KwArtistSearch.parseSongs(fixture("/artist-kw-songs.txt"))!!
        assertEquals(2, songs.size)
        val first = songs.first()
        assertTrue(first.str("id").startsWith("kw_"))
        assertTrue(first.str("name").isNotEmpty())
        assertEquals("周杰伦", first.str("singer"))
        // FORMATS 含 MP3128|MP3H|ALFLAC → 至少 128k；品质表在 meta 内
        val meta = first["meta"] as kotlinx.serialization.json.JsonObject
        val types = meta.arr("qualitys").map { it.str("type") }
        assertTrue(types.contains("128k"))
    }

    @Test
    fun `parse albums fixture`() {
        val albums = KwArtistSearch.parseAlbums(fixture("/artist-kw-albums.txt"))!!
        assertEquals(2, albums.size)
        val first = albums.first()
        assertEquals("29218", first.id)
        assertEquals("kw", first.source)
    }

    @Test
    fun `detail falls back to search row as info`() =
        kotlinx.coroutines.runBlocking {
            val bodies = listOf(fixture("/artist-kw-songs.txt"), fixture("/artist-kw-albums.txt")).iterator()
            val search = KwArtistSearch(fetch = { bodies.next() })
            val fallback =
                ArtistItem(id = "336", name = "周杰伦", albumCount = 45, musicCount = 693, source = "kw")
            val detail = search.detail(fallback)
            assertEquals("336", detail.info.id)
            assertEquals(45, detail.info.albumCount)
            assertEquals(2, detail.songs.size)
            assertEquals(2, detail.albums.size)
        }

    @Test
    fun `show zero and empty list return null or empty page`() {
        assertNull(KwArtistSearch.parseSearch("""{'SHOW':'0','abslist':[]}""", 1, 18))
        val page = KwArtistSearch.parseSearch("""{'SHOW':'1','TOTAL':'0','abslist':[]}""", 1, 18)!!
        assertTrue(page.list.isEmpty())
        assertEquals(0, page.allPage)
        assertNull(KwArtistSearch.parseSongs("not-json"))
        assertNull(KwArtistSearch.parseAlbums("not-json"))
    }
}
