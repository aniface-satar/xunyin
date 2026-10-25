package cn.toside.music.core.share

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** 黄金值对照 RN `tests/share-card-fit-lyric-block.mts` 里的 cardTextSizes 一节。 */
class CardTypographyTest {
    @Test
    fun twentySixLettersFillTheLineOnA360DpScreen() {
        // 360 × 0.78 = 280.8，减两侧 padding 20 ⇒ 文字列 240.8dp
        val sizes = cardTextSizes(240.8)
        assertEquals(18.5, sizes.title, 0.0)
        assertEquals(13.9, sizes.singer, 0.0)
        assertEquals(23.1, sizes.titleLineHeight, 0.0)
        // 判据本体：26 个字母 × 0.5em × 字号 ≈ 列宽（落 0.1 后仍在 1dp 内）
        assertTrue(Math.abs(26 * 0.5 * sizes.title - 240.8) < 1)
    }

    @Test
    fun theRuleIsCappedAt24AndFlooredAt14() {
        assertEquals(24.0, cardTextSizes(1000.0).title, 0.0)
        assertEquals(14.0, cardTextSizes(100.0).title, 0.0)
    }

    @Test
    fun derivedSizesFollowTheRoundedTitle() {
        val sizes = cardTextSizes(1000.0)
        assertEquals(30.0, sizes.titleLineHeight, 0.0)
        assertEquals(18.0, sizes.singer, 0.0)
    }

    @Test
    fun unmeasurableWidthFallsBackToTheCap() {
        for (width in listOf(Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY)) {
            val sizes = cardTextSizes(width)
            assertEquals(24.0, sizes.title, 0.0)
            assertTrue(sizes.singer.isFinite())
            assertTrue(sizes.titleLineHeight.isFinite())
        }
    }

    @Test
    fun theGoldenWidthUsesTheRoundedValueForDerivedSizes() {
        // 240.8 → 18.5 → 18.5 × 1.25 = 23.125 → 23.1；18.5 × 0.75 = 13.875 → 13.9
        val sizes = cardTextSizes(240.8)
        assertEquals(23.1, sizes.titleLineHeight, 0.0)
        assertEquals(13.9, sizes.singer, 0.0)
    }
}
