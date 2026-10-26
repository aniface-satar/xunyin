package cn.toside.music.core.music.search.album

import cn.toside.music.core.music.search.int
import cn.toside.music.core.music.search.str
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * QQ 音乐专辑黄金测试：fixture 为 2026-10-26 真实响应（关键词「周杰伦」）。
 * 钉住坑 3：**专辑 id 用 albumMID**（数字 albumID 只在歌曲详情的 album 对象里出现）。
 * 综合搜索专辑区无 total → 「整页 → 下一页」启发式。
 */
class TxAlbumSearchTest {
    private fun fixture(name: String): String = javaClass.getResource(name)!!.readText(Charsets.UTF_8)

    @Test
    fun `parse live search fixture uses album mid as id`() {
        val page = TxAlbumSearch.parseSearch(fixture("/album-tx-search.json"), page = 1, limit = 20)!!
        assertEquals(2, page.list.size)
        assertEquals(0, page.total)
        assertEquals(1, page.allPage)

        val first = page.list.first()
        assertEquals("000I5jJB3blWeN", first.id)
        assertEquals("范特西", first.name)
        assertEquals("周杰伦", first.singer)
        assertEquals("2001-09-14", first.publishTime)
        assertEquals("tx", first.source)
    }

    @Test
    fun `full page heuristic advances allPage`() {
        val page = TxAlbumSearch.parseSearch(fixture("/album-tx-search.json"), page = 1, limit = 2)!!
        assertEquals(2, page.allPage)
    }

    @Test
    fun `parse live detail fixture with song infos`() {
        val detail = TxAlbumSearch.parseDetail(fixture("/album-tx-detail.json"), page = 1)!!
        assertEquals("000I5jJB3blWeN", detail.info.id)
        assertEquals(10, detail.total)
        // RN 语义：详情一页装完（limit = total → allPage = 1）
        assertEquals(10, detail.limit)
        assertEquals(1, detail.allPage)
        assertEquals(2, detail.songs.size)

        val song = detail.songs.first()
        assertEquals("tx_002usg9o4GTAKf", song.str("id"))
        assertEquals("爱在西元前", song.str("name"))
        assertEquals("周杰伦", song.str("singer"))
        assertEquals("03:54", song.str("interval"))
        val meta = song["meta"] as kotlinx.serialization.json.JsonObject
        assertEquals("000I5jJB3blWeN", meta.str("albumMid"))
    }

    @Test
    fun `error code or missing album zone returns null`() {
        assertNull(TxAlbumSearch.parseSearch("""{"code":1}""", 1, 20))
        assertNull(TxAlbumSearch.parseSearch("""{"code":0,"req":{"code":0,"data":{"body":{}}}}""", 1, 20))
        assertNull(TxAlbumSearch.parseDetail("not-json", 1))
    }

    @Test
    fun `build detail request addresses album by mid`() {
        val request = TxAlbumSearch.buildDetailRequest("000I5jJB3blWeN", page = 1, searchId = "X")
        val body =
            kotlinx.serialization.json.Json.parseToJsonElement(request.body!!).let {
                (it as kotlinx.serialization.json.JsonObject)["music.musichallAlbum.AlbumInfoServer"]!!
            } as kotlinx.serialization.json.JsonObject
        val param = body["param"] as kotlinx.serialization.json.JsonObject
        assertEquals("000I5jJB3blWeN", param.str("albumMid"))
        assertEquals(0, param.int("albumId"))
        assertTrue(request.url.startsWith("https://u.y.qq.com/cgi-bin/musics.fcg?sign=zzc"))
    }
}
