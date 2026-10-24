package cn.toside.music.core.music.search

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** fixture: 2026-10-24 Kugou public search, keyword 周杰伦, three parents and one Grp child. */
class KgSearchTest {
    private fun fixture(): String = javaClass.getResource("/kg-search.json")!!.readText(Charsets.UTF_8)

    private fun JsonObject.str(key: String): String = (this[key] as JsonPrimitive).content

    @Test
    fun `buildRequest matches the public GET contract`() {
        val request = KgSearch.buildRequest("a b中", page = 3, limit = 7)

        assertEquals("GET", request.method)
        assertEquals(
            "https://songsearch.kugou.com/song_search_v2?keyword=a%20b%E4%B8%AD&page=3&pagesize=7" +
                "&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1",
            request.url,
        )
        assertTrue(request.headers.isEmpty())
        assertNull(request.body)
        assertNull(request.form)
    }

    @Test
    fun `parse live fixture preserves kg ids hashes language quality and paging`() {
        val page = KgSearch.parse(fixture(), page = 2, limit = 3)!!

        assertEquals(480, page.total)
        assertEquals(160, page.allPage)
        assertEquals(3, page.limit)
        assertEquals("kg", page.source)

        val first = page.list.first()
        assertEquals("666767327_B9B3A55FFB5B95F165839A26120E9FEC", first.str("id"))
        assertEquals("恒星不忘 Forever Forever", first.str("name"))
        assertEquals("周杰伦、言承旭、吴建豪、周渝民、五月天 阿信", first.str("singer"))
        assertEquals("kg", first.str("source"))
        assertEquals("04:45", first.str("interval"))

        val meta = first["meta"]!!.jsonObject
        assertEquals(666767327, (meta["songId"] as JsonPrimitive).int)
        assertEquals("B9B3A55FFB5B95F165839A26120E9FEC", meta.str("hash"))
        assertEquals("今夜让我带你高飞远走", meta.str("albumName"))
        assertEquals("212310356", meta.str("albumId"))
        assertEquals("国语", meta.str("lang"))
        assertEquals(
            "http://imge.kugou.com/stdmusic/400/20261022/20261022202632944419.jpg",
            meta.str("picUrl"),
        )

        val qualitys = meta["qualitys"] as JsonArray
        assertEquals(listOf("128k", "320k", "flac", "flac24bit"), qualitys.map { it.jsonObject.str("type") })
        assertEquals(
            listOf("4.36 MiB", "10.91 MiB", "34.21 MiB", "62.49 MiB"),
            qualitys.map { it.jsonObject.str("size") },
        )
        assertEquals("1634143DE36FDBFB0C2B4057BACC2BBA", qualitys[3].jsonObject.str("hash"))
        assertEquals(
            "3AE6698D3B88D598066F352FC93FDB4D",
            meta["_qualitys"]!!.jsonObject["flac"]!!.jsonObject.str("hash"),
        )
    }

    @Test
    fun `Grp child is skipped because RN reuses the already seen parent key`() {
        val page = KgSearch.parse(fixture(), page = 1, limit = 3)!!

        assertEquals(3, page.list.size)
        assertEquals("332453_8909E1809908CD8E3BF6CF85D98B93F0", page.list[2].str("id"))
        assertFalse(page.list.any { it.str("id").startsWith("298691834_") })
    }

    @Test
    fun `server error is retried at most three times`() {
        var calls = 0
        val search =
            KgSearch { _ ->
                calls++
                """{"error_code":1}"""
            }

        try {
            runBlocking { search.search("周杰伦", page = 1, limit = 3) }
            fail("expected retry exhaustion")
        } catch (expected: IllegalStateException) {
            assertTrue(expected.message!!.contains("3"))
        }
        assertEquals(3, calls)
    }
}
