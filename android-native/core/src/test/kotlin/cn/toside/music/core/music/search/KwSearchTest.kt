package cn.toside.music.core.music.search

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 酷我搜索黄金测试：fixture 为 2026-10-24 真实接口响应
 * （`search.kuwo.cn`，关键词「周杰伦」，rn=5）。
 */
class KwSearchTest {
    private fun fixture(): String = javaClass.getResource("/kw-search.json")!!.readText(Charsets.UTF_8)

    private fun JsonObject.str(key: String): String = (this[key] as JsonPrimitive).content

    @Test
    fun `parse live fixture into music infos`() {
        val page = KwSearch.parse(fixture(), page = 1, limit = 5)!!
        assertEquals(3292, page.total)
        assertEquals(5, page.limit)
        assertEquals("kw", page.source)
        assertEquals((3292 + 4) / 5, page.allPage)
        assertEquals(5, page.list.size)

        val first = page.list.first()
        assertEquals("kw_228908", first.str("id"))
        assertEquals("晴天", first.str("name"))
        assertEquals("周杰伦", first.str("singer"))
        assertEquals("kw", first.str("source"))
        assertEquals("04:29", first.str("interval"))

        val meta = first["meta"]!!.jsonObject
        assertEquals("228908", meta.str("songId"))
        assertEquals("叶惠美", meta.str("albumName"))
        assertEquals("1293", meta.str("albumId"))
        assertEquals(
            "http://img1.kwcdn.kuwo.cn/star/albumcover/500/s3s94/93/211513640.jpg",
            meta.str("picUrl"),
        )

        val qualitys = meta["qualitys"] as JsonArray
        assertEquals(listOf("128k", "320k", "flac"), qualitys.map { it.jsonObject.str("type") })
        assertEquals("4.12Mb", qualitys[0].jsonObject.str("size"))

        val typesMap = meta["_qualitys"]!!.jsonObject
        // RN 对 _types 的 size 做 toLocaleUpperCase
        assertEquals("52.83MB", typesMap["flac"]!!.jsonObject.str("size"))
        assertEquals("10.29MB", typesMap["320k"]!!.jsonObject.str("size"))
    }

    @Test
    fun `all fixture rows map to distinct ids`() {
        val page = KwSearch.parse(fixture(), page = 1, limit = 5)!!
        val ids = page.list.map { it.str("id") }.toSet()
        assertEquals(5, ids.size)
        val rest = page.list.drop(1).map { it.str("name") }
        assertEquals(listOf("夜曲", "枫", "青花瓷", "发如雪"), rest)
    }

    @Test
    fun `server show zero triggers retry`() {
        assertNull(
            KwSearch.parse(
                """{"TOTAL":"100","SHOW":"0","abslist":[]}""",
                page = 1,
                limit = 30,
            ),
        )
    }

    @Test
    fun `empty result returns empty page`() {
        val page = KwSearch.parse("""{"TOTAL":"0","SHOW":"0","abslist":[]}""", page = 1, limit = 30)!!
        assertTrue(page.list.isEmpty())
        assertEquals(0, page.total)
        assertEquals(0, page.allPage)
    }

    @Test
    fun `missing abslist returns empty page without retry`() {
        val page = KwSearch.parse("""{"TOTAL":"0","SHOW":"0"}""", page = 1, limit = 30)!!
        assertTrue(page.list.isEmpty())
        assertEquals(0, page.total)
        assertEquals(0, page.allPage)

        kotlinx.coroutines.runBlocking {
            var calls = 0
            val search =
                KwSearch { _ ->
                    calls++
                    """{"TOTAL":"0","SHOW":"0"}"""
                }
            val result = search.search("不存在", page = 1, limit = 30)
            assertEquals(1, calls)
            assertTrue(result.list.isEmpty())
        }
    }

    @Test
    fun `malformed abslist type still triggers retry`() {
        assertNull(KwSearch.parse("""{"TOTAL":"1","SHOW":"1","abslist":"bad"}""", page = 1, limit = 30))
        assertNull(KwSearch.parse("""{"TOTAL":"1","SHOW":"1","abslist":{}}""", page = 1, limit = 30))
    }

    @Test
    fun `missing N_MINFO retries the whole page until usable`() {
        val missingMinfo =
            """{"TOTAL":"1","SHOW":"1","abslist":[{"MUSICRID":"MUSIC_1","SONGNAME":"歌","ARTIST":"人"}]}"""
        assertNull(KwSearch.parse(missingMinfo, page = 1, limit = 30))

        kotlinx.coroutines.runBlocking {
            val bodies = ArrayDeque(listOf(missingMinfo, fixture()))
            var calls = 0
            val page =
                KwSearch { _ ->
                    calls++
                    bodies.removeFirst()
                }.search("周杰伦", page = 1, limit = 5)
            assertEquals(2, calls)
            assertEquals(5, page.list.size)
        }
    }

    @Test
    fun `missing N_MINFO fails after three attempts`() {
        val missingMinfo =
            """{"TOTAL":"1","SHOW":"1","abslist":[{"MUSICRID":"MUSIC_1","SONGNAME":"歌","ARTIST":"人"}]}"""
        var calls = 0
        val search =
            KwSearch { _ ->
                calls++
                missingMinfo
            }
        try {
            kotlinx.coroutines.runBlocking { search.search("周杰伦", page = 1, limit = 30) }
            throw AssertionError("expected retry exhaustion")
        } catch (expected: IllegalStateException) {
            assertTrue(expected.message!!.contains("3"))
        }
        assertEquals(3, calls)
    }

    @Test
    fun `search retries until a usable body arrives`() {
        kotlinx.coroutines.runBlocking {
            val bodies = ArrayDeque(listOf("""{"TOTAL":"9","SHOW":"0"}""", fixture()))
            var calls = 0
            val search =
                KwSearch { _ ->
                    calls++
                    bodies.removeFirst()
                }
            val page = search.search("周杰伦", page = 1, limit = 5)
            assertEquals(2, calls)
            assertEquals(5, page.list.size)
        }
    }

    @Test
    fun `buildRequest encodes keyword and paging as a GET`() {
        val request = KwSearch.buildRequest("a b中", page = 3, limit = 7)
        assertEquals("GET", request.method)
        assertTrue(request.url, request.url.contains("all=a%20b%E4%B8%AD"))
        assertTrue(request.url, request.url.contains("&pn=2&rn=7"))
        assertTrue(request.url, request.url.contains("rformat=json"))
        assertTrue(request.headers.isEmpty())
        assertNull(request.body)
        assertNull(request.form)
    }

    @Test
    fun `decodeEntities handles named hex and unknown`() {
        assertEquals("A & B 中 文 &unknown;", KwSearch.decodeEntities("A &amp; B &#x4E2D; &#25991; &unknown;"))
        assertEquals("plain", KwSearch.decodeEntities("plain"))
        assertEquals("x\u00A0y", KwSearch.decodeEntities("x&nbsp;y"))
    }
}
