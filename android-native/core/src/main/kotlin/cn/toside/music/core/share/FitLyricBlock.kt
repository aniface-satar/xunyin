package cn.toside.music.core.share

/**
 * 歌词海报「装得下多少句」判据（`src/components/ShareCard/fitLyricBlock.ts` 的移植）。
 *
 * 两种模式：
 * - 连续档（给了 [FitLyricOptions.fontSize] + [FitLyricOptions.minFontSize] 时，歌词卡走这条）：
 *   从歌词页字号逐 dp 下探到卡内歌手名那一档，取装得最多的一档；同句数留更大字号。
 * - 五档自适应（旧音乐卡路线）：[LYRIC_TIERS] 逐档尝试。
 *
 * 高度模型：给了 [FitLyricOptions.textWidth] 就按估宽折行数算，否则一句当一行。
 * 整句才收：装不下的那句连同译文一起丢掉（宁可少一句，不切半句）。
 */
data class LyricBlockLine(
    val text: String,
    val extendedLyrics: List<String> = emptyList(),
    /** 这一句在歌词页上没有折行；卡里也应尽量保持一行。 */
    val noWrap: Boolean = false,
)

data class FitLyricOptions(
    val maxHeight: Double,
    val tiers: List<Double> = LYRIC_TIERS,
    val lineHeightRatio: Double? = null,
    val extendedTierFloor: Double? = null,
    val textWidth: Double? = null,
    val extendedRatio: Double? = null,
    val fontSize: Double? = null,
    val minFontSize: Double? = null,
    val fontSizeStep: Double? = null,
)

data class FitLyricResult(
    val fontSize: Double,
    val extendedFontSize: Double,
    val visibleCount: Int,
    val truncated: Boolean,
)

val LYRIC_TIERS: List<Double> = listOf(24.0, 22.0, 20.0, 18.0, 16.0)

/** 正文已在最低档时译文的下探地板。 */
const val EXTENDED_TIER_FLOOR = 12.0
const val LYRIC_LINE_HEIGHT_RATIO = 1.5

/** 歌词卡落款：卡内唯一不随歌词字号变动的两个数。 */
const val LYRIC_FOOTER_TITLE_FONT_SIZE = 16.0
const val LYRIC_FOOTER_SINGER_FONT_SIZE = 14.0

/** 歌词正文逐 dp 下探的地板 = 卡内歌手名那一档。 */
const val LYRIC_MIN_FONT_SIZE = LYRIC_FOOTER_SINGER_FONT_SIZE
const val EXTENDED_FONT_RATIO = 0.8
const val WRAP_SLACK_ROWS = 1

/** 估宽的字宽模型：全宽区段 1em；拉丁、空格、标点取 0.55em（往保守侧抬）。 */
private const val NARROW_EM = 0.55

internal fun textWidthEm(text: String): Double {
    var total = 0.0
    var index = 0
    while (index < text.length) {
        val code = Character.codePointAt(text, index)
        total += if (isWideCodePoint(code)) 1.0 else NARROW_EM
        index += Character.charCount(code)
    }
    return total
}

/** 全宽区段：谚文、CJK、全角形式/符号、CJK 扩展 B~G。 */
private val WIDE_CODE_POINT_RANGES =
    listOf(
        0x1100..0x115F,
        0x2E80..0xA4CF,
        0xAC00..0xD7A3,
        0xF900..0xFAFF,
        0xFE30..0xFE6F,
        0xFF00..0xFF60,
        0xFFE0..0xFFE6,
        0x20000..0x3FFFD,
    )

private fun isWideCodePoint(code: Int): Boolean {
    if (code < 0x1100) return false
    if (code == 0x303F) return false // 半宽 CJK 区段收尾
    return WIDE_CODE_POINT_RANGES.any { code in it }
}

/** 一句在给定字号/列宽下折几行。空白句不占行；宽度无效时退回「一句一行」。 */
fun estimateRowCount(
    text: String?,
    fontSize: Double,
    textWidth: Double,
): Int {
    if (text == null || text.isBlank()) return 0
    if (!(textWidth > 0) || !(fontSize > 0)) return 1
    return maxOf(1, kotlin.math.ceil(textWidthEm(text) * fontSize / textWidth).toInt())
}

/** 这一档字号下，歌词页上没折行的句子在卡里还放不放得进一行。 */
fun fitsSingleRow(
    line: LyricBlockLine,
    fontSize: Double,
    textWidth: Double,
): Boolean = !line.noWrap || estimateRowCount(line.text, fontSize, textWidth) <= 1

/**
 * 这一句在卡里该不该钉成一行：歌词页量到的行数优先；没量到（FlatList 只挂载附近几行）
 * 就按歌词页自己的排版宽度与字号估一行。
 */
fun resolveNoWrap(
    measuredRows: Int?,
    text: String,
    pageFontSize: Double,
    pageTextWidth: Double,
): Boolean = measuredRows?.let { it <= 1 } ?: (estimateRowCount(text, pageFontSize, pageTextWidth) <= 1)

