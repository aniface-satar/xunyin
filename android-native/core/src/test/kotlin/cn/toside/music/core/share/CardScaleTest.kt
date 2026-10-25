package cn.toside.music.core.share

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** 黄金值对照 RN `tests/share-card-scale.mts`（基准屏幕按 360×800dp）。 */
class CardScaleTest {
    private val masterWidth = 360.0
    private val masterHeight = 800.0
    private val boxWidth = masterWidth * CARD_WIDTH_RATIO
    private val boxHeight = masterHeight * CARD_MAX_HEIGHT_RATIO

    private fun scale(
        rectWidth: Double,
        rectHeight: Double,
    ) = cardScale(rectWidth, rectHeight, masterWidth, masterHeight)

    @Test
    fun fullscreenCanvasKeepsTheMasterCardAtExactlyOne() {
        assertEquals(1.0, scale(360.0, 800.0), 0.0)
    }

    @Test
    fun theFactorNeverGrowsPastOne() {
        assertEquals(1.0, scale(400.0, 900.0), 0.0)
    }

    @Test
    fun aShortCanvasIsBoundByHeight() {
        assertEquals(416.0 / boxHeight, scale(312.0, 416.0), 1e-12)
    }

    @Test
    fun aNarrowCanvasIsBoundByWidth() {
        assertEquals(200.0 / boxWidth, scale(200.0, 700.0), 1e-12)
    }

    @Test
    fun theScaledCardAlwaysFitsWithoutCropping() {
        for ((w, h) in listOf(312.0 to 468.0, 312.0 to 416.0, 312.0 to 554.0, 360.0 to 800.0)) {
            val k = scale(w, h)
            assertTrue(boxWidth * k <= w + 1e-9)
            assertTrue(boxHeight * k <= h + 1e-9)
        }
    }

    @Test
    fun theFactorIsTheLargestFittingOne() {
        val k = scale(312.0, 416.0)
        assertTrue(boxHeight * (k + 1e-6) > 416.0)
        assertTrue(boxWidth * k < 312.0)
    }

    @Test
    fun everyRatioKeepsTheCapturedWidthAtTheScreenWidth() {
        for (ratio in RATIO_OPTIONS) {
            assertEquals(360.0, shotRect(ratio, 360.0, 800.0).width, 0.0)
        }
    }

    @Test
    fun onlyTheLengthChangesWithTheRatio() {
        assertEquals(360.0 * 3 / 2, shotRect(RatioKey.RATIO_2_3, 360.0, 800.0).height, 0.0)
        assertEquals(360.0 * 7 / 5, shotRect(RatioKey.RATIO_5_7, 360.0, 800.0).height, 0.0)
        assertEquals(360.0 * 4 / 3, shotRect(RatioKey.RATIO_3_4, 360.0, 800.0).height, 0.0)
        assertEquals(360.0 * 16 / 9, shotRect(RatioKey.RATIO_9_16, 360.0, 800.0).height, 0.0)
        assertEquals(800.0, shotRect(RatioKey.FULLSCREEN, 360.0, 800.0).height, 0.0)
    }

    @Test
    fun fiveSevenIsOfferedBetweenTwoThreeAndThreeFour() {
        assertEquals(
            listOf("2:3", "5:7", "3:4", "9:16", "fullscreen"),
            RATIO_OPTIONS.map { it.label },
        )
        val fiveSeven = RATIO_OPTIONS.first { it.label == "5:7" }
        assertEquals(5, fiveSeven.w)
        assertEquals(7, fiveSeven.h)
    }

    @Test
    fun withWidthPinnedToTheScreenMostRatiosStayAtMasterSize() {
        fun scaleFor(ratio: RatioKey): Double {
            val rect = shotRect(ratio, 360.0, 800.0)
            return cardScale(rect.width, rect.height, masterWidth, masterHeight)
        }
        assertEquals(1.0, scaleFor(RatioKey.RATIO_2_3), 0.0)
        assertEquals(1.0, scaleFor(RatioKey.RATIO_5_7), 0.0)
        assertEquals(1.0, scaleFor(RatioKey.RATIO_9_16), 0.0)
        assertEquals(1.0, scaleFor(RatioKey.FULLSCREEN), 0.0)
        val threeFour = scaleFor(RatioKey.RATIO_3_4)
        assertTrue("3:4 只该轻微缩，实际 $threeFour", threeFour < 1.0 && threeFour > 0.95)
    }
}
