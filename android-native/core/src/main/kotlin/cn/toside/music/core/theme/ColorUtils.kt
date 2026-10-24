package cn.toside.music.core.theme

/**
 * 主题颜色生成系统 —— 从 RN 侧 src/theme/themes/colorUtils.js 精确移植。
 *
 * JS 原版行为（黄金测试锁死）：
 * - RGB_Linear_Shade 输出逗号后无空格："rgb(69,158,112)"；
 *   带 alpha 输入时 alpha 段保留原串（含前导空格）："rgba(169,115,61, 1)"。
 * - RGB_Alpha_Shade 输出逗号后有空格、alpha 恒两位小数："rgba(77, 175, 124, 0.90)"。
 * - 通道解析用 parseInt 语义（截断浮点，"66.6" → 66）。
 */
internal object RgbParser {
    data class Rgb(
        val r: Int,
        val g: Int,
        val b: Int,
        /** 原始 alpha 串（含前导空格，如 " 1"）；无 alpha 时为 null。 */
        val alphaRaw: String?,
    )

    /** JS parseInt 语义：解析数字前缀，容忍小数与前导空格。 */
    private fun jsParseInt(s: String): Int? {
        val t = s.trim()
        val end = t.indexOfFirst { !it.isDigit() && it != '.' && it != '-' }
        val numStr = if (end == -1) t else t.substring(0, end)
        val d = numStr.toDoubleOrNull() ?: return null
        return d.toInt() // 截断
    }

    private fun jsParseFloat(s: String): Double? = s.trim().toDoubleOrNull()

    /** 解析 "rgb(r, g, b)" / "rgba(r, g, b, a)"；不匹配返回 null。 */
    fun parse(color: String): Rgb? {
        val rgba = color.startsWith("rgba(")
        if (!(rgba || color.startsWith("rgb("))) return null
        val close = color.lastIndexOf(')')
        if (close < 0) return null
        val inner = if (rgba) color.substring(5, close) else color.substring(4, close)
        val parts = inner.split(',')
        if (parts.size < 3) return null
        val r = jsParseInt(parts[0]) ?: return null
        val g = jsParseInt(parts[1]) ?: return null
        val b = jsParseInt(parts[2]) ?: return null
        val alphaRaw =
            if (rgba && parts.size >= 4) {
                // JS 原版直接引用第四段原串（含空格）
                inner.substring(inner.indexOf(',', inner.indexOf(',', inner.indexOf(',') + 1) + 1) + 1)
            } else {
                null
            }
        return Rgb(r, g, b, alphaRaw)
    }

    /** alpha 原串的数值。 */
    fun alphaValue(alphaRaw: String?): Double? = alphaRaw?.let { jsParseFloat(it) }
}

/**
 * Shade（明暗调整）：JS 原版 RGB_Linear_Shade 的精确移植。
 * p ∈ [-1.0, 1.0]，负数向黑色，正数向白色。
 */
fun rgbLinearShade(
    p: Double,
    color: String,
): String {
    val c = RgbParser.parse(color) ?: return color
    val negative = p < 0
    val t = if (negative) 0.0 else 255.0 * p
    val factor = if (negative) 1 + p else 1 - p

    fun shade(v: Int): Int = Math.round(v * factor + t).toInt()
    val r = shade(c.r)
    val g = shade(c.g)
    val b = shade(c.b)
    return if (c.alphaRaw != null) {
        "rgba($r,$g,$b,${c.alphaRaw})"
    } else {
        "rgb($r,$g,$b)"
    }
}

/**
 * Alpha 修改：JS 原版 RGB_Alpha_Shade 的精确移植。
 * p ∈ [-1.0, 1.0]；有 alpha 时按比例缩放，无 alpha 时视作 a=1。
 * 输出 "rgba(r, g, b, a)"（逗号后有空格，alpha 两位小数 toFixed(2)）。
 */
fun rgbAlphaShade(
    p: Double,
    color: String,
): String {
    val c = RgbParser.parse(color) ?: return color
    val negative = p < 0
    val current = RgbParser.alphaValue(c.alphaRaw) ?: 1.0
    val a: Double =
        if (c.alphaRaw != null) {
            val scaled = current - (if (negative) (1 - current) * p else current * p)
            if (negative) maxOf(0.0, scaled) else minOf(1.0, scaled)
        } else {
            minOf(1.0, 1 - p)
        }
    return "rgba(${c.r}, ${c.g}, ${c.b}, ${a.toFixed2()})"
}

/** JS toFixed(2) 的等价输出（恒两位小数）。 */
private fun Double.toFixed2(): String = String.format("%.2f", this)
