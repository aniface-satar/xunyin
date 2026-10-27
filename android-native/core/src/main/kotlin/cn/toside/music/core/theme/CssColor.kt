package cn.toside.music.core.theme

import java.util.Locale
import kotlin.math.roundToInt

/**
 * CSS 颜色字符串与 ARGB 整数之间的纯 Kotlin 转换。
 *
 * 主题表（`DefaultThemes` / `ThemeColors`）里的颜色都是 RN 侧的原串（`rgb(...)` / `rgba(...)`），
 * 装配 Compose 主题时需要整数；取色器返回的整数也要能拼回 CSS。
 * 只做解析/格式化与 WCAG 对比度，不依赖 Android。
 */
object CssColor {
    private val rgbRegex = Regex("^rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*(?:,\\s*([0-9.]+)\\s*)?\\)$")

    /** 解析 `rgb(r, g, b)` / `rgba(r, g, b, a)`；失败返回 null。返回 0xAARRGGBB。 */
    fun parse(raw: String?): Int? {
        val text = raw?.trim().orEmpty()
        val match = rgbRegex.find(text) ?: return null
        val r = match.groupValues[1].toIntOrNull()?.coerceIn(0, 255) ?: return null
        val g = match.groupValues[2].toIntOrNull()?.coerceIn(0, 255) ?: return null
        val b = match.groupValues[3].toIntOrNull()?.coerceIn(0, 255) ?: return null
        val alphaRaw = match.groupValues[4]
        val a =
            if (alphaRaw.isEmpty()) {
                255
            } else {
                val value = alphaRaw.toDoubleOrNull() ?: return null
                (value.coerceIn(0.0, 1.0) * 255).roundToInt()
            }
        return (a shl 24) or (r shl 16) or (g shl 8) or b
    }

    /** 0xAARRGGBB → `rgb(r, g, b)`（丢弃 alpha，用于纯色底）。 */
    fun toCssRgb(argb: Int): String = "rgb(${red(argb)}, ${green(argb)}, ${blue(argb)})"

    /** 0xAARRGGBB + 0..1 的 alpha → `rgba(r, g, b, a)`；alpha 两位小数，与 RN 输出一致。 */
    fun toCssRgba(
        argb: Int,
        alpha: Double,
    ): String = String.format(Locale.US, "rgba(%d, %d, %d, %.2f)", red(argb), green(argb), blue(argb), alpha.coerceIn(0.0, 1.0))

    fun red(argb: Int): Int = (argb shr 16) and 0xFF

    fun green(argb: Int): Int = (argb shr 8) and 0xFF

    fun blue(argb: Int): Int = argb and 0xFF

    fun alpha(argb: Int): Int = (argb ushr 24) and 0xFF

    fun withAlpha(
        argb: Int,
        alpha: Double,
    ): Int = ((alpha.coerceIn(0.0, 1.0) * 255).roundToInt() shl 24) or (argb and 0x00FFFFFF)

    /** 半透明色铺在给定底色上（sRGB 通道混合），返回不透明色。 */
    fun over(
        argb: Int,
        backdrop: Int,
    ): Int {
        val a = alpha(argb) / 255.0
        if (a >= 1.0) return argb
        val r = (red(argb) * a + red(backdrop) * (1 - a)).toInt()
        val g = (green(argb) * a + green(backdrop) * (1 - a)).toInt()
        val b = (blue(argb) * a + blue(backdrop) * (1 - a)).toInt()
        return (0xFF shl 24) or (r shl 16) or (g shl 8) or b
    }

    /** sRGB 相对亮度（WCAG 2.x）。 */
    fun luminance(argb: Int): Double {
        fun channel(value: Int): Double {
            val v = value / 255.0
            return if (v <= 0.03928) v / 12.92 else Math.pow((v + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(red(argb)) + 0.7152 * channel(green(argb)) + 0.0722 * channel(blue(argb))
    }

    /** WCAG 对比度，1..21。 */
    fun contrastRatio(
        a: Int,
        b: Int,
    ): Double {
        val la = luminance(a)
        val lb = luminance(b)
        return (maxOf(la, lb) + 0.05) / (minOf(la, lb) + 0.05)
    }

    /** 近似 CIELAB L*（0..100），只用于"明度差多少档"的阈值判断。 */
    fun lightnessStar(argb: Int): Double {
        val y = luminance(argb)
        return if (y <= 0.008856) y * 903.3 else 116 * Math.cbrt(y) - 16
    }
}
