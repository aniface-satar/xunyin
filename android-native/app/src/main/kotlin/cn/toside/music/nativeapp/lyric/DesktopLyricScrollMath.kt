package cn.toside.music.nativeapp.lyric

import kotlin.math.roundToInt

/**
 * 桌面歌词「单行横向滚动」的纯算法 —— RN `mobile/lyric/LyricTextView.java` 的静态部分。
 *
 * 抽出来的原因：滚动的步进/停靠/对齐全是浮点运算，不碰 Android API，
 * 可以直接进 JVM 单测（样本表见 `DesktopLyricScrollMathTest`）。
 * 逐字对齐 RN，包括那几处看着像 bug 但 RN 真就这么写的地方：
 *
 * - 速度 `SPEED_LIMIT * textSize`，**文本长度 ≥ 20 时速度翻倍**（RN `onDraw` 里的 `mSpeed += mSpeed`）；
 * - 判定「滚到底」用的是**本帧移动前**的 `xx`（RN `if (viewWidth - xx + mSpeed >= textLength)`）；
 * - 滚到底时 `xx` 被钉在 `viewWidth - textLength - 2`（末尾留 2px，RN 同）；
 * - 文本比视图窄时不滚，且**就地停表**（RN `getDrawX` 里 `isStop = true`）。
 *
 * 重力用本文件自己的常量表示，避免把 `android.view.Gravity` 拖进纯函数。
 */
object DesktopLyricScrollMath {
    /** RN `LyricTextView.SPEED_LIMIT`：速度与字号的换算系数。 */
    const val SPEED_LIMIT = 0.135f

    /** RN `startScrollDelay`：换文本后停 1.5 秒才开始滚（给长句一个可读的静止窗口）。 */
    const val START_SCROLL_DELAY_MS = 1500L

    /** RN `invalidateDelay`：滚动期间每 10ms 重绘一帧。 */
    const val INVALIDATE_DELAY_MS = 10L

    /** RN 的速度翻倍阈值：文本字符数 ≥ 20 时按两倍速滚。 */
    const val LONG_TEXT_LENGTH = 20

    /** RN 滚到底时末尾留的 2px。 */
    const val END_MARGIN_PX = 2f

    const val H_START = 0
    const val H_CENTER = 1
    const val H_END = 2

    const val V_TOP = 0
    const val V_CENTER = 1
    const val V_BOTTOM = 2

    /** RN `speed = SPEED_LIMIT * getTextSize()`。 */
    fun speedOf(textSizePx: Float): Float = SPEED_LIMIT * textSizePx

    /** RN `onDraw`：`if (getText().length() >= 20) mSpeed += mSpeed`。 */
    fun effectiveSpeed(
        textSizePx: Float,
        textLength: Int,
    ): Float {
        val base = speedOf(textSizePx)
        return if (textLength >= LONG_TEXT_LENGTH) base * 2f else base
    }

    data class ScrollStep(
        /** 下一帧的 `xx`（文本左端相对视图左端的偏移，滚动时为负）。 */
        val x: Float,
        /** true = 已经滚到底，本次之后停表。 */
        val stopped: Boolean,
    )

    /**
     * 一帧的步进（RN `onDraw` 里 `if (!isStop) { ... }` 那一段）。
     *
     * 注意判定用的是**移动前**的 [x]，RN 原样。
     */
    fun advance(
        x: Float,
        speed: Float,
        viewWidth: Float,
        textLength: Float,
    ): ScrollStep {
        val endX = viewWidth - textLength - END_MARGIN_PX
        return if (viewWidth - x + speed >= textLength) {
            ScrollStep(endX, stopped = true)
        } else {
            ScrollStep(x - speed, stopped = false)
        }
    }

    data class DrawX(
        val x: Float,
        /** true = 文本比视图窄，不需要滚（RN 在这里直接 `isStop = true`）。 */
        val fits: Boolean,
    )

    /** RN `getDrawX`：放得下就按水平重力摆，放不下才用滚动偏移。 */
    fun drawX(
        x: Float,
        textLength: Float,
        viewWidth: Float,
        gravityHorizontal: Int,
    ): DrawX {
        if (textLength < viewWidth) {
            val aligned =
                when (gravityHorizontal) {
                    H_CENTER -> (viewWidth - textLength) / 2f
                    H_END -> viewWidth - textLength
                    else -> 0f
                }
            return DrawX(aligned, fits = true)
        }
        return DrawX(x, fits = false)
    }

    /** RN `getDrawY`：基线纵坐标只跟垂直重力与字体度量有关。 */
    fun drawY(
        gravityVertical: Int,
        viewHeight: Float,
        fontTop: Float,
        fontBottom: Float,
        fontAscent: Float,
    ): Float =
        when (gravityVertical) {
            V_CENTER -> viewHeight / 2f + (fontBottom - fontTop) / 2f - fontBottom
            V_BOTTOM -> viewHeight - fontBottom
            else -> -fontAscent
        }

    /**
     * 位置百分比的落库形态（W7 写侧）：RN 写的是 `x / maxWidth * 100` 的浮点数，
     * 这里保留两位小数，避免把 `33.500000004` 这种浮点噪声写进设置文件。
     */
    fun roundPercent(value: Double): Double = (value * 100.0).roundToInt() / 100.0
}
