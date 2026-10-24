package cn.toside.music.core.music.leaderboard

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * MgLeaderboard 测试 —— fixture 为 2026-10-24 真机环境抓取的
 * `querycontentbyId.do?columnId=27553319`（新歌榜，50 首）真实响应。
 */
class MgLeaderboardTest {
    private fun fixture(): String =
        requireNotNull(javaClass.classLoader.getResourceAsStream("mg-leaderboard-27553319.json"))
            .use { it.readBytes().toString(Charsets.UTF_8) }

    @Test
    fun `parse real fixture maps objectInfo to rn shape`() {
        val parsed = MgLeaderboard.parse(fixture(), page = 1)
        assertNotNull(parsed)
        parsed!!
        assertEquals("mg", parsed.source)
        assertEquals(200, parsed.limit)
        assertEquals(1, parsed.page)
        assertEquals(50, parsed.total)
        assertEquals(50, parsed.list.size)

        val first = parsed.list[0]
        val songId = (first["id"] as JsonPrimitive).content.removePrefix("mg_")
        assertEquals(songId, ((first["meta"]) as JsonObject)["songId"].text())
        assertTrue((first["name"] as JsonPrimitive).content.isNotEmpty())
        // length="00:03:xx" → 尾段 mm:ss
        assertTrue(Regex("""\d\d:\d\d""").matches(first["interval"].text()))
        val meta = first["meta"] as JsonObject
        assertTrue(meta["picUrl"].text().startsWith("http"))
        assertEquals(
            listOf("128k", "320k", "flac", "flac24bit"),
            (meta["qualitys"] as JsonArray).map { ((it as JsonObject)["type"] as JsonPrimitive).content },
        )
        assertNotNull(meta["lrcUrl"].text())
    }

    @Test
    fun `zq size falls back to androidSize like rn`() {
        // 真实榜内靠后曲目含 ZQ（无 size、有 androidSize）
        val parsed = MgLeaderboard.parse(fixture(), page = 1)!!
        val withZq =
            parsed.list.first { item ->
                ((item["meta"] as JsonObject)["qualitys"] as JsonArray)
                    .any { ((it as JsonObject)["type"] as JsonPrimitive).content == "flac24bit" }
            }
        val qualitys = (withZq["meta"] as JsonObject)["qualitys"] as JsonArray
        val zq = qualitys.first { ((it as JsonObject)["type"] as JsonPrimitive).content == "flac24bit" } as JsonObject
        assertTrue((zq["size"] as JsonPrimitive).content.endsWith("MiB"))
        assertEquals(
            listOf("128k", "320k", "flac", "flac24bit"),
            qualitys.map { ((it as JsonObject)["type"] as JsonPrimitive).content },
        )
    }

    @Test
    fun `code gate and broken shapes return null`() {
        assertNull(MgLeaderboard.parse("""{"code":"000001"}""", 1))
        assertNull(MgLeaderboard.parse("""{"code":"000000"}""", 1))
        assertNull(MgLeaderboard.parse("""{"code":"000000","columnInfo":{"contents":3}}""", 1))
        assertNull(MgLeaderboard.parse("not json", 1))
    }

    @Test
    fun `dedupes by songId and tolerates missing fields`() {
        val body =
            """
            {
              "code": "000000",
              "columnInfo": {
                "contents": [
                  {
                    "objectInfo": {
                      "songId": "A", "songName": "甲", "length": "00:03:20",
                      "artists": [{ "name": "一" }, { "name": "二" }],
                      "newRateFormats": [
                        { "formatType": "PQ", "size": "1024" },
                        { "formatType": "ZZ", "size": "1" }
                      ],
                      "albumImgs": [{ "img": "http://img/a.jpg" }],
                      "albumId": 1,
                      "copyrightId": "CA"
                    }
                  },
                  { "objectInfo": { "songId": "A", "songName": "重复" } },
                  { "objectInfo": { "songId": "", "songName": "无id" } },
                  { "objectInfo": { "songId": "B", "songName": "乙", "albumImgs": [] } }
                ]
              }
            }
            """.trimIndent()
        val parsed = MgLeaderboard.parse(body, 1)!!
        assertEquals(2, parsed.total)
        val b = parsed.list[1]
        assertEquals("mg_B", b["id"].text())
        // length 缺失 → interval JsonNull（RN null）
        assertTrue(b["interval"] is kotlinx.serialization.json.JsonNull)
        assertTrue((b["meta"] as JsonObject)["picUrl"] is kotlinx.serialization.json.JsonNull)
        assertTrue(((b["meta"] as JsonObject)["qualitys"] as JsonArray).isEmpty())
        // 未知 formatType 跳过
        assertEquals(
            listOf("128k"),
            ((parsed.list[0]["meta"] as JsonObject)["qualitys"] as JsonArray)
                .map { ((it as JsonObject)["type"] as JsonPrimitive).content },
        )
        assertEquals("一、二", parsed.list[0]["singer"].text())
        assertEquals("03:20", parsed.list[0]["interval"].text())
    }

    @Test
    fun `getList retries failures up to rn cap of three`() {
        var calls = 0
        val lb =
            MgLeaderboard {
                calls++
                if (calls == 1) {
                    """{"code":"000001"}"""
                } else {
                    """{"code":"000000","columnInfo":{"contents":[{"objectInfo":{"songId":"X","songName":"x","length":"00:01:00"}}]}}"""
                }
            }
        val result = runBlocking { lb.getList("27553319", 1) }
        assertEquals(2, calls)
        assertEquals(1, result.total)

        var always = 0
        val failing =
            MgLeaderboard {
                always++
                """{"code":"000001"}"""
            }
        assertNotNull(runBlocking { runCatching { failing.getList("1", 1) }.exceptionOrNull() })
        assertEquals(3, always)
    }

    @Test
    fun `build url matches rn getUrl`() {
        assertEquals(
            "https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/querycontentbyId.do?columnId=27186466&needAll=0",
            MgLeaderboard.buildUrl("27186466"),
        )
    }

    private fun kotlinx.serialization.json.JsonElement?.text(): String =
        when (this) {
            null, is kotlinx.serialization.json.JsonNull -> ""
            is JsonPrimitive -> content
            else -> ""
        }
}
