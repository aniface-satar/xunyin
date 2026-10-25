package cn.toside.music.core.share

/** 分享卡的「基准整体 + 等比缩放」常数（`src/components/ShareCard/cardScale.ts` 的移植）。 */
const val CARD_WIDTH_RATIO = 0.78
const val CARD_MAX_HEIGHT_RATIO = 0.62

data class ShotRect(
    val width: Double,
    val height: Double,
)

/** 比例档。整数对而不是 w/h 小数：`宽 × h ÷ w` 在 360dp 宽上恰好落在整数。 */
enum class RatioKey(
    val label: String,
    val w: Int?,
    val h: Int?,
) {
    RATIO_2_3("2:3", 2, 3),
    RATIO_5_7("5:7", 5, 7),
    RATIO_3_4("3:4", 3, 4),
    RATIO_9_16("9:16", 9, 16),
    FULLSCREEN("fullscreen", null, null),
}

val RATIO_OPTIONS: List<RatioKey> =
    listOf(
        RatioKey.RATIO_2_3,
        RatioKey.RATIO_5_7,
        RatioKey.RATIO_3_4,
        RatioKey.RATIO_9_16,
        RatioKey.FULLSCREEN,
    )

/**
 * 卡片外层的等比缩放因子：封顶 1（基准就是全屏那张，切比例只有缩出去）。
 * 两个轴共用这一个数 —— 等比是构造上保证的。
 */
fun cardScale(
    rectWidth: Double,
    rectHeight: Double,
    masterWidth: Double,
    masterHeight: Double,
): Double =
    minOf(
        1.0,
        rectWidth / (masterWidth * CARD_WIDTH_RATIO),
        rectHeight / (masterHeight * CARD_MAX_HEIGHT_RATIO),
    )

/** 被拍矩形（= 导出图）的尺寸：宽恒等于屏宽，比例只改长度。 */
fun shotRect(
    ratio: RatioKey,
    screenWidth: Double,
    screenHeight: Double,
): ShotRect {
    val w = ratio.w
    val h = ratio.h
    return if (w == null || h == null) {
        ShotRect(screenWidth, screenHeight)
    } else {
        ShotRect(screenWidth, screenWidth * h / w)
    }
}
