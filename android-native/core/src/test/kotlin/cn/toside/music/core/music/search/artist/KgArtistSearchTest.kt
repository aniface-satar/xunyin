package cn.toside.music.core.music.search.artist

import cn.toside.music.core.music.search.SearchDetailSupport
import cn.toside.music.core.music.search.str
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 酷狗歌手黄金测试：fixture 为 2026-10-26 真实响应（关键词「周杰伦」）。
 * `api/v3/search/singer` 的 `data` 是**纯数组**（无 total）→ 整页启发式。
 */
class KgArtistSearchTest {
    private fun fixture(name: String): String = javaClass.getResource(name)!!.readText(Charsets.UTF_8)

    @Test
    fun `parse live search fixture from plain array data`() {
        val page = KgArtistSearch.parseSearch(fixture("/artist-kg-search.json"), page = 1, limit = 18)!!
        assertEquals(2, page.list.size)
        assertEquals(0, page.total)
        // 未装满整页（2 < 18）→ allPage = page
        assertEquals(1, page.allPage)

        val first = page.list.first()
        assertEquals("3520", first.id)
        assertEquals("周杰伦", first.name)
        assertEquals("kg", first.source)
    }

    @Test
    fun `full page heuristic advances allPage`() {
        val page = KgArtistSearch.parseSearch(fixture("/artist-kg-search.json"), page = 1, limit = 2)!!
        assertEquals(2, page.allPage)
    }

    @Test
    fun `parse info fixture with album and song counts`() {
        val info = KgArtistSearch.parseInfo(fixture("/artist-kg-info.json"))!!
        assertEquals("3520", info.id)
        assertEquals("周杰伦", info.name)
        assertEquals(49, info.albumCount)
        assertEquals(1851, info.musicCount)
        assertTrue(info.picUrl!!.contains("singerimg.kugou.com"))
        assertTrue(!info.picUrl!!.contains("{size}"))
    }

    @Test
    fun `parse songs hashes and gateway completion`() {
        val songs = KgArtistSearch.parseSongs(fixture("/artist-kg-song.json"))!!
        assertEquals(1851, songs.total)
        assertEquals(2, songs.hashes.size)

        val infos = SearchDetailSupport.kgAudioListToMusicInfos(SearchDetailSupport.kgGatewayParse(fixture("/artist-kg-gateway.json")))
        assertEquals(2, infos.size)
        val first = infos.first()
        assertEquals("20505418_B3A52A7A958BF0AED0EBFBA2E9A818B7", first.str("id"))
        assertEquals("晴天", first.str("name"))
        assertEquals("周杰伦", first.str("singer"))
    }

    @Test
    fun `parse albums fixture`() {
        val albums = KgArtistSearch.parseAlbums(fixture("/artist-kg-album.json"))!!
        assertEquals(2, albums.size)
        val first = albums.first()
        assertEquals("179652761", first.id)
        assertEquals("太阳之子", first.name)
        assertEquals("周杰伦", first.singer)
        assertEquals(13, first.songCount)
        assertEquals("2026-03-25", first.publishTime)
    }

    @Test
    fun `error status returns null`() {
        assertNull(KgArtistSearch.parseSearch("""{"status":0,"errcode":1}""", 1, 18))
        assertNull(KgArtistSearch.parseSearch("not-json", 1, 18))
        assertNull(KgArtistSearch.parseSongs("""{"errcode":1}"""))
        assertNull(KgArtistSearch.parseAlbums("""{"errcode":1}"""))
    }
}
