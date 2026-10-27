package cn.toside.music.core.recommend.radio

import cn.toside.music.core.recommend.m3.LangBucket
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** 候选池与打分（RN `candidatePool.ts`）单元测试：合并去重、裁剪、通道权重、抓取预算。 */
class RadioPoolTest {
    private val now = RadioFixtures.NOW

    private fun candidate(
        name: String,
        singer: String,
        channel: ChannelId = ChannelId.A,
        playlistId: String? = null,
        affinity: Double = 0.5,
        sourceId: String = "pl-1",
    ): PoolCandidate =
        RadioPool.createCandidate(
            CreatePoolCandidateInput(
                musicInfo = RadioFixtures.musicInfo(id = "id-$name", name = name, singer = singer),
                channel = channel,
                sourceId = sourceId,
                now = now,
                playlistIds = listOfNotNull(playlistId),
                affinity = affinity,
            ),
        )

    @Test
    fun mergeUnionsChannelsAndPlaylistsWithoutDuplicating() {
        val first = candidate("晴天", "周杰伦", ChannelId.A, playlistId = "pl-a", affinity = 0.4)
        val second = candidate("晴天", "周杰伦", ChannelId.B, playlistId = "pl-b", affinity = 0.8)
        val merged = RadioPool.mergeCandidates(listOf(first), listOf(second))
        assertEquals(1, merged.size)
        val item = merged.first()
        assertEquals(listOf(ChannelId.A, ChannelId.B), item.channels)
        assertEquals(listOf("pl-a", "pl-b"), item.playlistIds)
        assertEquals(0.8, item.affinity, 1e-9)
        assertEquals(2, item.localFrequency)
    }

    @Test
    fun capPoolSizeKeepsHighestScored() {
        val low = candidate("低分", "A", affinity = 0.1)
        val high = candidate("高分", "B", affinity = 0.9)
        val capped = RadioPool.capPoolSize(listOf(low, high), maxSize = 1)
        assertEquals(1, capped.size)
        assertEquals("ns:高分__b", capped.first().trackKey)
    }

    @Test
    fun poolUnderLimitIsUntouched() {
        val items = List(3) { candidate("曲$it", "歌手$it") }
        assertEquals(3, RadioPool.capPoolSize(items, maxSize = 10).size)
    }

    @Test
    fun filterPoolDropsExcludedCandidates() {
        val blocked = candidate("晴天", "周杰伦")
        val allowed = candidate("稻香", "周杰伦")
        val ctx = ExclusionContext(libraryKeys = setOf(blocked.trackKey))
        val filtered = RadioPool.filterPoolCandidates(listOf(blocked, allowed), ctx)
        assertEquals(1, filtered.size)
        assertEquals(allowed.trackKey, filtered.first().trackKey)
    }

    @Test
    fun channelWeightsStayInsideUnitRange() {
        val item = candidate("晴天", "周杰伦", ChannelId.A, playlistId = "pl-a")
        val weights = RadioPool.channelWeightsFor(item, FinalQueueBuildOptions(now = now))
        assertTrue(weights.isNotEmpty())
        assertTrue(weights.values.all { it in 0.01..1.0 })
    }

    @Test
    fun explorationGateLowersBlindExplorationInRadioMode() {
        val item = candidate("陌生曲", "陌生人", ChannelId.C, affinity = 0.0)
        val radio = RadioPool.channelWeightsFor(item, FinalQueueBuildOptions(now = now, mode = RadioMode.RADIO))
        val explore = RadioPool.channelWeightsFor(item, FinalQueueBuildOptions(now = now, mode = RadioMode.EXPLORE))
        assertTrue(radio.getValue(ChannelId.C) <= explore.getValue(ChannelId.C))
    }

    @Test
    fun sessionPenaltyLowersWeight() {
        val item = candidate("晴天", "周杰伦")
        val clean = RadioPool.channelWeightsFor(item, FinalQueueBuildOptions(now = now))
        val penalized =
            RadioPool.channelWeightsFor(
                item,
                FinalQueueBuildOptions(
                    now = now,
                    sessionPenalties = SessionPenalties(artistPenalty = mapOf("周杰伦" to 3.0), playlistPenalty = emptyMap()),
                ),
            )
        assertTrue(penalized.getValue(ChannelId.A) < clean.getValue(ChannelId.A))
    }

    @Test
    fun buildFinalQueueItemsKeepsIdentityAndWeights() {
        val items = RadioPool.buildFinalQueueItems(listOf(candidate("晴天", "周杰伦")), FinalQueueBuildOptions(now = now))
        assertEquals(1, items.size)
        val item = items.first()
        assertEquals("ns:晴天__周杰伦", item.key)
        assertEquals("周杰伦", item.primaryArtist)
        assertTrue(item.channels.contains(ChannelId.A))
        assertTrue(item.weight > 0)
    }

    @Test
    fun observedAffinityNormalizesSeedOverlap() {
        val observed =
            ObservedPlaylist(
                id = "pl",
                source = "kw",
                seedOverlap = 2,
                weakThemeScore = 0.0,
            )
        assertEquals(0.5, RadioPool.observedAffinity(observed, seedCount = 4, fallback = 0.0), 1e-9)
        assertEquals(0.3, RadioPool.observedAffinity(observed, seedCount = 0, fallback = 0.3), 1e-9)
    }

