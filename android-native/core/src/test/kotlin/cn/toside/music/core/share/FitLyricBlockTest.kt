package cn.toside.music.core.share

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 黄金值逐条对照 RN `tests/share-card-fit-lyric-block.mts`。 */
class FitLyricBlockTest {
    private fun line(
        text: String,
        extended: List<String> = emptyList(),
    ) = LyricBlockLine(text, extended)

    private fun flat(text: String) = LyricBlockLine(text, emptyList(), noWrap = true)

    @Test
    fun picksTheLargestTierThatFitsEveryLine() {
        val lines = listOf(line("第一句"), line("第二句"))
        assertEquals(
            FitLyricResult(fontSize = 24.0, extendedFontSize = 22.0, visibleCount = 2, truncated = false),
            fitLyricBlock(lines, FitLyricOptions(maxHeight = 100.0)),
        )
    }

    @Test
    fun stepsDownOneTierAtATimeBeforeItTruncates() {
        val lines = List(6) { line("第${it}句") }
        val result = fitLyricBlock(lines, FitLyricOptions(maxHeight = 150.0))
        assertEquals(16.0, result.fontSize, 0.0)
        assertFalse(result.truncated)
    }

    @Test
    fun truncatesAtTheSmallestTierInsteadOfShrinkingFurther() {
        val lines = List(30) { line("第${it}句") }
        val result = fitLyricBlock(lines, FitLyricOptions(maxHeight = 200.0))
        assertEquals(16.0, result.fontSize, 0.0)
        assertEquals(EXTENDED_TIER_FLOOR, result.extendedFontSize, 0.0)
        assertEquals(8, result.visibleCount)
        assertTrue(result.truncated)
    }

    @Test
    fun keepsTheBiggerFontWhenBothTiersShowTheSameLineCount() {
        val result = fitLyricBlock(listOf(line("第一句"), line("第二句")), FitLyricOptions(maxHeight = 40.0))
        assertEquals(FitLyricResult(24.0, 22.0, 1, true), result)
    }

    @Test
    fun aBodyLineAndItsTranslationAreOneBlockThatNeverSplits() {
        val lines = listOf(line("正文一", listOf("译文一")), line("正文二", listOf("译文二")))
        assertEquals(FitLyricResult(24.0, 22.0, 0, true), fitLyricBlock(lines, FitLyricOptions(maxHeight = 40.0)))
        assertEquals(FitLyricResult(16.0, 12.0, 1, true), fitLyricBlock(lines, FitLyricOptions(maxHeight = 45.0)))
    }

    @Test
    fun emptySelectionYieldsTheTopTierWithNothingShown() {
        assertEquals(
            FitLyricResult(24.0, 22.0, 0, false),
            fitLyricBlock(emptyList(), FitLyricOptions(maxHeight = 300.0)),
        )
    }

    @Test
    fun blankBodyWithOnlyATranslationStillOccupiesRows() {
        val lines = listOf(line("", listOf("只有译文")), line("", listOf("只有译文二")))
        val result = fitLyricBlock(lines, FitLyricOptions(maxHeight = 300.0))
        assertEquals(2, result.visibleCount)
        assertEquals(24.0, result.fontSize, 0.0)
    }

    @Test
    fun aSingleLineTallerThanMaxHeightShowsNothingRatherThanOverflowing() {
        val result = fitLyricBlock(listOf(line("很长很长的一句话")), FitLyricOptions(maxHeight = 10.0))
        assertEquals(0, result.visibleCount)
        assertTrue(result.truncated)
        assertEquals(LYRIC_TIERS[0], result.fontSize, 0.0)
    }

    @Test
    fun defaultRatioIsOnePointFiveAndIsOverridable() {
        assertEquals(1.5, LYRIC_LINE_HEIGHT_RATIO, 0.0)
        val lines = List(4) { line("第${it}句") }
        assertEquals(24.0, fitLyricBlock(lines, FitLyricOptions(maxHeight = 120.0, lineHeightRatio = 1.2)).fontSize, 0.0)
        // 1.5 档下逐档：24→144 超、22→132 超、20→120 恰好等于上限（判据是 >，等于算装得下）
        assertEquals(20.0, fitLyricBlock(lines, FitLyricOptions(maxHeight = 120.0)).fontSize, 0.0)
    }

    // —— 换行感知模型（textWidth 给了才启用）——

