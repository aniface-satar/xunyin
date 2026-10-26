package cn.toside.music.core.local

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

/**
 * 本地歌词解析：对照 RN `core/music/local.ts#parseLyric`。
 */
class LocalLyricTest {
    private fun b64(text: String): String = Base64.getEncoder().encodeToString(text.toByteArray(Charsets.UTF_8))

    private val lrcBody = "[00:01.00]第一行\n[00:02.50]第二行"

    @Test
    fun `plain lrc keeps body trimmed`() {
        val parsed = LocalLyric.parse("  $lrcBody\n")
        assertEquals(lrcBody, parsed.lyric)
        assertNull(parsed.tlyric)
        assertNull(parsed.rlyric)
        assertTrue(parsed.hasLyric)
    }

    @Test
    fun `awlrc tag carries translation and roma`() {
        val translation = "[00:01.00]line one\n[00:02.50]line two"
        val roma = "[00:01.00]ni hao\n[00:02.50]shi jie"
        val payload = "lrc:${b64(lrcBody)},tlrc:${b64(translation)},rlrc:${b64(roma)}"
        val parsed = LocalLyric.parse("$lrcBody\n[awlrc:$payload]")
        // 标签被剥掉，正文保留
        assertEquals(lrcBody, parsed.lyric)
        assertEquals(translation, parsed.tlyric)
        assertEquals(roma, parsed.rlyric)
    }

    @Test
    fun `lrc segment inside tag overrides body like rn spread`() {
        val fromTag = "[00:09.00]标签里的正文"
        val parsed = LocalLyric.parse("旧正文\n[awlrc:lrc:${b64(fromTag)}]")
        assertEquals(fromTag, parsed.lyric)
    }

    @Test
    fun `broken base64 is ignored instead of throwing`() {
        val parsed = LocalLyric.parse("$lrcBody\n[awlrc:lrc:@@@,tlrc:%%%]")
        assertEquals(lrcBody, parsed.lyric)
        assertNull(parsed.tlyric)
    }

    @Test
    fun `segment without timestamps fails verification`() {
        val notLyric = "这一行没有时间轴"
        val parsed = LocalLyric.parse("$lrcBody\n[awlrc:tlrc:${b64(notLyric)}]")
        assertNull(parsed.tlyric)
    }

    @Test
    fun `awlrc segment requires word timing`() {
        val word = "[00:01.00]<0,500>逐字"
        val parsed = LocalLyric.parse("$lrcBody\n[awlrc:awlrc:${b64(word)}]")
        assertEquals(word, parsed.lxlyric)
    }

    @Test
    fun `blank text is not a lyric`() {
        val parsed = LocalLyric.parse("   \n")
        assertEquals("", parsed.lyric)
        assertTrue(!parsed.hasLyric)
    }
}
