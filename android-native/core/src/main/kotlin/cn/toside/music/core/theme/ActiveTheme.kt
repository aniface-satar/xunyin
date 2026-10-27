package cn.toside.music.core.theme

/**
 * 应用主题的运行时形态 —— 从 RN 侧 `src/theme/themes/index.ts`
 * 的 `getTheme` / `buildActiveThemeColors` 移植。
 *
 * RN 语义（实证）：
 * - 「跟随系统」只影响**夜间是否强制黑主题**：
 *   `common.isAutoTheme && shouldUseDarkColors ? 'black' : theme.id`
 *   （`theme.lightId` / `theme.darkId` 的读取代码在 RN 里是注释掉的，属于遗留键，不参与选择）；
 * - 未知 id 回落到 `cyan`；`theme.id == 'auto'` 时夜间回落 `black`、日间回落 `cyan`；
 * - `hideBgDark` 只在**深色主题**上隐藏自带背景图，亮色主题不受影响；
 * - `extInfo` 里的 `var(c-…)` 会就地展开成主题色；
 * - 一组派生别名（`c-font` / `c-content-background` 等）供界面直接取用。
 */
data class ActiveTheme(
    val id: String,
    val name: String,
    val isDark: Boolean,
    val colors: Map<String, String>,
    val extInfo: Map<String, String>,
) {
    /** 主题背景图文件名；空串表示没有。 */
    val bgImage: String
        get() = extInfo["bg-image"].orEmpty()

    fun color(key: String): String? = colors[key] ?: extInfo[key]

    fun argb(key: String): Int? = CssColor.parse(color(key))
}

/** 装配 SaltUI 需要的颜色角色（整数 ARGB，Compose 侧自行包装成 Color）。 */
data class ThemeRoles(
    val isDark: Boolean,
    val highlight: Int,
    val text: Int,
    val subText: Int,
    val background: Int,
    val subBackground: Int,
    val popup: Int,
    val stroke: Int,
    val onHighlight: Int,
)

object ActiveThemes {
    const val FALLBACK_LIGHT = "cyan"
    const val AUTO_DARK = "black"

    private val builtIn: Map<String, Theme> by lazy { DefaultThemes.generate().associateBy { it.id } }

    /** 按 RN `getTheme` 语义解析最终主题 id。 */
    fun resolveId(
        themeId: String?,
        isAutoTheme: Boolean,
        systemDark: Boolean,
    ): String {
        if (isAutoTheme && systemDark) return AUTO_DARK
        val id = themeId?.trim().orEmpty()
        if (id.isEmpty()) return FALLBACK_LIGHT
        if (id == "auto") return if (systemDark) AUTO_DARK else FALLBACK_LIGHT
        return if (builtIn.containsKey(id)) id else FALLBACK_LIGHT
    }

    fun active(
        themeId: String?,
        isAutoTheme: Boolean,
        systemDark: Boolean,
        hideBgDark: Boolean,
    ): ActiveTheme {
        val id = resolveId(themeId, isAutoTheme, systemDark)
        return build(builtIn.getValue(id), hideBgDark)
    }

