package cn.toside.music.core.recommend.radio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 最终选曲（M2 降级版 diversity：配额 + 歌手间隔 + 探索间隔 + softmax）单元测试。
 *
 * `RadioSelection` 自 Wave6 起已 `@Deprecated`（选曲点换成 M3 的 `Diversity.select`）：
 * 这套用例**原样保留**，12 条断言是「新实现在这些老口径上没有退化」的对照基线。
 * 对照用的 M3 等价断言见 `DiversitySelectionParityTest`。
 */
@Suppress("DEPRECATION")
class RadioSelectionTest {
    private fun options(
        target: Int,
        plan: ChannelQuotaPlan,
        seed: Long = 1,
        recent: List<FinalQueueItem> = emptyList(),
        explorationGap: Int = 0,
        temperature: Double = RadioConfig.Softmax.TEMPERATURE,
    ) = SelectionOptions(
        target = target,
        recent = recent,
        channelPlan = plan,
        rng = RadioFixtures.seededRandom(seed),
        temperature = temperature,
        explorationGap = explorationGap,
    )

    @Test
    fun respectsChannelQuota() {
        val items = List(10) { RadioFixtures.finalItem("k$it", listOf(ChannelId.A), artistKeys = listOf("artist$it")) }
        val result =
            RadioSelection.select(
                items,
                options(target = 10, plan = RadioFixtures.quotaPlan(mapOf(ChannelId.A to 3))),
            )
        assertEquals(3, result.items.size)
        assertEquals(3, result.pickedByChannel.getValue(ChannelId.A))
    }

    @Test
    fun channelWithoutCandidatesHandsQuotaBack() {
        val items = List(5) { RadioFixtures.finalItem("b$it", listOf(ChannelId.B), artistKeys = listOf("artist$it")) }
        val plan = RadioFixtures.quotaPlan(mapOf(ChannelId.A to 2))
        val result = RadioSelection.select(items, options(target = 2, plan = plan))
        assertTrue(result.items.isEmpty())
        assertTrue(result.reasons.any { it.startsWith("channel_exhausted") })
    }

    @Test
    fun sameArtistIsSpacedOut() {
        val items =
            listOf(
                RadioFixtures.finalItem("x1", listOf(ChannelId.A), artistKeys = listOf("周杰伦")),
                RadioFixtures.finalItem("x2", listOf(ChannelId.A), artistKeys = listOf("周杰伦")),
                RadioFixtures.finalItem("x3", listOf(ChannelId.A), artistKeys = listOf("周杰伦")),
                RadioFixtures.finalItem("y1", listOf(ChannelId.A), artistKeys = listOf("陈奕迅")),
                RadioFixtures.finalItem("z1", listOf(ChannelId.A), artistKeys = listOf("林俊杰")),
            )
        val result =
            RadioSelection.select(
                items,
                options(target = 3, plan = RadioFixtures.quotaPlan(mapOf(ChannelId.A to 3)), seed = 5),
            )
        val picked = result.items.map { it.item }.toList()
        assertEquals(3, picked.size)
        // 间隔阶梯首档 8 首内不允许同歌手
        val artists = picked.flatMap { it.artistKeys }
        assertEquals(artists.distinct().size, artists.size)
    }

    @Test
    fun explorationGapDefersExplorationChannels() {
        // 同批里既有熟悉通道也有探索通道：间隔未满足时额度必须让给 A，不硬塞 C
        val items =
            List(3) { RadioFixtures.finalItem("c$it", listOf(ChannelId.C), artistKeys = listOf("c$it")) } +
                List(3) { RadioFixtures.finalItem("a$it", listOf(ChannelId.A), artistKeys = listOf("a$it")) }
        val plan = RadioFixtures.quotaPlan(mapOf(ChannelId.C to 2, ChannelId.A to 2))
        val result =
            RadioSelection.select(
                items,
                options(target = 2, plan = plan, seed = 3, explorationGap = RadioConfig.RadioExploration.GAP),
            )
        assertEquals(0, result.pickedByChannel.getValue(ChannelId.C))
        assertEquals(2, result.pickedByChannel.getValue(ChannelId.A))
    }

    @Test
    fun explorationGapOpensAfterEnoughFamiliarTracks() {
        val recent =
            List(3) { RadioFixtures.finalItem("r$it", listOf(ChannelId.A), artistKeys = listOf("a$it")) }
        val items = List(3) { RadioFixtures.finalItem("c$it", listOf(ChannelId.C), artistKeys = listOf("c$it")) }
        val plan = RadioFixtures.quotaPlan(mapOf(ChannelId.C to 1))
        val result =
            RadioSelection.select(
                items,
                options(target = 1, plan = plan, recent = recent, explorationGap = RadioConfig.RadioExploration.GAP),
            )
        assertEquals(1, result.items.size)
        assertEquals(ChannelId.C, result.items.first().channel)
    }

    @Test
    fun sameSeedPicksSameTracks() {
        val items = List(12) { RadioFixtures.finalItem("k$it", listOf(ChannelId.A), artistKeys = listOf("a$it")) }
        val plan = RadioFixtures.quotaPlan(mapOf(ChannelId.A to 4))
        val first = RadioSelection.select(items, options(target = 4, plan = plan, seed = 99)).items.map { it.item.key }
        val second = RadioSelection.select(items, options(target = 4, plan = plan, seed = 99)).items.map { it.item.key }
        assertEquals(first, second)
    }

    @Test
    fun neverPicksSameKeyTwice() {
        val items = List(6) { RadioFixtures.finalItem("dup", listOf(ChannelId.A), artistKeys = listOf("a$it")) }
        val result =
            RadioSelection.select(
                items,
                options(target = 6, plan = RadioFixtures.quotaPlan(mapOf(ChannelId.A to 6))),
            )
        assertEquals(1, result.items.size)
    }

    @Test
    fun playlistRepeatCapSkipsRepeatedSource() {
        val items =
            List(5) { RadioFixtures.finalItem("p$it", listOf(ChannelId.A), artistKeys = listOf("a$it"), playlistId = "pl-1") }
        val result =
            RadioSelection.select(
                items,
                options(target = 5, plan = RadioFixtures.quotaPlan(mapOf(ChannelId.A to 5))),
            )
        // SAME_PLAYLIST_IN_LAST_20 = 2：同一来源歌单最多 2 首
        assertEquals(2, result.items.size)
    }
}
