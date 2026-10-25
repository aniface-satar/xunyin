package cn.toside.music.core.music.search

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 咪咕歌单搜索黄金测试：fixture 为 2026-10-26 真实响应
 * （`searchAll`，searchSwitch 仅开 songlist，关键词「周杰伦」）。
 */
class MgSonglistSearchTest {
    private fun fixture(): String = javaClass.getResource("/songlist-search-mg.json")!!.readText(Charsets.UTF_8)

    @Test
    fun `parse live fixture into songlist items`() {
        val page = MgSonglistSearch.parse(fixture(), page = 1, limit = 18)!!
        assertEquals(200, page.total)
        assertEquals(18, page.list.size)
        assertEquals(12, page.allPage)

        val first = page.list.first()
        assertEquals("233754996", first.id)
        assertEquals("周杰伦精选100首：青春百听不厌", first.name)
        assertEquals("山间啊", first.author)
        assertEquals("213.7万", first.playCount)
        assertEquals(100, first.total)
        assertEquals("mg", first.source)
        assertTrue(first.img!!.startsWith("https://d.musicapp.migu.cn"))
    }

    @Test
    fun `build request carries songlist switch and deterministic signature`() {
        val time = "1700000000000"
        val request = MgSonglistSearch.buildRequest("周杰伦", page = 1, limit = 18, time = time)
        assertTrue(request.url.startsWith("https://jadeite.migu.cn/music_search/v3/search/searchAll?"))
        assertTrue(request.url.contains("songlist%22%3A1"))
        assertTrue(request.url.contains("pageSize=18"))
        assertTrue(request.url.contains("pageNo=1"))
        assertTrue(request.url.contains("text=%E5%91%A8%E6%9D%B0%E4%BC%A6"))
        assertEquals(time, request.headers["timestamp"])
        assertEquals("A_music_3.6.1", request.headers["uiVersion"])
        // keyword+固定串+appKey+deviceId+time 的 md5（独立算好的十六进制）
        assertEquals("32a64a14bc877d1521fae7854288cc94", request.headers["sign"])
        assertEquals(request.headers["sign"], MgSonglistSearch.signature("周杰伦", time))
    }

    @Test
    fun `missing songListResultData or error code returns null and search throws`() =
        runBlocking {
            assertNull(MgSonglistSearch.parse("""{"code":"000000"}""", 1, 18))
            assertNull(MgSonglistSearch.parse("""{"code":"100000","songListResultData":{}}""", 1, 18))
            val search = MgSonglistSearch(fetch = { """{"code":"100000"}""" })
            assertTrue(runCatching { search.search("周杰伦") }.exceptionOrNull() != null)
        }

    @Test
    fun `skips missing ids and treats non numeric play count as zero`() {
        val body =
            """
            {"code":"000000","songListResultData":{"totalCount":2,"result":[
              {"id":"","name":"空 id"},
              {"id":"42","name":"有 id","userName":"u","playNum":"不是数字","musicNum":"3"}
            ]}}
            """.trimIndent()
        val page = MgSonglistSearch.parse(body, page = 1, limit = 18)!!
        assertEquals(1, page.list.size)
        assertEquals("42", page.list.first().id)
        assertEquals("0", page.list.first().playCount)
        assertEquals(3, page.list.first().total)
    }
}
