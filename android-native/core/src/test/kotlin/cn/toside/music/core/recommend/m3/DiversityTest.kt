package cn.toside.music.core.recommend.m3

import cn.toside.music.core.recommend.radio.ChannelId
import cn.toside.music.core.recommend.radio.ChannelQuotaPlan
import cn.toside.music.core.recommend.radio.Channels
import cn.toside.music.core.recommend.radio.FinalQueueItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * MMR + 语种硬配额选曲 —— 对照 RN `core/recommend/diversity.ts` 的 `selectFinalQueue`。
 *
 * 随机源一律注入（`rng: () -> Double`），所以「同种子同结果」是可断言的；
 * MMR 的那一半用 [Diversity.mmrScores] 单独钉次序——抽样结果随机，相对次序不随机。
 */
class DiversityTest {
    private fun item(
        key: String,
        channel: ChannelId = ChannelId.A,
        weight: Double = 1.0,
        artists: List<String> = listOf("artist:$key"),
        albumKey: String = "album:$key",
        lang: LangBucket? = null,
        workKey: String? = null,
        groupIds: List<String> = emptyList(),
        playlistId: String? = null,
    ) = FinalQueueItem(
        key = key,
        channels = listOf(channel),
        channelWeights = mapOf(channel to weight),
        channelSourceIds = emptyMap(),
        primaryArtist = artists.firstOrNull().orEmpty(),
        artistKeys = artists,
        albumKey = albumKey,
        sourcePlaylistId = playlistId,
        sourceSeedTrackKey = null,
        sourceChartId = null,
        groupIds = groupIds,
        exposureCount = 0,
        weight = weight,
        lang = lang,
        workKey = workKey,
    )

    private fun plan(vararg pairs: Pair<ChannelId, Int>): ChannelQuotaPlan {
        val quotas = Channels.emptyCounts()
        for ((channel, count) in pairs) quotas[channel] = count
        return ChannelQuotaPlan(quotas, pairs.sumOf { it.second }, emptyMap())
    }

    /** 可复现的线性同余发生器：同一个种子必然给出同一条序列。 */
    private fun seededRng(seed: Long): () -> Double {
        var state = seed
        return {
            state = (state * 6364136223846793005L + 1442695040888963407L) ushr 11
            (state and 0xFFFFFFFFFFFFL).toDouble() / 0x1000000000000L.toDouble()
        }
    }

    private fun options(
        target: Int,
        quotas: ChannelQuotaPlan,
        seed: Long = 7L,
        recent: List<FinalQueueItem> = emptyList(),
        langCaps: LanguageQuota.LangCaps = LanguageQuota.LangCaps.UNENFORCED,
        mmrLambda: Double = Diversity.DEFAULT_MMR_LAMBDA,
        explorationGap: Int = 0,
        timeSlotFactor: (List<String>) -> Double = { 1.0 },
    ) = Diversity.Options(
        target = target,
        recent = recent,
        channelPlan = quotas,
        rng = seededRng(seed),
        explorationGap = explorationGap,
        langCaps = langCaps,
        mmrLambda = mmrLambda,
        timeSlotFactor = timeSlotFactor,
    )

    @Test
    fun `同种子给出同一条队列`() {
        val candidates = List(12) { item("t$it", weight = 1.0 + it * 0.1) }
        val quotas = plan(ChannelId.A to 6)
        val first = Diversity.select(candidates, options(target = 6, quotas = quotas, seed = 42)).items.map { it.item.key }
        val second = Diversity.select(candidates, options(target = 6, quotas = quotas, seed = 42)).items.map { it.item.key }
        assertEquals(first, second)
        assertEquals(6, first.size)
    }

