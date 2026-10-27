package cn.toside.music.core.lyric

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 桌面歌词浮窗的纯逻辑契约 —— 对照 RN `mobile/lyric/LyricPlayer.java`
 * （`offset = 150`、`findCurLineNum`）、`LyricView.java`（`setLyric` 拼接扩展歌词、
 * `setLayoutParamsHeight`、`fixViewPosition`、`onTouch` 松手存百分比）。
 *
 * 桌面歌词和播放页的差别：播放页 offset 100ms，桌面 150ms。
 */
class DesktopLyricLineTest {
    private fun parsed(vararg lines: Pair<Long, String>): ParsedLyric =
        ParsedLyric(
            lines = lines.map { (time, text) -> LyricLine(timeMs = time, text = text) },
        )

    @Test
    fun emptyLyricHasNoLine() {
        assertEquals(-1, DesktopLyricLine.indexAt(ParsedLyric(), 0))
        assertNull(DesktopLyricLine.lineAt(ParsedLyric(), 10_000))
        assertEquals(emptyList<String>(), DesktopLyricLine.lines(ParsedLyric(), 10_000, singleLine = false, maxLineNum = 5))
    }

    @Test
    fun desktopOffsetSwitchesLineAt150ms() {
        val parsed = parsed(0L to "第一行", 1000L to "第二行")
        // 850 + 150 = 1000：仍在第一行；851 + 150 = 1001：切到第二行。
        assertEquals(0, DesktopLyricLine.indexAt(parsed, 850))
        assertEquals(1, DesktopLyricLine.indexAt(parsed, 851))
        // 若误用播放页的 100ms，851 会算成 951，仍停在第一行。
        assertEquals("第二行", DesktopLyricLine.lineAt(parsed, 851)?.text)
    }

    @Test
    fun positionBeforeFirstLineClampsToFirst() {
        val parsed = parsed(5_000L to "第一行", 9_000L to "第二行")
        assertEquals(0, DesktopLyricLine.indexAt(parsed, 0))
        assertEquals(0, DesktopLyricLine.indexAt(parsed, -10_000))
        assertEquals(0, DesktopLyricLine.indexAt(parsed, 4_000))
        assertEquals(1, DesktopLyricLine.indexAt(parsed, 20_000))
    }

    @Test
    fun lrcOffsetTagShiftsLineSelectionToo() {
        // RN 桌面 performanceTime 同时减去 [offset:] 标签，等价于标签值叠到时间上。
        val parsed = ParsedLyric(lines = listOf(LyricLine(0, "第一行"), LyricLine(1_000, "第二行")), tags = LyricTags(offset = 500))
        assertEquals(1, DesktopLyricLine.indexAt(parsed, 400))
    }

    @Test
    fun contentAppendsExtendedLyricsUpToMaxLineNum() {
        val parsed =
            parsed(0L to "第一行", 1_000L to "第二行")
                .let { it.copy(lines = listOf(it.lines[0], it.lines[1].copy(extendedLyrics = listOf("翻译", "音译")))) }
        assertEquals(listOf("第一行"), DesktopLyricLine.lines(parsed, 0, singleLine = false, maxLineNum = 5))
        assertEquals(listOf("第二行", "翻译", "音译"), DesktopLyricLine.lines(parsed, 1_000, singleLine = false, maxLineNum = 5))
        assertEquals(listOf("第二行", "翻译"), DesktopLyricLine.lines(parsed, 1_000, singleLine = false, maxLineNum = 2))
        assertEquals(listOf("第二行"), DesktopLyricLine.lines(parsed, 1_000, singleLine = false, maxLineNum = 1))
        assertEquals(listOf("第二行"), DesktopLyricLine.lines(parsed, 1_000, singleLine = true, maxLineNum = 5))
    }

    @Test
    fun singleLineAndZeroMaxStillShowCurrentLineOnce() {
        val parsed = parsed(0L to "唯一行").let { it.copy(lines = listOf(it.lines[0].copy(extendedLyrics = listOf("翻译")))) }
        assertEquals(listOf("唯一行"), DesktopLyricLine.lines(parsed, 0, singleLine = true, maxLineNum = 0))
        assertEquals(listOf("唯一行"), DesktopLyricLine.lines(parsed, 0, singleLine = false, maxLineNum = 0))
    }

    @Test
    fun blankExtendedLyricsAreSkipped() {
        val parsed = parsed(0L to "主行").let { it.copy(lines = listOf(it.lines[0].copy(extendedLyrics = listOf("", "  ", "翻译")))) }
        assertEquals(listOf("主行", "翻译"), DesktopLyricLine.lines(parsed, 0, singleLine = false, maxLineNum = 3))
    }

