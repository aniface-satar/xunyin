package cn.toside.music.core.recommend.radio

import cn.toside.music.core.recommend.m3.Diversity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * `RadioSelectionTest` 8 条用例（13 个断言）到 M3 [Diversity] 的迁移对照。
 *
 * 原 `RadioSelectionTest` **原样保留**（M2 实现已标 `@Deprecated` 作参照），
 * 这里逐条给出 M3 语义下的等价断言；被 M3 有意取代的两条在用例名里写明了新口径：
 *
 * | M2 用例 | M3 迁移后 | 说明 |
 * | --- | --- | --- |
 * | respectsChannelQuota | 同 | 通道配额仍按 plan 扣 |
 * | channelWithoutCandidatesHandsQuotaBack | **换成**「用其他通道补位并记 fallback_channel」 | M2 在这里直接收口（`channel_exhausted`）；M3 与 RN 一致走 fallback，让队列不被 plan 的通道构成饿死 |
 * | sameArtistIsSpacedOut | 同 | 首档间隔 8 仍在 |
 * | explorationGapDefersExplorationChannels | **换成**「刚播过探索曲后先出熟悉通道」 | M3 的间隔看窗口内是否出现探索曲，不看连续熟悉曲长度 |
 * | explorationGapOpensAfterEnoughFamiliarTracks | 同 | 历史里没有探索曲即放行 |
 * | sameSeedPicksSameTracks | 同 | RNG 注入 |
 * | neverPicksSameKeyTwice | **换成**「池内键唯一时不重复」 | M3 按候选对象去重（RN 同），键唯一是池子的契约 |
 * | playlistRepeatCapSkipsRepeatedSource | **改成**「放宽档抬到 4 首」 | M3 第 1 档起把 samePlaylistInLast20 放宽到 4（RN 同） |
 */
class DiversitySelectionParityTest {
    private fun item(
        key: String,
        channels: List<ChannelId>,
        artistKeys: List<String> = listOf(key),
        albumKey: String = "album:$key",
        playlistId: String? = null,
    ) = FinalQueueItem(
        key = key,
        channels = channels,
        channelWeights = channels.associateWith { 1.0 },
        channelSourceIds = emptyMap(),
        primaryArtist = artistKeys.firstOrNull().orEmpty(),
        artistKeys = artistKeys,
        albumKey = albumKey,
        sourcePlaylistId = playlistId,
        sourceSeedTrackKey = null,
        sourceChartId = null,
        groupIds = emptyList(),
        exposureCount = 0,
        weight = 1.0,
    )

    private fun options(
        target: Int,
        plan: ChannelQuotaPlan,
        seed: Long = 1,
        recent: List<FinalQueueItem> = emptyList(),
        explorationGap: Int = 0,
    ) = Diversity.Options(
        target = target,
        recent = recent,
        channelPlan = plan,
        rng = RadioFixtures.seededRandom(seed),
        explorationGap = explorationGap,
    )

    @Test
    fun `通道配额仍按 plan 扣`() {
        val items = List(10) { item("k$it", listOf(ChannelId.A)) }
        val result = Diversity.select(items, options(10, RadioFixtures.quotaPlan(mapOf(ChannelId.A to 3))))
        assertEquals(3, result.items.size)
        assertEquals(3, result.pickedByChannel.getValue(ChannelId.A))
    }

    @Test
    fun `plan 里没有可用通道时用其他通道补位并记 fallback_channel`() {
        // M2 的 channelWithoutCandidatesHandsQuotaBack 在这里直接收口（channel_exhausted）；
        // M3 与 RN `selectFinalQueue` 一致走 fallback：候选明明在池里，不能因为 plan 只给了 A
        // 就让队列空着。记账按候选自己的通道（B），`quota_exhausted` 只在 plan 额度**用尽**时才记。
        val items = List(5) { item("b$it", listOf(ChannelId.B)) }
        val result = Diversity.select(items, options(2, RadioFixtures.quotaPlan(mapOf(ChannelId.A to 2))))
        assertEquals(2, result.items.size)
        assertTrue(result.reasons.contains("fallback_channel"))
        assertEquals(2, result.pickedByChannel.getValue(ChannelId.B))
        assertEquals(0, result.pickedByChannel.getValue(ChannelId.A))
    }

