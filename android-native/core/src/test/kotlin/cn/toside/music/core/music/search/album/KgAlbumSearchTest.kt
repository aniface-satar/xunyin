package cn.toside.music.core.music.search.album

import cn.toside.music.core.music.search.SearchDetailSupport
import cn.toside.music.core.music.search.str
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 酷狗专辑黄金测试：fixture 为 2026-10-26 真实响应（关键词「周杰伦」）。
 * 分页/total 语义：`data.total` 真实存在，allPage = ceil(total/limit)。
 */
class KgAlbumSearchTest {
    private fun fixture(name: String): String = javaClass.getResource(name)!!.readText(Charsets.UTF_8)

    @Test
    fun `parse live search fixture with real total`() {
        val page = KgAlbumSearch.parseSearch(fixture("/album-kg-search.json"), page = 1, limit = 20)!!
        assertEquals(435, page.total)
        assertEquals((435 + 19) / 20, page.allPage)
        assertEquals(2, page.list.size)

        val first = page.list.first()
        assertEquals("958706", first.id)
        assertEquals("范特西", first.name)
        assertEquals("周杰伦", first.singer)
        assertEquals("2001-09-14", first.publishTime)
        assertEquals(10, first.songCount)
        assertTrue(first.picUrl!!.contains("imge.kugou.com"))
        assertTrue(!first.picUrl!!.contains("{size}"))
        assertEquals("kg", first.source)
    }

    @Test
    fun `parse info fixture into album header`() {
        val info = KgAlbumSearch.parseInfo(fixture("/album-kg-info.json"))!!
        assertEquals("958706", info.id)
        assertEquals("范特西", info.name)
        assertEquals("周杰伦", info.singer)
    }

    @Test
    fun `detail song list yields hashes and gateway completes music infos`() {
        val songPage = KgAlbumSearch.parseDetailSongs(fixture("/album-kg-song.json"))!!
        assertEquals(10, songPage.total)
        assertEquals(2, songPage.hashes.size)
        assertEquals("66B756FB1331807B032EF97F7BA9948E", songPage.hashes.first())

        val songs = SearchDetailSupport.kgAudioListToMusicInfos(SearchDetailSupport.kgGatewayParse(fixture("/album-kg-gateway.json")))
        assertEquals(2, songs.size)
        val first = songs.first()
        // RN：id = audioId_hash
        assertEquals("351062_66B756FB1331807B032EF97F7BA9948E", first.str("id"))
        assertEquals("爱在西元前", first.str("name"))
        assertEquals("周杰伦", first.str("singer"))
        assertEquals("03:54", first.str("interval"))
        assertEquals("范特西", (first["meta"] as kotlinx.serialization.json.JsonObject).str("albumName"))
    }

    @Test
    fun `gateway requests batch hashes by 100`() {
        val hashes = (0 until 150).map { "hash$it" }
        val requests = SearchDetailSupport.kgGatewayRequests(hashes)
        assertEquals(2, requests.size)
        val sizes =
            requests.map { request ->
                val root = SearchDetailSupport.json.parseToJsonElement(request.body!!) as kotlinx.serialization.json.JsonObject
                (root["data"] as kotlinx.serialization.json.JsonArray).size
            }
        assertEquals(listOf(100, 50), sizes)
    }

    @Test
    fun `empty info list with zero total pins allPage to zero`() {
        val page = KgAlbumSearch.parseSearch("""{"status":1,"errcode":0,"data":{"total":0,"info":[]}}""", 1, 20)!!
        assertTrue(page.list.isEmpty())
        assertEquals(0, page.total)
        assertEquals(0, page.allPage)
    }

    @Test
    fun `error status returns null`() {
        assertNull(KgAlbumSearch.parseSearch("""{"status":0,"errcode":1}""", 1, 20))
        assertNull(KgAlbumSearch.parseSearch("not-json", 1, 20))
        assertNull(KgAlbumSearch.parseDetailSongs("""{"errcode":1}"""))
        assertNull(KgAlbumSearch.parseInfo("""{"errcode":1}"""))
    }

    @Test
    fun `build requests carry keyword page pagesize and album id`() {
        val search = KgAlbumSearch.buildSearchRequest("周杰伦", page = 3, limit = 20)
        assertTrue(search.url.contains("keyword=%E5%91%A8%E6%9D%B0%E4%BC%A6"))
        assertTrue(search.url.contains("page=3"))
        assertTrue(search.url.contains("pagesize=20"))
        val song = KgAlbumSearch.buildDetailSongRequest("958706", page = 1)
        assertTrue(song.url.contains("albumid=958706"))
        assertTrue(song.url.contains("pagesize=${KgAlbumSearch.DETAIL_LIMIT}"))
        assertTrue(KgAlbumSearch.buildInfoRequest("958706").url.contains("album/info?albumid=958706"))
    }
}
