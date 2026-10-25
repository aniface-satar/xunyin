package cn.toside.music.core.share

/**
 * 分享卡配色（`src/components/ShareCard/cardTheme.ts` 的移植）。
 *
 * 卡色跟随应用深浅模式：深色黑卡、浅色白卡，音乐卡与歌词卡共用同一张选票。
 * 两套卡底都是**不透明实底**；[scrimColor] 只铺在封面糊底上（20% 黑）。
 */
data class CardTheme(
    val cardBackground: Int,
    val titleColor: Int,
    val subtitleColor: Int,
    val lyricColor: Int,
    val scrimColor: Int,
    val coverBorderColor: Int,
)

val LIGHT_CARD_THEME =
    CardTheme(
        cardBackground = 0xFFFFFFFF.toInt(),
        titleColor = 0xFF1C1C1E.toInt(),
        subtitleColor = 0xFF8E8E93.toInt(),
        lyricColor = 0xFF1C1C1E.toInt(),
        // rgba(0,0,0,0.20)：0.20 × 255 = 51 = 0x33
        scrimColor = 0x33000000,
        coverBorderColor = 0xFF000000.toInt(),
    )

val DARK_CARD_THEME =
    CardTheme(
        cardBackground = 0xFF000000.toInt(),
        titleColor = 0xFFFFFFFF.toInt(),
        // rgba(255,255,255,0.72)：0.72 × 255 = 183.6 → 0xB8
        subtitleColor = 0xB8FFFFFF.toInt(),
        lyricColor = 0xFFFFFFFF.toInt(),
        scrimColor = 0x33000000,
        coverBorderColor = 0xFFFFFFFF.toInt(),
    )

fun pickCardTheme(isDark: Boolean): CardTheme = if (isDark) DARK_CARD_THEME else LIGHT_CARD_THEME
