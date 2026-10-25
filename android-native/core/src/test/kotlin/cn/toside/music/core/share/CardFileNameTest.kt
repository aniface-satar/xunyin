package cn.toside.music.core.share

import org.junit.Assert.assertEquals
import org.junit.Test

/** 黄金值对照 RN `tests/share-card-file-name.mts`。 */
class CardFileNameTest {
    @Test
    fun joinsNameAndSingerWithASeparator() {
        assertEquals("平凡之路 - 朴树", cardFileName("平凡之路", "朴树"))
    }

    @Test
    fun dropsCharactersTheFilesystemRefuses() {
        assertEquals("ABCDEFGHI - 朴树", cardFileName("A/B:C*D?E\"F<G>H|I", "朴树"))
    }

    @Test
    fun dropsControlCharacters() {
        assertEquals("ab", cardFileName("a\u0001b", ""))
    }

    @Test
    fun fallsBackToTheTitleAloneWhenTheSingerIsEmpty() {
        assertEquals("平凡之路", cardFileName("平凡之路", ""))
        assertEquals("平凡之路", cardFileName("平凡之路", "   "))
    }

    @Test
    fun truncatesVeryLongTitles() {
        val long = "字".repeat(400)
        assertEquals(72, cardFileName(long, "歌手").length)
    }

    @Test
    fun collapsesWhitespaceLeftBehindByStrippedCharacters() {
        assertEquals("歌 名 - A B", cardFileName("歌 名", "A  B"))
    }

    @Test
    fun fallsBackWhenBothPartsAreEmpty() {
        assertEquals("lyric-poster", cardFileName("", ""))
        assertEquals("lyric-poster", cardFileName("/:*", "?"))
    }

    @Test
    fun uniqueNameAppendsAnIndexBeforeTheExtension() {
        assertEquals("平凡之路 - 朴树.png", uniqueCardFileName("平凡之路 - 朴树") { false })
        val taken = setOf("平凡之路 - 朴树.png", "平凡之路 - 朴树 (1).png")
        assertEquals("平凡之路 - 朴树 (2).png", uniqueCardFileName("平凡之路 - 朴树") { it in taken })
    }
}
