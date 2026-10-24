package cn.toside.music.core.songlist

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 网易云歌单 —— 真实 fixture（2026-10-25）：
 * `songlist-wy-catalogue/hottags/list/detail/song-detail.json`。
 *
 * 详情链路特殊：linuxapi 返回的 `tracks` 只有 10 条而 `trackIds` 有 97 条，
 * 因此会走 RN 的 `musicDetail` 回退（weapi v3/song/detail），两个真实响应都落盘。
 */
class WySonglistTest {
    private val catalogue = Fixtures.text("songlist-wy-catalogue.json")
    private val hottags = Fixtures.text("songlist-wy-hottags.json")
    private val list = Fixtures.text("songlist-wy-list.json")
    private val detail = Fixtures.text("songlist-wy-detail.json")
    private val songDetail = Fixtures.text("songlist-wy-song-detail.json")

    @Test
    fun `getTags maps catalogue groups and hottags`() =
        runBlocking {
            val source =
                WySonglist { request ->
                    if (request.url.endsWith("/hottags")) hottags else catalogue
                }
            val result = source.getTags()
            assertEquals(5, result.tags.size)
            assertEquals(listOf("语种", "风格", "场景", "情感", "主题"), result.tags.map { it.name })
            assertEquals(70, result.tags.sumOf { it.list.size })
            assertEquals(
                "综艺",
                result.tags
                    .last()
                    .list
                    .first()
                    .name,
            )
            assertEquals(10, result.hotTags.size)
            assertEquals("华语", result.hotTags.first().name)
        }

    @Test
    fun `getList parses weapi playlist page`() =
        runBlocking {
            val source = WySonglist { list }
            val page = source.getList("hot", null, 1)
            assertEquals(30, page.list.size)
            assertEquals(684, page.total)
            val first = page.list.first()
            assertEquals("18271967084", first.id)
            assertEquals("欧美R&B｜“顶级旋律 开口沦陷”", first.name)
            assertEquals("Buradarrr", first.author)
            assertEquals(97, first.total ?: -1)
            assertEquals("10.3万", first.playCount)
            assertTrue(first.img!!.startsWith("http://p1.music.126.net"))
        }

    @Test
    fun `linuxapi encrypt matches the response-accepted golden`() {
        val golden = Fixtures.text("songlist-linuxapi-golden.txt").trim().lines()
        val payload = golden[0]
        assertEquals(golden[1], WyLinuxapi.encrypt(payload))
    }

    @Test
    fun `getDetail falls back to song detail and maps fallthrough qualities`() =
        runBlocking {
            val urls = mutableListOf<String>()
            val source =
                WySonglist { request ->
                    urls.add(request.url)
                    if (request.url.contains("song/detail")) songDetail else detail
                }
            val result = source.getDetail("18271967084", 1)
            assertTrue(urls.first().contains("linux/forward"))
            assertTrue(urls.last().contains("song/detail"))
            assertEquals(97, result.total)
            assertEquals(97, result.list.size)
            val info = requireNotNull(result.info)
            assertEquals("欧美R&B｜“顶级旋律 开口沦陷”", info.name)
            assertEquals("Buradarrr", info.author)
            assertEquals("10.3万", info.playCount)
            val first = result.list.first()
            assertEquals("wy_19827042", (first["id"] as JsonPrimitive).content)
            assertEquals("Call You Tonight", (first["name"] as JsonPrimitive).content)
            assertEquals("Whitney Houston", (first["singer"] as JsonPrimitive).content)
            assertEquals("04:10", (first["interval"] as JsonPrimitive).content)
            val meta = first["meta"]!!.jsonObject
            val qualitys = meta["qualitys"] as JsonArray
            assertEquals(
                listOf("128k", "320k", "flac"),
                qualitys.map { ((it as JsonObject)["type"] as JsonPrimitive).content },
            )
            val qualityMap = meta["_qualitys"]!!.jsonObject
            assertEquals(
                "29.62 MiB",
                ((qualityMap["flac"] as JsonObject)["size"] as JsonPrimitive).content,
            )
            assertEquals(
                "3.82 MiB",
                ((qualityMap["128k"] as JsonObject)["size"] as JsonPrimitive).content,
            )
        }

    @Test
    fun `direct mapping branch uses playlist tracks when sizes match`() =
        runBlocking {
            // 合成 fixture：只取真实响应里的一首歌与一条 privilege，验证 trackIds==privileges 分支。
            val body =
                """
                {"code":200,"playlist":{"name":"t","playCount":1,"trackIds":[{"id":19827042}],
                  "tracks":[{"id":19827042,"name":"Call You Tonight","dt":250066,
                    "ar":[{"name":"Whitney Houston"}],"al":{"id":1,"name":"A","picUrl":"http://p"}}],
                  "creator":{"nickname":"n"}},"privileges":[{"id":19827042,"maxbr":320000,"maxBrLevel":"lossless"}]}
                """.trimIndent()
            val source = WySonglist { body }
            val result = source.getDetail("1", 1)
            assertEquals(1, result.list.size)
            val meta = result.list.first()["meta"]!!.jsonObject
            assertEquals(
                listOf("128k", "320k"),
                (meta["qualitys"] as JsonArray).map { ((it as JsonObject)["type"] as JsonPrimitive).content },
            )
        }
}
