package cn.toside.music.core.recommend.m3

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 「相似歌曲」排序 —— RN 无此功能，规则见 [SimilarSongs] 类注释。
 * 数值级别锁住三条：同歌手优先、弱信号被丢弃、同歌手限额。
 */
class SimilarSongsTest {
    private fun track(
        name: String,
        singer: String,
        album: String = "",
        lists: Set<String> = emptySet(),
    ) = SimilarSongs.Track(
        trackKey = "$name::$singer",
        name = name,
        singer = singer,
        album = album,
        listIds = lists,
    )

    private val seed = track("晴天", "周杰伦", album = "叶惠美", lists = setOf("love"))

    @Test
    fun `同歌手的歌排在不同歌手前面`() {
        val sameArtist = track("七里香", "周杰伦")
        val exactTitle = track("晴天", "某翻唱歌手")
        val unrelated = track("大海", "张雨生")
        val ranked =
            SimilarSongs
                .rank(seed, listOf(unrelated, exactTitle, sameArtist), limit = 10)
                .map { it.track.trackKey }
        assertEquals(listOf(sameArtist.trackKey, exactTitle.trackKey), ranked)
    }

    @Test
    fun `只有弱信号的候选被丢弃`() {
        val onlySameList = track("完全无关", "另一个歌手", lists = setOf("love"))
        val sameAlbumOtherArtist = track("以父之名", "另一个歌手", album = "叶惠美")
        val exactTitle = track("晴天", "翻唱歌手")
        // 仅同歌单 / 仅同专辑都只有 0.1 分（< MIN_SCORE），跨歌手同名 0.3 分保留
        val ranked = SimilarSongs.rank(seed, listOf(onlySameList, sameAlbumOtherArtist, exactTitle), limit = 10)
        assertEquals(listOf(exactTitle.trackKey), ranked.map { it.track.trackKey })
        assertTrue("弱信号分数应低于同歌手", ranked.first().score < 0.5)
    }

    @Test
    fun `同一歌手最多出两首`() {
        val jay = (1..5).map { track("周杰伦歌曲$it", "周杰伦") }
        val other = track("晴天", "翻唱歌手")
        val ranked = SimilarSongs.rank(seed, jay + other, limit = 10)
        assertEquals(3, ranked.size)
        assertEquals(2, ranked.count { it.track.singer == "周杰伦" })
        assertEquals("翻唱歌手", ranked.last().track.singer)
    }

    @Test
    fun `种子曲与重复候选都不入结果`() {
        val dup = track("七里香", "周杰伦", lists = setOf("a"))
        val dupOtherList = track("七里香", "周杰伦", lists = setOf("b"))
        val ranked = SimilarSongs.rank(seed, listOf(seed, dup, dupOtherList), limit = 10)
        assertEquals(1, ranked.size)
        assertEquals(setOf("a", "b"), ranked.first().track.listIds)
    }

    @Test
    fun `结果与输入顺序无关`() {
        val a = track("七里香", "周杰伦")
        val b = track("晴天", "翻唱歌手")
        val c = track("夜曲", "周杰伦")
        val first = SimilarSongs.rank(seed, listOf(a, b, c), limit = 10).map { it.track.trackKey }
        val second = SimilarSongs.rank(seed, listOf(c, b, a), limit = 10).map { it.track.trackKey }
        assertEquals(first, second)
    }
}
