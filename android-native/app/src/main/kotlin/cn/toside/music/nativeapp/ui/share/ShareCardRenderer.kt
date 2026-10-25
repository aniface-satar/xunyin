package cn.toside.music.nativeapp.ui.share

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.text.StaticLayout
import android.text.TextPaint
import android.text.TextUtils
import androidx.compose.ui.graphics.asAndroidBitmap
import cn.toside.music.core.share.LYRIC_FOOTER_SINGER_FONT_SIZE
import cn.toside.music.core.share.LYRIC_FOOTER_TITLE_FONT_SIZE
import cn.toside.music.core.share.LYRIC_LINE_HEIGHT_RATIO
import cn.toside.music.core.share.ShareCardLayout
import cn.toside.music.core.share.ShareCardStyle
import cn.toside.music.core.share.ShareLyricLayout
import cn.toside.music.core.share.estimateRowCount
import cn.toside.music.nativeapp.R
import cn.toside.music.nativeapp.ui.play.CoverArt

/** 分享卡绘制所需的曲目信息（RN `ShareCardData`）。 */
data class ShareTrackInfo(
    val name: String,
    val singer: String,
    val coverUrl: String?,
)

/**
 * 分享卡渲染器：把 `:core/share` 的决策画成一张位图。
 *
 * 预览与导出显示/写入的**就是这同一张位图**（WYSIWYG），不存在第二套排版。
 * 为什么不用截屏：见 `docs/waves/w4-B.md` 的「导出方案选型」。
 */
object ShareCardRenderer {
    private const val HAIRLINE_PX = 1f
    private const val DEFAULT_LINE_HEIGHT_RATIO = 1.25f

    // ic_launcher_foreground 是 108 视口里的 music_note 字形（Material Symbols）。
    // 字形墨迹范围取自 pathData：x 30.5..68、y 32..76；把这一块精确映射到品牌行 14×13.1dp。
    private const val GLYPH_VIEWPORT = 108f
    private const val GLYPH_INK_LEFT = 30.5f
    private const val GLYPH_INK_TOP = 32f
    private const val GLYPH_INK_WIDTH = 37.5f
    private const val GLYPH_INK_HEIGHT = 44f

    fun render(
        context: Context,
        track: ShareTrackInfo,
        card: ShareCardLayout,
        lyric: ShareLyricLayout?,
        cover: CoverArt?,
    ): Bitmap {
        val density = context.resources.displayMetrics.density
        val width = (card.rect.width * density).toInt().coerceAtLeast(1)
        val height = (card.rect.height * density).toInt().coerceAtLeast(1)
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        drawBackdrop(canvas, card, cover, width, height)

        val k = density * card.scale.toFloat()
        val glyph = runCatching { context.getDrawable(R.drawable.ic_launcher_foreground) }.getOrNull()
        if (lyric == null) {
            drawMusicCard(canvas, track, card, cover, k, width, height, glyph)
        } else {
            drawLyricCard(canvas, track, card, lyric, cover, k, width, height, glyph)
        }
        return bitmap
    }

    /** 糊底：RN 走 Fresco 的 20dp 框糊；原生用 32px 缩略图放大近似（不新增模糊依赖）。 */
    private fun drawBackdrop(
        canvas: Canvas,
        card: ShareCardLayout,
        cover: CoverArt?,
        width: Int,
        height: Int,
    ) {
        canvas.drawColor(ShareCardStyle.BACKDROP_COLOR)
        val blur = cover?.blurSource?.asAndroidBitmap()
        if (blur != null) {
            val fill = maxOf(width.toFloat() / blur.width, height.toFloat() / blur.height)
            val matrix =
                Matrix().apply {
                    setScale(fill, fill)
                    postTranslate((width - blur.width * fill) / 2f, (height - blur.height * fill) / 2f)
                }
            canvas.drawBitmap(blur, matrix, Paint(Paint.FILTER_BITMAP_FLAG).apply { isAntiAlias = true })
        }
        canvas.drawColor(card.theme.scrimColor)
    }

