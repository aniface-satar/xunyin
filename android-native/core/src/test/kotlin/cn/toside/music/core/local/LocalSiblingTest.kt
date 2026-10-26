package cn.toside.music.core.local

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 同目录同名歌词算路（SAF document id 版本）。
 */
class LocalSiblingTest {
    @Test
    fun `replaces only the last extension of the file name`() {
        assertEquals("primary:Music/a.lrc", LocalSibling.lyricDocumentId("primary:Music/a.mp3"))
        assertEquals("primary:Music/song.name.lrc", LocalSibling.lyricDocumentId("primary:Music/song.name.flac"))
        assertEquals("1A2B-3C4D:Music/专辑/x.lrc", LocalSibling.lyricDocumentId("1A2B-3C4D:Music/专辑/x.ogg"))
    }

    @Test
    fun `dots inside directories are not extensions`() {
        assertEquals(
            "primary:Music/1960.01/song.lrc",
            LocalSibling.lyricDocumentId("primary:Music/1960.01/song.mp3"),
        )
        assertNull(LocalSibling.lyricDocumentId("primary:Music/1960.01/song"))
    }

    @Test
    fun `no extension means no sibling`() {
        assertNull(LocalSibling.lyricDocumentId("primary:Music/noext"))
        assertNull(LocalSibling.replaceExtension("noext", "lrc"))
    }

    @Test
    fun `extension other than lrc can be requested`() {
        assertEquals("primary:Music/a.txt", LocalSibling.replaceExtension("primary:Music/a.mp3", "txt"))
    }

    @Test
    fun `trailing dot name is rejected`() {
        assertNull(LocalSibling.replaceExtension("primary:Music/a.", "lrc"))
    }
}
