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
 * 语种硬配额与时段因子的**接线级**用例（纯规则层的用例在 LanguageQuotaTest / DiversityTest）。
 *
 * 这里走「问卷百分比 → targets → caps → Diversity」整条链，锁的是两端接起来之后的行为：
 * 配额为 0 的桶一首都不出；时段因子确实改变固定种子下的选中分布。
 */
class LanguageQuotaWiringTest {
    private fun item(
        key: String,
        lang: LangBucket?,
        artists: List<String> = listOf("artist:$key"),
        weight: Double = 1.0,
    ) = FinalQueueItem(
        key = key,
        channels = listOf(ChannelId.A),
        channelWeights = mapOf(ChannelId.A to weight),
        channelSourceIds = emptyMap(),
        primaryArtist = artists.first(),
        artistKeys = artists,
        albumKey = "album:$key",
        sourcePlaylistId = null,
        sourceSeedTrackKey = null,
        sourceChartId = null,
        groupIds = emptyList(),
        exposureCount = 0,
        weight = weight,
        lang = lang,
    )

    private fun plan(count: Int): ChannelQuotaPlan {
        val quotas = Channels.emptyCounts()
        quotas[ChannelId.A] = count
        return ChannelQuotaPlan(quotas, count, emptyMap())
    }

    private fun options(
        target: Int,
        caps: LanguageQuota.LangCaps,
        seed: Long = 11,
        timeSlotFactor: (List<String>) -> Double = { 1.0 },
    ) = Diversity.Options(
        target = target,
        recent = emptyList(),
        channelPlan = plan(target),
        rng = RadioFixtures.seededRandom(seed),
        langCaps = caps,
        timeSlotFactor = timeSlotFactor,
    )

    /**
     * 这两条只在 **2 首** 的队列上断言「全给 / 一首都不出」：同语种最多连播 2 首是硬规则
     * （[LanguageQuota.MAX_CONSECUTIVE_SAME_LANG]，配额放开档也守），目标一超过 2，
     * 第三首必然走放宽档、把配额放开——那是下面 [配额与连播规则打架时先放开配额] 锁的行为，
     * 不是这里要验证的 caps 语义。用 10 首来断言「全华语」等于要求连播 10 首中文。
     */
    @Test
    fun `问卷华语 100 其余 0 时队列先吃满华语额度`() {
        val targets = LanguageQuota.computeLangTargets(mapOf("zh" to 100.0, "western" to 0.0))
        val caps = LanguageQuota.computeLangCaps(targets, emptyMap())
        assertEquals(0, caps.caps[LangBucket.EN])
        val candidates =
            (0 until 10).map { item("zh$it", LangBucket.ZH) } +
                (0 until 10).map { item("en$it", LangBucket.EN) }
        val result = Diversity.select(candidates, options(target = 2, caps = caps))
        assertEquals(2, result.items.size)
        assertTrue(result.items.all { it.item.lang == LangBucket.ZH })
    }

    @Test
    fun `问卷华语 0 时一首华语都不出`() {
        val targets = LanguageQuota.computeLangTargets(mapOf("zh" to 0.0))
        val caps = LanguageQuota.computeLangCaps(targets, emptyMap())
        assertEquals(0, caps.caps[LangBucket.ZH])
        val candidates =
            (0 until 10).map { item("zh$it", LangBucket.ZH) } +
                (0 until 10).map { item("en$it", LangBucket.EN) }
        val result = Diversity.select(candidates, options(target = 2, caps = caps))
        assertEquals(2, result.items.size)
        assertTrue(result.items.none { it.item.lang == LangBucket.ZH })
    }

    @Test
    fun `配额与连播规则打架时先放开配额`() {
        // 用户要 100% 华语，但「最多连播 2 首同语种」从第 3 首起与配额互斥：
        // M3（RN 同）的选择是放宽档放开配额、出一首别的语种，也不连播第三首中文；
        // 原因串必须留下 lang_quota_relaxed，否则用户看到混合队列会以为配额没生效。
        // western 必须显式声明 0%：没声明的桶在 caps 里缺席，语义是「不限」，英文就会直接放行
        val targets = LanguageQuota.computeLangTargets(mapOf("zh" to 100.0, "western" to 0.0))
        val caps = LanguageQuota.computeLangCaps(targets, emptyMap())
        val candidates =
            (0 until 10).map { item("zh$it", LangBucket.ZH) } +
                (0 until 10).map { item("en$it", LangBucket.EN) }
        val result = Diversity.select(candidates, options(target = 5, caps = caps))
        assertEquals(5, result.items.size)
        assertTrue(result.reasons.contains("lang_quota_relaxed"))
        var run = 0
        var maxRun = 0
        for (item in result.items) {
            run = if (item.item.lang == LangBucket.ZH) run + 1 else 0
            maxRun = maxOf(maxRun, run)
        }
        assertEquals(2, maxRun)
    }

    @Test
    fun `整池只有被配额拒绝的语种时放弃配额并记录原因`() {
        // 供给不足（not enough）与用户明确不要（cap=0）必须能从原因里分开
        val targets = LanguageQuota.computeLangTargets(mapOf("zh" to 0.0))
        val caps = LanguageQuota.computeLangCaps(targets, emptyMap())
        val candidates = (0 until 5).map { item("zh$it", LangBucket.ZH) }
        val result = Diversity.select(candidates, options(target = 5, caps = caps))
        assertEquals(5, result.items.size)
        assertTrue(result.reasons.contains("lang_quota_relaxed"))
    }

    @Test
    fun `时段因子改变固定种子序列下的选中分布`() {
        val candidates =
            listOf(
                item("a", null, artists = listOf("甲")),
                item("b", null, artists = listOf("乙")),
            )

        fun countPickedA(factor: (List<String>) -> Double): Int =
            (0 until 200).count { seed ->
                val result =
                    Diversity.select(
                        candidates,
                        options(
                            target = 1,
                            caps = LanguageQuota.LangCaps.UNENFORCED,
                            seed = seed.toLong(),
                            timeSlotFactor = factor,
                        ),
                    )
                val picked = result.items.first()
                picked.item.key == "a"
            }
        val neutral = countPickedA { 1.0 }
        val boosted = countPickedA { artists -> if (artists.contains("甲")) 2.0 else 1.0 }
        assertTrue("时段因子没有改变选中分布：neutral=$neutral boosted=$boosted", boosted > neutral)
        assertTrue("提升幅度不合理：neutral=$neutral boosted=$boosted", boosted > 100)
    }
}
