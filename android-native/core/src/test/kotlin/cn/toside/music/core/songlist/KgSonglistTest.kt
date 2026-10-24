package cn.toside.music.core.songlist

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 酷狗歌单 —— 真实 fixture（2026-10-25）：
 * `songlist-kg-tags/list.json`、`songlist-kg-detail.html`（`global.data` 30 首）、
 * `songlist-kg-gateway.json`（按 hash 批量换详情后的响应）。
 *
 * 推荐位（`guess_special_recommend`）只做形状验证，用空列表合成响应；
 * 其余字段均来自线上落盘。
 */
class KgSonglistTest {
    private val tags = Fixtures.text("songlist-kg-tags.json")
    private val list = Fixtures.text("songlist-kg-list.json")
    private val html = Fixtures.text("songlist-kg-detail.html")
    private val gateway = Fixtures.text("songlist-kg-gateway.json")
    private val recommend = """{"status":1,"data":{"special_list":[]}}"""

    @Test
    fun `getTags parses hot tags and groups`() =
        runBlocking {
            val source = KgSonglist(fetch = { tags })
            val result = source.getTags()
            assertEquals(14, result.hotTags.size)
            assertEquals("12", result.hotTags.first().id)
            assertEquals("经典", result.hotTags.first().name)
            assertEquals(6, result.tags.size)
            assertEquals("主题", result.tags.first().name)
            assertEquals(
                "1084",
                result.tags
                    .first()
                    .list
                    .first()
                    .id,
            )
            assertEquals(
                "精选",
                result.tags
                    .first()
                    .list
                    .first()
                    .name,
            )
        }

    @Test
    fun `getList merges recommend on first page and reads page info`() =
        runBlocking {
            val urls = mutableListOf<String>()
            val source =
                KgSonglist(fetch = { request ->
                    urls.add(request.url)
                    when {
                        request.url.contains("guess_special_recommend") -> recommend
                        request.url.contains("is_ajax=1") -> list
                        else -> tags
                    }
                })
            val page = source.getList("5", null, 1)
            assertEquals(20, page.list.size)
            assertEquals(2000, page.total)
            assertEquals(20, page.limit)
            val first = page.list.first()
            assertEquals("id_3339907", first.id)
            assertEquals("乡村之旅：安静惬意·与自然同在", first.name)
            assertEquals("蔓若", first.author)
            assertEquals("1716.1万", first.playCount)
            // 第一页同时拉了推荐位与列表
            assertTrue(urls.any { it.contains("guess_special_recommend") })
            assertTrue(urls.any { it.contains("is_ajax=1") })
        }

    @Test
    fun `getDetail exchanges hashes through gateway and backfills language`() =
        runBlocking {
            val source =
                KgSonglist(fetch = { request ->
                    if (request.url.contains("gateway.kugou.com")) gateway else html
                })
            val result = source.getDetail("id_3339907", 1)
            // HTML 里 30 行，但网关有 4 条没有 audio_info（不可播）→ 映射后 26 首
            assertEquals(26, result.total)
            assertEquals(26, result.list.size)
            val info = requireNotNull(result.info)
            assertEquals("乡村之旅：安静惬意·与自然同在", info.name)
            assertTrue(info.img!!.contains("20201207134716994336"))
            assertTrue(info.desc!!.contains("清晨的泥土芳香"))
            val first = result.list.first()
            assertEquals("2488043_24E89719264E73D48C1C26AC2A47C5F5", (first["id"] as JsonPrimitive).content)
            assertEquals("For The Love Of God (Album Version)", (first["name"] as JsonPrimitive).content)
            assertEquals("Josh Turner、Ricky Skaggs", (first["singer"] as JsonPrimitive).content)
            assertEquals("04:07", (first["interval"] as JsonPrimitive).content)
            val meta = first["meta"]!!.jsonObject
            // gateway 返回的 hash 与 HTML 里的 hash 不同，语种只能靠 a<audio_id> 索引回填
            assertEquals("英语", (meta["lang"] as JsonPrimitive).content)
            assertTrue((meta["picUrl"] as JsonPrimitive).content.endsWith("/400/20250425/20250425112023164897.jpg"))
            val qualitys = meta["qualitys"] as JsonArray
            assertEquals(
                listOf("128k", "320k", "flac"),
                qualitys.map { ((it as JsonObject)["type"] as JsonPrimitive).content },
            )
            assertEquals(
                "3.77 MiB",
                ((meta["_qualitys"] as JsonObject)["128k"] as JsonObject)["size"]!!.let { (it as JsonPrimitive).content },
            )
        }

    @Test
    fun `gateway error code is treated as failure and hashes dedupe`() {
        assertNull(KgSonglist.parseGateway("""{"error_code":300,"data":[]}"""))
        assertNull(KgSonglist.parseGateway("""{"errcode":1,"data":[]}"""))
        assertTrue(KgSonglist.parseGateway("""{"error_code":0,"data":[]}""")!!.isEmpty())

        val rows =
            listOf(
                JsonPrimitive("A"),
                JsonPrimitive("a"),
                JsonPrimitive("B"),
                JsonPrimitive(""),
            ).map { hash -> JsonObject(mapOf("hash" to hash)) }
        assertEquals(listOf("A", "a", "B"), KgSonglist.deduplicateHashes(rows))
    }
}