/** 从用户字号到地板的一串候选（含两端、降序、去重），默认步长 1dp。 */
fun lyricFontSizes(
    max: Double,
    min: Double,
    step: Double = 1.0,
): List<Double> {
    if (!isPositive(max)) return emptyList()
    val floor = if (isPositive(min)) round1(minOf(max, min)) else round1(max)
    val sizes = mutableListOf(round1(max))
    val stride = if (isPositive(step)) step else 1.0
    var size = max
    while (size - stride > floor) {
        val next = round1(size - stride)
        if (next != sizes.last()) sizes.add(next)
        size -= stride
    }
    if (sizes.last() != floor) sizes.add(floor)
    return sizes
}

fun fitLyricBlock(
    lines: List<LyricBlockLine>,
    options: FitLyricOptions,
): FitLyricResult {
    val ratio = options.lineHeightRatio ?: LYRIC_LINE_HEIGHT_RATIO
    val floor = options.extendedTierFloor ?: EXTENDED_TIER_FLOOR
    val wrapWidth = options.textWidth?.takeIf { it.isFinite() && it > 0 } ?: 0.0

    fun countFitting(
        body: Double,
        ext: Double,
    ): Int {
        // 行高确定时不留余量：那一整行余量会白白挤掉一句
        val estimated =
            wrapWidth > 0 &&
                lines.any { line ->
                    !line.noWrap ||
                        line.extendedLyrics.any { it.isNotBlank() } ||
                        estimateRowCount(line.text, body, wrapWidth) > 1
                }
        val slack = if (estimated) WRAP_SLACK_ROWS * rowHeight(body, ratio) else 0.0
        val budget = options.maxHeight - slack
        var height = 0.0
        var count = 0
        for (line in lines) {
            val h = blockHeight(line, body, ext, ratio, wrapWidth)
            if (height + h > budget) break
            height += h
            count++
        }
        return count
    }

    val startFont = options.fontSize
    val minFont = options.minFontSize
    if (isPositive(startFont) && isPositive(minFont)) {
        val extendedRatio = options.extendedRatio ?: EXTENDED_FONT_RATIO

        // 译文跟着正文字号走，但不越过正文，也不低于既有地板
        fun extendedOf(body: Double): Double = minOf(body, maxOf(floor, round1(body * extendedRatio)))

        val sizes = lyricFontSizes(startFont!!, minFont!!, options.fontSizeStep ?: 1.0)
        // 上界：让歌词页上一行的句子在卡里也保持一行的最大字号。
        // 连地板都放不进一行的长句不在约束里 —— 不该为它把整张卡拖到地板。
        val smallest = sizes.last()
        val keepOneRow = lines.filter { it.noWrap && fitsSingleRow(it, smallest, wrapWidth) }
        val safeIndex = sizes.indexOfFirst { body -> keepOneRow.all { fitsSingleRow(it, body, wrapWidth) } }
        val start = if (safeIndex >= 0) safeIndex else 0
        var best: FitLyricResult? = null
        for (i in start until sizes.size) {
            val body = sizes[i]
            val extendedFontSize = extendedOf(body)
            val visibleCount = countFitting(body, extendedFontSize)
            val current = best
            if (current == null || visibleCount > current.visibleCount) {
                best = FitLyricResult(body, extendedFontSize, visibleCount, visibleCount < lines.size)
            }
            // 降序扫描：第一次「全装得下」就是能装下全部的最大字号
            if (visibleCount == lines.size) break
        }
        best?.let { return it }
    }

    val tiers = options.tiers
    // visibleCount 给 -1 让第一档一定「严格更多」从而接管它；之后同句数留在更大字号
    var fallback =
        FitLyricResult(
            fontSize = tiers.lastOrNull() ?: 0.0,
            extendedFontSize = floor,
            visibleCount = -1,
            truncated = lines.isNotEmpty(),
        )
    for (i in tiers.indices) {
        val body = tiers[i]
        val ext = tiers.getOrNull(i + 1) ?: floor
        val count = countFitting(body, ext)
        if (count == lines.size) {
            return FitLyricResult(body, ext, count, false)
        }
        if (count > fallback.visibleCount) {
            fallback = FitLyricResult(body, ext, count, true)
        }
    }
    return fallback
}

private fun rowHeight(
    fontSize: Double,
    ratio: Double,
): Double = fontSize * ratio

/** 一句占多高：正文按折行数 + 每个非空译文按折行数；空白行不占高。 */
private fun blockHeight(
    line: LyricBlockLine,
    body: Double,
    ext: Double,
    ratio: Double,
    textWidth: Double,
): Double {
    var height = estimateRowCount(line.text, body, textWidth) * rowHeight(body, ratio)
    for (text in line.extendedLyrics) {
        height += estimateRowCount(text, ext, textWidth) * rowHeight(ext, ratio)
    }
    return height
}

private fun isPositive(value: Double?): Boolean = value != null && value.isFinite() && value > 0
