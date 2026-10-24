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
 * 企鹅歌单 —— fixture 均来自 2026-10-25 线上真实响应：
 * `songlist-tx-tags/hot.html/list/list-tagged/detail-blocked/detail-fallback.json`。
 * 其中 GET 详情被风控（`subcode=4000`），落盘的 blocked 响应用于驱动 POST 回退分支。
 */
class TxSonglistTest {
    private val tags = Fixtures.text("songlist-tx-tags.json")
    private val hot = Fixtures.text("songlist-tx-hot.html")
    private val list = Fixtures.text("songlist-tx-list.json")
    private val tagged = Fixtures.text("songlist-tx-list-tagged.json")
    private val blocked = Fixtures.text("songlist-tx-detail-blocked.json")
    private val fallback = Fixtures.text("songlist-tx-detail-fallback.json")

    @Test
    fun `getTags combines category groups and html hot tags`() =
        runBlocking {
            val source =
                TxSonglist { request ->
                    if (request.url.contains("category_playlist.html")) hot else tags
                }
            val result = source.getTags()
            assertEquals(7, result.tags.size)
            assertEquals("热门", result.tags.first().name)
            assertEquals(
                "3317",
                result.tags
                    .first()
                    .list
                    .first()
                    .id,
            )
            assertEquals(
                "官方歌单",
                result.tags
                    .first()
                    .list
                    .first()
                    .name,
            )
            assertEquals(15, result.hotTags.size)
            assertEquals("3270", result.hotTags.first().id)
            assertEquals("门店音乐", result.hotTags.first().name)
        }

    @Test
    fun `getList without tag parses plaza items`() =
        runBlocking {
            val source = TxSonglist { list }
            val page = source.getList("5", null, 1)
            assertEquals(36, page.list.size)
            assertEquals(11617, page.total)
            val first = page.list.first()
            assertEquals("7707261125", first.id)
            assertEquals("甜度爆表 | 旋律说唱狙击少女心", first.name)
            assertEquals("我想要两颗西柚", first.author)
            assertEquals("855.5万", first.playCount)
            assertEquals(66, first.total)
        }

    @Test
    fun `getList with tag parses category content`() =
        runBlocking {
            val source = TxSonglist { tagged }
            val page = source.getList("5", "3317", 1)
            assertEquals(36, page.list.size)
            assertEquals(949, page.total)
            val first = page.list.first()
            assertEquals("9607499637", first.id)
            assertEquals("相信音乐官方精选", first.name)
            assertEquals("相信音乐", first.author)
            assertEquals("66.7万", first.playCount)
            assertTrue(first.img!!.contains("w/600"))
        }

    @Test
    fun `getDetail falls back to post when get is blocked`() =
        runBlocking {
            val calls = mutableListOf<Pair<String, String>>()
            val source =
                TxSonglist { request ->
                    calls.add(request.method to request.url)
                    if (request.method == "POST") fallback else blocked
                }
            val result = source.getDetail("7707261125", 1)
            assertEquals(listOf("GET", "POST"), calls.map { it.first })
            val info = requireNotNull(result.info)
            assertEquals("甜度爆表 | 旋律说唱狙击少女心", info.name)
            assertEquals("我想要两颗西柚", info.author)
            assertEquals("855.5万", info.playCount)
            assertEquals(66, result.total)
            assertEquals(66, result.list.size)
        }

    @Test
    fun `fallback detail maps songs with qualities and cover rules`() =
        runBlocking {
            val result = requireNotNull(TxSonglist.parseFallbackDetail(fallback))
            val first = result.list.first()
            assertEquals("tx_002xTzGb2UBQRk", (first["id"] as JsonPrimitive).content)
            assertEquals("你的", (first["name"] as JsonPrimitive).content)
            assertEquals("DouDou、Viva宋佩豫", (first["singer"] as JsonPrimitive).content)
            assertEquals("02:43", (first["interval"] as JsonPrimitive).content)
            val meta = first["meta"]!!.jsonObject
            assertEquals("0023VbHy1oT80v", (meta["albumMid"] as JsonPrimitive).content)
            assertEquals("002AkhKv0YDLIl", (meta["strMediaMid"] as JsonPrimitive).content)
            val qualitys = meta["qualitys"] as JsonArray
            assertEquals(
                listOf("128k", "320k", "flac"),
                qualitys.map { ((it as JsonObject)["type"] as JsonPrimitive).content },
            )
            assertEquals(
                "18.48 MiB",
                ((meta["_qualitys"] as JsonObject)["flac"] as JsonObject)["size"]!!.let { (it as JsonPrimitive).content },
            )
            assertTrue(
                (meta["picUrl"] as JsonPrimitive).content.startsWith(
                    "https://y.gtimg.cn/music/photo_new/T002R500x500M0000023VbHy1oT80v.jpg",
                ),
            )
        }
}