    /** 把一个内置主题展开成运行时主题（别名、var() 展开、背景图显隐）。 */
    fun build(
        theme: Theme,
        hideBgDark: Boolean,
    ): ActiveTheme {
        val colors = LinkedHashMap(theme.themeColors)

        // 派生别名：顺序与 RN buildActiveThemeColors 一致（只收原生界面要用的键）
        fun add(
            key: String,
            from: String,
        ) {
            colors[from]?.let { colors[key] = it }
        }
        add("c-font", "c-850")
        add("c-font-label", "c-450")
        add("c-primary-font", "c-primary")
        add("c-primary-font-hover", "c-primary-alpha-300")
        add("c-primary-font-active", "c-primary-dark-100-alpha-200")
        add("c-primary-background", "c-primary-light-400-alpha-700")
        add("c-primary-background-hover", "c-primary-light-300-alpha-800")
        add("c-primary-background-active", "c-primary-light-100-alpha-800")
        add("c-primary-input-background", "c-primary-light-400-alpha-700")
        add("c-button-font", "c-primary-alpha-100")
        add("c-button-font-selected", "c-primary-dark-100-alpha-100")
        add("c-button-background", "c-primary-light-400-alpha-700")
        add("c-button-background-selected", "c-primary-alpha-600")
        add("c-button-background-hover", "c-primary-light-300-alpha-600")
        add("c-button-background-active", "c-primary-light-100-alpha-600")
        add("c-list-header-border-bottom", "c-primary-alpha-900")
        add("c-content-background", "c-primary-light-1000")
        add("c-border-background", "c-primary-light-100-alpha-700")

        val rawInfo =
            linkedMapOf(
                "app-background" to theme.extInfo.appBackground,
                "main-background" to theme.extInfo.mainBackground,
                "bg-image" to theme.extInfo.bgImage,
                "bg-image-position" to theme.extInfo.bgImagePosition,
                "bg-image-size" to theme.extInfo.bgImageSize,
                "badge-primary" to theme.extInfo.badgePrimary,
                "badge-secondary" to theme.extInfo.badgeSecondary,
                "badge-tertiary" to theme.extInfo.badgeTertiary,
            )
        val extInfo =
            rawInfo
                .mapValues { (_, value) ->
                    val inner = value.removePrefix("var(").removeSuffix(")")
                    if (value.startsWith("var(") && value.endsWith(")")) colors[inner] ?: value else value
                }.toMutableMap()
        // RN: 亮色主题永远显示自带背景图；深色主题只看 hideBgDark
        if (theme.isDark && hideBgDark) extInfo["bg-image"] = ""

        return ActiveTheme(
            id = theme.id,
            name = theme.name,
            isDark = theme.isDark,
            colors = colors,
            extInfo = extInfo,
        )
    }

    /**
     * 界面颜色角色。
     *
     * SaltUI 的角色与 RN 键的对应：
     * - `highlight` ← `c-primary`
     * - `text` ← `c-font`（`c-850`）、`subText` ← `c-font-label`（`c-450`）
     * - `background` ← `c-main-background`（半透明时按黑白底压平）
     * - `subBackground` / `popup` ← `c-content-background`（`c-primary-light-1000`）
     * - `stroke` ← `c-primary-alpha-700` 压在背景上（分隔线）
     * - `onHighlight` 按对比度在白/近黑之间选（主题主色可能很亮，例如橙/黄）
     */
    fun roles(theme: ActiveTheme): ThemeRoles {
        val opaqueBackground = if (theme.isDark) 0xFF000000.toInt() else 0xFFFFFFFF.toInt()
        val background =
            theme.argb("c-main-background")?.let { CssColor.over(it, opaqueBackground) }
                ?: if (theme.isDark) 0xFF131313.toInt() else 0xFFFFFFFF.toInt()
        val content =
            theme.argb("c-content-background")?.let { CssColor.over(it, background) }
                ?: background
        val highlight = theme.argb("c-primary") ?: 0xFF4DAF7C.toInt()
        val stroke =
            theme.argb("c-primary-alpha-700")?.let { CssColor.over(it, background) }
                ?: content
        val white = 0xFFFFFFFF.toInt()
        val darkInk = 0xFF1B1B1B.toInt()
        return ThemeRoles(
            isDark = theme.isDark,
            highlight = highlight,
            text = theme.argb("c-font") ?: theme.argb("c-850") ?: darkInk,
            subText = theme.argb("c-font-label") ?: theme.argb("c-450") ?: darkInk,
            background = background,
            subBackground = content,
            popup = content,
            stroke = stroke,
            onHighlight = if (CssColor.contrastRatio(white, highlight) >= 4.5) white else darkInk,
        )
    }
}
