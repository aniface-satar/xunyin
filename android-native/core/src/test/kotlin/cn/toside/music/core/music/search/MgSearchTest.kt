package cn.toside.music.core.music.search

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** fixture: 2026-10-24 Migu public v3 search, keyword 周杰伦, pageSize three. */
class MgSearchTest {
    private fun fixture(): String = javaClass.getResource("/mg-search.json")!!.readText(Charsets.UTF_8)

    private fun JsonObject.str(key: String): String = (this[key] as JsonPrimitive).content

    @Test
    fun `buildRequest uses golden signature and exact headers`() {
        val request = MgSearch.buildRequest("周杰伦", page = 1, limit = 3, time = "1700000000123")

        assertEquals("GET", request.method)
        assertEquals(
            "https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1" +
                "&searchSwitch=%7B%22song%22%3A1%2C%22album%22%3A0%2C%22singer%22%3A0%2C%22tagSong%22%3A1" +
                "%2C%22mvSong%22%3A0%2C%22bestShow%22%3A1%2C%22songlist%22%3A0%2C%22lyricSong%22%3A0%7D" +
                "&pageSize=3&text=%E5%91%A8%E6%9D%B0%E4%BC%A6&pageNo=1&sort=0&sid=USS",
            request.url,
        )
        assertEquals("A_music_3.6.1", request.headers["uiVersion"])
        assertEquals("963B7AA0D21511ED807EE5846EC87D20", request.headers["deviceId"])
        assertEquals("1700000000123", request.headers["timestamp"])
        assertEquals("9b22f2b3be628e5ae9cae2eaedca6b9c", request.headers["sign"])
        assertEquals("0146921", request.headers["channel"])
        assertEquals(
            "Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) " +
                "AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30",
            request.headers["User-Agent"],
        )
        assertNull(request.body)
        assertNull(request.form)
    }

    @Test
    fun `parse live fixture preserves mg ids lyric urls relative image formats and paging`() {
        val page = MgSearch.parse(fixture(), page = 2, limit = 3)!!

        assertEquals(149, page.total)
        assertEquals(50, page.allPage)
        assertEquals(3, page.limit)
        assertEquals("mg", page.source)
        assertEquals(4, page.list.size)

        val first = page.list.first()
        assertEquals("mg_1140505222", first.str("id"))
        assertEquals("圣诞星（feat. 杨瑞代）", first.str("name"))
        assertEquals("周杰伦", first.str("singer"))
        assertEquals("mg", first.str("source"))
        assertEquals("03:02", first.str("interval"))

        val meta = first["meta"]!!.jsonObject
        assertEquals("1140505222", meta.str("songId"))
        assertEquals("60054704965", meta.str("copyrightId"))
        assertEquals("圣诞星", meta.str("albumName"))
        assertEquals("1140505221", meta.str("albumId"))
        assertEquals(
            "http://d.musicapp.migu.cn/data/oss/resource/00/5u/7q/959ba4e19cf64d488f1f623f95892bf2.webp",
            meta.str("picUrl"),
        )
        assertEquals(
            "https://d.musicapp.migu.cn/data/oss/resource/00/2t/1l/38a861e9806641448f8cab425b1f2b18",
            meta.str("lrcUrl"),
        )
        assertEquals(JsonNull, meta["mrcUrl"])
        assertEquals(JsonNull, meta["trcUrl"])

        val qualitys = meta["qualitys"] as JsonArray
        assertEquals(listOf("128k", "320k", "flac", "flac24bit"), qualitys.map { it.jsonObject.str("type") })
        assertEquals(
            listOf("2.79 MiB", "6.97 MiB", "18.93 MiB", "35.34 MiB"),
            qualitys.map { it.jsonObject.str("size") },
        )
        assertEquals("18.93 MiB", meta["_qualitys"]!!.jsonObject["flac"]!!.jsonObject.str("size"))
    }

    @Test
    fun `successful response without song data returns RN empty page`() {
        val page = MgSearch.parse("""{"code":"000000"}""", page = 1, limit = 20)!!

        assertTrue(page.list.isEmpty())
        assertEquals(0, page.total)
        assertEquals(0, page.allPage)
        assertEquals(20, page.limit)
    }

    @Test
    fun `server error is not retried by RN search`() {
        var calls = 0
        val search =
            MgSearch(
                fetch = { _ ->
                    calls++
                    """{"code":"100000","info":"failed"}"""
                },
                clock = { "1700000000123" },
            )

        try {
            runBlocking { search.search("周杰伦", page = 1, limit = 3) }
            fail("expected server error")
        } catch (expected: IllegalStateException) {
            assertTrue(expected.message!!.contains("mg"))
        }
        assertEquals(1, calls)
    }
}
