package cn.toside.music.core.recommend.m3

import cn.toside.music.core.recommend.radio.ObservedPlaylist
import cn.toside.music.core.recommend.radio.PlayEndReason
import cn.toside.music.core.recommend.radio.RadioPlayRecord
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 共现索引的纯算术 —— 对照 RN `core/recommend/similarity.ts`
 * （`buildTrackPlaylistIndex` / `computeCandidateCoOccurrence` / `groupSimilarPlaylists` /
 * `buildSessionCoOccurrence`）。数值与 RN 逐条对齐，改动必须同步改这里。
 */
class LibraryIndexTest {
    private fun observed(
        id: String,
        tracks: List<String>,
        confirmed: Boolean = true,
        seedOverlap: Int = 1,
        confidence: Double = 1.0,
    ): ObservedPlaylist =
        ObservedPlaylist(
            id = id,
            source = "kw",
            trackKeys = tracks,
            seedOverlap = seedOverlap,
            confidence = confidence,
            confirmed = confirmed,
        )

    @Test
    fun `倒排索引记录每首歌所在的歌单`() {
        val index =
            LibraryIndex.buildTrackPlaylistIndex(
                listOf(
                    observed("p1", listOf("t1", "t2", "t3")),
                    observed("p2", listOf("t2", "t4")),
                ),
                now = 1_000,
            )
        assertEquals(listOf("p1"), index["t1"]?.playlistIds)
        assertEquals(listOf("p1", "p2"), index["t2"]?.playlistIds)
        assertEquals(listOf("p2"), index["t4"]?.playlistIds)
        assertEquals(1_000L, index["t1"]?.updatedAt)
    }

    @Test
    fun `倒排索引到容量上限后只补已有条目不收新曲`() {
        // p1 收 t1/t2 后满 2 条；p2 的 t2 会补进已有条目，t3 作为新曲被丢弃（RN 同）
        val index =
            LibraryIndex.buildTrackPlaylistIndex(
                listOf(
                    observed("p1", listOf("t1", "t2", "t3")),
                    observed("p2", listOf("t2", "t3")),
                ),
                maxEntries = 2,
            )
        assertEquals(setOf("t1", "t2"), index.keys)
        assertEquals(listOf("p1", "p2"), index["t2"]?.playlistIds)
    }

    @Test
    fun `共现分按歌单规模与置信度归一`() {
        val playlists =
            listOf(
                // 贡献 = 2 × 1.0 / √4 = 1.0
                observed("pA", listOf("t1", "t2", "t3", "t4"), seedOverlap = 2),
                // 贡献 = 1 × 0.5 / √9 = 1/6
                observed("pB", listOf("t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10"), seedOverlap = 1, confidence = 0.5),
            )
        val index = LibraryIndex.buildTrackPlaylistIndex(playlists)
        val input = LibraryIndex.CoOccurrenceInput(seedTrackKeys = setOf("s1"), observedPlaylists = playlists, index = index)

        // 只在 pA：total=1 → 饱和 0.5；封顶 = 1 × 2.5 × 1/(1+ln2) ≈ 1.476 > 0.5，取饱和值
        assertEquals(0.5, LibraryIndex.computeCandidateCoOccurrence("t1", input), 1e-9)
        // pA + pB：total = 7/6 → 饱和 (7/6)/(13/6) = 7/13
        assertEquals(7.0 / 13.0, LibraryIndex.computeCandidateCoOccurrence("t2", input), 1e-9)
        // 只在 pB：total = 1/6 → 饱和 (1/6)/(7/6) = 1/7
        assertEquals(1.0 / 7.0, LibraryIndex.computeCandidateCoOccurrence("t5", input), 1e-9)
        // 不在任何观察歌单里
        assertEquals(0.0, LibraryIndex.computeCandidateCoOccurrence("nope", input), 1e-9)
    }

    @Test
    fun `未确认与无种子重合的歌单不贡献共现`() {
        val playlists =
            listOf(
                observed("pA", listOf("t1", "t2"), seedOverlap = 3),
                observed("pB", listOf("t1", "t2"), confirmed = false, seedOverlap = 3),
                observed("pC", listOf("t1", "t2"), seedOverlap = 0),
            )
        val index = LibraryIndex.buildTrackPlaylistIndex(playlists)
        val input = LibraryIndex.CoOccurrenceInput(observedPlaylists = playlists, index = index)
        // 三个歌单里只有 pA 计入：damping 仍按索引里的 3 个歌单算（RN 同），
        // total = 3/√2 ≈ 2.1213 → 饱和 ≈ 0.6796，封顶 = 2.1213 × 2.5 × 1/(1+ln4) ≈ 2.238 → 取饱和值
        val expected = 2.1213203435596424 / (1 + 2.1213203435596424)
        assertEquals(expected, LibraryIndex.computeCandidateCoOccurrence("t1", input), 1e-9)
    }

