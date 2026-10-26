package cn.toside.music.core.recommend.m3

import cn.toside.music.core.recommend.radio.ChannelId
import cn.toside.music.core.recommend.radio.ChannelQuotaPlan
import cn.toside.music.core.recommend.radio.Channels
import cn.toside.music.core.recommend.radio.FinalQueueItem
import cn.toside.music.core.recommend.radio.RadioFixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * fallback 分支的通道归属 —— Wave6 实证到的一个真 bug 的回归用例。
 *
 * 旧实现把「池中第一首的通道」贴给 fallback 里选中的**任何**歌：
 * 池首是 C 时，被选中的 A 也会记成 C。通道配额与 `getSummary().channelShare`
 * 因此一起错位（真机上表现为某个通道占比异常高、另一个恒 0）。
 */
class DiversityFallbackChannelTest {
    private fun item(
        key: String,
        channel: ChannelId,
        lang: LangBucket,
        weight: Double,
    ) = FinalQueueItem(
        key = key,
        channels = listOf(channel),
        channelWeights = mapOf(channel to weight),
        channelSourceIds = emptyMap(),
        primaryArtist = "artist:$key",
        artistKeys = listOf("artist:$key"),
        albumKey = "album:$key",
        sourcePlaylistId = null,
        sourceSeedTrackKey = null,
        sourceChartId = null,
        groupIds = emptyList(),
        exposureCount = 0,
        weight = weight,
        lang = lang,
    )

    @Test
    fun `fallback 选中的歌按自己的通道记账`() {
        val quotas = Channels.emptyCounts()
        quotas[ChannelId.A] = 1
        quotas[ChannelId.C] = 1
        val plan = ChannelQuotaPlan(quotas, 2, emptyMap())
        // 历史里已经连了 2 首 ZH：所有候选都被连播规则卡住 → 必然走 fallback。
        // 池首是 C（低分），真正会被抽中的是 A（高分）。
        val history =
            listOf(
                item("h1", ChannelId.A, LangBucket.ZH, 1.0),
                item("h2", ChannelId.A, LangBucket.ZH, 1.0),
            )
        val candidates =
            listOf(
                item("c-low", ChannelId.C, LangBucket.ZH, 0.01),
                item("a-high", ChannelId.A, LangBucket.ZH, 1.0),
            )
        val result =
            Diversity.select(
                candidates,
                Diversity.Options(
                    target = 1,
                    recent = history,
                    channelPlan = plan,
                    rng = RadioFixtures.seededRandom(7),
                ),
            )
        val picked = result.items.single()
        assertEquals("a-high", picked.item.key)
        assertEquals(ChannelId.A, picked.channel)
        assertEquals(1, result.pickedByChannel.getValue(ChannelId.A))
        assertEquals(0, result.pickedByChannel.getValue(ChannelId.C))
        assertTrue(result.reasons.contains("fallback_channel"))
    }
}
