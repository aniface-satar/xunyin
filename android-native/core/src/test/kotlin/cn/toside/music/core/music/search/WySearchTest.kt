package cn.toside.music.core.music.search

import kotlinx.coroutines.runBlocking
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

/** fixture: 2026-10-24 Netease public eapi search, keyword 周杰伦, three rows. */
class WySearchTest {
    private fun fixture(): String = javaClass.getResource("/wy-search.json")!!.readText(Charsets.UTF_8)

    private fun JsonObject.str(key: String): String = (this[key] as JsonPrimitive).content

    @Test
    fun `buildRequest matches independent MD5 and padded AES eapi golden value`() {
        val request = WySearch.buildRequest("周杰伦", page = 1, limit = 3)

        assertEquals("http://interface.music.163.com/eapi/batch", request.url)
        assertEquals("POST", request.method)
        assertEquals(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36",
            request.headers["User-Agent"],
        )
        assertEquals("https://music.163.com", request.headers["origin"])
        assertEquals("application/x-www-form-urlencoded", request.headers["Content-Type"])
        assertNull(request.body)
        assertEquals(mapOf("params" to EAPI_PARAMS), request.form)
    }

    @Test
    fun `parse live fixture preserves wy metadata fall through quality and default limit paging`() {
        val page = WySearch.parse(fixture(), page = 2, limit = 3)!!

        assertEquals(273, page.total)
        assertEquals(10, page.allPage)
        assertEquals(30, page.limit)
        assertEquals("wy", page.source)
        assertEquals(3, page.list.size)

        val first = page.list.first()
        assertEquals("wy_509781655", first.str("id"))
        assertEquals("想你就写信 (Live)", first.str("name"))
        assertEquals("周杰伦、李硕、张鑫", first.str("singer"))
        assertEquals("wy", first.str("source"))
        assertEquals("03:58", first.str("interval"))

        val meta = first["meta"]!!.jsonObject
        assertEquals(509781655, (meta["songId"] as JsonPrimitive).int)
        assertEquals("中国新歌声第二季 第13期", meta.str("albumName"))
        assertEquals(36412633, (meta["albumId"] as JsonPrimitive).int)
        assertEquals(
            "http://p2.music.126.net/yD9vbpuILH-tqNRIaP640g==/109951163038292176.jpg",
            meta.str("picUrl"),
        )

        val qualitys = meta["qualitys"] as JsonArray
        assertEquals(listOf("128k", "320k", "flac"), qualitys.map { it.jsonObject.str("type") })
        assertEquals(listOf("3.64 MiB", "9.11 MiB", "26.13 MiB"), qualitys.map { it.jsonObject.str("size") })
        assertEquals("26.13 MiB", meta["_qualitys"]!!.jsonObject["flac"]!!.jsonObject.str("size"))
    }

    @Test
    fun `non 200 response is retried at most three times`() {
        var calls = 0
        val search =
            WySearch { _ ->
                calls++
                """{"code":500}"""
            }

        try {
            runBlocking { search.search("周杰伦", page = 1, limit = 3) }
            fail("expected retry exhaustion")
        } catch (expected: IllegalStateException) {
            assertTrue(expected.message!!.contains("3"))
        }
        assertEquals(3, calls)
    }

    private companion object {
        const val EAPI_PARAMS =
            "74A595527B7A1647174ADDB4F261E92F180F42F921F98E9D338C60DB20AF499C" +
                "EA90E95FB2FDA117A0B5D8175C2F21E5C36449C9001E1313F7DB1857F58630A9" +
                "19DAF108921554FF2E37CCDABD64DFF067C74B52CA83B70A99D95E6041014BEB" +
                "8681560ACD4C3031D80CC455804122F1F7EF25FFE170B5C832E020AEB68C0E97" +
                "1753443212D2E000125C49933ACE78BD92164D2B19D74A1709C6158B6A41EDB38" +
                "40F1EF3BB56EF9B8B58A936805985CBD26C79900472F7487EC8A05CB16A203E5" +
                "FD968187C4C2F49447D9B712A0EE643"
    }
}
