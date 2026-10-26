package cn.toside.music.core.recommend.radio

import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 通道候选构建：E（相似歌手）与 C（探索补货）的归属与权重口径。
 *
 * 这两个通道的候选都进同一个池子，配额由 `Channels.plan` 的 A7/B5/C4/D2/E2 决定，
 * 所以这里只钉两件事：**主通道对不对**、**亲和度/探索度有没有被夹在预期区间**。
 *
 * 歌手名一律用纯中文：画像里的歌手键是 `TrackKeys.normalizeText` 过的小写串，
 * 带拉丁字母的名字会和小写化的候选侧键对不上（生产环境两侧都归一化，测试里别自找麻烦）。
 */
class RadioCandidatesChannelsTest {
    private val now = RadioFixtures.NOW

    private fun params(
        topArtists: List<RadioArtist> = listOf(RadioArtist("歌手甲", 1.0)),
        exclusion: ExclusionContext = ExclusionContext(),
    ): CandidateBuildParams =
        CandidateBuildParams(
            profile = RadioProfile(seedKeys = setOf("ns:种子__歌手甲"), topArtists = topArtists),
            now = now,
            exclusion = exclusion,
        )

    private fun tracks(): List<JsonObject> =
        List(3) { index ->
            RadioFixtures.musicInfo(id = "t$index", name = "曲目$index", singer = if (index == 0) "歌手甲" else "陌生$index")
        }

    @Test
    fun discoveryCandidatesBelongToChannelC() {
        val created = RadioCandidates.createDiscoveryCandidates(tracks(), "日语", params())

        assertEquals(3, created.size)
        // channels 首项即主通道；命中画像歌手时会追加 A（见下一个用例）
        assertTrue(created.all { it.channels.first() == ChannelId.C })
        assertTrue(created.all { it.reasons.contains("discovery:日语") })
        // 撞新通道固定高探索度
        assertTrue(created.all { it.exploration >= 0.9 })
    }

    @Test
    fun discoveryCandidatesAlsoCountForChannelAWhenArtistMatches() {
        val created = RadioCandidates.createDiscoveryCandidates(tracks(), "华语", params())

        val hit = created.first { it.musicInfo.stringField("singer") == "歌手甲" }
        val miss = created.first { it.musicInfo.stringField("singer") != "歌手甲" }
        // 主通道仍是 C，但命中画像歌手时同时算 A 的份额
        assertTrue(hit.channels.contains(ChannelId.A))
        assertTrue(miss.channels.none { it == ChannelId.A })
    }

    @Test
    fun discoveryCandidatesRespectExclusion() {
        val blockedTrack = tracks().first()
        val blockedKey = RadioTrackKeys.buildTrackKey(blockedTrack)
        val created =
            RadioCandidates.createDiscoveryCandidates(
                tracks(),
                "华语",
                params(exclusion = ExclusionContext(dislikedTrackKeys = setOf(blockedKey))),
            )

        assertEquals(2, created.size)
        assertTrue(created.none { it.trackKey == blockedKey })
    }

    @Test
    fun similarArtistAffinityIsClampedAndSeededByProfile() {
        val contributions =
            listOf(
                SimilarArtistContribution(seedArtist = "歌手甲", artistName = "相似1", tracks = tracks().take(2)),
                // 画像里没有这位种子歌手 → 走默认 0.3 下限分支
                SimilarArtistContribution(seedArtist = "没听过的歌手", artistName = "相似2", tracks = tracks().take(1)),
            )
        val created = RadioCandidates.createSimilarArtistCandidates(contributions, params())

        assertEquals(3, created.size)
        assertTrue(created.all { it.channels == listOf(ChannelId.E) })
        val known = created.first { it.reasons.contains("similar_artist:歌手甲") }
        val unknown = created.first { it.reasons.contains("similar_artist:没听过的歌手") }
        // 画像权重 1.0 × 0.8 = 0.8；未知种子歌手取 0.3 × 0.8 = 0.24 → 抬到 0.3 下限
        assertEquals(0.8, known.affinity, 1e-9)
        assertEquals(0.3, unknown.affinity, 1e-9)
        // E 只做画像延伸，不该像 C 那样高探索
        assertTrue(created.all { it.exploration < 0.5 })
    }

    @Test
    fun similarArtistAffinityIsCappedAtPointNine() {
        val created =
            RadioCandidates.createSimilarArtistCandidates(
                listOf(SimilarArtistContribution("歌手甲", "相似1", tracks().take(1))),
                params(topArtists = listOf(RadioArtist("歌手甲", 5.0))),
            )

        assertEquals(0.9, created.first().affinity, 1e-9)
    }
}
