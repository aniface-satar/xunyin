package cn.toside.music.core.music.leaderboard

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** KgLeaderboard 测试：errcode 门禁、字段映射（hash 音质）、重试上限。 */
class KgLeaderboardTest {
    @Test
    fun `parse maps rank songs with quality hashes`() {
        val body =
            """
            {"errcode":0,"data":{"total":2,"info":[
              {"songname":"晴天","remark":"叶惠美","album_id":"1","audio_id":"60000",
               "duration":269,"hash":"ABC123","filesize":4294967,"320filesize":10485760,
               "320hash":"H320","sqfilesize":55364813,"sqhash":"HSQ","filesize_high":0,"hash_high":"",
               "authors":[{"author_name":"周杰伦"}]},
              {"songname":"七里香","remark":"七里香","album_id":"2","audio_id":"60001",
               "duration":270,"hash":"DEF456","filesize":4194304,"320filesize":0,
               "320hash":"","sqfilesize":0,"sqhash":"","filesize_high":117440512,"hash_high":"HHI",
               "authors":[]}
            ]}}
            """.trimIndent()

        val parsed = KgLeaderboard.parse(body, page = 1)!!

        assertEquals("kg", parsed.source)
        assertEquals(2, parsed.total)
        assertEquals(100, parsed.limit)

        val first = parsed.list[0]
        assertEquals("60000_ABC123", (first["id"] as JsonPrimitive).content)
        assertEquals("晴天", (first["name"] as JsonPrimitive).content)
        assertEquals("周杰伦", (first["singer"] as JsonPrimitive).content)
        assertEquals("04:29", (first["interval"] as JsonPrimitive).content)
        val meta = first["meta"] as JsonObject
        assertEquals("ABC123", (meta["hash"] as JsonPrimitive).content)
        val qualitys = meta["qualitys"] as JsonArray
        assertEquals(
            listOf("128k", "320k", "flac"),
            qualitys.map { ((it as JsonObject)["type"] as JsonPrimitive).content },
        )
        assertEquals("HSQ", (((qualitys[2] as JsonObject)["hash"]) as JsonPrimitive).content)

        val second = parsed.list[1]
        val secondMeta = second["meta"] as JsonObject
        val secondQualitys = secondMeta["qualitys"] as JsonArray
        // 320filesize=0 → 320k 缺；filesize_high>0 → flac24bit 带 hash_high
        assertEquals(
            listOf("128k", "flac24bit"),
            secondQualitys.map { ((it as JsonObject)["type"] as JsonPrimitive).content },
        )
        assertEquals("HHI", (((secondQualitys[1] as JsonObject)["hash"]) as JsonPrimitive).content)
    }

    @Test
    fun `parse returns null on nonzero errcode`() {
        assertNull(KgLeaderboard.parse("""{"errcode":1}""", page = 1))
        assertNull(KgLeaderboard.parse("not json", page = 1))
    }

    @Test
    fun `buildUrl embeds bangid page and pagesize`() {
        val url = KgLeaderboard.buildUrl("8888", 2)
        assertTrue(url.contains("rankid=8888"))
        assertTrue(url.contains("page=2"))
        assertTrue(url.contains("pagesize=100"))
    }

    @Test
    fun `getList retries on failure up to max attempts`() =
        runBlocking {
            var calls = 0
            val leaderboard =
                KgLeaderboard(
                    fetch = { _ ->
                        calls++
                        """{"errcode":1}"""
                    },
                )
            var error: Exception? = null
            try {
                leaderboard.getList("8888", 1)
            } catch (e: Exception) {
                error = e
            }
            assertEquals(3, calls)
            assertTrue(error is IllegalStateException)
        }
}
