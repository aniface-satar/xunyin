package cn.toside.music.nativeapp.lyric

import cn.toside.music.nativeapp.lyric.DesktopLyricScrollMath.H_CENTER
import cn.toside.music.nativeapp.lyric.DesktopLyricScrollMath.H_END
import cn.toside.music.nativeapp.lyric.DesktopLyricScrollMath.H_START
import cn.toside.music.nativeapp.lyric.DesktopLyricScrollMath.V_BOTTOM
import cn.toside.music.nativeapp.lyric.DesktopLyricScrollMath.V_CENTER
import cn.toside.music.nativeapp.lyric.DesktopLyricScrollMath.V_TOP
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 单行横向滚动的样本表 —— 逐条对照 RN `mobile/lyric/LyricTextView.java`。
 *
 * 这些数字看着别扭但都是 RN 的真实行为（滚动方向为负、到底判定用移动前的偏移、
 * 长句翻倍速），改动前先想清楚是不是 RN 就是这么写的。
 */
class DesktopLyricScrollMathTest {
    private val speed = DesktopLyricScrollMath.speedOf(20f)

    @Test
    fun speedIsProportionalToTextSize() {
        assertEquals(2.7f, DesktopLyricScrollMath.speedOf(20f), 1e-5f)
        assertEquals(1.35f, DesktopLyricScrollMath.speedOf(10f), 1e-5f)
    }

    /** RN `if (getText().length() >= 20) mSpeed += mSpeed`。 */
    @Test
    fun longTextDoublesSpeed() {
        assertEquals(2.7f, DesktopLyricScrollMath.effectiveSpeed(20f, 19), 1e-5f)
        assertEquals(5.4f, DesktopLyricScrollMath.effectiveSpeed(20f, 20), 1e-5f)
        assertEquals(5.4f, DesktopLyricScrollMath.effectiveSpeed(20f, 120), 1e-5f)
    }

    @Test
    fun scrollMovesTextLeftwards() {
        val step = DesktopLyricScrollMath.advance(x = 0f, speed = speed, viewWidth = 200f, textLength = 500f)
        assertEquals(-2.7f, step.x, 1e-5f)
        assertFalse(step.stopped)
    }

    /** RN 的到底判定用的是移动**前**的偏移，不是移动后。 */
    @Test
    fun reachingTheEndPinsOffsetAndStops() {
        // viewWidth - x + speed >= textLength → 200 - (-497) + 2.7 >= 500
        val step = DesktopLyricScrollMath.advance(x = -497f, speed = speed, viewWidth = 200f, textLength = 500f)
        assertEquals(200f - 500f - 2f, step.x, 1e-5f)
        assertTrue(step.stopped)
    }

    @Test
    fun oneFrameBeforeTheEndStillMoves() {
        // 临界点：200 - x + 2.7 >= 500，即 x <= -297.3；-295 还差一帧才到底
        val step = DesktopLyricScrollMath.advance(x = -295f, speed = speed, viewWidth = 200f, textLength = 500f)
        assertFalse(step.stopped)
        assertEquals(-297.7f, step.x, 1e-4f)
    }

    @Test
    fun shortTextIsAlignedByGravityAndNeverScrolls() {
        assertEquals(
            0f,
            DesktopLyricScrollMath.drawX(0f, textLength = 100f, viewWidth = 200f, H_START).x,
            1e-5f,
        )
        assertEquals(
            50f,
            DesktopLyricScrollMath.drawX(0f, textLength = 100f, viewWidth = 200f, H_CENTER).x,
            1e-5f,
        )
        assertEquals(
            100f,
            DesktopLyricScrollMath.drawX(0f, textLength = 100f, viewWidth = 200f, H_END).x,
            1e-5f,
        )
        assertTrue(DesktopLyricScrollMath.drawX(0f, 100f, 200f, H_CENTER).fits)
        assertFalse(DesktopLyricScrollMath.drawX(-10f, 500f, 200f, H_CENTER).fits)
    }

    /** RN `getDrawY`：三种垂直重力各一套基线算法。 */
    @Test
    fun baselineFollowsVerticalGravity() {
        val top = DesktopLyricScrollMath.drawY(V_TOP, 100f, -30f, 8f, -28f)
        val center = DesktopLyricScrollMath.drawY(V_CENTER, 100f, -30f, 8f, -28f)
        val bottom = DesktopLyricScrollMath.drawY(V_BOTTOM, 100f, -30f, 8f, -28f)
        assertEquals(28f, top, 1e-5f)
        assertEquals(50f + 19f - 8f, center, 1e-5f)
        assertEquals(92f, bottom, 1e-5f)
    }

    /** W7 写侧：位置百分比保留两位小数，与 RN 的浮点落盘形状对齐。 */
    @Test
    fun storedPercentKeepsTwoDecimals() {
        assertEquals(33.5, DesktopLyricScrollMath.roundPercent(33.500000004), 1e-9)
        assertEquals(33.53, DesktopLyricScrollMath.roundPercent(33.526), 1e-9)
        assertEquals(0.0, DesktopLyricScrollMath.roundPercent(0.0), 1e-9)
        assertEquals(100.0, DesktopLyricScrollMath.roundPercent(100.0), 1e-9)
    }
}
