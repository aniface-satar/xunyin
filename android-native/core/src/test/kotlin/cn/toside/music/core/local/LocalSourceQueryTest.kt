package cn.toside.music.core.local

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 六级候选阶梯（对照 RN `src/core/music/local.ts#getOtherSourceByLocal`）。
 */
class LocalSourceQueryTest {
    @Test
    fun `name with dash produces split and swapped levels`() {
        val candidates = LocalSourceQuery.candidates(name = "晴天 - 周杰伦", singer = "群星", fileNameStem = "晴天 - 周杰伦")
        assertEquals(3, candidates.size)
        assertEquals("晴天 - 周杰伦 群星", candidates[0].keyword)
        assertEquals("晴天", candidates[1].expectName)
        assertEquals("周杰伦", candidates[1].expectSinger)
        assertEquals("周杰伦", candidates[2].expectName)
        assertEquals("晴天", candidates[2].expectSinger)
    }

    @Test
    fun `name without dash only keeps level one when stem equals name`() {
        val candidates = LocalSourceQuery.candidates(name = "晴天", singer = "周杰伦", fileNameStem = "晴天")
        assertEquals(1, candidates.size)
        assertEquals("晴天 周杰伦", candidates[0].keyword)
    }

    @Test
    fun `stem different from name and without dash produces plain name level`() {
        val candidates = LocalSourceQuery.candidates(name = "unknown", singer = "", fileNameStem = "track01")
        assertEquals(2, candidates.size)
        assertEquals("track01", candidates[1].expectName)
        assertEquals("", candidates[1].expectSinger)
        assertEquals("track01", candidates[1].keyword)
    }

    @Test
    fun `stem with dash produces two swapped levels`() {
        val candidates = LocalSourceQuery.candidates(name = "novalue", singer = "", fileNameStem = "晴天 - 周杰伦")
        assertEquals(3, candidates.size)
        assertEquals("晴天", candidates[1].expectName)
        assertEquals("周杰伦", candidates[1].expectSinger)
        assertEquals("周杰伦", candidates[2].expectName)
        assertEquals("晴天", candidates[2].expectSinger)
    }

    @Test
    fun `null stem skips file name levels`() {
        val candidates = LocalSourceQuery.candidates(name = "晴天", singer = "周杰伦", fileNameStem = null)
        assertEquals(1, candidates.size)
    }

    @Test
    fun `fully exhausted ladder collapses to single level`() {
        val candidates = LocalSourceQuery.candidates(name = "晴天", singer = "周杰伦", fileNameStem = "晴天")
        assertEquals(listOf("晴天 周杰伦"), candidates.map { it.keyword })
    }

    @Test
    fun `dash name without stem keeps three levels`() {
        val candidates = LocalSourceQuery.candidates(name = "A-B", singer = "", fileNameStem = null)
        assertEquals(listOf("A-B", "A B", "B A"), candidates.map { it.keyword })
    }

    @Test
    fun `matching normalizes case punctuation and width`() {
        assertTrue(LocalSourceQuery.matches(expectName = "晴天", expectSinger = "周杰伦", actualName = "晴天", actualSinger = "周杰伦"))
        assertTrue(LocalSourceQuery.matches(expectName = "Blue", expectSinger = "", actualName = "ｂｌｕｅ", actualSinger = ""))
        assertTrue(LocalSourceQuery.matches(expectName = "夜曲", expectSinger = "", actualName = "夜 曲!", actualSinger = ""))
        assertFalse(LocalSourceQuery.matches(expectName = "晴天", expectSinger = "", actualName = "七里香", actualSinger = ""))
    }

    @Test
    fun `matching allows inclusion and empty singer`() {
        assertTrue(LocalSourceQuery.matches(expectName = "晴天", expectSinger = "周杰伦", actualName = "晴天 (Live)", actualSinger = "周杰伦/群星"))
        assertTrue(LocalSourceQuery.matches(expectName = "晴天", expectSinger = "", actualName = "晴天", actualSinger = ""))
        // RN `fSinger.includes(singer)`：结果侧歌手为空串时恒放行（`includes("")` 恒真），照抄
        assertTrue(LocalSourceQuery.matches(expectName = "晴天", expectSinger = "周杰伦", actualName = "晴天", actualSinger = ""))
    }
}