    @Test
    fun `语种配额为 0 的桶一首都不出`() {
        // 四种非零额度语言各一首：不会触发连播硬规则，隔离出「配额为 0 就不出」这一条
        val candidates =
            (0 until 3).map { item("zh$it", weight = 5.0, lang = LangBucket.ZH) } +
                listOf(
                    item("en0", weight = 1.0, lang = LangBucket.EN),
                    item("ja0", weight = 1.0, lang = LangBucket.JA),
                    item("ko0", weight = 1.0, lang = LangBucket.KO),
                    item("other0", weight = 1.0, lang = LangBucket.OTHER),
                )
        val caps =
            LanguageQuota.LangCaps(
                enforced = true,
                caps =
                    mapOf(
                        LangBucket.ZH to 0,
                        LangBucket.EN to 1,
                        LangBucket.JA to 1,
                        LangBucket.KO to 1,
                        LangBucket.OTHER to 1,
                    ),
            )
        val result = Diversity.select(candidates, options(target = 4, quotas = plan(ChannelId.A to 4), langCaps = caps))
        assertEquals(4, result.items.size)
        assertTrue(result.items.none { it.item.lang == LangBucket.ZH })
    }

    @Test
    fun `整池同语种时放宽连播而不是把队列截断`() {
        val candidates = List(6) { item("zh$it", lang = LangBucket.ZH) }
        val caps = LanguageQuota.LangCaps(enforced = true, caps = mapOf(LangBucket.ZH to 6))
        val result = Diversity.select(candidates, options(target = 6, quotas = plan(ChannelId.A to 6), langCaps = caps))
        assertEquals(6, result.items.size)
        assertTrue(result.reasons.contains("lang_consecutive_relaxed"))
    }

    @Test
    fun `语种配额在放开档才满足时留下 lang_quota_relaxed`() {
        // 只有 ZH 有额度，但连播规则先卡住；放开档会把配额一起放掉
        val candidates = List(8) { item("zh$it", lang = LangBucket.ZH) }
        val caps = LanguageQuota.LangCaps(enforced = true, caps = mapOf(LangBucket.ZH to 2))
        val result = Diversity.select(candidates, options(target = 6, quotas = plan(ChannelId.A to 6), langCaps = caps))
        assertTrue(result.items.size > 2)
        assertTrue(result.reasons.contains("lang_quota_relaxed"))
    }

    @Test
    fun `MMR 在 lambda 低于 1 时压低与已选曲目冗余的候选`() {
        val chosen = item("a1", albumKey = "X", artists = listOf("A1"))
        val redundant = item("a2", albumKey = "X", artists = listOf("A2"))
        val fresh = item("b1", albumKey = "Y", artists = listOf("B1"))
        val pool = listOf(redundant, fresh)

        val pure =
            Diversity.mmrScores(
                pool,
                ChannelId.A,
                emptyList(),
                listOf(chosen),
                options(target = 1, quotas = plan(ChannelId.A to 1), mmrLambda = 1.0),
            )
        // λ=1 退化为纯 softmax：两个候选相关性相同，分数也相同
        assertEquals(pure.getValue(redundant), pure.getValue(fresh), 1e-9)

        val diverse =
            Diversity.mmrScores(
                pool,
                ChannelId.A,
                emptyList(),
                listOf(chosen),
                options(target = 1, quotas = plan(ChannelId.A to 1), mmrLambda = 0.0),
            )
        assertTrue(diverse.getValue(fresh) > diverse.getValue(redundant))
    }

    @Test
    fun `同作品不同版本只软降频 不硬排除`() {
        val played = item("a1", workKey = "W", artists = listOf("A1"))
        val variant = item("a2", workKey = "W", artists = listOf("A2"))
        val other = item("b1", workKey = "Z", artists = listOf("B1"))
        val scores =
            Diversity.mmrScores(
                listOf(variant, other),
                ChannelId.A,
                listOf(played),
                emptyList(),
                options(target = 1, quotas = plan(ChannelId.A to 1), mmrLambda = 1.0),
            )
        // 同 workKey 的候选权重被乘 0.4，但没有被剔除
        assertEquals(2, scores.size)
        assertTrue(scores.getValue(other) > scores.getValue(variant))
    }

    @Test
    fun `同歌手在最小间隔内被硬排除`() {
        val candidates =
            listOf(
                item("a1", artists = listOf("同一人"), weight = 10.0),
                item("a2", artists = listOf("同一人"), weight = 9.0),
                item("b1", artists = listOf("另一个人"), weight = 1.0),
            )
        val result = Diversity.select(candidates, options(target = 2, quotas = plan(ChannelId.A to 2)))
        // 首首可能是 a1 也可能是 a2（同歌手、同质量门槛内），但第二首必然换人
        assertEquals(2, result.items.size)
        assertEquals(listOf("同一人", "另一个人"), result.items.map { it.item.artistKeys.first() })
    }

