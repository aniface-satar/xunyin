package cn.toside.music.core.music.search

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 网易云歌单搜索黄金测试：fixture 为 2026-10-26 真实响应
 * （eapi `/api/cloudsearch/pc`，type=1000，关键词「周杰伦」）。
 */
class WySonglistSearchTest {
    private fun fixture(): String = javaClass.getResource("/songlist-search-wy.json")!!.readText(Charsets.UTF_8)

    @Test
    fun `parse live fixture into songlist items`() {
        val page = WySonglistSearch.parse(fixture(), page = 1, limit = 18)!!
        assertEquals(462, page.total)
        assertEquals(18, page.list.size)

        val first = page.list.first()
        assertEquals("6792103822", first.id)
        assertEquals("周杰伦-Jay 『网易云精选』", first.name)
        assertEquals("Buradarrr", first.author)
        assertEquals("3415.3万", first.playCount)
        assertEquals(144, first.total)
        assertEquals("wy", first.source)
        assertTrue(first.img!!.contains("music.126.net"))
    }

    @Test
    fun `build request posts encrypted eapi params`() {
        val request = WySonglistSearch.buildRequest("周杰伦", page = 1, limit = 18)
        assertEquals("POST", request.method)
        assertEquals("http://interface.music.163.com/eapi/batch", request.url)
        assertEquals("https://music.163.com", request.headers["origin"])
        val params = request.form!!.getValue("params")
        assertTrue(params.length > 32)
        assertTrue(params.all { it.isDigit() || it in 'A'..'F' })
        // 相同输入可复现；换页则不同（offset/total 变化）
        assertEquals(params, WySonglistSearch.buildRequest("周杰伦", 1, 18).form!!.getValue("params"))
        assertTrue(params != WySonglistSearch.buildRequest("周杰伦", 2, 18).form!!.getValue("params"))
    }

    @Test
    fun `non 200 code or missing result returns null and search throws`() =
        runBlocking {
            assertNull(WySonglistSearch.parse("""{"code":400,"result":{}}""", 1, 18))
            assertNull(WySonglistSearch.parse("""{"code":200}""", 1, 18))
            val search = WySonglistSearch(fetch = { """{"code":400}""" })
            assertTrue(runCatching { search.search("周杰伦") }.exceptionOrNull() != null)
        }
}
