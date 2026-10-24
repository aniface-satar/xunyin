package cn.toside.music.core.music.leaderboard

import cn.toside.music.core.music.search.SearchRequest
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * WyLeaderboard 测试 —— fixture 为合成档：本机直连 `weapi/v3/playlist/detail`
 * 持续返回 200 空体（见 lane 报告「语义修正」），结构字段按 RN
 * `musicDetail.filterList` 消费的集合构造（含 pc 后备曲与 hires/320k/128k 三档）。
 */
class WyLeaderboardTest {
    private fun resource(name: String): String =
        requireNotNull(javaClass.classLoader.getResourceAsStream(name))
            .use { it.readBytes().toString(Charsets.UTF_8) }

    private val playlistJson = lazy { resource("wy-playlist-detail.json") }
    private val songDetailJson = lazy { resource("wy-song-detail.json") }

    private fun twoStageLb(
        vararg failures: Int,
        captured: MutableList<SearchRequest> = mutableListOf(),
    ): Pair<WyLeaderboard, () -> Int> {
        var calls = 0
        val lb =
            WyLeaderboard { request ->
                captured.add(request)
                calls++
                if (calls in failures) throw java.io.IOException("stub network $calls")
                if (request.url.endsWith("playlist/detail")) playlistJson.value else songDetailJson.value
            }
        return lb to { calls }
    }

    @Test
    fun `two-stage chain maps songs with privileges`() {
        val captured = mutableListOf<SearchRequest>()
        val (lb, _) = twoStageLb(captured = captured)
        val result = runBlocking { lb.getList("3778678", 1) }
        assertEquals("wy", result.source)
        assertEquals(3, result.total)
        assertEquals(3, result.list.size)
        assertEquals(100_000, result.limit)
        assertEquals(1, result.page)

        val first = result.list[0]
        assertEquals("wy_3000002", first["id"].text())
        assertEquals("晴天", first["name"].text())
        assertEquals("周杰伦", first["singer"].text())
        assertEquals("04:06", first["interval"].text())
        val meta = first["meta"] as JsonObject
        assertEquals("叶惠美", meta["albumName"].text())
        assertEquals("http://p1.music.126.net/pic1/9001.jpg", meta["picUrl"].text())
        // hires + 999000 → reverse 后高音质在前
        assertEquals(
            listOf("128k", "320k", "flac", "flac24bit"),
            (meta["qualitys"] as JsonArray).map { ((it as JsonObject)["type"] as JsonPrimitive).content },
        )

        // pc 后备曲：name/singer 取 pc.sn / pc.ar
        val pcSong = result.list[2]
        assertEquals("wy_3000004", pcSong["id"].text())
        assertEquals("老歌新唱", pcSong["name"].text())
        assertEquals("某人", pcSong["singer"].text())
        assertEquals("旧盒", (pcSong["meta"] as JsonObject)["albumName"].text())
    }

    @Test
    fun `request shapes match rn playlist detail and song detail`() {
        val captured = mutableListOf<SearchRequest>()
        val (lb, _) = twoStageLb(captured = captured)
        runBlocking { lb.getList("3778678", 1) }
        assertEquals(2, captured.size)
        val detail = captured[0]
        assertEquals("POST", detail.method)
        assertEquals("https://music.163.com/weapi/v3/playlist/detail", detail.url)
        assertNotNull(detail.form)
        assertTrue(detail.form!!.containsKey("params"))
        assertTrue(detail.form!!.containsKey("encSecKey"))
        val song = captured[1]
        assertEquals("https://music.163.com/weapi/v3/song/detail", song.url)
        assertEquals("https://music.163.com", song.headers["origin"])
        assertEquals(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36",
            song.headers["User-Agent"],
        )
    }

    @Test
    fun `empty trackIds is a legal empty board without detail call`() {
        var calls = 0
        val lb =
            WyLeaderboard {
                calls++
                """{"code":200,"playlist":{"trackIds":[]}}"""
            }
        val result = runBlocking { lb.getList("1", 1) }
        assertEquals(0, result.total)
        assertTrue(result.list.isEmpty())
        assertEquals(1, calls)
    }

    @Test
    fun `non-200 playlist detail retries then fails at cap`() {
        var calls = 0
        val lb =
            WyLeaderboard {
                calls++
                """{"code":502}"""
            }
        assertNotNull(runBlocking { runCatching { lb.getList("1", 1) }.exceptionOrNull() })
        assertEquals(6, calls)
    }

    @Test
    fun `transport failure on playlist retries within outer cap`() {
        val (lb, calls) = twoStageLb(failures = intArrayOf(1))
        val result = runBlocking { lb.getList("3778678", 1) }
        assertEquals(3, result.total)
        assertEquals(3, calls()) // 1 失败 + 2（playlist+detail）成功
    }

    @Test
    fun `song detail retry cap throws to outer loop`() {
        var calls = 0
        val lb =
            WyLeaderboard {
                calls++
                if (it.url.endsWith("playlist/detail")) playlistJson.value else """{"code":500}"""
            }
        assertNotNull(runBlocking { runCatching { lb.getList("3778678", 1) }.exceptionOrNull() })
        // 外层 6 轮：每轮 1 playlist + 3 detail = 4 → 但 detail 第 3 次即抛，
        // 第 6 轮抛错前同样结构 → 总调用 6*(1+3)=24
        assertEquals(24, calls)
    }

    @Test
    fun `parseSongList tolerates missing privileges and null sizes`() {
        val root =
            """
            {"code":200,
             "songs":[{"id":7,"name":"曲","dt":60000,"al":{"id":1,"name":"专"}},
                      {"id":8,"name":"缺priv","dt":61000,"al":{"id":2,"name":"专2"}},
                      {"id":9,"name":"无音质","dt":0,"ar":[{"name":"甲"},{"name":"乙"}],
                       "al":{"id":3,"name":"专3"}}],
             "privileges":[{"id":7,"maxBrLevel":"none","maxbr":128000},
                           {"id":9,"maxBrLevel":"none","maxbr":999000}]}
            """.trimIndent()
        val list = WyLeaderboard.parseSongList(json.parseToJsonElement(root).jsonObject)
        assertEquals(2, list.size)
        assertEquals("wy_7", list[0]["id"].text())
        assertEquals("01:00", list[0]["interval"].text())
        assertEquals(
            listOf("128k"),
            ((list[0]["meta"] as JsonObject)["qualitys"] as JsonArray)
                .map { ((it as JsonObject)["type"] as JsonPrimitive).content },
        )
        // maxbr=999000 但 sq/h/l 缺失 → size 为 null 的条目保留（RN types.push({size:null})）
        val third = list[1]
        assertEquals("wy_9", third["id"].text())
        assertEquals("甲、乙", third["singer"].text())
        assertEquals("--/--", third["interval"].text())
        val qualities = (third["meta"] as JsonObject)["qualitys"] as JsonArray
        assertEquals(3, qualities.size)
        assertTrue(qualities.all { ((it as JsonObject)["size"]) is kotlinx.serialization.json.JsonNull })
    }

    private fun kotlinx.serialization.json.JsonElement?.text(): String =
        when (this) {
            null, is kotlinx.serialization.json.JsonNull -> ""
            is JsonPrimitive -> content
            else -> ""
        }

    private companion object {
        val json = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }
    }
}
