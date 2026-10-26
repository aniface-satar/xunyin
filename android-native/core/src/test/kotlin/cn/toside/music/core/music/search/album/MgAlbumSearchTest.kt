package cn.toside.music.core.music.search.album

import cn.toside.music.core.music.search.str
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 咪咕专辑黄金测试：fixture 为 2026-10-26 真实响应（关键词「周杰伦」）。
 * 坑：`totalCount` 是**字符串**；RN 一页装完语义（limit = total）。
 */
class MgAlbumSearchTest {
    private fun fixture(name: String): String = javaClass.getResource(name)!!.readText(Charsets.UTF_8)

    @Test
    fun `parse live search fixture with string total count`() {
        val page = MgAlbumSearch.parseSearch(fixture("/album-mg-search.json"), page = 1, limit = 20)!!
        assertEquals(3, page.total)
        assertEquals((3 + 19) / 20, page.allPage)
        assertEquals(2, page.list.size)

        val first = page.list.first()
        assertEquals("7948", first.id)
        assertEquals("范特西", first.name)
        assertEquals("周杰伦", first.singer)
        assertEquals("2001-09-20", first.publishTime)
        assertTrue(first.picUrl!!.startsWith("https://"))
        assertEquals("mg", first.source)
    }

    @Test
    fun `parse songs fixture reuses leaderboard filter`() {
        val songs = MgAlbumSearch.parseSongs(fixture("/album-mg-song.json"))!!
        assertEquals(10, songs.total)
        assertEquals(2, songs.list.size)
        val first = songs.list.first()
        assertEquals("mg_2498", first.str("id"))
        assertEquals("爱在西元前", first.str("name"))
    }

    @Test
    fun `parse info fixture into album header`() {
        val info = MgAlbumSearch.parseInfo(fixture("/album-mg-info.json"))!!
        assertEquals("7948", info.id)
        assertEquals("范特西", info.name)
        assertEquals(10, info.songCount)
    }

    @Test
    fun `detail pins one page semantics with limit equal to total`() =
        runBlocking {
            val bodies = listOf(fixture("/album-mg-song.json"), fixture("/album-mg-info.json")).iterator()
            val search = MgAlbumSearch(fetch = { bodies.next() }, clock = { "1700000000000" })
            val detail = search.detail("7948")
            assertEquals(10, detail.total)
            assertEquals(10, detail.limit)
            assertEquals(1, detail.allPage)
            assertEquals(2, detail.songs.size)
            assertEquals("7948", detail.info.id)
        }

    @Test
    fun `empty result with zero total pins allPage to zero`() {
        val body =
            """{"code":"000000","albumResultData":{"totalCount":"0","correct":[],"result":[]}}"""
        val page = MgAlbumSearch.parseSearch(body, 1, 20)!!
        assertTrue(page.list.isEmpty())
        assertEquals(0, page.allPage)
    }

    @Test
    fun `wrong code returns null`() {
        assertNull(MgAlbumSearch.parseSearch("""{"code":"000001"}""", 1, 20))
        assertNull(MgAlbumSearch.parseSearch("not-json", 1, 20))
        assertNull(MgAlbumSearch.parseSongs("""{"code":"000001"}"""))
        assertNull(MgAlbumSearch.parseInfo("""{"code":"000001"}"""))
    }

    @Test
    fun `build search request opens album switch only`() {
        val request = MgAlbumSearch.buildSearchRequest("周杰伦", page = 1, limit = 20, time = "1700000000000")
        assertTrue(request.url.contains("searchSwitch=%7B%22song%22%3A0"))
        assertTrue(request.url.contains("%22album%22%3A1"))
        assertTrue(request.url.contains("%22singer%22%3A0"))
        assertTrue(request.url.contains("pageSize=20"))
        assertTrue(request.url.contains("pageNo=1"))
    }
}
