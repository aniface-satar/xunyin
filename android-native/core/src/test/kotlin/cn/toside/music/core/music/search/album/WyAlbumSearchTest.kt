package cn.toside.music.core.music.search.album

import cn.toside.music.core.music.search.arr
import cn.toside.music.core.music.search.str
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 网易云专辑黄金测试：fixture 为 2026-10-26 真实响应（关键词「周杰伦」）。
 * 分页/total 语义：`result.albumCount` 真实存在，allPage = ceil(albumCount/limit)。
 */
class WyAlbumSearchTest {
    private fun fixture(name: String): String = javaClass.getResource(name)!!.readText(Charsets.UTF_8)

    @Test
    fun `parse live search fixture with album count total`() {
        val page = WyAlbumSearch.parseSearch(fixture("/album-wy-search.json"), page = 1, limit = 20)!!
        assertEquals(215, page.total)
        assertEquals((215 + 19) / 20, page.allPage)
        assertEquals(2, page.list.size)

        val first = page.list.first()
        assertEquals("272566217", first.id)
        assertEquals("范特西 - 流行Pop x 周杰伦 Type Beat", first.name)
        assertEquals(1, first.songCount)
        assertTrue(first.picUrl!!.startsWith("http"))
        assertEquals("wy", first.source)
    }

    @Test
    fun `parse live detail fixture with embedded privilege qualities`() {
        val detail = WyAlbumSearch.parseDetail(fixture("/album-wy-detail.json"), page = 1)!!
        assertEquals("21349", detail.info.id)
        assertEquals("看我72变", detail.info.name)
        assertEquals("蔡依林", detail.info.singer)
        assertEquals(11, detail.info.songCount)
        assertEquals(11, detail.total)
        // 一页装完语义（limit = total → allPage = 1）
        assertEquals(11, detail.limit)
        assertEquals(1, detail.allPage)
        assertEquals(2, detail.songs.size)

        val song = detail.songs.first()
        assertEquals("wy_210042", song.str("id"))
        assertEquals("说爱你", song.str("name"))
        // maxbr 999000 → 128k/320k/flac（无 hires → 无 flac24bit）；品质表在 meta 内
        val meta = song["meta"] as kotlinx.serialization.json.JsonObject
        val types = meta.arr("qualitys").map { it.str("type") }
        assertTrue(types.containsAll(listOf("128k", "320k", "flac")))
        assertTrue(!types.contains("flac24bit"))
    }

    @Test
    fun `empty albums with zero count pins allPage to zero`() {
        val page = WyAlbumSearch.parseSearch("""{"code":200,"result":{"albumCount":0,"albums":[]}}""", 1, 20)!!
        assertTrue(page.list.isEmpty())
        assertEquals(0, page.allPage)
    }

    @Test
    fun `error code or missing album returns null`() {
        assertNull(WyAlbumSearch.parseSearch("""{"code":405}""", 1, 20))
        assertNull(WyAlbumSearch.parseDetail("""{"code":200}""", 1))
        assertNull(WyAlbumSearch.parseDetail("not-json", 1))
    }

    @Test
    fun `search request body carries type offset and eapi path`() {
        val request = WyAlbumSearch.buildSearchRequest("周杰伦", page = 2, limit = 20)
        assertEquals("http://interface.music.163.com/eapi/batch", request.url)
        assertEquals("POST", request.method)
        assertTrue(request.form!!.containsKey("params"))
        val detail = WyAlbumSearch.buildDetailRequest("21349")
        assertTrue(detail.url.endsWith("/weapi/v1/album/21349"))
    }
}
