package cn.toside.music.core.recommend.m3

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** 通道 E 首屏补给的纯计划部分（W5-3 方案 b）：只读缓存、不碰网络。 */
class SimilarArtistPrefillTest {
    private fun entry(name: String) = SimilarArtist.SimilarEntry(mbid = "mbid-$name", name = name, score = 1.0)

    private fun record(
        names: List<String>,
        fetchedAt: Long,
        nextIndex: Int = 0,
    ) = SimilarArtist.Record(
        similar = names.map(::entry),
        fetchedAt = fetchedAt,
        nextIndex = nextIndex,
    )

    @Test
    fun `空缓存不发任何请求也不给计划`() {
        assertTrue(SimilarArtist.planCachePrefill(SimilarArtist.Cache(), maxArtists = 2).isEmpty())
    }

    @Test
    fun `从记录的轮换位开始取相似歌手`() {
        val cache =
            SimilarArtist.Cache(
                byArtist = mapOf("甲" to record(listOf("A", "B", "C"), fetchedAt = 1, nextIndex = 2)),
            )
        val picks = SimilarArtist.planCachePrefill(cache, maxArtists = 2)
        assertEquals(listOf("C", "A"), picks.map { it.artistName })
        assertEquals(listOf("甲", "甲"), picks.map { it.seedArtist })
    }

    @Test
    fun `最多只取 maxArtists 位`() {
        val cache =
            SimilarArtist.Cache(
                byArtist =
                    mapOf(
                        "甲" to record(listOf("A", "B"), fetchedAt = 2),
                        "乙" to record(listOf("C", "D"), fetchedAt = 1),
                    ),
            )
        val picks = SimilarArtist.planCachePrefill(cache, maxArtists = 3)
        assertEquals(3, picks.size)
        assertEquals(listOf("A", "B", "C"), picks.map { it.artistName })
    }

    @Test
    fun `最近铺完的种子优先`() {
        val cache =
            SimilarArtist.Cache(
                byArtist =
                    mapOf(
                        "旧" to record(listOf("Old"), fetchedAt = 1),
                        "新" to record(listOf("New"), fetchedAt = 9),
                    ),
            )
        val picks = SimilarArtist.planCachePrefill(cache, maxArtists = 1)
        assertEquals("New", picks.single().artistName)
    }

    @Test
    fun `没有相似歌手的记录跳过`() {
        val cache =
            SimilarArtist.Cache(
                byArtist =
                    mapOf(
                        "空" to record(emptyList(), fetchedAt = 9),
                        "有" to record(listOf("A"), fetchedAt = 1),
                    ),
            )
        val picks = SimilarArtist.planCachePrefill(cache, maxArtists = 2)
        assertEquals(listOf("A"), picks.map { it.artistName })
    }

    @Test
    fun `maxArtists 非正时直接返回空表`() {
        val cache = SimilarArtist.Cache(byArtist = mapOf("甲" to record(listOf("A"), fetchedAt = 1)))
        assertTrue(SimilarArtist.planCachePrefill(cache, maxArtists = 0).isEmpty())
    }
}
