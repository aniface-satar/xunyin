package cn.toside.music.nativeapp.lyric

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.view.Gravity
import android.widget.TextView
import cn.toside.music.nativeapp.lyric.DesktopLyricScrollMath.H_CENTER
import cn.toside.music.nativeapp.lyric.DesktopLyricScrollMath.H_END
import cn.toside.music.nativeapp.lyric.DesktopLyricScrollMath.H_START
import cn.toside.music.nativeapp.lyric.DesktopLyricScrollMath.INVALIDATE_DELAY_MS
import cn.toside.music.nativeapp.lyric.DesktopLyricScrollMath.START_SCROLL_DELAY_MS
import cn.toside.music.nativeapp.lyric.DesktopLyricScrollMath.V_BOTTOM
import cn.toside.music.nativeapp.lyric.DesktopLyricScrollMath.V_CENTER
import cn.toside.music.nativeapp.lyric.DesktopLyricScrollMath.V_TOP

/**
 * 桌面歌词的单行文本视图 —— RN `mobile/lyric/LyricTextView.java` 的移植。
 *
 * 继承 `TextView` 是为了能塞进 `TextSwitcher`（它把子 View 强转成 `TextView` 再 `setText`），
 * 但绘制完全自己来：**不调用 `super.onDraw`**，只用 `paint` 画一次文本（RN 同）。
 * 算法全在 [DesktopLyricScrollMath] 里，本类只管 paint / 重绘节奏 / 尺寸与重力。
 *
 * [scrollEnabled] 为 false 时（多行模式）退化成普通 `TextView`：直接走 `super.onDraw`，
 * 与改造前**逐像素一致**，多行显示一点没动。
 */
@SuppressLint("AppCompatCustomView")
internal class DesktopLyricTextView(
    context: Context,
) : TextView(context) {
    /** 单行模式下的横向滚动开关（多行模式关掉，走系统 TextView 绘制）。 */
    var scrollEnabled: Boolean = false
        set(value) {
            if (field == value) return
            field = value
            resetScroll()
        }

    private var textLength = 0f
    private var viewWidthPx = 0f
    private var viewHeightPx = 0f
    private var speed = 0f
    private var offsetX = 0f
    private var drawY = 0f
    private var stopped = true
    private var gravityHorizontal = H_START
    private var gravityVertical = V_TOP
    private var drawnText: String? = null

    private val startScrollRunnable = Runnable { startScroll() }
    private val invalidateRunnable = Runnable { invalidate() }

    override fun onDetachedFromWindow() {
        removeCallbacks(startScrollRunnable)
        removeCallbacks(invalidateRunnable)
        super.onDetachedFromWindow()
    }

    override fun onTextChanged(
        text: CharSequence,
        start: Int,
        lengthBefore: Int,
        lengthAfter: Int,
    ) {
        super.onTextChanged(text, start, lengthBefore, lengthAfter)
        stopScroll()
        drawnText = text.toString()
        resetScroll()
        postInvalidate()
        postDelayed(startScrollRunnable, START_SCROLL_DELAY_MS)
    }

    /** RN `setWidth`：视图宽由浮窗按 `widthPercent` 给，这里只记账。 */
    override fun setWidth(pixels: Int) {
        super.setWidth(pixels)
        viewWidthPx = pixels.toFloat()
        updateDrawY()
        restartIfReady()
    }

    override fun setHeight(pixels: Int) {
        super.setHeight(pixels)
        viewHeightPx = pixels.toFloat()
        updateDrawY()
        restartIfReady()
    }

    override fun setTextSize(size: Float) {
        super.setTextSize(size)
        speed = DesktopLyricScrollMath.speedOf(size)
        updateDrawY()
        restartIfReady()
    }

    override fun setShadowLayer(
        radius: Float,
        dx: Float,
        dy: Float,
        shadowColor: Int,
    ) {
        super.setShadowLayer(radius, dx, dy, shadowColor)
        restartIfReady()
    }

    override fun setGravity(gravity: Int) {
        var next = gravity
        if (next and Gravity.RELATIVE_HORIZONTAL_GRAVITY_MASK == 0) next = next or Gravity.START
        if (next and Gravity.VERTICAL_GRAVITY_MASK == 0) next = next or Gravity.TOP
        super.setGravity(next)
        gravityHorizontal =
            when (next and Gravity.RELATIVE_HORIZONTAL_GRAVITY_MASK) {
                Gravity.CENTER_HORIZONTAL -> H_CENTER
                Gravity.END -> H_END
                else -> H_START
            }
        gravityVertical =
            when (next and Gravity.VERTICAL_GRAVITY_MASK) {
                Gravity.CENTER_VERTICAL -> V_CENTER
                Gravity.BOTTOM -> V_BOTTOM
                else -> V_TOP
            }
        updateDrawY()
        restartIfReady()
    }

    override fun onDraw(canvas: Canvas) {
        if (!scrollEnabled) {
            super.onDraw(canvas)
            return
        }
        val text = drawnText
        if (text != null) {
            textLength = paint.measureText(text)
            val stepSpeed = DesktopLyricScrollMath.effectiveSpeed(textSize, text.length)
            val draw = DesktopLyricScrollMath.drawX(offsetX, textLength, viewWidthPx, gravityHorizontal)
            if (draw.fits) stopped = true
            canvas.drawText(text, draw.x, drawY, paint)
            if (!stopped) {
                val step = DesktopLyricScrollMath.advance(offsetX, stepSpeed, viewWidthPx, textLength)
                offsetX = step.x
                stopped = step.stopped
                invalidateAfter()
            }
        }
    }

    private fun invalidateAfter() {
        removeCallbacks(invalidateRunnable)
        postDelayed(invalidateRunnable, INVALIDATE_DELAY_MS)
    }

    private fun startScroll() {
        resetScroll()
        stopped = false
        postInvalidate()
    }

    private fun stopScroll() {
        stopped = true
        removeCallbacks(startScrollRunnable)
        postInvalidate()
    }

    /** RN `init()`：偏移归零、重新量文本长度。 */
    private fun resetScroll() {
        offsetX = 0f
        val text = text?.toString()
        textLength = if (text.isNullOrEmpty()) 0f else paint.measureText(text)
    }

    private fun updateDrawY() {
        val metrics = paint.fontMetrics
        drawY =
            DesktopLyricScrollMath.drawY(
                gravityVertical = gravityVertical,
                viewHeight = viewHeightPx,
                fontTop = metrics.top,
                fontBottom = metrics.bottom,
                fontAscent = metrics.ascent,
            )
    }

    private fun restartIfReady() {
        if (drawnText == null) return
        post(startScrollRunnable)
    }
}
