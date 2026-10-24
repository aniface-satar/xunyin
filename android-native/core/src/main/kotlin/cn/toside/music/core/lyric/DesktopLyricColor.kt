package cn.toside.music.core.lyric

/**
 * 设置里的歌词颜色字符串 → ARGB —— RN `LyricView.parseColor` 的移植。
 *
 * RN 先匹配 CSS 风格 `rgba?()`，否则交给 `Color.parseColor`，失败回退黑色。
 * 默认值都是 `rgba(...)`（见 [cn.toside.music.core.setting.DefaultSetting.base]），
 * 该函数的 alpha 是 0-1 的小数，换算成 0-255。
 */
object DesktopLyricColor {
    private const val OPAQUE_BLACK = 0xFF000000.toInt()

    private val RGBA = Regex("""rgba? *\( *(\d+), *(\d+), *(\d+)(?:, *([\d.]+))? *\)""")
    private val HEX = Regex("""[0-9a-fA-F]+""")

    fun parse(input: String): Int {
        val raw = input.trim()
        if (raw.startsWith("#")) return parseHex(raw)
        val match = RGBA.matchEntire(raw) ?: return OPAQUE_BLACK
        val red = match.groupValues[1].toIntOrNull() ?: return OPAQUE_BLACK
        val green = match.groupValues[2].toIntOrNull() ?: return OPAQUE_BLACK
        val blue = match.groupValues[3].toIntOrNull() ?: return OPAQUE_BLACK
        val alpha = match.groupValues[4].takeIf { it.isNotEmpty() }?.toFloatOrNull() ?: 1f
        return argb((alpha * 255).toInt(), red, green, blue)
    }

    private fun parseHex(input: String): Int {
        val hex = input.substring(1)
        if (!HEX.matches(hex)) return OPAQUE_BLACK
        return when (hex.length) {
            3 -> argb(255, dup(hex[0]), dup(hex[1]), dup(hex[2]))
            4 -> argb(dup(hex[0]), dup(hex[1]), dup(hex[2]), dup(hex[3]))
            6 -> argb(255, hex.at(0), hex.at(2), hex.at(4))
            8 -> argb(hex.at(0), hex.at(2), hex.at(4), hex.at(6))
            else -> OPAQUE_BLACK
        }
    }

    private fun dup(c: Char): Int = ("$c$c").toInt(16)

    /** 取相邻两位十六进制并转 Int。 */
    private fun String.at(start: Int): Int = substring(start, start + 2).toInt(16)

    private fun argb(
        alpha: Int,
        red: Int,
        green: Int,
        blue: Int,
    ): Int =
        (alpha.coerceIn(0, 255) shl 24) or
            (red.coerceIn(0, 255) shl 16) or
            (green.coerceIn(0, 255) shl 8) or
            blue.coerceIn(0, 255)
}
