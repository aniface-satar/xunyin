package cn.toside.music.core.music.search

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * QQ 音乐歌单搜索黄金测试：fixture 为 2026-10-26 真实响应
 * （`c.y.qq.com/soso/fcgi-bin/client_music_search_songlist`，关键词「周杰伦」）。
 */
class TxSonglistSearchTest {
    private fun fixture(): String = javaClass.getResource("/songlist-search-tx.json")!!.readText(Charsets.UTF_8)

    @Test
    fun `parse live fixture into songlist items`() {
        val page = TxSonglistSearch.parse(fixture(), page = 1, limit = 18)!!
        assertEquals(46639, page.total)
        assertEquals(18, page.list.size)

        val first = page.list.first()
        assertEquals("3805603854", first.id)
        assertEquals("周杰伦歌曲大全！一张歌单全听完", first.name)
        assertEquals("歌单狂魔", first.author)
        assertEquals("9亿", first.playCount)
        assertEquals(223, first.total)
        assertEquals("2018-04-01", first.time)
        assertTrue(first.img!!.startsWith("http://p.qpic.cn/music_cover/"))
        // 双重 decodeName 后实体消失，&#10; 变真换行，且 <br> 也换行
        assertTrue(first.desc.contains("\n"))
        assertTrue(!first.desc.contains("&#10;"))
    }

    @Test
    fun `non zero code retries up to six attempts`() =
        runBlocking {
            var calls = 0
            val search =
                TxSonglistSearch(
                    fetch = {
                        calls++
                        if (calls < 3) """{"code":104,"data":{}}""" else fixture()
                    },
                )
            val page = search.search("周杰伦")
            assertEquals(3, calls)
            assertEquals(46639, page.total)

            var failing = 0
            val impossible =
                TxSonglistSearch(
                    fetch = {
                        failing++
                        """{"code":500}"""
                    },
                )
            assertTrue(runCatching { impossible.search("周杰伦") }.exceptionOrNull() != null)
            assertEquals(6, failing)
        }

    @Test
    fun `build request carries rn headers and encoded keyword`() {
        val request = TxSonglistSearch.buildRequest("周杰伦", page = 3, limit = 18)
        assertTrue(request.url.contains("page_no=2"))
        assertTrue(request.url.contains("num_per_page=18"))
        assertTrue(request.url.contains("query=%E5%91%A8%E6%9D%B0%E4%BC%A6"))
        assertEquals("http://y.qq.com/portal/search.html", request.headers["Referer"])
        assertTrue(request.headers["User-Agent"]!!.contains("MSIE 9.0"))
    }

    @Test
    fun `code zero without data is rejected`() {
        assertNull(TxSonglistSearch.parse("""{"code":0}""", 1, 18))
    }
}
