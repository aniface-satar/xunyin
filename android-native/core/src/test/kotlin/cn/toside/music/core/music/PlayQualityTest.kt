package cn.toside.music.core.music

import org.junit.Assert.assertEquals
import org.junit.Test

class PlayQualityTest {
    private val allSource = listOf("128k", "320k", "flac", "flac24bit")

    @Test
    fun pickKeepsRequestedTierWhenSongAndSourceSupportIt() {
        assertEquals(
            "flac24bit",
            PlayQuality.pick("flac24bit", setOf("128k", "flac24bit"), allSource),
        )
    }

    @Test
    fun pickFallsBackToNextSupportedTier() {
        assertEquals("flac", PlayQuality.pick("flac24bit", setOf("flac", "320k"), allSource))
        assertEquals("320k", PlayQuality.pick("flac24bit", setOf("320k"), allSource))
    }

    @Test
    fun pickRequiresSourceSupportNotJustSongSupport() {
        // 歌曲带 flac，但当前音源只声明到 320k：不能去要音源没有的档位
        assertEquals("320k", PlayQuality.pick("flac24bit", setOf("flac", "320k"), listOf("128k", "320k")))
    }

    @Test
    fun pickNeverUpgradesFromRequestedTier() {
        // 选 flac 时即使歌曲有 flac24bit 也不上探
        assertEquals("128k", PlayQuality.pick("flac", setOf("flac24bit"), allSource))
    }

    @Test
    fun pickDefaultsTo128k() {
        assertEquals("128k", PlayQuality.pick("128k", setOf("320k"), allSource))
        assertEquals("128k", PlayQuality.pick("flac24bit", emptySet(), allSource))
        assertEquals("128k", PlayQuality.pick("unknown", setOf("flac24bit"), allSource))
    }
}
