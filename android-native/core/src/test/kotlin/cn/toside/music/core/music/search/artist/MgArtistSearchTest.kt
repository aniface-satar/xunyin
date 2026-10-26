package cn.toside.music.core.music.search.artist

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 咪咕歌手黄金测试：fixture 为 2026-10-26 真实响应（关键词「周杰伦」）。
 * 只实现 search（详情接口无真实响应证据，按「宁可少做」不实现）；
 * `singerResultData.totalCount` 是**字符串**。
 */
class MgArtistSearchTest {
    private fun fixture(name: String): String = javaClass.getResource(name)!!.readText(Charsets.UTF_8)

    @Test
    fun `parse live search fixture with string total count`() {
        val page = MgArtistSearch.parseSearch(fixture("/artist-mg-search.json"), page = 1, limit = 18)!!
        assertEquals(4, page.total)
        assertEquals((4 + 17) / 18, page.allPage)
        assertEquals(2, page.list.size)

        val first = page.list.first()
        assertEquals("112", first.id)
        assertEquals("周杰伦", first.name)
        assertEquals(41, first.albumCount)
        assertEquals(413, first.musicCount)
        assertTrue(first.picUrl!!.startsWith("https://"))
        assertEquals("mg", first.source)
    }

    @Test
    fun `empty result with zero total pins allPage to zero`() {
        val body =
            """{"code":"000000","singerResultData":{"totalCount":"0","correct":[],"result":[]}}"""
        val page = MgArtistSearch.parseSearch(body, 1, 18)!!
        assertTrue(page.list.isEmpty())
        assertEquals(0, page.allPage)
    }

    @Test
    fun `wrong code returns null`() {
        assertNull(MgArtistSearch.parseSearch("""{"code":"000001"}""", 1, 18))
        assertNull(MgArtistSearch.parseSearch("not-json", 1, 18))
    }

    @Test
    fun `build search request opens singer switch only`() {
        val request = MgArtistSearch.buildSearchRequest("周杰伦", page = 2, limit = 18, time = "1700000000000")
        assertTrue(request.url.contains("%22singer%22%3A1"))
        assertTrue(request.url.contains("%22album%22%3A0"))
        assertTrue(request.url.contains("pageSize=18"))
        assertTrue(request.url.contains("pageNo=2"))
    }
}
