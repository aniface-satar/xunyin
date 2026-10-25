package cn.toside.music.core.list

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 去重分组规则（对照 RN MyList/utils.ts#filterDuplicateMusic）。
 *
 * 判据只看歌名：Live/Remix 等括号后缀剥离、大小写与标点空白忽略；
 * 只返回成员数 ≥ 2 的组，组按组名 locale 排序，组内保持原列表顺序。
 */
class DuplicateMusicTest {
    private fun music(
        id: String,
        name: String,
    ): JsonObject =
        buildJsonObject {
            put("id", id)
            put("name", name)
        }

    @Test
    fun variantBracketSuffixGroupsTogether() {
        val result =
            DuplicateMusic.filter(
                listOf(
                    music("a", "Song"),
                    music("b", "Other"),
                    music("c", "Song (Live)"),
                ),
                localeId = "en-US",
            )
        assertEquals(listOf("a", "c"), result.map { it.id })
        assertEquals(listOf(0, 2), result.map { it.index })
        assertEquals(1, result.map { it.group }.distinct().size)
    }

    @Test
    fun casePunctuationAndWhitespaceIgnored() {
        val result =
            DuplicateMusic.filter(
                listOf(
                    music("a", "A-B"),
                    music("b", "a b"),
                    music("c", "AB"),
                    music("d", "zzz"),
                ),
                localeId = "en-US",
            )
        assertEquals(listOf("a", "b", "c"), result.map { it.id })
    }

    @Test
    fun variantOnlyNameFallsBackToWhitespaceStripped() {
        val result =
            DuplicateMusic.filter(
                listOf(
                    music("a", "（Live）"),
                    music("b", "（ Live ）"),
                ),
                localeId = "en-US",
            )
        assertEquals(listOf("a", "b"), result.map { it.id })
        assertEquals("（live）", result.first().group)
    }

    @Test
    fun filterVariantFalseKeepsBracketText() {
        val result =
            DuplicateMusic.filter(
                listOf(
                    music("a", "Song"),
                    music("b", "Song (Live)"),
                ),
                isFilterVariant = false,
                localeId = "en-US",
            )
        assertEquals(emptyList<DuplicateMusicItem>(), result)
    }

    @Test
    fun groupsSortedAndSingletonsDropped() {
        val result =
            DuplicateMusic.filter(
                listOf(
                    music("b1", "b"),
                    music("a1", "a"),
                    music("b2", "B"),
                    music("a2", "A"),
                    music("c1", "c"),
                ),
                localeId = "en-US",
            )
        assertEquals(listOf("a1", "a2", "b1", "b2"), result.map { it.id })
        assertEquals(listOf("a", "a", "b", "b"), result.map { it.group })
    }
}