    private fun drawMusicCard(
        canvas: Canvas,
        track: ShareTrackInfo,
        card: ShareCardLayout,
        cover: CoverArt?,
        k: Float,
        bitmapWidth: Int,
        bitmapHeight: Int,
        glyph: Drawable?,
    ) {
        val padding = ShareCardStyle.CARD_PADDING.toFloat() * k
        val textWidth = (card.cardTextWidth.toFloat() * k).toInt().coerceAtLeast(1)
        val titlePaint = textPaint(card.theme.titleColor, card.textSizes.title.toFloat() * k)
        val singerPaint = textPaint(card.theme.subtitleColor, card.textSizes.singer.toFloat() * k)
        val title =
            buildTextLayout(
                text = track.name,
                paint = titlePaint,
                widthPx = textWidth,
                maxLines = ShareCardStyle.MUSIC_TITLE_MAX_LINES,
                lineHeightPx = card.textSizes.titleLineHeight.toFloat() * k,
            )
        val singer =
            buildTextLayout(
                text = track.singer,
                paint = singerPaint,
                widthPx = textWidth,
                maxLines = ShareCardStyle.MUSIC_SINGER_MAX_LINES,
                lineHeightPx = card.textSizes.singer.toFloat() * DEFAULT_LINE_HEIGHT_RATIO * k,
            )
        val brand = buildBrand(card.theme.subtitleColor, k)

        val coverSize = card.coverSize.toFloat() * k
        val titleMargin = ShareCardStyle.MUSIC_TITLE_MARGIN_TOP.toFloat() * k
        val singerMargin = ShareCardStyle.MUSIC_SINGER_MARGIN_TOP.toFloat() * k
        val brandMargin = ShareCardStyle.BRAND_ROW_MARGIN_TOP.toFloat() * k
        val contentHeight =
            coverSize + titleMargin + title.height + singerMargin + singer.height + brandMargin + brand.height
        val cardWidth = card.cardWidth.toFloat() * k
        val cardHeight = minOf(padding * 2 + contentHeight, card.cardMaxHeight.toFloat() * k)
        val left = (bitmapWidth - cardWidth) / 2f
        val top = (bitmapHeight - cardHeight) / 2f

        beginCard(canvas, left, top, cardWidth, cardHeight, ShareCardStyle.CARD_RADIUS.toFloat() * k, card.theme.cardBackground)
        var y = top + padding
        drawCover(
            canvas = canvas,
            cover = cover,
            left = left + padding,
            top = y,
            size = coverSize,
            radius = ShareCardStyle.COVER_RADIUS.toFloat() * k,
            borderColor = card.theme.coverBorderColor,
        )
        y += coverSize + titleMargin
        drawLayout(canvas, title, left + padding, y)
        y += title.height + singerMargin
        drawLayout(canvas, singer, left + padding, y)
        y += singer.height + brandMargin
        drawBrand(canvas, brand, glyph, left + padding, y)
        canvas.restore()
    }

