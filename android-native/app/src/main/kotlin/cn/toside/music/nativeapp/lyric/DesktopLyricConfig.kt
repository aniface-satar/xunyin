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
    const val SHOW_TRANSLATION = "desktopLyric.isShowTranslation"
    const val SHOW_ROMA = "desktopLyric.isShowRoma"
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
    /** 桌面歌词**独立**的译文开关（W7 新增键，默认 true = 改造前观感）。 */
    val showTranslation: Boolean,
    /** 桌面歌词**独立**的罗马音开关（W7 新增键，默认 true：RN 桌面扩展行无条件显示）。 */
    val showRoma: Boolean,
    val widthPercent: Int,
    val maxLineNum: Int,
    val fontSizeTenths: Int,
    val opacityPercent: Int,
    val playedColor: Int,
    /** `desktopLyric.style.lyricUnplayColor`：扩展行（译文/罗马音）的文字色，见 W7 语义修正。 */
    val unplayColor: Int,
    val shadowColor: Int,
    /**
     * `desktopLyric.position.x/y`：滑杆写出的百分比是浮点（会出现 33.5）。
     *
     * W7-1 读侧收口：默认值键表侧由 Lane A 改成 `0.0`（Int 默认会把小数截成整数），
     * 这里字段改 `Double` + `double()` 读取——A 的改动并入后，写→读→重启全链路
     * 小数等值往返，不再每次重启漂移。
     */
    val positionX: Double,
    val positionY: Double,
    val textPositionX: String,
    val textPositionY: String,
)

internal fun SettingsStore.desktopLyricConfig(): DesktopLyricConfig =
    DesktopLyricConfig(
        singleLine = bool(DesktopLyricKeys.SINGLE_LINE),
        showToggleAnima = bool(DesktopLyricKeys.SHOW_TOGGLE_ANIMA),
        locked = bool(DesktopLyricKeys.LOCK),
        // W7 新键：老库里没有这一键时，SettingsStore.merge 用 DefaultSetting 表尾的
        // 默认值（译文/罗马音都 true）兜底，因此升级后观感与改造前一致。
        showTranslation = bool(DesktopLyricKeys.SHOW_TRANSLATION),
        showRoma = bool(DesktopLyricKeys.SHOW_ROMA),
        widthPercent = int(DesktopLyricKeys.WIDTH),
        maxLineNum = int(DesktopLyricKeys.MAX_LINE_NUM),
        fontSizeTenths = int(DesktopLyricKeys.FONT_SIZE),
        opacityPercent = int(DesktopLyricKeys.OPACITY),
        playedColor = DesktopLyricColor.parse(string(DesktopLyricKeys.PLAYED_COLOR)),
        unplayColor = DesktopLyricColor.parse(string(DesktopLyricKeys.UNPLAY_COLOR)),
        shadowColor = DesktopLyricColor.parse(string(DesktopLyricKeys.SHADOW_COLOR)),
        positionX = double(DesktopLyricKeys.POSITION_X),
        positionY = double(DesktopLyricKeys.POSITION_Y),
        textPositionX = string(DesktopLyricKeys.TEXT_POSITION_X),
        textPositionY = string(DesktopLyricKeys.TEXT_POSITION_Y),
    )
