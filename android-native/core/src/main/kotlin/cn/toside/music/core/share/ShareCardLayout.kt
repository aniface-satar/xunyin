package cn.toside.music.core.share

import cn.toside.music.core.lyric.ParsedLyric

/**
 * 分享卡几何与卡内样式常数（`src/components/ShareCard/index.tsx` 等文件的移植）。
 *
 * 这里只放决策：绘制层拿到的每个 dp 值都应能在这里或 [ShareCardLayout] 找到出处。
 */
object ShareCardStyle {
    const val CARD_PADDING = 20.0

    /** 糊底半径（RN Fresco 的 20dp；原生用缩略图放大近似，见 lane 报告的选型）。 */
    const val BLUR_RADIUS = 20.0
    const val CARD_RADIUS = 20.0
    const val COVER_RADIUS = 12.0

    /** 歌词卡底部：省略号一行 + 分隔线 + 小封面行 + 落款 ≈ 160dp。 */
    const val LYRIC_FOOTER_RESERVE = 160.0

    /** 音乐卡封面之外的那几行：标题 + 歌手 + 落款 ≈ 200dp。 */
    const val MUSIC_CARD_TEXT_RESERVE = 200.0

    const val MUSIC_TITLE_MARGIN_TOP = 18.0
    const val MUSIC_SINGER_MARGIN_TOP = 6.0
    const val MUSIC_TITLE_MAX_LINES = 3
    const val MUSIC_SINGER_MAX_LINES = 2

    const val LYRIC_SEPARATOR_OPACITY = 0.35
    const val LYRIC_SEPARATOR_MARGIN_VERTICAL = 14.0
    const val LYRIC_MINI_COVER_SIZE = 56.0
    const val LYRIC_MINI_COVER_RADIUS = 8.0
    const val LYRIC_MINI_COVER_MARGIN_RIGHT = 12.0
    const val LYRIC_FOOTER_SINGER_MARGIN_TOP = 2.0
    const val LYRIC_FOOTER_TITLE_MAX_LINES = 2

    const val BRAND_ROW_MARGIN_TOP = 16.0
    const val BRAND_GLYPH_WIDTH = 14.0
    const val BRAND_GLYPH_HEIGHT = 13.1
    const val BRAND_GLYPH_MARGIN_RIGHT = 5.0
    const val BRAND_WORD_FONT_SIZE = 17.0
    const val BRAND_WORD_LETTER_SPACING = 0.2

    /** 糊底缺失时的底色（RN `styles.fill` 的 backgroundColor）。 */
    val BACKDROP_COLOR: Int = 0xFF111114.toInt()
}

/** 一张卡的全部几何决策（dp）。卡盒按基准屏幕算，[scale] 只缩这个整体。 */
data class ShareCardLayout(
    val theme: CardTheme,
    val rect: ShotRect,
    val cardWidth: Double,
    val cardMaxHeight: Double,
    val scale: Double,
    val coverSize: Double,
    val lyricMaxHeight: Double,
    val cardTextWidth: Double,
    val textSizes: CardTextSizes,
)

fun buildShareCardLayout(
    isDark: Boolean,
    ratio: RatioKey,
    screenWidth: Double,
    screenHeight: Double,
): ShareCardLayout {
    val rect = shotRect(ratio, screenWidth, screenHeight)
    val cardWidth = screenWidth * CARD_WIDTH_RATIO
    val cardMaxHeight = screenHeight * CARD_MAX_HEIGHT_RATIO
    val scale = cardScale(rect.width, rect.height, screenWidth, screenHeight)
    val padding = ShareCardStyle.CARD_PADDING
    val coverSize =
        maxOf(
            0.0,
            minOf(
                cardWidth - padding * 2,
                cardMaxHeight - padding * 2 - ShareCardStyle.MUSIC_CARD_TEXT_RESERVE,
            ),
        )
    val lyricMaxHeight = maxOf(0.0, cardMaxHeight - padding * 2 - ShareCardStyle.LYRIC_FOOTER_RESERVE)
    val cardTextWidth = maxOf(0.0, cardWidth - padding * 2)
    return ShareCardLayout(
        theme = pickCardTheme(isDark),
        rect = rect,
        cardWidth = cardWidth,
        cardMaxHeight = cardMaxHeight,
        scale = scale,
        coverSize = coverSize,
        lyricMaxHeight = lyricMaxHeight,
        cardTextWidth = cardTextWidth,
        textSizes = cardTextSizes(cardTextWidth),
    )
}

/** 歌词卡的排版结果：整首的块行 + 适配决策 + 实际显示的前 N 句。 */
data class ShareLyricLayout(
    val lines: List<LyricBlockLine>,
    val fit: FitLyricResult,
    val shown: List<LyricBlockLine>,
)

fun buildShareLyricLayout(
    lines: List<LyricBlockLine>,
    card: ShareCardLayout,
    lyricFontSizeDp: Double?,
): ShareLyricLayout {
    val fit =
        fitLyricBlock(
            lines,
            FitLyricOptions(
                maxHeight = card.lyricMaxHeight,
                textWidth = card.cardTextWidth,
                fontSize = lyricFontSizeDp,
                minFontSize = if (lyricFontSizeDp != null) LYRIC_MIN_FONT_SIZE else null,
                extendedRatio = EXTENDED_FONT_RATIO,
            ),
        )
    return ShareLyricLayout(lines, fit, lines.take(fit.visibleCount))
}

/**
 * 解析后的歌词 → 卡内块行。
 *
 * RN 的歌词卡数据来自歌词工具页的「选中行」，原生这一波没有工具页，MVP 用整首：
 * 丢掉正文与译文都空白的行，其余按歌词页的宽度/字号决定 [LyricBlockLine.noWrap]。
 */
fun lyricBlockLines(
    parsed: ParsedLyric,
    pageFontSize: Double,
    pageTextWidth: Double,
): List<LyricBlockLine> =
    parsed.lines.mapNotNull { line ->
        val extended = line.extendedLyrics
        if (line.text.isBlank() && extended.none { it.isNotBlank() }) {
            null
        } else {
            LyricBlockLine(
                text = line.text,
                extendedLyrics = extended,
                noWrap = resolveNoWrap(null, line.text, pageFontSize, pageTextWidth),
            )
        }
    }
