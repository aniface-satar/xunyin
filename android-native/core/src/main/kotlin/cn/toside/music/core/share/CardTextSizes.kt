package cn.toside.music.core.share

/**
 * 音乐卡字号判据（`src/components/ShareCard/cardTypography.ts` 的移植）：
 * 一行最多容纳 26 个平均英文字母（0.5em），整块字号随卡内文字列宽走。
 */
data class CardTextSizes(
    val title: Double,
    val titleLineHeight: Double,
    val singer: Double,
)

private const val AVG_LATIN_LETTER_EM = 0.5
private const val MAX_LETTERS_PER_LINE = 26.0

/** 上限钉在旧手写值 24dp：卡再宽也不把字放回去。 */
private const val MAX_TITLE_FONT_SIZE = 24.0

/** 下限：小屏上按判据会算到读不动的字号，宁可一行多装几个字母。 */
private const val MIN_TITLE_FONT_SIZE = 14.0
private const val SINGER_FONT_RATIO = 0.75
private const val TITLE_LINE_HEIGHT_RATIO = 1.25

fun cardTextSizes(textWidth: Double): CardTextSizes {
    val byLetters = textWidth / MAX_LETTERS_PER_LINE / AVG_LATIN_LETTER_EM
    // 量不出宽度（NaN/Infinity）时按上限那档走，与改动前的手写值一致
    val title =
        if (byLetters.isFinite()) {
            byLetters.coerceIn(MIN_TITLE_FONT_SIZE, MAX_TITLE_FONT_SIZE)
        } else {
            MAX_TITLE_FONT_SIZE
        }
    val rounded = round1(title)
    return CardTextSizes(
        title = rounded,
        titleLineHeight = round1(rounded * TITLE_LINE_HEIGHT_RATIO),
        singer = round1(rounded * SINGER_FONT_RATIO),
    )
}
