package cn.toside.music.nativeapp.lyric

import android.content.Context
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.animation.AlphaAnimation
import android.view.animation.AnimationSet
import android.view.animation.TranslateAnimation
import android.widget.TextSwitcher
import android.widget.TextView

/**
 * 桌面歌词浮窗的内容视图 —— RN `LyricSwitchView.java` + `LyricTextView.java` 的 MVP 版。
 *
 * 两个 TextView 靠 [TextSwitcher] 逐行切换；`showToggleAnima` 时做 300ms 向上滑动 + 淡入淡出。
 * 单行模式不做 RN 的横向滚动，改用 marquee 截断显示（差异记入 lane 报告）。
 */
internal class DesktopLyricOverlay(
    context: Context,
    config: DesktopLyricConfig,
) : TextSwitcher(context) {
    private val views = listOf(TextView(context), TextView(context))
    private var lyricText: String = ""

    init {
        views.forEach { addView(it) }
        applyConfig(config)
    }

    fun applyConfig(config: DesktopLyricConfig) {
        // RN 桥：textSize = 设置值 / 10，alpha = opacity / 100
        val textSizeSp = config.fontSizeTenths.coerceAtLeast(10) / 10f
        views.forEach { view ->
            view.setTextSize(TypedValue.COMPLEX_UNIT_SP, textSizeSp)
            view.setTextColor(config.playedColor)
            view.setShadowLayer(1.6f, 1.5f, 1.3f, config.shadowColor)
            view.gravity = gravityOf(config.textPositionX, config.textPositionY)
            if (config.singleLine) {
                view.isSingleLine = true
                view.ellipsize = TextUtils.TruncateAt.MARQUEE
                view.isSelected = true
            } else {
                view.maxLines = config.maxLineNum.coerceAtLeast(1)
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

    /** 内容没变就不切，否则 200ms 轮询会让 TextSwitcher 一直播动画。 */
    fun setLyric(text: String) {
        if (text == lyricText) return
        lyricText = text
        setText(text)
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
