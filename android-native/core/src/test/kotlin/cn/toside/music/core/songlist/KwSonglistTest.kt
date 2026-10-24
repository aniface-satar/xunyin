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
 * 酷我歌单 —— fixture 均为 2026-10-25 线上真实响应：
 * `songlist-kw-tags/hot/list/list-tag10000/list-tag43/detail.json`。
 * digest5 的 qukudata 响应未落盘（接口只对带 digest=5 的链接生效），
 * 该分支用合成 fixture 仅验证 `child[0].sourceid` 的读取链路。
 */
class KwSonglistTest {
    private val tags = Fixtures.text("songlist-kw-tags.json")
    private val hot = Fixtures.text("songlist-kw-hot.json")
    private val list = Fixtures.text("songlist-kw-list.json")
    private val listTag10000 = Fixtures.text("songlist-kw-list-tag10000.json")
    private val listTag43 = Fixtures.text("songlist-kw-list-tag43.json")
    private val detail = Fixtures.text("songlist-kw-detail.json")

    @Test
    fun `getTags parses groups and hot tags`() =
        runBlocking {
            val source =
                KwSonglist { request ->
                    if (request.url.contains("getRcmTagList")) hot else tags
                }
            val result = source.getTags()
            assertEquals("kw", result.source)
            assertEquals(8, result.tags.size)
            assertEquals("专区", result.tags.first().name)
            assertEquals(
                "211-43",
                result.tags
                    .first()
                    .list
                    .first()
                    .id,
            )
            assertEquals(8, result.hotTags.size)
            assertEquals("短视频", result.hotTags.first().name)
        }

    @Test
    fun `getList without tag parses rcm page`() =
        runBlocking {
            val source = KwSonglist { list }
            val page = source.getList("new", null, 1)
            assertEquals(36, page.list.size)
            assertEquals(1753, page.total)
            assertEquals(1, page.page)
            assertEquals(36, page.limit)
            val first = page.list.first()
            assertEquals("digest-8__3677488020", first.id)
            assertEquals("爱的故事翻篇，被爱的人不用道歉", first.name)
            assertEquals("余笑笑", first.author)
            assertEquals("368.4万", first.playCount)
            assertEquals(121, first.total)
            assertEquals(
                "8",
                first.id
                    .split("__")
                    .first()
                    .removePrefix("digest-"),
            )
        }

    @Test
    fun `getList with digest 10000 tag parses tag page`() =
        runBlocking {
            val source = KwSonglist { listTag10000 }
            val page = source.getList("hot", "2189-10000", 1)
            // 服务端 rn=36 但实际只回了 35 条（真实响应如此），总数仍报 10500
            assertEquals(35, page.list.size)
            assertEquals(10500, page.total)
            assertEquals("digest-8__3602662459", page.list.first().id)
        }

    @Test
    fun `getList with digest 43 tag parses grouped array and filters types`() =
        runBlocking {
            val source = KwSonglist { listTag43 }
            val page = source.getList("hot", "1-43", 1)
            assertTrue(page.list.size > 100)
            assertEquals(1000, page.total)
            assertTrue(page.list.all { it.id.startsWith("digest-") })
            assertEquals("digest-8__2498180359", page.list.first().id)
            assertEquals("最新热门DJ", page.list.first().name)
        }

    @Test
    fun `getDetail digest 8 maps music infos and info block`() =
        runBlocking {
            val source = KwSonglist { detail }
            val result = source.getDetail("digest-8__3677488020", 1)
            assertEquals(121, result.total)
            assertEquals(121, result.list.size)
            val info = requireNotNull(result.info)
            assertEquals("爱的故事翻篇，被爱的人不用道歉", info.name)
            // 线上 detail 的 uname 就是 uid 形态（kw3563157520），RN 也原样透传
            assertEquals("kw3563157520", info.author)
            assertTrue(info.img!!.startsWith("http://img1.kuwo.cn/"))
            val first = result.list.first()
            assertEquals("kw_466354", (first["id"] as JsonPrimitive).content)
            assertEquals("下雨天", (first["name"] as JsonPrimitive).content)
            assertEquals("南拳妈妈", (first["singer"] as JsonPrimitive).content)
            assertEquals("04:14", (first["interval"] as JsonPrimitive).content)
            val meta = first["meta"]!!.jsonObject
            val qualitys = meta["qualitys"] as JsonArray
            assertEquals(
                listOf("128k", "320k", "flac"),
                qualitys.map {
                    (it as JsonObject)["type"]!!.let { t ->
                        (t as JsonPrimitive).content
                    }
                },
            )
            val qualityMap = meta["_qualitys"]!!.jsonObject
            assertEquals("27.4MB", (qualityMap["flac"] as JsonObject)["size"]!!.let { (it as JsonPrimitive).content })
        }

    @Test
    fun `getDetail digest 5 resolves sourceid before fetching songs`() =
        runBlocking {
            val urls = mutableListOf<String>()
            val source =
                KwSonglist { request ->
                    urls.add(request.url)
                    if (request.url.contains("qukudata")) {
                        """{"child":[{"sourceid":"3677488020"}]}"""
                    } else {
                        detail
                    }
                }
            val result = source.getDetail("digest-5__777", 1)
            assertEquals(121, result.list.size)
            assertTrue(urls.first().contains("qukudata"))
            assertTrue(urls[1].contains("pid=3677488020"))
        }

    @Test
    fun `getDetail rejects album digest 13`() =
        runBlocking {
            val source = KwSonglist { detail }
            val error = runCatching { source.getDetail("digest-13__42", 1) }
            assertTrue(error.isFailure)
        }
}
