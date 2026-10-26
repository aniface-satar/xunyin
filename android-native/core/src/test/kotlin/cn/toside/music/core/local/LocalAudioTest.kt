package cn.toside.music.core.local

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 扫描过滤规则：对照 RN `localMediaMetadata.ts#scanAudioFiles` 与 `utils/fs.ts#extname`。
 */
class LocalAudioTest {
    @Test
    fun `audio mime prefix wins regardless of extension`() {
        assertTrue(LocalAudio.isAudio("track.bin", "audio/mpeg"))
        assertTrue(LocalAudio.isAudio("no-extension", "audio/flac"))
        assertTrue(LocalAudio.isAudio("a.txt", "audio/ogg"))
    }

    @Test
    fun `ogg extension is accepted even when mime says otherwise`() {
        assertTrue(LocalAudio.isAudio("song.ogg", "text/plain"))
        assertTrue(LocalAudio.isAudio("song.ogg", null))
    }

    @Test
    fun `saf fallback accepts container extensions when mime says nothing`() {
        assertTrue(LocalAudio.isAudio("a.mp3", "application/octet-stream"))
        assertTrue(LocalAudio.isAudio("a.flac", null))
        assertTrue(LocalAudio.isAudio("a.wav", ""))
        assertTrue(LocalAudio.isAudio("a.ogg", "binary/octet-stream"))
    }

    @Test
    fun `mime that denies audio is respected`() {
        assertFalse(LocalAudio.isAudio("a.mp3", "video/mp4"))
        assertFalse(LocalAudio.isAudio("a.mp3", "application/x-flac"))
    }

    @Test
    fun `non audio files are rejected`() {
        assertFalse(LocalAudio.isAudio("a.txt", "text/plain"))
        assertFalse(LocalAudio.isAudio("cover.jpg", "image/jpeg"))
        assertFalse(LocalAudio.isAudio("archive.tar.gz", null))
        assertFalse(LocalAudio.isAudio(null, null))
    }

    @Test
    fun `extension follows rn extname guard`() {
        assertEquals("mp3", LocalAudio.extensionOf("a.mp3"))
        // RN extname 不转小写；大小写归一发生在 isAudio 的比较里
        assertEquals("MP3", LocalAudio.extensionOf("a.MP3"))
        assertTrue(LocalAudio.isAudio("a.MP3", null))
        assertEquals("gz", LocalAudio.extensionOf("archive.tar.gz"))
        // lastIndexOf > 0 的守卫：以点开头视为无扩展名
        assertEquals("", LocalAudio.extensionOf(".mp3"))
        assertEquals("", LocalAudio.extensionOf("noext"))
        assertEquals("", LocalAudio.extensionOf(null))
    }
}
