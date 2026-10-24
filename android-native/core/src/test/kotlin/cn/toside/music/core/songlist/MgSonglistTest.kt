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
 * 咪咕歌单 —— 真实 fixture（2026-10-25）：
 * `songlist-mg-tags.json`、`songlist-mg-list.json`（新 `contents` 递归分支）、
 * `songlist-mg-list-tagged.json`（旧 `contentItemList[1]` 分支）、
 * `songlist-mg-detail-songs/info.json`。
 */
class MgSonglistTest {
    private val tags = Fixtures.text("songlist-mg-tags.json")
    private val list = Fixtures.text("songlist-mg-list.json")
    private val tagged = Fixtures.text("songlist-mg-list-tagged.json")
    private val songs = Fixtures.text("songlist-mg-detail-songs.json")
    private val info = Fixtures.text("songlist-mg-detail-info.json")

    @Test
    fun `getTags reads hot row and groups`() =
        runBlocking {
            val source = MgSonglist { tags }
            val result = source.getTags()
            assertEquals(14, result.hotTags.size)
            assertEquals("1001076096", result.hotTags.first().id)
            assertEquals("网络热歌", result.hotTags.first().name)
            assertEquals(listOf("风格", "语种", "场景", "主题", "心情"), result.tags.map { it.name })
            assertEquals(
                12,
                result.tags
                    .first()
                    .list.size,
            )
            assertEquals(
                "1000001672",
                result.tags
                    .first()
                    .list
                    .first()
                    .id,
            )
            assertEquals(
                "流行",
                result.tags
                    .first()
                    .list
                    .first()
                    .name,
            )
        }

    @Test
    fun `getList walks nested contents and dedupes resId`() =
        runBlocking {
            val source = MgSonglist { list }
            val page = source.getList("15127315", null, 1)
            assertEquals(127, page.list.size)
            assertEquals(
                127,
                page.list
                    .map { it.id }
                    .distinct()
                    .size,
            )
            val first = page.list.first()
            assertEquals("234008681", first.id)
            assertEquals("活力百分百：KPOP春日心动旋律", first.name)
            assertTrue(first.desc.startsWith("春日限定 KPOP"))
            assertTrue(first.img!!.endsWith(".jpeg"))
        }

    @Test
    fun `getList tagged uses legacy contentItemList branch`() =
        runBlocking {
            val source = MgSonglist { tagged }
            val page = source.getList("15127315", "1000001672", 1)
            assertEquals(30, page.list.size)
            val first = page.list.first()
            assertEquals("211267917", first.id)
            assertEquals("治愈 | 生活的答案不止是完美", first.name)
            assertEquals("134.4万", first.playCount)
            assertTrue(first.img!!.endsWith("fx.webp"))
        }

    @Test
    fun `getDetail maps V5 quality table and info block`() =
        runBlocking {
            val source =
                MgSonglist { request ->
                    if (request.url.contains("playlist/song")) songs else info
                }
            val result = source.getDetail("234008681", 1)
            assertEquals(121, result.total)
            assertEquals(30, result.list.size)
            val detailInfo = requireNotNull(result.info)
            assertEquals("活力百分百：KPOP春日心动旋律", detailInfo.name)
            assertEquals("南方人不懂暖气香啦", detailInfo.author)
            assertEquals("100.2万", detailInfo.playCount)
            val first = result.list.first()
            assertEquals("mg_1134982507", (first["id"] as JsonPrimitive).content)
            assertEquals("Waves", (first["name"] as JsonPrimitive).content)
            assertEquals("姜丹尼尔、Simon D、朴智敏", (first["singer"] as JsonPrimitive).content)
            assertEquals("02:44", (first["interval"] as JsonPrimitive).content)
            val meta = first["meta"]!!.jsonObject
            assertEquals("6005973QW2Q", (meta["copyrightId"] as JsonPrimitive).content)
            assertTrue((meta["picUrl"] as JsonPrimitive).content.startsWith("/data/resource-service/file-down/"))
            val qualitys = meta["qualitys"] as JsonArray
            assertEquals(
                listOf("128k", "320k"),
                qualitys.map { ((it as JsonObject)["type"] as JsonPrimitive).content },
            )
            // 该响应不带 size/androidSize，RN 同样得到 0 B —— 保留旧语义
            assertEquals(
                "0 B",
                ((meta["_qualitys"] as JsonObject)["320k"] as JsonObject)["size"]!!.let { (it as JsonPrimitive).content },
            )
        }
}
