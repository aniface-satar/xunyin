package cn.toside.music.core.theme

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 主题装配：RN 选择语义、别名、颜色角色。 */
class ActiveThemeTest {
    @Test
    fun autoThemeForcesBlackOnlyWhenSystemIsDark() {
        assertEquals("black", ActiveThemes.resolveId("orange", isAutoTheme = true, systemDark = true))
        assertEquals("orange", ActiveThemes.resolveId("orange", isAutoTheme = true, systemDark = false))
    }

    @Test
    fun lightIdAndDarkIdDoNotOverrideSelectedTheme() {
        // RN 的 lightId/darkId 读取代码是注释掉的：系统深色但未开自动主题时仍是用户选的亮主题
        val theme = ActiveThemes.active("cyan", isAutoTheme = false, systemDark = true, hideBgDark = false)
        assertEquals("cyan", theme.id)
        assertTrue(!theme.isDark)
    }

    @Test
    fun unknownOrAutoThemeFallsBackLikeRn() {
        assertEquals("cyan", ActiveThemes.resolveId("not-a-theme", isAutoTheme = false, systemDark = true))
        assertEquals("cyan", ActiveThemes.resolveId("auto", isAutoTheme = false, systemDark = false))
        assertEquals("black", ActiveThemes.resolveId("auto", isAutoTheme = false, systemDark = true))
        assertEquals("cyan", ActiveThemes.resolveId(null, isAutoTheme = false, systemDark = false))
    }

    @Test
    fun hideBgDarkOnlyAffectsDarkThemes() {
        val black = ActiveThemes.active("black", isAutoTheme = false, systemDark = false, hideBgDark = true)
        assertEquals("", black.bgImage)
        val naruto = ActiveThemes.active("naruto", isAutoTheme = false, systemDark = false, hideBgDark = true)
        assertEquals("myzcbg.jpg", naruto.bgImage)
    }

    @Test
    fun darkThemeKeepsBackgroundImageWhenNotHidden() {
        val black = ActiveThemes.active("black", isAutoTheme = false, systemDark = false, hideBgDark = false)
        assertEquals("landingMoon.png", black.bgImage)
    }

    @Test
    fun derivedAliasesMatchRn() {
        val theme = ActiveThemes.active("green", isAutoTheme = false, systemDark = false, hideBgDark = false)
        assertEquals(theme.color("c-850"), theme.color("c-font"))
        assertEquals(theme.color("c-450"), theme.color("c-font-label"))
        assertEquals(theme.color("c-primary"), theme.color("c-primary-font"))
        assertEquals(theme.color("c-primary-light-1000"), theme.color("c-content-background"))
        assertEquals(theme.color("c-primary-light-400-alpha-700"), theme.color("c-primary-background"))
    }

    @Test
    fun extInfoVarReferencesAreExpanded() {
        val theme = ActiveThemes.active("green", isAutoTheme = false, systemDark = false, hideBgDark = false)
        // green 的 c-app-background = var(c-primary-light-600-alpha-700)
        assertEquals(theme.color("c-primary-light-600-alpha-700"), theme.extInfo["app-background"])
        assertTrue(!theme.extInfo.getValue("app-background").startsWith("var("))
    }

    @Test
    fun rolesComeFromThemeColorsAndStayReadable() {
        val theme = ActiveThemes.active("black", isAutoTheme = false, systemDark = false, hideBgDark = false)
        val roles = ActiveThemes.roles(theme)
        assertTrue(roles.isDark)
        assertEquals(CssColor.parse("rgb(190, 190, 190)"), roles.highlight)
        assertEquals(CssColor.parse("rgb(219,219,219)"), roles.text)
        assertEquals(CssColor.parse("rgb(146,146,146)"), roles.subText)
        assertEquals(0xFF131313.toInt(), roles.background)
        assertEquals(CssColor.parse("rgb(49,49,49)"), roles.popup)
        assertTrue(CssColor.contrastRatio(roles.onHighlight, roles.highlight) >= 4.5)
    }

    @Test
    fun cssColorParsesRgbAndRgba() {
        assertEquals(0xFF4DAF7C.toInt(), CssColor.parse("rgb(77, 175, 124)"))
        assertEquals(0xFF4DAF7C.toInt(), CssColor.parse("rgba(77, 175, 124, 1)"))
        assertEquals(0x804DAF7C.toInt(), CssColor.parse("rgba(77, 175, 124, 0.5)"))
        assertEquals(0xFF000000.toInt(), CssColor.parse("rgba(0, 0, 0, 0)")?.let { CssColor.withAlpha(it, 1.0) })
        assertNull(CssColor.parse("var(c-primary)"))
        assertNull(CssColor.parse(null))
    }

    @Test
    fun cssColorCompositesAndMeasuresContrast() {
        assertEquals(0xFFFFFFFF.toInt(), CssColor.over(0x80FFFFFF.toInt(), 0xFFFFFFFF.toInt()))
        assertEquals(0xFF000000.toInt(), CssColor.over(0x80000000.toInt(), 0xFF000000.toInt()))
        assertEquals(21.0, CssColor.contrastRatio(0xFFFFFFFF.toInt(), 0xFF000000.toInt()), 0.001)
        assertNotNull(CssColor.parse(CssColor.toCssRgb(0xFF336699.toInt())))
    }
}
