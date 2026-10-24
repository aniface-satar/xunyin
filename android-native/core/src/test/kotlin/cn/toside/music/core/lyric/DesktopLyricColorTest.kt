package cn.toside.music.core.lyric

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * RN `LyricView.parseColor` 的移植契约：设置里存的是 CSS 风格 rgba/rgb 或 #hex。
 * RN 正则 `rgba? *\( *(\d+), *(\d+), *(\d+)(?:, *([\d.]+))? *\)`，
 * 其余走 `Color.parseColor`，解析失败回退黑色。
 */
class DesktopLyricColorTest {
    @Test
    fun parsesRgbaFromDefaults() {
        assertEquals(0xFFFFFFFF.toInt(), DesktopLyricColor.parse("rgba(255, 255, 255, 1)"))
        assertEquals(0xFF07C556.toInt(), DesktopLyricColor.parse("rgba(7, 197, 86, 1)"))
        assertEquals(0xFF000000.toInt(), DesktopLyricColor.parse("rgba(0, 0, 0, 1)"))
    }

    @Test
    fun alphaBecomes255Scale() {
        assertEquals(0x99000000.toInt(), DesktopLyricColor.parse("rgba(0, 0, 0, 0.6)"))
        assertEquals(0x7F07C556.toInt(), DesktopLyricColor.parse("rgba(7,197,86,0.5)"))
    }

    @Test
    fun rgbWithoutAlphaIsOpaque() {
        assertEquals(0xFF07C556.toInt(), DesktopLyricColor.parse("rgb(7,197,86)"))
        assertEquals(0xFF07C556.toInt(), DesktopLyricColor.parse("rgba(7,197,86,1)"))
        // RN 正则只在逗号后允许空格；逗号前有空格不匹配，回退黑色。
        assertEquals(0xFF000000.toInt(), DesktopLyricColor.parse("rgb(7 , 197 , 86)"))
    }

    @Test
    fun parsesHexColors() {
        assertEquals(0xFF07C556.toInt(), DesktopLyricColor.parse("#07c556"))
        assertEquals(0xFF07C556.toInt(), DesktopLyricColor.parse("#FF07C556"))
        assertEquals(0x8F07C556.toInt(), DesktopLyricColor.parse("#8f07c556"))
        assertEquals(0xFFFFCC55.toInt(), DesktopLyricColor.parse("#fc5"))
    }

    @Test
    fun invalidFallsBackToBlack() {
        assertEquals(0xFF000000.toInt(), DesktopLyricColor.parse("not-a-color"))
        assertEquals(0xFF000000.toInt(), DesktopLyricColor.parse(""))
        assertEquals(0xFF000000.toInt(), DesktopLyricColor.parse("#12"))
    }
}
