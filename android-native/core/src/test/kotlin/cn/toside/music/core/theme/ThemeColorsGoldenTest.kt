package cn.toside.music.core.theme

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 主题颜色生成器黄金测试。
 *
 * 黄金值全部提取自 RN 侧生成物 src/theme/themes/themes.ts
 * （由 createThemes.js 生成），锁死 Kotlin 移植版的等价性。
 */
class ThemeColorsGoldenTest {
    @Test
    fun greenThemeColorsMatchGeneratedTs() {
        val colors = ThemeColors.createThemeColors("rgb(77, 175, 124)", "rgb(33, 33, 33)", isDark = false)
        // themes.ts green 主题实测值
        assertEquals("rgb(77, 175, 124)", colors["c-primary"])
        assertEquals("rgb(69,158,112)", colors["c-primary-dark-100"])
        assertEquals("rgba(69, 158, 112, 0.90)", colors["c-primary-dark-100-alpha-100"])
        assertEquals("rgba(77, 175, 124, 0.90)", colors["c-primary-alpha-100"])
        assertEquals("rgb(113,191,150)", colors["c-primary-light-100"])
        assertEquals("rgb(77, 175, 124)", colors["c-theme"])
        assertEquals("rgb(33, 33, 33)", colors["c-1000"])
        assertEquals("rgb(44,44,44)", colors["c-950"])
        assertEquals("rgb(55,55,55)", colors["c-900"])
    }

    @Test
    fun cyanThemeColorsMatchGeneratedTs() {
        val colors = ThemeColors.createThemeColors("rgb(0, 163, 178)", "rgb(33, 33, 33)", isDark = false)
        assertEquals("rgb(0,147,160)", colors["c-primary-dark-100"])
        assertEquals("rgba(0, 163, 178, 0.90)", colors["c-primary-alpha-100"])
        assertEquals("rgb(51,181,193)", colors["c-primary-light-100"])
        assertEquals("rgb(0, 163, 178)", colors["c-theme"])
    }

    @Test
    fun bluePlusThemeColorsMatchGeneratedTs() {
        val colors = ThemeColors.createThemeColors("rgb(77, 131, 175)", "rgb(33, 33, 33)", isDark = false)
        assertEquals("rgb(69,118,158)", colors["c-primary-dark-100"])
        assertEquals("rgb(113,156,191)", colors["c-primary-light-100"])
        assertEquals("rgb(77, 131, 175)", colors["c-theme"])
    }

    @Test
    fun brownThemeWithRgbaPrimaryMatchesGeneratedTs() {
        val colors = ThemeColors.createThemeColors("rgba(188, 128, 68, 1)", "rgb(33, 33, 33)", isDark = false)
        assertEquals("rgba(169,115,61, 1)", colors["c-primary-dark-100"])
        assertEquals("rgba(188, 128, 68, 0.90)", colors["c-primary-alpha-100"])
        assertEquals("rgba(201,153,105, 1)", colors["c-primary-light-100"])
        assertEquals("rgba(188, 128, 68, 1)", colors["c-theme"])
    }

    @Test
    fun blackDarkThemeMatchesGeneratedTs() {
        val colors = ThemeColors.createThemeColors("rgb(190, 190, 190)", "rgb(255, 255, 255)", isDark = true)
        assertEquals("rgb(203,203,203)", colors["c-primary-dark-100"])
        assertEquals("rgba(190, 190, 190, 0.90)", colors["c-primary-alpha-100"])
        assertEquals("rgb(171,171,171)", colors["c-primary-light-100"])
        // 暗色主题 c-theme = c-primary-light-900（生成表实测 rgb(75,75,75)）
        assertEquals("rgb(75,75,75)", colors["c-theme"])
        assertEquals("rgb(255, 255, 255)", colors["c-1000"])
        assertEquals("rgb(242,242,242)", colors["c-950"])
        assertEquals("rgb(230,230,230)", colors["c-900"])
    }

    @Test
    fun chinaInkThemeWithRgbaPrimaryAndNoFontChange() {
        val colors = ThemeColors.createThemeColors("rgba(47, 47, 47, 1)", "rgb(33, 33, 33)", isDark = false)
        assertEquals("rgba(42,42,42, 1)", colors["c-primary-dark-100"])
        assertEquals("rgba(89,89,89, 1)", colors["c-primary-light-100"])
        assertEquals("rgba(47, 47, 47, 1)", colors["c-theme"])
    }

    @Test
    fun defaultThemesTableMatchesCreateThemesJs() {
        val themes = DefaultThemes.generate()
        assertEquals(17, themes.size)
        val ids = themes.map { it.id }
        assertTrue(
            ids.containsAll(
                listOf(
                    "green",
                    "blue",
                    "cyan",
                    "blue_plus",
                    "orange",
                    "brown",
                    "red",
                    "pink",
                    "purple",
                    "grey",
                    "ming",
                    "blue2",
                    "black",
                    "mid_autumn",
                    "naruto",
                    "china_ink",
                    "happy_new_year",
                ),
            ),
        )
        val black = themes.first { it.id == "black" }
        assertTrue(black.isDark)
        assertEquals("黑灯瞎火", black.name)
        assertEquals("landingMoon.png", black.extInfo.bgImage)
        val happy = themes.first { it.id == "happy_new_year" }
        assertEquals("rgb(192, 57, 43)", happy.themeColors["c-primary"])
    }

    @Test
    fun fontColorsFallbackWhenNull() {
        val light = ThemeColors.createThemeColors("rgb(77, 175, 124)", null, isDark = false)
        assertEquals("rgb(33, 33, 33)", light["c-1000"])
        val dark = ThemeColors.createThemeColors("rgb(190, 190, 190)", null, isDark = true)
        assertEquals("rgb(229, 229, 229)", dark["c-1000"])
    }

    @Test
    fun themeColorsKeySetComplete() {
        val colors = ThemeColors.createThemeColors("rgb(77, 175, 124)", "rgb(33, 33, 33)", isDark = false)
        // c-primary 1 + dark 10 + dark-alpha 90 + primary-alpha 9（dark 循环内重复写入仅 9 个唯一键）
        // + light 9 + light-alpha 81 + light-1000 1 + light-1000-alpha 9 + c-theme 1 + 字体色 21 = 232
        assertEquals(232, colors.size)
        assertTrue(colors.containsKey("c-primary-dark-1000"))
        assertTrue(colors.containsKey("c-primary-dark-1000-alpha-900"))
        assertTrue(colors.containsKey("c-primary-light-900"))
        assertTrue(colors.containsKey("c-primary-light-1000"))
        assertTrue(colors.containsKey("c-primary-light-1000-alpha-900"))
        assertTrue(colors.containsKey("c-000"))
        assertNull(colors["c-primary-light-1000-alpha-1000"])
    }
}
