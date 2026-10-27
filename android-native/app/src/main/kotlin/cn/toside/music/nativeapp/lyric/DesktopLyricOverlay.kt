package cn.toside.music.nativeapp.lyric

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.text.Spannable
import android.text.SpannableString
import android.text.style.ForegroundColorSpan
import android.util.TypedValue
import android.view.Gravity
import android.view.animation.AlphaAnimation
import android.view.animation.AnimationSet
import android.view.animation.TranslateAnimation
import android.widget.TextSwitcher

/**
 * 桌面歌词浮窗的内容视图 —— RN `LyricSwitchView.java` + `LyricTextView.java` 的移植。
 *
 * 两个 [DesktopLyricTextView] 靠 [TextSwitcher] 逐行切换；`showToggleAnima` 时做
 * 300ms 向上滑动 + 淡入淡出。单行模式走 [DesktopLyricTextView] 的自绘横向滚动，
 * **不再是 MVP 的 marquee 截断**（W7 对齐 RN `LyricTextView`，算法见
 * [DesktopLyricScrollMath]）。
 */
internal class DesktopLyricOverlay(
    context: Context,
    config: DesktopLyricConfig,
) : TextSwitcher(context) {
    private val views = listOf(DesktopLyricTextView(context), DesktopLyricTextView(context))
    private var lyricText: String = ""
    private var unplayColor: Int = Color.WHITE

    init {
        views.forEach { addView(it) }
        applyConfig(config)
    }

    fun applyConfig(config: DesktopLyricConfig) {
        // RN 桥：textSize = 设置值 / 10，alpha = opacity / 100
        val textSizeSp = config.fontSizeTenths.coerceAtLeast(10) / 10f
        unplayColor = config.unplayColor
        views.forEach { view ->
            view.scrollEnabled = config.singleLine
            view.setTextSize(TypedValue.COMPLEX_UNIT_SP, textSizeSp)
            view.setTextColor(config.playedColor)
            view.setShadowLayer(1.6f, 1.5f, 1.3f, config.shadowColor)
            view.gravity = gravityOf(config.textPositionX, config.textPositionY)
            if (config.singleLine) {
                view.isSingleLine = true
                // 单行横向滚动由自绘 onDraw 负责，不能留 marquee：
                // 它会把文本截成「…」并且和自己的滚动偏移打架
                view.ellipsize = null
                view.isSelected = false
            } else {
                view.maxLines = config.maxLineNum.coerceAtLeast(1)
                view.ellipsize = null
            }
        }
        alpha = (config.opacityPercent / 100f).coerceIn(0f, 1f)
        val animationHeight = views.first().textSize
        if (config.showToggleAnima) {
            setInAnimation(slideAnimation(animationHeight, enter = true))
            setOutAnimation(slideAnimation(animationHeight, enter = false))
        } else {
            setInAnimation(null)
            setOutAnimation(null)
        }
        // RN：解锁态是 #29000000/2dp 圆角底，锁定态透明（靠文字阴影保证可读）
        background =
            if (config.locked) {
                null
            } else {
                GradientDrawable().apply {
                    setColor(0x29000000)
                    cornerRadius = 2 * resources.displayMetrics.density
                }
            }
    }

    /**
     * 内容没变就不切，否则 200ms 轮询会让 TextSwitcher 一直播动画。
     *
     * 多行模式下第一行（正在唱的那句）用 `lyricPlayedColor`，其余行（译文/罗马音）
     * 用 `lyricUnplayColor`——见 W7 语义修正：RN 那个键收了却没渲染，
     * 这里按「未播放的次要文字」的角色用上。
     */
    fun setLyric(lines: List<String>) {
        val text = lines.joinToString("\n")
        if (text == lyricText) return
        lyricText = text
        setText(colorize(lines, text))
    }

    private fun colorize(
        lines: List<String>,
        text: String,
    ): CharSequence {
        if (lines.size < 2) return text
        val spannable = SpannableString(text)
        var start = lines.first().length + 1
        for (index in 1 until lines.size) {
            val end = (start + lines[index].length).coerceAtMost(text.length)
            if (start < end) {
                spannable.setSpan(
                    ForegroundColorSpan(unplayColor),
                    start,
                    end,
                    Spannable.SPAN_EXCLUSIVE_EXCLUSIVE,
                )
            }
            start = end + 1
        }
        return spannable
    }

    fun lineHeightPx(): Int {
        val metrics = views.first().paint.fontMetricsInt
        return (metrics.descent - metrics.ascent).coerceAtLeast(1)
    }

    fun applySize(
        widthPx: Int,
        heightPx: Int,
    ) {
        views.forEach {
            it.width = widthPx
            it.height = heightPx
        }
    }

    private fun slideAnimation(
        height: Float,
        enter: Boolean,
    ): AnimationSet =
        AnimationSet(true).apply {
            addAnimation(
                TranslateAnimation(
                    0f,
                    0f,
                    if (enter) height else 0f,
                    if (enter) 0f else -height,
                ).apply { duration = ANIMATION_MS },
            )
            addAnimation(
                AlphaAnimation(
                    if (enter) 0f else 1f,
                    if (enter) 1f else 0f,
                ).apply { duration = ANIMATION_MS },
            )
        }

    private fun gravityOf(
        x: String,
        y: String,
    ): Int {
        val horizontal =
            when (x.lowercase()) {
                "center" -> Gravity.CENTER_HORIZONTAL
                "right" -> Gravity.END
                else -> Gravity.START
            }
        val vertical =
            when (y.lowercase()) {
                "center" -> Gravity.CENTER_VERTICAL
                "bottom" -> Gravity.BOTTOM
                else -> Gravity.TOP
            }
        return horizontal or vertical
    }

    private companion object {
        const val ANIMATION_MS = 300L
    }
}