    @Test
    fun `观察歌单按曲目重合并查集分组`() {
        val playlists =
            listOf(
                observed("p1", listOf("a", "b", "c", "d", "e")),
                observed("p2", listOf("a", "b", "c", "d", "e")),
                observed("p3", listOf("f", "g")),
            )
        val groups = LibraryIndex.groupSimilarPlaylists(playlists)
        assertEquals(groups["p1"], groups["p2"])
        assertTrue(groups["p3"] != groups["p1"])
        assertTrue(groups["p1"]!!.startsWith("group:"))
    }

    @Test
    fun `低置信度采样不并组`() {
        // Jaccard = 5/10 = 0.5，但 p4 置信度 0.2 → 0.1 < 0.35，不合并（RN 同）
        val playlists =
            listOf(
                observed("p4", listOf("a", "b", "c", "d", "e"), confidence = 0.2),
                observed("p5", listOf("a", "b", "c", "d", "e", "f", "g", "h", "i", "j")),
            )
        val groups = LibraryIndex.groupSimilarPlaylists(playlists)
        assertTrue(groups["p4"] != groups["p5"])
    }

    private fun record(
        trackKey: String,
        startedAt: Long,
        coverage: Double,
        reason: PlayEndReason,
    ): RadioPlayRecord =
        RadioPlayRecord(
            playId = trackKey + startedAt,
            trackKey = trackKey,
            startedAt = startedAt,
            coverage = coverage,
            endReason = reason,
        )

    @Test
    fun `会话共现只吸收中性收听且带锚点的场次`() {
        val now = 100_000L
        val history =
            listOf(
                record("s1", now, 1.0, PlayEndReason.NATURAL_END),
                record("x", now + 1_000, 0.9, PlayEndReason.NATURAL_END),
                // 早切：USER_NEXT 且覆盖率 < 0.5 → 不吸收信号
                record("y", now + 2_000, 0.1, PlayEndReason.USER_NEXT),
                // 超过 30 分钟间隔 = 另一场，且本场没有锚点 → 不产出
                record("z", now + 31 * 60 * 1000, 0.8, PlayEndReason.NATURAL_END),
            )
        val scores = LibraryIndex.buildSessionCoOccurrence(history, setOf("s1"), LibraryIndex.SessionCoOccurrenceOptions(now = now))
        assertEquals(mapOf("x" to 0.5), scores)
        assertFalse(scores.containsKey("y"))
        assertFalse(scores.containsKey("z"))
    }

    @Test
    fun `会话共现按半衰期衰减并跨场次累加`() {
        val now = 1_000_000L
        val fourteenDays = 14L * 24 * 60 * 60 * 1000
        val history =
            listOf(
                // 本场锚点就在 now：贡献 1.0
                record("s1", now, 1.0, PlayEndReason.NATURAL_END),
                record("x", now + 1_000, 0.9, PlayEndReason.NATURAL_END),
                // 半个半衰期前的一场：贡献 0.5^1 = 0.5
                record("s1", now - fourteenDays, 1.0, PlayEndReason.NATURAL_END),
                record("x", now - fourteenDays + 1_000, 0.9, PlayEndReason.NATURAL_END),
            )
        val scores = LibraryIndex.buildSessionCoOccurrence(history, setOf("s1"), LibraryIndex.SessionCoOccurrenceOptions(now = now))
        // total = 1.5 → 1.5 / 2.5 = 0.6
        assertEquals(0.6, scores["x"]!!, 1e-9)
    }

    @Test
    fun `没有种子或没有中性收听就没有会话共现`() {
        val now = 100_000L
        val history = listOf(record("x", now, 0.9, PlayEndReason.NATURAL_END))
        assertTrue(LibraryIndex.buildSessionCoOccurrence(history, emptySet(), LibraryIndex.SessionCoOccurrenceOptions(now = now)).isEmpty())
        assertTrue(LibraryIndex.buildSessionCoOccurrence(emptyList(), setOf("s1")).isEmpty())
        // 踩雷结束不是中性收听
        val disliked =
            listOf(
                record("s1", now, 1.0, PlayEndReason.NATURAL_END),
                record("x", now + 1_000, 0.9, PlayEndReason.DISLIKE),
            )
        assertTrue(
            LibraryIndex
                .buildSessionCoOccurrence(disliked, setOf("s1"), LibraryIndex.SessionCoOccurrenceOptions(now = now))
                .isEmpty(),
        )
    }
}