    @Test
    fun estimateRowCountFollowsTheWrapWidthAndIsConservativeViaCeil() {
        assertEquals(1, estimateRowCount("一二三四五", 20.0, 100.0))
        assertEquals(2, estimateRowCount("一二三四五", 40.0, 100.0))
        assertEquals(2, estimateRowCount("hello world", 20.0, 100.0))
        assertEquals(0, estimateRowCount("   ", 20.0, 100.0))
        assertEquals(1, estimateRowCount("hello", 20.0, 0.0))
        assertEquals(1, estimateRowCount("hello", 20.0, Double.NaN))
    }

    @Test
    fun wrapModeReservesOneBodyRowAsEstimationSlack() {
        assertEquals(1, WRAP_SLACK_ROWS)
        val lines = listOf(line("一二三四"), line("四三四二"))
        assertEquals(
            FitLyricResult(24.0, 22.0, 2, false),
            fitLyricBlock(lines, FitLyricOptions(maxHeight = 100.0)),
        )
        // 折行 120：24 档预算 100−36=64，第二句装不下；22 档预算 67，两行 66 → 全装
        assertEquals(
            FitLyricResult(22.0, 20.0, 2, false),
            fitLyricBlock(lines, FitLyricOptions(maxHeight = 100.0, textWidth = 120.0)),
        )
    }

    @Test
    fun wrapAwareBudgetCountsWrappedRowsNotSentences() {
        val lines = listOf(line("一二三四五六七八九十"), line("一二三四五六七"))
        assertEquals(
            FitLyricResult(16.0, EXTENDED_TIER_FLOOR, 2, false),
            fitLyricBlock(lines, FitLyricOptions(maxHeight = 100.0, textWidth = 120.0)),
        )
    }

    @Test
    fun wrappedTranslationsArePartOfTheSameBlockBudget() {
        val lines = listOf(line("一二三", listOf("一二三四五六七八九十")))
        assertEquals(
            FitLyricResult(16.0, EXTENDED_TIER_FLOOR, 1, false),
            fitLyricBlock(lines, FitLyricOptions(maxHeight = 100.0, textWidth = 120.0)),
        )
    }

    @Test
    fun degenerateWidthKeepsTheAllZeroTieAtTheTopTier() {
        val result = fitLyricBlock(listOf(line("很长很长的一句话")), FitLyricOptions(maxHeight = 10.0, textWidth = 120.0))
        assertEquals(0, result.visibleCount)
        assertTrue(result.truncated)
        assertEquals(LYRIC_TIERS[0], result.fontSize, 0.0)
    }

    // —— 逐 dp 下探（歌词卡走的那一支）——

    @Test
    fun theFloorIsTheCardSingerNameSize() {
        assertEquals(14.0, LYRIC_FOOTER_SINGER_FONT_SIZE, 0.0)
        assertEquals(LYRIC_FOOTER_SINGER_FONT_SIZE, LYRIC_MIN_FONT_SIZE, 0.0)
    }

    @Test
    fun lyricFontSizesWalksDownByOneDpAndAlwaysLandsOnTheFloor() {
        assertEquals(listOf(20.0, 19.0, 18.0, 17.0, 16.0, 15.0, 14.0), lyricFontSizes(20.0, 14.0))
        assertEquals(listOf(14.5, 14.0), lyricFontSizes(14.5, 14.0))
        assertEquals(listOf(13.0), lyricFontSizes(13.0, 14.0))
        assertEquals(listOf(14.0), lyricFontSizes(14.0, 14.0))
        assertEquals(emptyList<Double>(), lyricFontSizes(0.0, 14.0))
        assertEquals(emptyList<Double>(), lyricFontSizes(Double.NaN, 14.0))
    }

    @Test
    fun theDescentStartsAtTheLyricPageSizeAndStaysThereWhenAllFits() {
        val lines = listOf(flat("第一句"), flat("第二句"), flat("第三句"))
        assertEquals(
            FitLyricResult(20.0, 16.0, 3, false),
            fitLyricBlock(
                lines,
                FitLyricOptions(
                    maxHeight = 100.0,
                    textWidth = 100.0,
                    fontSize = 20.0,
                    minFontSize = 14.0,
                    extendedRatio = 0.8,
                ),
            ),
        )
    }

