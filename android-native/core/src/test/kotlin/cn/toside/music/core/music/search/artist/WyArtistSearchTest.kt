package cn.toside.music.core.music.search.artist

import cn.toside.music.core.music.search.arr
import cn.toside.music.core.music.search.str
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 网易云歌手黄金测试：fixture 为 2026-10-26 真实响应（关键词「周杰伦」）。
 * 搜索走 eapi（type=100），详情/专辑走 weapi；分页/total 语义：`result.artistCount`。
 */
class WyArtistSearchTest {
    private fun fixture(name: String): String = javaClass.getResource(name)!!.readText(Charsets.UTF_8)

    @Test
    fun `parse live search fixture with artist count total`() {
        val page = WyArtistSearch.parseSearch(fixture("/artist-wy-search.json"), page = 1, limit = 18)!!
        assertEquals(83, page.total)
        assertEquals((83 + 17) / 18, page.allPage)
        assertEquals(2, page.list.size)

        val first = page.list.first()
        assertEquals("6452", first.id)
        assertEquals("周杰伦", first.name)
        assertEquals("Jay Chou、周董", first.alias)
        assertEquals(42, first.albumCount)
        assertEquals(582, first.musicCount)
        assertTrue(first.picUrl!!.startsWith("http"))
        assertEquals("wy", first.source)
    }

    @Test
    fun `parse detail fixture with hot songs`() {
        val fallback = ArtistItem(id = "6452", name = "周杰伦", source = "wy")
        val (info, songs) = WyArtistSearch.parseDetail(fixture("/artist-wy-detail.json"), fallback)!!
        assertEquals("6452", info.id)
        assertEquals(45, info.albumCount)
        assertEquals(582, info.musicCount)
        assertEquals("Jay Chou、周董", info.alias)
        assertEquals(2, songs.size)

        val song = songs.first()
        assertEquals("wy_210049", song.str("id"))
        assertEquals("布拉格广场", song.str("name"))
        // maxBrLevel=lossless + maxbr=999000 → 128k/320k/flac，无 flac24bit；品质表在 meta 内
        val meta = song["meta"] as kotlinx.serialization.json.JsonObject
        val types = meta.arr("qualitys").map { it.str("type") }
        assertTrue(types.containsAll(listOf("128k", "320k", "flac")))
        assertTrue(!types.contains("flac24bit"))
    }

    @Test
    fun `parse albums fixture with hot albums`() {
        val albums = WyArtistSearch.parseAlbums(fixture("/artist-wy-albums.json"))!!
        assertEquals(2, albums.size)
        val first = albums.first()
        assertEquals("403900711", first.id)
        assertEquals("太阳之子", first.name)
        assertEquals("周杰伦", first.singer)
        assertEquals(13, first.songCount)
    }

    @Test
    fun `error code or missing artist returns null`() {
        val fallback = ArtistItem(id = "6452", name = "周杰伦", source = "wy")
        assertNull(WyArtistSearch.parseSearch("""{"code":405}""", 1, 18))
        assertNull(WyArtistSearch.parseDetail("""{"code":200}""", fallback))
        assertNull(WyArtistSearch.parseAlbums("""{"code":405}"""))
        assertNull(WyArtistSearch.parseSearch("not-json", 1, 18))
    }

    @Test
    fun `search request uses eapi with type 100`() {
        val request = WyArtistSearch.buildSearchRequest("周杰伦", page = 2, limit = 18)
        assertEquals("http://interface.music.163.com/eapi/batch", request.url)
        assertTrue(request.form!!.containsKey("params"))
        val albums = WyArtistSearch.buildAlbumsRequest("6452", page = 1)
        assertTrue(albums.url.endsWith("/weapi/artist/albums/6452"))
    }
}
