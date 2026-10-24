package cn.toside.music.core.lyric

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 黄金值来自 `lrc-file-parser@2.4.2` 本体（node 直接 new Lyric 取 lines/tags），
 * 以及其 `_findCurLineNum` 的边界输出。改动解析逻辑先跑这些用例。
 */
class LyricParserTest {
    private val basic =
        """
        [ti:歌名]
        [ar:歌手]
        [al:专辑]
        [by:作者]
        [offset:200]
        [00:01.00]第一行
        [00:02.50]第二行
        [00:03.75]第三行
        """.trimIndent()

    @Test
    fun parsesTags() {
        val parsed = LyricParser.parse(basic)
        assertEquals(LyricTags(title = "歌名", artist = "歌手", album = "专辑", offset = 200, by = "作者"), parsed.tags)
    }

    @Test
    fun parsesLinesAndSortsByTime() {
        val parsed = LyricParser.parse(basic)
        assertEquals(listOf(1000L, 2500L, 3750L), parsed.lines.map { it.timeMs })
        assertEquals(listOf("第一行", "第二行", "第三行"), parsed.lines.map { it.text })
    }

    @Test
    fun multiTimestampLineBecomesMultipleLines() {
        val parsed = LyricParser.parse("[00:01.00][00:05.00]重复行\n[00:02.00]中间\n[00:06.00]末尾")
        assertEquals(listOf(1000L, 2000L, 5000L, 6000L), parsed.lines.map { it.timeMs })
        assertEquals(listOf("重复行", "中间", "重复行", "末尾"), parsed.lines.map { it.text })
    }

    @Test
    fun duplicateTimestampFoldsTextIntoExtendedLyrics() {
        val parsed = LyricParser.parse("[00:01.00]主行\n[00:01.00]第二段\n[00:01.00]第三段")
        assertEquals(1, parsed.lines.size)
        assertEquals("主行", parsed.lines[0].text)
        assertEquals(listOf("第二段", "第三段"), parsed.lines[0].extendedLyrics)
    }

    @Test
    fun threeDigitFractionSwitchWholeSongToMilliseconds() {
        val parsed = LyricParser.parse("[00:01.345]毫秒行\n[00:02.12]厘秒行")
        assertEquals(listOf(1345L, 2012L), parsed.lines.map { it.timeMs })
    }

    @Test
    fun shorterFractionsAreCentisecondsWithoutMsMarker() {
        val parsed = LyricParser.parse("[00:01.34]厘秒行\n[00:02.5]十分之一秒")
        assertEquals(listOf(1340L, 2500L), parsed.lines.map { it.timeMs })
    }

    @Test
    fun skipsBlankAndNonTimestampLines() {
        val parsed = LyricParser.parse("[00:01.00]有字\n[00:02.00]   \n[00:03.00]结束\n非时间行")
        assertEquals(listOf(1000L, 3000L), parsed.lines.map { it.timeMs })
    }

    @Test
    fun timestampsWithoutFractionAreDropped() {
        val parsed = LyricParser.parse("[00:01.00]保留\n[00:03]无小数")
        assertEquals(listOf(1000L), parsed.lines.map { it.timeMs })
    }

    @Test
    fun oneComponentIsTreatedAsSeconds() {
        val parsed = LyricParser.parse("[01.00]一秒\n[1:02.34]一分两秒")
        assertEquals(listOf(1000L, 62_340L), parsed.lines.map { it.timeMs })
    }

    @Test
    fun zeroTimestampsParse() {
        val parsed = LyricParser.parse("[00:00.000]零\n[00:00.500]半秒")
        assertEquals(listOf(0L, 500L), parsed.lines.map { it.timeMs })
    }

    @Test
    fun emptyLyricHasNoLines() {
        val parsed = LyricParser.parse("")
        assertTrue(parsed.lines.isEmpty())
        assertEquals(-1, parsed.indexAt(1000))
    }

    @Test
    fun negativeTagOffsetParses() {
        val parsed = LyricParser.parse("[offset:-100]\n[00:10.00]a")
        assertEquals(-100, parsed.tags.offset)
        assertEquals(10_000L, parsed.lines[0].timeMs)
    }

    @Test
    fun nonNumericOffsetFallsBackToZero() {
        assertEquals(0, LyricParser.parse("[offset:abc]\n[00:01.00]a").tags.offset)
        assertEquals(0, LyricParser.parse("[offset:]\n[00:01.00]a").tags.offset)
    }

    @Test
    fun extendedLyricsOnlyAttachToMatchingTimestamps() {
        val parsed =
            LyricParser.parse(
                basic,
                listOf("[00:01.00]译文一\n[00:02.50]译文二\n[00:09.00]无匹配\n[00:03.75]   "),
            )
        assertEquals(listOf("译文一", "译文二"), parsed.lines[0].extendedLyrics + parsed.lines[1].extendedLyrics)
        assertTrue(parsed.lines[2].extendedLyrics.isEmpty())
    }

    @Test
    fun duplicateTimestampExtendedLyricAppendsLast() {
        val parsed = LyricParser.parse("[00:01.00]主行\n[00:01.00]第二段\n[00:01.00]第三段", listOf("[00:01.00]译文"))
        assertEquals(listOf("第二段", "第三段", "译文"), parsed.lines[0].extendedLyrics)
    }

    @Test
    fun lineIndexMatchesLibraryBoundaries() {
        // 黄金值是库的 _findCurLineNum 原始入参；这里不叠加插件默认 offset 与标签 offset
        val lines = LyricParser.parse("[00:01.00]第一行\n[00:02.50]第二行\n[00:03.75]第三行").lines
        val expected =
            mapOf(
                -100L to 0,
                0L to 0,
                999L to 0,
                1000L to 0,
                1001L to 0,
                2499L to 0,
                2500L to 0,
                2501L to 1,
                3749L to 1,
                3750L to 1,
                3751L to 2,
                99_999L to 2,
            )
        for ((position, index) in expected) {
            assertEquals("position=$position", index, LyricParser.indexAt(lines, position, extraOffsetMs = 0))
        }
    }

    @Test
    fun tagOffsetShiftsLineIndex() {
        val parsed = LyricParser.parse("[offset:500]\n[00:01.00]a\n[00:02.00]b\n[00:03.00]c")
        // 位置 + 100（插件默认）+ 500（标签）= 有效时间
        assertEquals(0, parsed.indexAt(500))
        assertEquals(0, parsed.indexAt(1400))
        assertEquals(1, parsed.indexAt(1401))
    }
}
