package cn.toside.music.core.theme

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 封面取色器：确定性、闸门、输入守卫。 */
class CoverPaletteTest {
    private fun argb(
        r: Int,
        g: Int,
        b: Int,
        a: Int = 255,
    ): Int = (a shl 24) or (r shl 16) or (g shl 8) or b

    private fun pixels(
        width: Int,
        height: Int,
        pixel: (x: Int, y: Int) -> Int,
    ): IntArray = IntArray(width * height) { index -> pixel(index % width, index / width) }

    private fun colorfulCover(): IntArray =
        pixels(24, 24) { x, y ->
            when {
                x < 8 -> argb(210, 40, 40)
                x < 16 -> argb(40, 90, 210)
                else -> argb(60, 60, 60)
            }.let { color ->
                // 纵向加一点起伏，避免所有块同色
                val lift = y
                argb(
                    CssColor.red(color) + lift.coerceAtMost(20),
                    CssColor.green(color) + lift.coerceAtMost(20),
                    CssColor.blue(color) + lift.coerceAtMost(20),
                )
            }
        }

    @Test
    fun sameSeedIsReproducible() {
        val cover = colorfulCover()
        val first = CoverPaletteExtractor.extract(cover, 24, 24, seed = 7L)
        val second = CoverPaletteExtractor.extract(cover, 24, 24, seed = 7L)
        assertNotNull(first)
        assertEquals(first, second)
    }

    @Test
    fun defaultSeedIsStableAcrossCalls() {
        val cover = colorfulCover()
        val first = CoverPaletteExtractor.extract(cover, 24, 24)
        val second = CoverPaletteExtractor.extract(cover, 24, 24)
        assertNotNull(first)
        assertEquals(first, second)
    }

    @Test
    fun customSeedIsAcceptedAndStable() {
        val cover = colorfulCover()
        val first = CoverPaletteExtractor.extract(cover, 24, 24, seed = 123456789L)
        val second = CoverPaletteExtractor.extract(cover, 24, 24, seed = 123456789L)
        assertNotNull(first)
        assertEquals(first, second)
    }

    @Test
    fun grayCoverDoesNotGainHue() {
        // 三通道完全相同的纯灰渐变：取色后也不该凭空多出色相
        val cover = pixels(16, 16) { x, y -> argb(120 + (x + y) % 8, 120 + (x + y) % 8, 120 + (x + y) % 8) }
        val palette = CoverPaletteExtractor.extract(cover, 16, 16)
        assertNotNull(palette)
        val source = palette!!
        val maxChannel = maxOf(CssColor.red(source.sourceArgb), CssColor.green(source.sourceArgb), CssColor.blue(source.sourceArgb))
        val minChannel = minOf(CssColor.red(source.sourceArgb), CssColor.green(source.sourceArgb), CssColor.blue(source.sourceArgb))
        assertTrue("灰封面不应被染出彩色：$source", maxChannel - minChannel <= 2)
    }

    @Test
    fun whiteTextAlwaysPassesContrastGate() {
        val fixtures =
            listOf(
                "red" to pixels(16, 16) { _, _ -> argb(220, 30, 30) },
                "blue" to pixels(16, 16) { _, _ -> argb(30, 80, 220) },
                "yellow" to pixels(16, 16) { _, _ -> argb(240, 210, 40) },
                "white" to pixels(16, 16) { _, _ -> argb(250, 250, 250) },
                "dark" to pixels(16, 16) { _, _ -> argb(12, 12, 16) },
            )
        for ((name, cover) in fixtures) {
            val palette = CoverPaletteExtractor.extract(cover, 16, 16) ?: continue
            assertTrue(
                "$name 底色对白字对比度不足：${CssColor.contrastRatio(palette.baseArgb, 0xFFFFFFFF.toInt())}",
                CssColor.contrastRatio(palette.baseArgb, 0xFFFFFFFF.toInt()) >= CoverPaletteExtractor.MIN_CONTRAST,
            )
            assertTrue(
                "$name 合成场对白字对比度不足：${CssColor.contrastRatio(palette.fieldArgb, 0xFFFFFFFF.toInt())}",
                CssColor.contrastRatio(palette.fieldArgb, 0xFFFFFFFF.toInt()) >= CoverPaletteExtractor.MIN_CONTRAST,
            )
        }
    }

    @Test
    fun scrimIsWithinUnitRange() {
        val palette = CoverPaletteExtractor.extract(colorfulCover(), 24, 24)
        assertNotNull(palette)
        assertTrue(palette!!.scrimAlpha in 0.0..1.0)
    }

    @Test
    fun brightBlockDrivesHighlight() {
        val cover =
            pixels(24, 24) { x, y ->
                if (x < 6 && y < 6) argb(245, 245, 245) else argb(20, 20, 20)
            }
        val palette = CoverPaletteExtractor.extract(cover, 24, 24)
        assertNotNull(palette)
        assertTrue(CssColor.luminance(palette!!.highlightArgb) > CssColor.luminance(palette.averageArgb))
    }

    @Test
    fun transparentPixelsAreIgnored() {
        val cover =
            pixels(16, 16) { x, _ ->
                if (x < 8) argb(255, 255, 255, a = 0) else argb(0, 0, 0)
            }
        val palette = CoverPaletteExtractor.extract(cover, 16, 16)
        assertNotNull(palette)
        assertTrue(CssColor.luminance(palette!!.averageArgb) < 0.01)
    }

    @Test
    fun rejectsInvalidInput() {
        assertNull(CoverPaletteExtractor.extract(null, 4, 4))
        assertNull(CoverPaletteExtractor.extract(IntArray(0), 0, 0))
        assertNull(CoverPaletteExtractor.extract(IntArray(15), 4, 4))
        assertNull(CoverPaletteExtractor.extract(IntArray(16) { argb(1, 2, 3, a = 0) }, 4, 4))
    }
}
