package cn.toside.music.core.music.leaderboard

import cn.toside.music.core.music.search.SearchRequest
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
 * TxLeaderboard 测试 —— fixture 为 2026-10-24 真机环境抓取的音乐云 `musicu.fcg`
 * GetDetail(topid=26, period=2026-10-24) 真实响应（songInfoList 裁剪到 35 首）。
 */
class TxLeaderboardTest {
    private fun fixture(): String =
        requireNotNull(javaClass.classLoader.getResourceAsStream("tx-leaderboard-26.json"))
            .use { it.readBytes().toString(Charsets.UTF_8) }

    @Test
    fun `parse real fixture maps songs to RN shape`() {
        val parsed = TxLeaderboard.parse(fixture())
        assertNotNull(parsed)
        parsed!!
        assertEquals("tx", parsed.source)
        assertEquals(300, parsed.limit)
        assertEquals(1, parsed.page)
        assertEquals(35, parsed.total)
        assertEquals(35, parsed.list.size)

        val first = parsed.list[0]
        assertTrue((first["id"] as JsonPrimitive).content.startsWith("tx_"))
        assertTrue((first["name"] as JsonPrimitive).content.isNotEmpty())
        val meta = first["meta"] as JsonObject
        assertEquals("tx", first["source"].text())
        assertEquals(first["id"].text().removePrefix("tx_"), meta["songId"].text())
        assertTrue(meta["picUrl"].text().startsWith("https://y.gtimg.cn/music/photo_new/"))
        // interval 为 mm:ss 或 --/--
        val interval = first["interval"].text()
        assertTrue(interval == "--/--" || Regex("""\d\d:\d\d""").matches(interval))
        // 音质表按 128k/320k/flac/flac24bit 顺序、size 为格式化字符串
        val types =
            (meta["qualitys"] as JsonArray).map { ((it as JsonObject)["type"] as JsonPrimitive).content }
        val allowed = setOf("128k", "320k", "flac", "flac24bit")
        assertTrue(types.all { it in allowed })
        assertEquals(types.sortedBy { allowed.indexOf(it) }, types)
        val map = meta["_qualitys"] as JsonObject
        assertEquals(types.toSet(), map.keys.toSet())
        types.forEach { type ->
            val entry = map[type] as JsonObject
            val arrayEntry =
                (meta["qualitys"] as JsonArray).first { ((it as JsonObject)["type"] as JsonPrimitive).content == type } as JsonObject
            assertEquals(arrayEntry["size"].text(), entry["size"].text())
        }
    }

    @Test
    fun `parse rejects non-zero code and broken shapes`() {
        assertNull(TxLeaderboard.parse("""{"code":404}"""))
        assertNull(TxLeaderboard.parse("""{"code":0}"""))
        assertNull(TxLeaderboard.parse("""{"code":0,"toplist":{"code":2000}}"""))
        assertNull(TxLeaderboard.parse("""{"code":0,"toplist":{"data":{"songInfoList":3}}}"""))
        assertNull(TxLeaderboard.parse("not json"))
    }

    @Test
    fun `toMusicInfo skips items without mid or file`() {
        val body =
            """
            {
              "code": 0,
              "toplist": {
                "data": {
                  "songInfoList": [
                    { "mid": "", "title": "无mid", "file": {}, "album": { "mid": "a", "name": "专" } },
                    { "mid": "M1", "title": "缺file", "album": { "mid": "a", "name": "专" } },
                    {
                      "mid": "M2", "title": "正常", "interval": 200,
                      "file": { "media_mid": "F2", "size_128mp3": 1024 },
                      "album": { "mid": "AM", "name": "专名" },
                      "singer": [{ "mid": "SM", "name": "某人" }],
                      "id": 9
                    }
                  ]
                }
              }
            }
            """.trimIndent()
        val parsed = TxLeaderboard.parse(body)!!
        assertEquals(3, parsed.total)
        assertEquals(1, parsed.list.size)
        val item = parsed.list[0]
        assertEquals("tx_M2", item["id"].text())
        assertEquals((item["meta"] as JsonObject)["albumMid"].text(), "AM")
    }

    @Test
    fun `empty album name falls back to singer image`() {
        val body =
            """
            {"code":0,"toplist":{"data":{"songInfoList":[
              {"mid":"M1","title":"t","interval":61,
               "file":{"media_mid":"F","size_128mp3":2048},
               "album":{"mid":"","name":""},"singer":[{"mid":"SMID","name":"歌手"}],"id":1}]}}}
            """.trimIndent()
        val parsed = TxLeaderboard.parse(body)!!
        val meta = parsed.list[0]["meta"] as JsonObject
        assertEquals("https://y.gtimg.cn/music/photo_new/T001R500x500M000SMID.jpg", meta["picUrl"].text())
        assertEquals("01:01", parsed.list[0]["interval"].text())
        assertEquals("2.00 KiB", ((meta["qualitys"] as JsonArray)[0] as JsonObject)["size"].text())
    }

    @Test
    fun `getList fetches period from html then posts numeric topid`() {
        val seen = mutableListOf<SearchRequest>()
        val html =
            """<i class="play_cover__btn c_tx_link js_icon_play" data-listkey="Toplist/Index/top26" """ +
                """data-listname="热歌榜" data-tid="top/26" data-date="2026-10-24" >x</i>"""
        val lb =
            TxLeaderboard { request ->
                seen.add(request)
                if (request.url == "https://c.y.qq.com/node/pc/wk_v15/top.html") html else fixture()
            }
        val result = runBlocking { lb.getList("26", 1) }
        assertEquals(35, result.list.size)
        // 第一次抓 HTML（GET，无 body），第二次 POST 明细
        assertEquals(2, seen.size)
        assertNull(seen[0].body)
        assertEquals("GET", seen[0].method)
        val post = seen[1]
        assertEquals("POST", post.method)
        assertEquals("https://u.y.qq.com/cgi-bin/musicu.fcg", post.url)
        assertEquals("application/json", post.headers["Content-Type"])
        val body = post.body.orEmpty()
        assertTrue(body.contains(""""topid":26"""))
        assertTrue(body.contains(""""period":"2026-10-24""""))
        assertTrue(body.contains(""""num":300"""))
    }

    @Test
    fun `getList retries non-zero code and stops at cap`() {
        var calls = 0
        val lb =
            TxLeaderboard {
                calls++
                if (it.url.endsWith("top.html")) {
                    """<i class="a" data-listname="热歌榜" data-tid="top/26" data-date="2026-10-24" >x</i>"""
                } else {
                    """{"code":800}"""
                }
            }
        val error = runBlocking { runCatching { lb.getList("26", 1) }.exceptionOrNull() }
        assertNotNull(error)
        // 1 次 HTML + 3 次明细（MAX_ATTEMPTS=3）
        assertEquals(4, calls)
    }

    @Test
    fun `period not found rejects`() {
        val lb =
            TxLeaderboard {
                """<i class="a" data-listname="飙升榜" data-tid="top/62" data-date="2026-10-24" >x</i>"""
            }
        assertNotNull(runBlocking { runCatching { lb.getList("26", 1) }.exceptionOrNull() })
    }

    private fun kotlinx.serialization.json.JsonElement?.text(): String =
        when (this) {
            null, is kotlinx.serialization.json.JsonNull -> ""
            is JsonPrimitive -> content
            else -> ""
        }
}
