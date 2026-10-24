package cn.toside.music.core.music.search

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** fixture: 2026-10-24 QQ Music public search, keyword 周杰伦, three rows. */
class TxSearchTest {
    private fun fixture(): String = javaClass.getResource("/tx-search.json")!!.readText(Charsets.UTF_8)

    private fun JsonObject.str(key: String): String = (this[key] as JsonPrimitive).content

    @Test
    fun `buildRequest uses deterministic zzc signature and exact RPC body`() {
        val request = TxSearch.buildRequest("周杰伦", page = 1, limit = 3, searchId = SEARCH_ID)

        assertEquals("POST", request.method)
        assertEquals(
            "https://u.y.qq.com/cgi-bin/musics.fcg?sign=zzca2c003c1idkvt0jptykccxulqbwo2fpm0fe0c9e9",
            request.url,
        )
        assertEquals("QQMusic 14090508(android 12)", request.headers["User-Agent"])
        assertEquals("application/json", request.headers["Content-Type"])
        assertNull(request.form)

        val body = Json.parseToJsonElement(request.body!!).jsonObject
        assertEquals("0", body["comm"]!!.jsonObject.str("uin"))
        val rpc = body["music.search.SearchCgiService"]!!.jsonObject
        assertEquals("DoSearchForQQMusicDesktop", rpc.str("method"))
        val param = rpc["param"]!!.jsonObject
        assertEquals(SEARCH_ID, param.str("searchid"))
        assertEquals(1, (param["grp"] as JsonPrimitive).int)
        assertEquals(3, (param["num_per_page"] as JsonPrimitive).int)
        assertEquals(1, (param["page_num"] as JsonPrimitive).int)
        assertEquals("周杰伦", param.str("query"))
    }

    @Test
    fun `parse live fixture preserves tx identity metadata quality and paging`() {
        val page = TxSearch.parse(fixture(), page = 2, limit = 3)!!

        assertEquals(999, page.total)
        assertEquals(333, page.allPage)
        assertEquals(3, page.limit)
        assertEquals("tx", page.source)
        assertEquals(3, page.list.size)

        val first = page.list.first()
        assertEquals("tx_0039MnYb0qxYhV", first.str("id"))
        assertEquals("晴天", first.str("name"))
        assertEquals("周杰伦", first.str("singer"))
        assertEquals("tx", first.str("source"))
        assertEquals("04:29", first.str("interval"))

        val meta = first["meta"]!!.jsonObject
        assertEquals("0039MnYb0qxYhV", meta.str("songId"))
        assertEquals("叶惠美", meta.str("albumName"))
        assertEquals("000MkMni19ClKG", meta.str("albumId"))
        assertEquals("000MkMni19ClKG", meta.str("albumMid"))
        assertEquals("003Qui1q2u1Zho", meta.str("strMediaMid"))
        assertEquals(97773, (meta["id"] as JsonPrimitive).int)
        assertEquals(
            "https://y.gtimg.cn/music/photo_new/T002R500x500M000000MkMni19ClKG.jpg",
            meta.str("picUrl"),
        )

        val qualitys = meta["qualitys"] as JsonArray
        assertEquals(listOf("128k", "320k", "flac"), qualitys.map { it.jsonObject.str("type") })
        assertEquals(listOf("4.12 MiB", "10.29 MiB", "52.83 MiB"), qualitys.map { it.jsonObject.str("size") })
        assertEquals("52.83 MiB", meta["_qualitys"]!!.jsonObject["flac"]!!.jsonObject.str("size"))
    }

    @Test
    fun `missing song list returns empty page without retry`() {
        val body =
            """{"code":0,"music.search.SearchCgiService":{"code":0,"data":{"body":{"song":{}},"meta":{"sum":0}}}}"""
        val page = TxSearch.parse(body, page = 1, limit = 3)!!
        assertTrue(page.list.isEmpty())
        assertEquals(0, page.total)
        assertEquals(0, page.allPage)

        var calls = 0
        val search =
            TxSearch(
                fetch = { _ ->
                    calls++
                    body
                },
                searchId = { SEARCH_ID },
            )
        runBlocking { search.search("不存在", page = 1, limit = 3) }
        assertEquals(1, calls)
    }

    @Test
    fun `invalid RPC response is retried at most six times`() {
        var calls = 0
        val search =
            TxSearch(
                fetch = { _ ->
                    calls++
                    """{"code":1}"""
                },
                searchId = { SEARCH_ID },
            )

        try {
            runBlocking { search.search("周杰伦", page = 1, limit = 3) }
            fail("expected retry exhaustion")
        } catch (expected: IllegalStateException) {
            assertTrue(expected.message!!.contains("6"))
        }
        assertEquals(6, calls)
    }

    private companion object {
        const val SEARCH_ID = "0123456789ABCDEF0123456789ABCDEF00001"
    }
}