    private fun drawLyricCard(
        canvas: Canvas,
        track: ShareTrackInfo,
        card: ShareCardLayout,
        lyric: ShareLyricLayout,
        cover: CoverArt?,
        k: Float,
        bitmapWidth: Int,
        bitmapHeight: Int,
        glyph: Drawable?,
    ) {
        val padding = ShareCardStyle.CARD_PADDING.toFloat() * k
        val textWidth = (card.cardTextWidth.toFloat() * k).toInt().coerceAtLeast(1)
        val fit = lyric.fit
        val bodyPaint = textPaint(card.theme.lyricColor, fit.fontSize.toFloat() * k, bold = true)
        val extendedPaint = textPaint(card.theme.subtitleColor, fit.extendedFontSize.toFloat() * k)
        val bodyLineHeight = fit.fontSize.toFloat() * LYRIC_LINE_HEIGHT_RATIO.toFloat() * k
        val extendedLineHeight = fit.extendedFontSize.toFloat() * LYRIC_LINE_HEIGHT_RATIO.toFloat() * k

        val rows = mutableListOf<StaticLayout>()
        for (line in lyric.shown) {
            if (line.text.isNotBlank()) {
                // 钉一行必须同时满足「歌词页上没折行」与「这一档字号在卡宽里仍放得下一行」
                val oneRow = line.noWrap && estimateRowCount(line.text, fit.fontSize, card.cardTextWidth) <= 1
                rows += buildTextLayout(line.text, bodyPaint, textWidth, if (oneRow) 1 else null, bodyLineHeight)
            }
            for (extended in line.extendedLyrics) {
                if (extended.isNotBlank()) {
                    rows += buildTextLayout(extended, extendedPaint, textWidth, null, extendedLineHeight)
                }
            }
        }
        if (fit.truncated) {
            rows += buildTextLayout("…", extendedPaint, textWidth, 1, extendedLineHeight)
        }

        val footerTitlePaint = textPaint(card.theme.titleColor, LYRIC_FOOTER_TITLE_FONT_SIZE.toFloat() * k)
        val footerSingerPaint = textPaint(card.theme.subtitleColor, LYRIC_FOOTER_SINGER_FONT_SIZE.toFloat() * k)
        val miniCover = ShareCardStyle.LYRIC_MINI_COVER_SIZE.toFloat() * k
        val miniCoverMargin = ShareCardStyle.LYRIC_MINI_COVER_MARGIN_RIGHT.toFloat() * k
        val footerTextWidth = (textWidth - miniCover - miniCoverMargin).toInt().coerceAtLeast(1)
        val footerTitle =
            buildTextLayout(
                text = track.name,
                paint = footerTitlePaint,
                widthPx = footerTextWidth,
                maxLines = ShareCardStyle.LYRIC_FOOTER_TITLE_MAX_LINES,
                lineHeightPx = LYRIC_FOOTER_TITLE_FONT_SIZE.toFloat() * DEFAULT_LINE_HEIGHT_RATIO * k,
            )
        val footerSinger =
            buildTextLayout(
                text = track.singer,
                paint = footerSingerPaint,
                widthPx = footerTextWidth,
                maxLines = 1,
                lineHeightPx = LYRIC_FOOTER_SINGER_FONT_SIZE.toFloat() * DEFAULT_LINE_HEIGHT_RATIO * k,
            )
        val footerSingerMargin = ShareCardStyle.LYRIC_FOOTER_SINGER_MARGIN_TOP.toFloat() * k
        val footerTextHeight = footerTitle.height + footerSingerMargin + footerSinger.height
        val footerHeight = maxOf(miniCover, footerTextHeight)

        val brand = buildBrand(card.theme.subtitleColor, k)
        val separatorMargin = ShareCardStyle.LYRIC_SEPARATOR_MARGIN_VERTICAL.toFloat() * k
        val lyricBlockHeight = rows.sumOf { it.height.toDouble() }.toFloat()
        val brandMargin = ShareCardStyle.BRAND_ROW_MARGIN_TOP.toFloat() * k
        val contentHeight =
            lyricBlockHeight + separatorMargin * 2 + HAIRLINE_PX + footerHeight + brandMargin + brand.height
        val cardWidth = card.cardWidth.toFloat() * k
        val cardHeight = minOf(padding * 2 + contentHeight, card.cardMaxHeight.toFloat() * k)
        val left = (bitmapWidth - cardWidth) / 2f
        val top = (bitmapHeight - cardHeight) / 2f

        beginCard(canvas, left, top, cardWidth, cardHeight, ShareCardStyle.CARD_RADIUS.toFloat() * k, card.theme.cardBackground)
        var y = top + padding
        for (row in rows) {
            drawLayout(canvas, row, left + padding, y)
            y += row.height
        }
        y += separatorMargin
        val separatorPaint =
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = withOpacity(card.theme.subtitleColor, ShareCardStyle.LYRIC_SEPARATOR_OPACITY.toFloat())
            }
        canvas.drawRect(left + padding, y, left + padding + textWidth, y + HAIRLINE_PX, separatorPaint)
        y += HAIRLINE_PX + separatorMargin
        drawCover(
            canvas = canvas,
            cover = cover,
            left = left + padding,
            top = y,
            size = miniCover,
            radius = ShareCardStyle.LYRIC_MINI_COVER_RADIUS.toFloat() * k,
            borderColor = card.theme.coverBorderColor,
        )
        drawLayout(canvas, footerTitle, left + padding + miniCover + miniCoverMargin, y)
        drawLayout(
            canvas,
            footerSinger,
            left + padding + miniCover + miniCoverMargin,
            y + footerTitle.height + footerSingerMargin,
        )
        y += footerHeight + brandMargin
        drawBrand(canvas, brand, glyph, left + padding, y)
        canvas.restore()
    }

    /** 圆角裁剪 + 卡底；调用方负责配对的 [Canvas.restore]（RN 的 `overflow: hidden` 保险）。 */
    private fun beginCard(
        canvas: Canvas,
        left: Float,
        top: Float,
        width: Float,
        height: Float,
        radius: Float,
        background: Int,
    ) {
        val rect = RectF(left, top, left + width, top + height)
        val path = Path().apply { addRoundRect(rect, radius, radius, Path.Direction.CW) }
        canvas.save()
        canvas.clipPath(path)
        canvas.drawRoundRect(rect, radius, radius, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = background })
    }

    private fun drawCover(
        canvas: Canvas,
        cover: CoverArt?,
        left: Float,
        top: Float,
        size: Float,
        radius: Float,
        borderColor: Int,
    ) {
        val rect = RectF(left, top, left + size, top + size)
        val bitmap = cover?.cover?.asAndroidBitmap()
        if (bitmap != null) {
            val path = Path().apply { addRoundRect(rect, radius, radius, Path.Direction.CW) }
            canvas.save()
            canvas.clipPath(path)
            canvas.drawBitmap(bitmap, null, rect, Paint(Paint.FILTER_BITMAP_FLAG).apply { isAntiAlias = true })
            canvas.restore()
        }
        val border =
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.STROKE
                strokeWidth = HAIRLINE_PX
                color = borderColor
            }
        val bordered = RectF(rect).apply { inset(HAIRLINE_PX / 2f, HAIRLINE_PX / 2f) }
        canvas.drawRoundRect(bordered, radius, radius, border)
    }

    private class BrandBlock(
        val height: Float,
        val wordPaint: TextPaint,
        val glyphWidth: Float,
        val glyphHeight: Float,
        val glyphMarginRight: Float,
    )

    private fun buildBrand(
        color: Int,
        k: Float,
    ): BrandBlock {
        val glyphWidth = ShareCardStyle.BRAND_GLYPH_WIDTH.toFloat() * k
        val glyphHeight = ShareCardStyle.BRAND_GLYPH_HEIGHT.toFloat() * k
        val wordPaint = textPaint(color, ShareCardStyle.BRAND_WORD_FONT_SIZE.toFloat() * k)
        wordPaint.letterSpacing =
            (ShareCardStyle.BRAND_WORD_LETTER_SPACING / ShareCardStyle.BRAND_WORD_FONT_SIZE).toFloat()
        val wordHeight = wordPaint.fontMetrics.run { descent - ascent }
        return BrandBlock(
            height = maxOf(glyphHeight, wordHeight),
            wordPaint = wordPaint,
            glyphWidth = glyphWidth,
            glyphHeight = glyphHeight,
            glyphMarginRight = ShareCardStyle.BRAND_GLYPH_MARGIN_RIGHT.toFloat() * k,
        )
    }

    private fun drawBrand(
        canvas: Canvas,
        brand: BrandBlock,
        glyph: Drawable?,
        left: Float,
        top: Float,
    ) {
        if (glyph != null) {
            // contain：RN 的 PNG 本身就裁到墨迹（218×204），我们这张矢量墨迹更瘦高（37.5×44），
            // 等比缩进同一个 14×13.1 的框里再左对齐，字形不会被拉扁。
            val viewportScale = minOf(brand.glyphWidth / GLYPH_INK_WIDTH, brand.glyphHeight / GLYPH_INK_HEIGHT)
            val inkWidth = GLYPH_INK_WIDTH * viewportScale
            val inkHeight = GLYPH_INK_HEIGHT * viewportScale
            val inkLeft = left
            val inkTop = top + (brand.height - inkHeight) / 2f
            val boundsLeft = inkLeft - GLYPH_INK_LEFT * viewportScale
            val boundsTop = inkTop - GLYPH_INK_TOP * viewportScale
            glyph.setColorFilter(brand.wordPaint.color, PorterDuff.Mode.SRC_IN)
            glyph.setBounds(
                boundsLeft.toInt(),
                boundsTop.toInt(),
                (boundsLeft + GLYPH_VIEWPORT * viewportScale).toInt(),
                (boundsTop + GLYPH_VIEWPORT * viewportScale).toInt(),
            )
            glyph.draw(canvas)
            glyph.setColorFilter(null)
        }
        val textX = left + brand.glyphWidth + brand.glyphMarginRight
        val metrics = brand.wordPaint.fontMetrics
        val baseline = top + brand.height / 2f - (metrics.ascent + metrics.descent) / 2f
        canvas.drawText("Music", textX, baseline, brand.wordPaint)
    }

    private fun drawLayout(
        canvas: Canvas,
        layout: StaticLayout,
        left: Float,
        top: Float,
    ) {
        canvas.save()
        canvas.translate(left, top)
        layout.draw(canvas)
        canvas.restore()
    }

    private fun textPaint(
        color: Int,
        sizePx: Float,
        bold: Boolean = false,
    ): TextPaint =
        TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color
            textSize = sizePx
            typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
            isSubpixelText = true
        }

    private fun buildTextLayout(
        text: String,
        paint: TextPaint,
        widthPx: Int,
        maxLines: Int?,
        lineHeightPx: Float,
    ): StaticLayout {
        val metrics = paint.fontMetrics
        val extra = (lineHeightPx - (metrics.descent - metrics.ascent)).coerceAtLeast(0f)
        val builder =
            StaticLayout
                .Builder
                .obtain(text, 0, text.length, paint, widthPx)
                .setIncludePad(false)
                .setLineSpacing(extra, 1f)
                .setEllipsize(TextUtils.TruncateAt.END)
        if (maxLines != null) builder.setMaxLines(maxLines)
        return builder.build()
    }

    private fun withOpacity(
        color: Int,
        opacity: Float,
    ): Int {
        val alpha = (Color.alpha(color) * opacity).toInt().coerceIn(0, 255)
        return Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color))
    }
}