    @Test
    fun `同歌手在首档间隔内被硬排除`() {
        val items =
            listOf(
                item("x1", listOf(ChannelId.A), artistKeys = listOf("周杰伦")),
                item("x2", listOf(ChannelId.A), artistKeys = listOf("周杰伦")),
                item("x3", listOf(ChannelId.A), artistKeys = listOf("周杰伦")),
                item("y1", listOf(ChannelId.A), artistKeys = listOf("陈奕迅")),
                item("z1", listOf(ChannelId.A), artistKeys = listOf("林俊杰")),
            )
        val result = Diversity.select(items, options(3, RadioFixtures.quotaPlan(mapOf(ChannelId.A to 3)), seed = 5))
        val artists = result.items.flatMap { it.item.artistKeys }
        assertEquals(3, result.items.size)
        assertEquals(artists.distinct().size, artists.size)
    }

    @Test
    fun `刚播过探索曲后先出熟悉通道`() {
        val items =
            List(3) { item("c$it", listOf(ChannelId.C)) } +
                List(3) { item("a$it", listOf(ChannelId.A)) }
        val recent = listOf(item("c-last", listOf(ChannelId.C)))
        val result =
            Diversity.select(
                items,
                options(
                    target = 1,
                    plan = RadioFixtures.quotaPlan(mapOf(ChannelId.C to 1, ChannelId.A to 1)),
                    recent = recent,
                    explorationGap = RadioConfig.RadioExploration.GAP,
                ),
            )
        assertEquals(ChannelId.A, result.items.first().channel)
    }

    @Test
    fun `历史里没有探索曲时探索间隔放行`() {
        val recent = List(3) { item("r$it", listOf(ChannelId.A)) }
        val items = List(3) { item("c$it", listOf(ChannelId.C)) }
        val result =
            Diversity.select(
                items,
                options(
                    target = 1,
                    plan = RadioFixtures.quotaPlan(mapOf(ChannelId.C to 1)),
                    recent = recent,
                    explorationGap = RadioConfig.RadioExploration.GAP,
                ),
            )
        assertEquals(1, result.items.size)
        assertEquals(ChannelId.C, result.items.first().channel)
    }

    @Test
    fun `同种子给出同一条队列`() {
        val items = List(12) { item("k$it", listOf(ChannelId.A)) }
        val plan = RadioFixtures.quotaPlan(mapOf(ChannelId.A to 4))
        val first = Diversity.select(items, options(4, plan, seed = 99)).items.map { it.item.key }
        val second = Diversity.select(items, options(4, plan, seed = 99)).items.map { it.item.key }
        assertEquals(first, second)
    }

    @Test
    fun `池内键唯一时不会选到同一首两次`() {
        // M3 按候选对象去重（RN 的 Set 语义）；键唯一是候选池的契约（mergeCandidates 以 trackKey 建索引）
        val items = List(6) { item("k$it", listOf(ChannelId.A)) }
        val result = Diversity.select(items, options(6, RadioFixtures.quotaPlan(mapOf(ChannelId.A to 6))))
        assertEquals(6, result.items.size)
        val keys = result.items.map { it.item.key }
        assertEquals(keys.size, keys.distinct().size)
    }

    @Test
    fun `同一来源歌单的重复上限在放宽档抬到 4 首`() {
        // M2 的末档仍守 2 首；M3 从第 1 档起把 samePlaylistInLast20 放宽到 4（RN 同），
        // 这是「候选枯竭优先保住队列」的有意取舍，不是回归
        val items = List(6) { item("p$it", listOf(ChannelId.A), playlistId = "pl-1") }
        val result = Diversity.select(items, options(6, RadioFixtures.quotaPlan(mapOf(ChannelId.A to 6))))
        assertEquals(4, result.items.size)
    }
}