    @Test
    fun theDescentShrinksOneDpAtATimeUntilTheWholeSelectionFits() {
        val lines = listOf(flat("第一句"), flat("第二句"), flat("第三句"))
        assertEquals(
            FitLyricResult(15.0, 12.0, 3, false),
            fitLyricBlock(
                lines,
                FitLyricOptions(
                    maxHeight = 70.0,
                    textWidth = 100.0,
                    fontSize = 20.0,
                    minFontSize = 14.0,
                    extendedRatio = 0.8,
                ),
            ),
        )
    }

    @Test
    fun theDescentStopsAtTheFloorAndTruncatesWholeSentencesThere() {
        val lines = List(10) { flat("第${it}句") }
        val result =
            fitLyricBlock(
                lines,
                FitLyricOptions(
                    maxHeight = 85.0,
                    textWidth = 100.0,
                    fontSize = 20.0,
                    minFontSize = 14.0,
                    extendedRatio = 0.8,
                ),
            )
        assertEquals(LYRIC_MIN_FONT_SIZE, result.fontSize, 0.0)
        assertEquals(4, result.visibleCount)
        assertTrue(result.truncated)
    }

    @Test
    fun theDescentKeepsTheBiggerFontWhenTwoTiersShowTheSameCount() {
        val lines = List(10) { flat("第${it}句") }
        assertEquals(
            FitLyricResult(16.0, 12.8, 4, true),
            fitLyricBlock(
                lines,
                FitLyricOptions(
                    maxHeight = 100.0,
                    textWidth = 100.0,
                    fontSize = 20.0,
                    minFontSize = 14.0,
                    extendedRatio = 0.8,
                ),
            ),
        )
    }

    // —— 换行跟歌词页对齐 ——

    @Test
    fun fitsSingleRowOnlyConstrainsLinesTheLyricPageShowsAsOneRow() {
        assertEquals(false, fitsSingleRow(LyricBlockLine("一二三四五六", noWrap = true), 20.0, 100.0))
        assertEquals(true, fitsSingleRow(LyricBlockLine("一二三四五六", noWrap = true), 16.0, 100.0))
        assertEquals(true, fitsSingleRow(LyricBlockLine("一二三", noWrap = true), 20.0, 100.0))
        assertEquals(true, fitsSingleRow(LyricBlockLine("一二三四五六七八九十"), 20.0, 100.0))
        assertEquals(false, fitsSingleRow(LyricBlockLine("a".repeat(40), noWrap = true), 14.0, 100.0))
    }

    @Test
    fun aOneRowLineOnTheLyricPagePullsTheCardFontDownToStayOneRow() {
        assertEquals(
            FitLyricResult(16.0, 12.8, 1, false),
            fitLyricBlock(
                listOf(flat("一二三四五六")),
                FitLyricOptions(
                    maxHeight = 100.0,
                    textWidth = 100.0,
                    fontSize = 20.0,
                    minFontSize = 14.0,
                    extendedRatio = 0.8,
                ),
            ),
        )
        assertEquals(
            FitLyricResult(20.0, 16.0, 1, false),
            fitLyricBlock(
                listOf(line("一二三四五六")),
                FitLyricOptions(
                    maxHeight = 100.0,
                    textWidth = 100.0,
                    fontSize = 20.0,
                    minFontSize = 14.0,
                    extendedRatio = 0.8,
                ),
            ),
        )
    }

    @Test
    fun resolveNoWrapTrustsTheLyricPageMeasurementFirst() {
        assertEquals(false, resolveNoWrap(2, "一二三", 20.0, 1000.0))
        assertEquals(true, resolveNoWrap(1, "一二三四五六七八九十".repeat(2), 20.0, 100.0))
    }

    @Test
    fun resolveNoWrapFallsBackToTheLyricPageGeometryForRowsNeverLaidOut() {
        assertEquals(true, resolveNoWrap(null, "一二三", 20.0, 100.0))
        assertEquals(false, resolveNoWrap(null, "一二三四五六七", 20.0, 100.0))
    }

    @Test
    fun wideAndNarrowCodePointsFeedTheWidthModel() {
        assertEquals(5.0, textWidthEm("一二三四五"), 1e-9)
        assertEquals(0.55, textWidthEm("a"), 1e-9)
        // 半宽 CJK 收尾符按窄字算（RN 的 0x303f 例外）
        assertEquals(0.55, textWidthEm("\u303F"), 1e-9)
        // 补充平面汉字（CJK 扩展 B）按一个全宽字算，而不是两个代理项
        assertEquals(1.0, textWidthEm("\uD840\uDC00"), 1e-9)
    }
}
