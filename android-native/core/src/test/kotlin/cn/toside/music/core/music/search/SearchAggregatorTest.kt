package cn.toside.music.core.music.search

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Test

class SearchAggregatorTest {
    @Test
    fun `all sorts by RN similarity and keeps sortInsert tie order across five sources`() {
        val results =
            listOf(
                page("kw", 4, 10, 30, music("low", "其他", "", "kw")),
                page("tx", 3, 20, 30, music("exactA", "晴天", "", "tx")),
                page("wy", 2, 30, 30, music("exactB", "晴天", "", "wy")),
                page("kg", 5, 40, 30, music("middle", "晴天", "周杰伦", "kg")),
                page("mg", 1, 50, 30, music("exactC", "晴天", "", "mg")),
            )

        val merged = SearchAggregator.all("晴天", results, page = 1)

        assertEquals(listOf("exactA", "exactB", "exactC", "middle", "low"), merged.list.ids())
        assertEquals(5, merged.allPage)
        assertEquals(50, merged.total)
        assertEquals(30, merged.limit)
        assertEquals("all", merged.source)
    }

    @Test
    fun `all filters exhausted and failed sources deduplicates across pages and falls back total`() {
        val previous =
            SearchPage(
                list = listOf(music("old", "旧歌", "歌手", "kw"), music("duplicate", "晴天", "", "tx")),
                total = 70,
                allPage = 4,
                limit = 30,
                source = "all",
            )
        val results =
            listOf(
                page("kw", 1, 500, 10, music("excluded", "晴天", "", "kw")),
                page(
                    "tx",
                    2,
                    0,
                    20,
                    music("duplicate", "晴天", "", "tx"),
                    music("new", "晴天", "", "tx"),
                ),
                SearchAggregator.emptyPage("wy"),
                page("kg", 3, 0, 40),
                page("mg", 2, 0, 50),
            )

        val merged = SearchAggregator.all("晴天", results, page = 2, previous = previous)

        assertEquals(listOf("old", "duplicate", "new"), merged.list.ids())
        assertEquals(3, merged.allPage)
        assertEquals(100, merged.total)
        assertEquals(30, merged.limit)
    }

    @Test
    fun `single source keeps prior page order deduplicates by id and falls back total`() {
        val previous = page("kw", 5, 99, 30, music("a", "歌", "手", "kw"), music("b", "歌", "手", "kw"))
        val current = page("kw", 5, 0, 30, music("b", "歌", "手", "kw"), music("c", "歌", "手", "kw"))

        val merged = SearchAggregator.single(current, page = 2, previous = previous)

        assertEquals(listOf("a", "b", "c"), merged.list.ids())
        assertEquals(60, merged.total)
        assertEquals(5, merged.allPage)
        assertEquals("kw", merged.source)
    }

    private fun page(
        source: String,
        allPage: Int,
        total: Int,
        limit: Int,
        vararg list: JsonObject,
    ): SearchPage = SearchPage(list.toList(), total, allPage, limit, source)

    private fun music(
        id: String,
        name: String,
        singer: String,
        source: String,
    ): JsonObject =
        buildJsonObject {
            put("id", id)
            put("name", name)
            put("singer", singer)
            put("source", source)
            put("interval", "01:00")
            put(
                "meta",
                buildJsonObject {
                    put("songId", id)
                    put("albumName", "专辑")
                    put("picUrl", JsonPrimitive(""))
                    put("albumId", "album")
                    put("qualitys", kotlinx.serialization.json.JsonArray(emptyList()))
                    put("_qualitys", buildJsonObject { })
                },
            )
        }

    private fun List<JsonObject>.ids(): List<String> = map { (it["id"] as JsonPrimitive).content }
}