    @Test
    fun refreshBudgetReservesDetailFetches() {
        val (detail, discover) = RadioPool.planRefreshBudget(budget = 14, detailFetches = 4)
        assertEquals(4, detail)
        assertEquals(10, discover)
        val (noDetail, allDiscover) = RadioPool.planRefreshBudget(budget = 14, detailFetches = 0)
        assertEquals(0, noDetail)
        assertEquals(14, allDiscover)
    }

    @Test
    fun profileRefreshNeedsThresholdAndCooldown() {
        val args = { revision: Int, last: Int, at: Long, inFlight: Boolean ->
            RadioPool.shouldRefreshForProfileChange(
                revision = revision,
                lastRefreshRevision = last,
                lastRefreshAt = at,
                now = now,
                inFlight = inFlight,
                revisionThreshold = RadioConfig.ProfileRefresh.REVISION_THRESHOLD,
                minIntervalMs = RadioConfig.ProfileRefresh.MIN_INTERVAL_MS,
            )
        }
        assertTrue("反馈条数不够不补池", !args(3, 0, now - 2_000_000, false))
        assertTrue("冷却未到不补池", !args(9, 0, now, false))
        assertTrue("已有请求在飞不补池", !args(9, 0, now - 2_000_000, true))
        assertTrue(args(9, 0, now - 2_000_000, false))
    }

    @Test
    fun poolStatsCountsChannelsAndConfirmed() {
        val stats = RadioPool.poolStats(listOf(candidate("a", "x"), candidate("b", "y", ChannelId.B)))
        assertEquals(2, stats.total)
        assertEquals(1, stats.byChannel.getValue(ChannelId.A))
        assertEquals(1, stats.byChannel.getValue(ChannelId.B))
        assertEquals(0, stats.confirmed)
        // 语种构成与 unknown 占比：lang_unmet 诊断的对照组
        assertEquals(2, stats.byLang[LangBucket.UNKNOWN])
        assertEquals(1.0, stats.unknownShare, 1e-9)
        assertTrue(RadioPool.poolStats(emptyList()).unknownShare == 0.0)
    }

    private fun observed(
        id: String,
        tracks: List<String>,
        confirmed: Boolean = true,
        seedOverlap: Int = 2,
    ): ObservedPlaylist =
        ObservedPlaylist(
            id = id,
            source = "kw",
            trackKeys = tracks,
            seedOverlap = seedOverlap,
            confidence = 1.0,
            confirmed = confirmed,
        )

    @Test
    fun `观察歌单按曲目重合打组`() {
        val a = observed("pA", listOf("t1", "t2", "t3", "t4"))
        val b = observed("pB", listOf("t1", "t2", "t3", "t4"))
        val c = observed("pC", listOf("t9"))
        val grouped = RadioPool.assignPlaylistGroups(listOf(a, b, c))
        assertEquals(grouped[0].groupId, grouped[1].groupId)
        assertTrue(grouped[2].groupId != grouped[0].groupId)
    }

    @Test
    fun `共现与分组信号回填到候选`() {
        val hit = candidate("晴天", "周杰伦", playlistId = "pA")
        val lonely = candidate("稻香", "周杰伦", playlistId = "pB")
        val others = listOf("other-1", "other-2", "other-3")
        val playlists =
            RadioPool.assignPlaylistGroups(
                listOf(
                    // pA 已确认含种子、规模 4：贡献 = 2 × 1 / √4 = 1 → 饱和 0.5
                    observed("pA", listOf(hit.trackKey) + others),
                    // pB 未确认：里面的候选共现必须是 0
                    observed("pB", listOf(lonely.trackKey), confirmed = false),
                ),
            )
        val signals = RadioPool.applyObservationSignals(listOf(hit, lonely), playlists)
        assertEquals(0.5, signals.first { it.trackKey == hit.trackKey }.coOccurrence, 1e-9)
        // 只在未确认歌单里的候选：共现必须是 0（不造信号）
        assertEquals(0.0, signals.first { it.trackKey == lonely.trackKey }.coOccurrence, 1e-9)
        assertTrue(signals.first { it.trackKey == hit.trackKey }.groupIds.isNotEmpty())
        // 观察歌单为空时保持原样
        assertEquals(listOf(hit), RadioPool.applyObservationSignals(listOf(hit), emptyList()))
    }

    @Test
    fun `会话共现给 A 与 E 通道加权`() {
        val item = candidate("晴天", "周杰伦", ChannelId.A)
        val base = RadioPool.channelWeightsFor(item, FinalQueueBuildOptions(now = now))
        val boosted =
            RadioPool.channelWeightsFor(
                item,
                FinalQueueBuildOptions(now = now, sessionCoOccurrence = mapOf(item.trackKey to 1.0)),
            )
        assertTrue(boosted.getValue(ChannelId.A) > base.getValue(ChannelId.A))

        val eItem = candidate("夜曲", "周杰伦", ChannelId.E)
        val eBase = RadioPool.channelWeightsFor(eItem, FinalQueueBuildOptions(now = now))
        val eBoosted =
            RadioPool.channelWeightsFor(
                eItem,
                FinalQueueBuildOptions(now = now, sessionCoOccurrence = mapOf(eItem.trackKey to 1.0)),
            )
        assertTrue(eBoosted.getValue(ChannelId.E) > eBase.getValue(ChannelId.E))
        // 权重仍钳在 [0.01, 1]
        assertTrue(eBoosted.getValue(ChannelId.E) <= 1.0)
    }
}
