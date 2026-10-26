package cn.toside.music.core.music.search.album

import cn.toside.music.core.music.search.arr
import cn.toside.music.core.music.search.str
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 酷我专辑黄金测试：fixture 为 2026-10-26 真实响应（关键词「周杰伦」）。
 * `r.s` 单引号对象串 + 无 TOTAL 的「整页 → 下一页」启发式。
 */
class KwAlbumSearchTest {
    private fun fixture(name: String): String = javaClass.getResource(name)!!.readText(Charsets.UTF_8)

    @Test
    fun `parse live search fixture into album items`() {
        val page = KwAlbumSearch.parseSearch(fixture("/album-kw-search.txt"), page = 1, limit = 20)!!
        assertEquals(4, page.list.size)
        assertEquals(0, page.total)
        // 未装满整页（4 < 20）→ allPage = page
        assertEquals(1, page.allPage)

        val first = page.list.first()
        assertEquals("1287", first.id)
        assertEquals("范特西", first.name)
        assertEquals("周杰伦", first.singer)
        assertEquals(10, first.songCount)
        assertTrue(first.picUrl!!.startsWith("http"))
        assertEquals("kw", first.source)
    }

    @Test
    fun `full page heuristic advances allPage`() {
        // 装满整页（2 == limit）→ 视为可能还有下一页
        val page = KwAlbumSearch.parseSearch(fixture("/album-kw-search.txt"), page = 1, limit = 2)!!
        assertEquals(2, page.allPage)
    }

    @Test
    fun `parse live detail fixture with formats quality table`() {
        val detail = KwAlbumSearch.parseDetail(fixture("/album-kw-detail.txt"), page = 1)!!
        assertEquals(10, detail.total)
        assertEquals(10, detail.info.songCount)
        assertEquals("1287", detail.info.id)
        assertEquals("范特西", detail.info.name)
        assertEquals("周杰伦", detail.info.singer)
        assertEquals(KwAlbumSearch.DETAIL_LIMIT, detail.limit)
        assertEquals(1, detail.allPage)

        val song = detail.songs.first()
        assertEquals("kw_588552", song.str("id"))
        assertEquals("爱在西元前", song.str("name"))
        assertEquals("周杰伦", song.str("singer"))
        // FORMATS: ALFLAC|MP3128|MP3H → 128k/320k/flac（品质表在 meta 内，与既有音乐项形状一致）
        val meta = song["meta"] as kotlinx.serialization.json.JsonObject
        val types = meta.arr("qualitys").map { it.str("type") }
        assertTrue(types.containsAll(listOf("128k", "320k", "flac")))
    }

    @Test
    fun `empty albumlist yields empty page`() {
        val page = KwAlbumSearch.parseSearch("""{'SHOW':'1','albumlist':[]}""", page = 1, limit = 20)!!
        assertTrue(page.list.isEmpty())
        assertEquals(1, page.allPage)
    }

    @Test
    fun `show zero and malformed bodies return null for retry`() {
        assertNull(KwAlbumSearch.parseSearch("""{'SHOW':'0','albumlist':[]}""", 1, 20))
        assertNull(KwAlbumSearch.parseSearch("not-json", 1, 20))
        // 详情缺 musiclist → 重试
        assertNull(KwAlbumSearch.parseDetail("""{'SHOW':'1'}""", 1))
    }

    @Test
    fun `build requests carry keyword page and album id`() {
        val search = KwAlbumSearch.buildSearchRequest("周杰伦", page = 2, limit = 20)
        assertTrue(search.url.contains("all=%E5%91%A8%E6%9D%B0%E4%BC%A6"))
        assertTrue(search.url.contains("&pn=1&"))
        assertTrue(search.url.contains("rn=20"))
        assertTrue(search.url.contains("ft=album"))
        val detail = KwAlbumSearch.buildDetailRequest("1287", page = 1)
        assertTrue(detail.url.contains("stype=albuminfo"))
        assertTrue(detail.url.contains("albumid=1287"))
    }
}
