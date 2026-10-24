package cn.toside.music.core.theme

/**
 * 主题颜色生成器 —— 从 RN 侧 src/theme/themes/utils.js 的 createThemeColors
 * 及 src/theme/themes/createThemes.js 的 defaultThemes 配置精确移植。
 *
 * 生成结构与 themes.ts（RN 侧生成物）完全一致：
 * - c-primary + 10 级 dark + 9 级 light + light-1000，各带 alpha-100..900
 * - c-theme（暗色主题取 light-900）
 * - 字体颜色 c-1000 及 c-950..c-000（20 级）
 */
object ThemeColors {
    /** 生成的主题颜色表（键 → css 颜色串）。 */
    fun createThemeColors(
        primary: String,
        font: String?,
        isDark: Boolean,
    ): Map<String, String> {
        val colors = linkedMapOf("c-primary" to primary)

        // dark 100..1000
        var preColor = primary
        for (i in 1..10) {
            preColor = rgbLinearShade(if (isDark) 0.2 else -0.1, preColor)
            colors["c-primary-dark-${i * 100}"] = preColor
            for (j in 1..9) {
                colors["c-primary-dark-${i * 100}-alpha-${j * 100}"] = rgbAlphaShade(0.1 * j, preColor)
                colors["c-primary-alpha-${j * 100}"] = rgbAlphaShade(0.1 * j, primary)
            }
        }
        // light 100..900
        preColor = primary
        for (i in 1..9) {
            preColor = rgbLinearShade(if (isDark) -0.1 else 0.2, preColor)
            colors["c-primary-light-${i * 100}"] = preColor
            for (j in 1..9) {
                colors["c-primary-light-${i * 100}-alpha-${j * 100}"] = rgbAlphaShade(0.1 * j, preColor)
            }
        }
        // light 1000（最后一级再做一次特殊 shade）
        preColor = rgbLinearShade(if (isDark) -0.35 else 1.0, preColor)
        colors["c-primary-light-1000"] = preColor
        for (j in 1..9) {
            colors["c-primary-light-1000-alpha-${j * 100}"] = rgbAlphaShade(0.1 * j, preColor)
        }

        colors["c-theme"] = if (isDark) colors.getValue("c-primary-light-900") else primary

        colors.putAll(createFontColors(font, isDark))
        return colors
    }

    /** 字体颜色梯度：亮色主题按 0.05 累进、暗色主题每步独立 shade。 */
    private fun createFontColors(
        rgbaColor: String?,
        isDark: Boolean,
    ): Map<String, String> {
        val color = rgbaColor ?: if (isDark) "rgb(229, 229, 229)" else "rgb(33, 33, 33)"
        if (isDark) return createFontDarkColors(color)

        val colors = linkedMapOf("c-1000" to color)
        val step = if (isDark) -0.05 else 0.05
        for (i in 1..20) {
            colors["c-${(1000 - 50 * i).toString().padStart(3, '0')}"] = rgbLinearShade(step * i, color)
        }
        return colors
    }

    /** 暗色字体：JS 原版逐级 -0.05 且基于前级颜色累积。 */
    private fun createFontDarkColors(rgbaColor: String): Map<String, String> {
        val colors = linkedMapOf("c-1000" to rgbaColor)
        val step = -0.05
        var preColor = rgbaColor
        for (i in 1..20) {
            preColor = rgbLinearShade(step, preColor)
            colors["c-${(1000 - 50 * i).toString().padStart(3, '0')}"] = preColor
        }
        return colors
    }
}