    @Test
    fun windowWidthUsesPercentOfScreen() {
        assertEquals(2550, DesktopLyricLine.windowWidth(maxWidthPx = 2550, widthPercent = 100))
        assertEquals(1275, DesktopLyricLine.windowWidth(maxWidthPx = 2550, widthPercent = 50))
        assertEquals(841, DesktopLyricLine.windowWidth(maxWidthPx = 2550, widthPercent = 33))
    }

    @Test
    fun windowHeightCapsAtScreenMinus100() {
        assertEquals(100, DesktopLyricLine.windowHeight(lineHeightPx = 20, maxLineNum = 5, maxHeightPx = 2_000))
        assertEquals(1_900, DesktopLyricLine.windowHeight(lineHeightPx = 20, maxLineNum = 100, maxHeightPx = 2_000))
        assertEquals(20, DesktopLyricLine.windowHeight(lineHeightPx = 20, maxLineNum = 1, maxHeightPx = 2_000))
    }

    @Test
    fun clampPositionKeepsWindowOnScreen() {
        assertEquals(
            DesktopLyricLine.WindowPosition(0, 0),
            DesktopLyricLine.clampPosition(1_000, 2_000, 400, 100, percentX = 0.0, percentY = 0.0),
        )
        assertEquals(
            DesktopLyricLine.WindowPosition(500, 1_000),
            DesktopLyricLine.clampPosition(1_000, 2_000, 400, 100, percentX = 50.0, percentY = 50.0),
        )
        assertEquals(
            DesktopLyricLine.WindowPosition(600, 1_900),
            DesktopLyricLine.clampPosition(1_000, 2_000, 400, 100, percentX = 100.0, percentY = 100.0),
        )
        assertEquals(
            DesktopLyricLine.WindowPosition(0, 0),
            DesktopLyricLine.clampPosition(1_000, 2_000, 400, 100, percentX = -10.0, percentY = -10.0),
        )
    }

    /**
     * W7：桌面歌词**独立**的译文/罗马音开关（RN 没有这两键，桌面跟播放页走同一个开关）。
     *
     * 扩展行按下标认：0 = 翻译、1 = 罗马音（RN `Lyric.java#refreshLyric` 的构造顺序）。
     * 关掉的那一项根本不进列表（不是进来再隐藏），所以「最大行数」的配额也跟着省下来。
     */
    @Test
    fun desktopOnlyTranslationAndRomaSwitches() {
        val parsed =
            parsed(0L to "主行").let {
                it.copy(lines = listOf(it.lines[0].copy(extendedLyrics = listOf("翻译", "音译"))))
            }

        fun lines(
            translation: Boolean,
            roma: Boolean,
        ) = DesktopLyricLine.lines(
            parsed,
            0,
            singleLine = false,
            maxLineNum = 5,
            showTranslation = translation,
            showRoma = roma,
        )

        // 默认（不传参）行为与改造前一致：两个都显示
        assertEquals(listOf("主行", "翻译", "音译"), DesktopLyricLine.lines(parsed, 0, singleLine = false, maxLineNum = 5))
        assertEquals(listOf("主行", "翻译", "音译"), lines(translation = true, roma = true))
        assertEquals(listOf("主行", "翻译"), lines(translation = true, roma = false))
        assertEquals(listOf("主行", "音译"), lines(translation = false, roma = true))
        assertEquals(listOf("主行"), lines(translation = false, roma = false))
    }

    @Test
    fun disabledExtendedLineFreesTheMaxLineQuota() {
        val parsed =
            parsed(0L to "主行").let {
                it.copy(lines = listOf(it.lines[0].copy(extendedLyrics = listOf("翻译", "音译"))))
            }
        // 关掉译文后，「罗马音」顶上来而不是留一个空位
        assertEquals(
            listOf("主行", "音译"),
            DesktopLyricLine.lines(
                parsed,
                0,
                singleLine = false,
                maxLineNum = 2,
                showTranslation = false,
                showRoma = true,
            ),
        )
    }

    @Test
    fun extendedVisibilityFallsThroughForUnknownIndexes() {
        // 扩展行超过两条时（多语种歌词）不做猜测，一律放行，避免整行内容凭空消失
        assertEquals(true, DesktopLyricLine.extendedVisible(2, showTranslation = false, showRoma = false))
        assertEquals(false, DesktopLyricLine.extendedVisible(0, showTranslation = false, showRoma = true))
        assertEquals(false, DesktopLyricLine.extendedVisible(1, showTranslation = true, showRoma = false))
    }

    @Test
    fun dragPercentRoundTrips() {
        assertEquals(50.0, DesktopLyricLine.percentOf(500, 1_000), 1e-9)
        assertEquals(27.7777, DesktopLyricLine.percentOf(300, 1_080), 1e-4)
        assertEquals(0.0, DesktopLyricLine.percentOf(300, 0), 1e-9)
    }
}