    @Test
    fun `候选枯竭时宁可少出几首也不违反歌手间隔`() {
        val candidates = List(5) { item("same$it", artists = listOf("同一人"), weight = 1.0) }
        val result = Diversity.select(candidates, options(target = 5, quotas = plan(ChannelId.A to 5)))
        assertEquals(1, result.items.size)
        assertTrue(result.reasons.contains("no_candidate_after_relaxation"))
    }

    @Test
    fun `时段因子乘进权重`() {
        val neutral =
            Diversity.mmrScores(
                listOf(item("a", artists = listOf("甲"))),
                ChannelId.A,
                emptyList(),
                emptyList(),
                options(target = 1, quotas = plan(ChannelId.A to 1), mmrLambda = 1.0),
            )
        val boosted =
            Diversity.mmrScores(
                listOf(item("a", artists = listOf("甲"))),
                ChannelId.A,
                emptyList(),
                emptyList(),
                options(target = 1, quotas = plan(ChannelId.A to 1), mmrLambda = 1.0, timeSlotFactor = { 1.12 }),
            )
        // 单候选时 relNorm 恒为 1（自己比自己），时段因子只在多候选时改变相对次序
        assertEquals(neutral.values.first(), boosted.values.first(), 1e-9)

        val mixed =
            Diversity.mmrScores(
                listOf(item("a", artists = listOf("甲")), item("b", artists = listOf("乙"))),
                ChannelId.A,
                emptyList(),
                emptyList(),
                options(
                    target = 2,
                    quotas = plan(ChannelId.A to 2),
                    mmrLambda = 1.0,
                    timeSlotFactor = { artists -> if (artists.contains("甲")) 1.1 else 1.0 },
                ),
            )
        assertTrue(mixed.values.max() > 0.0)
    }

    @Test
    fun `探索间隔生效时先出非探索通道`() {
        val candidates =
            listOf(
                item("c1", channel = ChannelId.C, weight = 100.0),
                item("a1", channel = ChannelId.A, weight = 1.0),
            )
        val recent = listOf(item("c0", channel = ChannelId.C, artists = listOf("x")))
        val result =
            Diversity.select(
                candidates,
                options(target = 1, quotas = plan(ChannelId.A to 1, ChannelId.C to 1), recent = recent, explorationGap = 1),
            )
        val first = result.items.first()
        assertEquals("a1", first.item.key)
    }

    @Test
    fun `配额用尽时提前收口并记录原因`() {
        val candidates = List(6) { item("t$it") }
        val result = Diversity.select(candidates, options(target = 6, quotas = plan(ChannelId.A to 2)))
        assertEquals(2, result.items.size)
        assertTrue(result.reasons.contains("quota_exhausted"))
        assertEquals(2, result.pickedByChannel[ChannelId.A])
    }

    @Test
    fun `不修改调用方的配额表`() {
        val candidates = List(4) { item("zh$it", lang = LangBucket.ZH) }
        val caps = LanguageQuota.LangCaps(enforced = true, caps = mapOf(LangBucket.ZH to 4))
        Diversity.select(candidates, options(target = 2, quotas = plan(ChannelId.A to 2), langCaps = caps))
        // 纯函数契约：caps 必须克隆后再扣，否则第二次生成队列就少一批名额
        assertEquals(4, caps.caps[LangBucket.ZH])
    }

    @Test
    fun `空候选给出空队列而不是例外`() {
        val result = Diversity.select(emptyList(), options(target = 5, quotas = plan(ChannelId.A to 5)))
        assertTrue(result.items.isEmpty())
        assertTrue(result.reasons.contains("no_candidate_after_relaxation"))
        assertEquals(0, result.pickedByChannel.getValue(ChannelId.A))
        assertFalse(result.reasons.contains("quota_exhausted"))
    }
}
