package cn.toside.music.core.share

import cn.toside.music.core.lyric.LyricLine
import cn.toside.music.core.lyric.ParsedLyric
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ShareCardLayoutTest {
    private fun layout(
        isDark: Boolean = false,
        ratio: RatioKey = RatioKey.FULLSCREEN,
    ) = buildShareCardLayout(isDark, ratio, 360.0, 800.0)

    @Test
    fun geometryFollowsTheMasterScreenOnFullscreen() {
        val card = layout()
        assertEquals(280.8, card.cardWidth, 1e-9)
        assertEquals(496.0, card.cardMaxHeight, 1e-9)
        assertEquals(1.0, card.scale, 0.0)
        // coverSize = min(280.8 − 40, 496 − 40 − 200) = 240.8
        assertEquals(240.8, card.coverSize, 1e-9)
        assertEquals(296.0, card.lyricMaxHeight, 1e-9)
        assertEquals(240.8, card.cardTextWidth, 1e-9)
        assertEquals(18.5, card.textSizes.title, 0.0)
    }

    @Test
    fun themeFollowsTheAppMode() {
        assertEquals(LIGHT_CARD_THEME, layout(isDark = false).theme)
        assertEquals(DARK_CARD_THEME, layout(isDark = true).theme)
    }

    @Test
    fun theRectKeepsTheScreenWidthAndOnlyChangesLength() {
        val card = layout(ratio = RatioKey.RATIO_3_4)
        assertEquals(360.0, card.rect.width, 0.0)
        assertEquals(480.0, card.rect.height, 1e-9)
        assertTrue(card.scale in 0.95..1.0)
    }

    @Test
    fun lyricLayoutWalksDownFromTheLyricPageFontWhenItCannotFit() {
        val lines = List(10) { LyricBlockLine("第${it}句", noWrap = true) }
        val card = layout()
        val lyric = buildShareLyricLayout(lines, card, lyricFontSizeDp = 20.0)
        // 预算 296dp、列宽 240.8dp：20 档 10 句要 300dp，差一句装不下；19 档 285dp 全装
        assertEquals(19.0, lyric.fit.fontSize, 0.0)
        assertEquals(10, lyric.shown.size)
        assertFalse(lyric.fit.truncated)
    }

    @Test
    fun aTinyCardStillProducesATruncatedLayoutAboveTheFloor() {
        val card = buildShareCardLayout(false, RatioKey.FULLSCREEN, 120.0, 400.0)
        val lines = List(30) { LyricBlockLine("第${it}句", noWrap = true) }
        val lyric = buildShareLyricLayout(lines, card, lyricFontSizeDp = 20.0)
        // 卡太小装不下整首：字号停留在下探档位上，只显示装得下的前几句
        assertTrue(lyric.fit.fontSize >= LYRIC_MIN_FONT_SIZE)
        assertTrue(lyric.fit.truncated)
        assertEquals(lyric.fit.visibleCount, lyric.shown.size)
    }

    @Test
    fun anImpossibleCardShowsNoLyricLinesInsteadOfFailing() {
        // 高度小到歌词预算为 0：五档兜底都数出 0 句，显示列表必须还是空表而不是负数切片
        val card = buildShareCardLayout(false, RatioKey.FULLSCREEN, 120.0, 240.0)
        assertEquals(0.0, card.lyricMaxHeight, 0.0)
        val lyric = buildShareLyricLayout(listOf(LyricBlockLine("这一句很长".repeat(20))), card, lyricFontSizeDp = null)
        assertEquals(0, lyric.fit.visibleCount)
        assertTrue(lyric.fit.truncated)
        assertTrue(lyric.shown.isEmpty())
    }

    @Test
    fun lyricBlockLinesDropsFullyBlankLinesAndResolvesNoWrapFromThePageGeometry() {
        val parsed =
            ParsedLyric(
                lines =
                    listOf(
                        LyricLine(0, "一二三"),
                        LyricLine(1000, "一二三四五六七"),
                        LyricLine(2000, "", listOf("译文")),
                        LyricLine(3000, "", emptyList()),
                        LyricLine(4000, "  ", emptyList()),
                    ),
            )
        // 歌词页：字号 20dp、列宽 100dp ⇒ 60 ≤ 100 一行；140 > 100 折行
        val lines = lyricBlockLines(parsed, pageFontSize = 20.0, pageTextWidth = 100.0)
        assertEquals(3, lines.size)
        assertEquals(true, lines[0].noWrap)
        assertEquals(false, lines[1].noWrap)
        assertTrue(lines[2].text.isBlank())
        assertEquals(listOf("译文"), lines[2].extendedLyrics)
    }
}
