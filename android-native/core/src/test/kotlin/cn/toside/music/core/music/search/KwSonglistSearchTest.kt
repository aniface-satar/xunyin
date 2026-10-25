package cn.toside.music.core.music.search

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 酷我歌单搜索黄金测试：fixture 为 2026-10-26 真实响应
 * （`search.kuwo.cn`，关键词「周杰伦」，rn=18），响应是单引号 JS 对象串。
 */
class KwSonglistSearchTest {
    private fun fixture(): String = javaClass.getResource("/songlist-search-kw.json")!!.readText(Charsets.UTF_8)

    @Test
    fun `parse live fixture into songlist items`() {
        val page = KwSonglistSearch.parse(fixture(), page = 1, limit = 18)!!
        assertEquals(143, page.total)
        assertEquals(18, page.limit)
        assertEquals("kw", page.source)
        assertEquals(18, page.list.size)

        val first = page.list.first()
        assertEquals("2867496601", first.id)
        assertEquals("终于等到周杰伦，说好不哭你今天哭了吗？", first.name)
        assertEquals("第一天", first.author)
        assertEquals("566.4万", first.playCount)
        assertEquals(177, first.total)
        assertEquals("kw", first.source)
        assertTrue(first.img!!.startsWith("http://img1.kwcdn.kuwo.cn/"))
        assertTrue(first.desc.contains("说好不哭"))
        // RN decodeName：&nbsp; 等实体已被解码
        assertTrue(!first.desc.contains("&nbsp;"))
    }

    @Test
    fun `build request encodes keyword and paginates like rn`() {
        val request = KwSonglistSearch.buildRequest("周杰伦", page = 2, limit = 18)
        assertTrue(request.url.contains("all=%E5%91%A8%E6%9D%B0%E4%BC%A6"))
        assertTrue(request.url.contains("pn=1"))
        assertTrue(request.url.contains("rn=18"))
        assertTrue(request.url.contains("ft=playlist"))
        assertEquals("GET", request.method)
    }

    @Test
    fun `invalid body returns null and search throws`() =
        runBlocking {
            assertNull(KwSonglistSearch.parse("not json at all", 1, 18))
            val search = KwSonglistSearch(fetch = { "<html>blocked</html>" })
            val error = runCatching { search.search("周杰伦") }.exceptionOrNull()
            assertTrue(error != null)
        }

    @Test
    fun `single quotes in json structure are converted but apostrophes kept`() {
        val converted = SonglistSearchSupport.singleQuotesToJson("{'name':'It's here','id':'1'}")
        assertEquals("{\"name\":\"It's here\",\"id\":\"1\"}", converted)
    }
}
