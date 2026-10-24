package cn.toside.music.nativeapp.lyric

import cn.toside.music.core.lyric.DesktopLyricColor
import cn.toside.music.core.setting.SettingsStore

/** `desktopLyric.*` 键名（键与默认值已在 core DefaultSetting 里齐全，这里只引用）。 */
internal object DesktopLyricKeys {
    const val ENABLE = "desktopLyric.enable"
    const val LOCK = "desktopLyric.isLock"
    const val WIDTH = "desktopLyric.width"
    const val MAX_LINE_NUM = "desktopLyric.maxLineNum"
    const val SINGLE_LINE = "desktopLyric.isSingleLine"
    const val SHOW_TOGGLE_ANIMA = "desktopLyric.showToggleAnima"
    const val POSITION_X = "desktopLyric.position.x"
    const val POSITION_Y = "desktopLyric.position.y"
    const val TEXT_POSITION_X = "desktopLyric.textPosition.x"
    const val TEXT_POSITION_Y = "desktopLyric.textPosition.y"
    const val FONT_SIZE = "desktopLyric.style.fontSize"
    const val OPACITY = "desktopLyric.style.opacity"
    const val UNPLAY_COLOR = "desktopLyric.style.lyricUnplayColor"
    const val PLAYED_COLOR = "desktopLyric.style.lyricPlayedColor"
    const val SHADOW_COLOR = "desktopLyric.style.lyricShadowColor"
}

/**
 * 浮窗所需的设置快照 —— 对照 RN `core/desktopLyric.ts#showDesktopLyric` 的入参。
 *
 * 字号/透明度在 RN 桥里做了换算（`fontSize / 10`、`opacity / 100`），这里同样存
 * 设置原值，渲染时再换算。
 */
internal data class DesktopLyricConfig(
    val singleLine: Boolean,
    val showToggleAnima: Boolean,
    val locked: Boolean,
    val widthPercent: Int,
    val maxLineNum: Int,
    val fontSizeTenths: Int,
    val opacityPercent: Int,
    val playedColor: Int,
    val shadowColor: Int,
    val positionX: Int,
    val positionY: Int,
    val textPositionX: String,
    val textPositionY: String,
)

internal fun SettingsStore.desktopLyricConfig(): DesktopLyricConfig =
    DesktopLyricConfig(
        singleLine = bool(DesktopLyricKeys.SINGLE_LINE),
        showToggleAnima = bool(DesktopLyricKeys.SHOW_TOGGLE_ANIMA),
        locked = bool(DesktopLyricKeys.LOCK),
        widthPercent = int(DesktopLyricKeys.WIDTH),
        maxLineNum = int(DesktopLyricKeys.MAX_LINE_NUM),
        fontSizeTenths = int(DesktopLyricKeys.FONT_SIZE),
        opacityPercent = int(DesktopLyricKeys.OPACITY),
        playedColor = DesktopLyricColor.parse(string(DesktopLyricKeys.PLAYED_COLOR)),
        shadowColor = DesktopLyricColor.parse(string(DesktopLyricKeys.SHADOW_COLOR)),
        positionX = int(DesktopLyricKeys.POSITION_X),
        positionY = int(DesktopLyricKeys.POSITION_Y),
        textPositionX = string(DesktopLyricKeys.TEXT_POSITION_X),
        textPositionY = string(DesktopLyricKeys.TEXT_POSITION_Y),
    )
