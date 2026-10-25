package cn.toside.music.core.music.search

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 酷狗歌单搜索黄金测试：fixture 为 2026-10-26 真实响应
 * （`msearchretry.kugou.com`，关键词「周杰伦」，pagesize=18）。
 */
class KgSonglistSearchTest {
    private fun fixture(): String = javaClass.getResource("/songlist-search-kg.json")!!.readText(Charsets.UTF_8)

    @Test
    fun `parse live fixture into songlist items`() {
        val page = KgSonglistSearch.parse(fixture(), page = 1, limit = 18)!!
        assertEquals(480, page.total)
        assertEquals((480 + 17) / 18, page.allPage)
        assertEquals(18, page.list.size)

        val first = page.list.first()
        assertEquals("id_6409645", first.id)
        assertEquals("周杰伦必听热歌｜聆听周式金曲，聆听青春记忆", first.name)
        assertEquals("酷乐推荐", first.author)
        assertEquals("3665.8万", first.playCount)
        assertEquals(154, first.total)
        assertEquals("2023-01-10", first.time)
        assertTrue(first.img!!.contains("imge.kugou.com"))
    }

    @Test
    fun `build request carries keyword page and page size`() {
        val request = KgSonglistSearch.buildRequest("周杰伦", page = 2, limit = 18)
        assertTrue(request.url.contains("keyword=%E5%91%A8%E6%9D%B0%E4%BC%A6"))
        assertTrue(request.url.contains("&page=2&"))
        assertTrue(request.url.contains("pagesize=18"))
        assertTrue(request.url.contains("showtype=10"))
    }

    @Test
    fun `non zero errcode returns null and search throws`() =
        runBlocking {
            assertNull(KgSonglistSearch.parse("""{"errcode":1,"data":{"total":0,"info":[]}}""", 1, 18))
            val search = KgSonglistSearch(fetch = { """{"errcode":1}""" })
            assertTrue(runCatching { search.search("周杰伦") }.exceptionOrNull() != null)
        }
}
