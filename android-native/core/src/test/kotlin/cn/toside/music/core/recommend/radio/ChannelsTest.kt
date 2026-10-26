package cn.toside.music.core.recommend.radio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 通道配额（RN `channels.ts`）单元测试。
 *
 * 覆盖三件事：窗口目标配比、最近窗口缺口回填、候选不足时的让额与降级原因。
 */
class ChannelsTest {
    private val now = RadioFixtures.NOW
    private val full = CHANNEL_IDS.associateWith { 10_000 }

    @Test
    fun radioWindowSplitsIntoConfiguredRatios() {
        val plan = Channels.plan(20, emptyList(), full, Channels.PlanOptions(mode = RadioMode.RADIO, now = now))
        assertEquals(20, plan.total)
        assertEquals(7, plan.quotas.getValue(ChannelId.A))
        assertEquals(5, plan.quotas.getValue(ChannelId.B))
        assertEquals(4, plan.quotas.getValue(ChannelId.C))
        assertEquals(2, plan.quotas.getValue(ChannelId.D))
        assertEquals(2, plan.quotas.getValue(ChannelId.E))
    }

    @Test
    fun exploreWindowShiftsQuotaToExplorationChannels() {
        val plan = Channels.plan(20, emptyList(), full, Channels.PlanOptions(mode = RadioMode.EXPLORE, now = now))
        assertEquals(20, plan.total)
        assertEquals(3, plan.quotas.getValue(ChannelId.A))
        assertEquals(1, plan.quotas.getValue(ChannelId.B))
        assertEquals(9, plan.quotas.getValue(ChannelId.C))
        assertEquals(7, plan.quotas.getValue(ChannelId.D))
        assertEquals(0, plan.quotas.getValue(ChannelId.E))
    }

    @Test
    fun recentWindowCountsReduceQuota() {
        val recent = List(7) { ChannelId.A }
        val plan = Channels.plan(10, recent, full, Channels.PlanOptions(now = now))
        // A 已经吃满 7 个窗口额度 → 本批不再给 A
        assertEquals(0, plan.quotas.getValue(ChannelId.A))
        assertEquals(10, plan.total)
        assertTrue(plan.quotas.getValue(ChannelId.B) > 0)
    }

    @Test
    fun unavailableChannelHandsQuotaToOthers() {
        val availability = CHANNEL_IDS.associateWith { 0 }.toMutableMap()
        availability[ChannelId.A] = 100
        val plan = Channels.plan(10, emptyList(), availability, Channels.PlanOptions(now = now))
        assertEquals(10, plan.total)
        assertEquals(10, plan.quotas.getValue(ChannelId.A))
        assertEquals("no_candidate", plan.reasons.getValue(ChannelId.C))
    }

    @Test
    fun insufficientCandidateIsReportedSeparately() {
        val availability = CHANNEL_IDS.associateWith { 1000 }.toMutableMap()
        availability[ChannelId.B] = 2
        val plan = Channels.plan(20, emptyList(), availability, Channels.PlanOptions(now = now))
        assertEquals(2, plan.quotas.getValue(ChannelId.B))
        assertEquals("insufficient_candidate", plan.reasons.getValue(ChannelId.B))
        assertEquals(20, plan.total)
    }

    @Test
    fun coldStartMarksMissingArtistChannel() {
        val availability = CHANNEL_IDS.associateWith { 1000 }.toMutableMap()
        availability[ChannelId.B] = 0
        val plan = Channels.plan(20, emptyList(), availability, Channels.PlanOptions(coldStart = true, now = now))
        assertEquals("cold_start", plan.reasons.getValue(ChannelId.B))
        assertEquals(20, plan.total)
    }

    @Test
    fun noAvailabilityAtAllLeavesEmptyPlan() {
        val availability = CHANNEL_IDS.associateWith { 0 }
        val plan = Channels.plan(20, emptyList(), availability, Channels.PlanOptions(now = now))
        assertEquals(0, plan.total)
        assertTrue(plan.reasons.containsKey(ChannelId.A))
    }

    @Test
    fun allocateByWeightsKeepsTotalAndNonNegative() {
        val weights = mapOf(ChannelId.A to 1.0, ChannelId.B to 1.0, ChannelId.C to 1.0)
        val allocation = Channels.allocateByWeights(10, weights)
        assertEquals(10, allocation.values.sum())
        assertTrue(allocation.values.all { it >= 0 })
    }

    @Test
    fun negativeExplorationFactorShrinksExploration() {
        val throttle = Channels.plan(20, emptyList(), full, Channels.PlanOptions(explorationFactor = 0.25, now = now))
        val normal = Channels.plan(20, emptyList(), full, Channels.PlanOptions(explorationFactor = 1.0, now = now))
        assertTrue(throttle.quotas.getValue(ChannelId.C) <= normal.quotas.getValue(ChannelId.C))
        assertTrue(throttle.quotas.getValue(ChannelId.A) >= normal.quotas.getValue(ChannelId.A))
    }

    @Test
    fun neutralBanditKeepsBaseAllocation() {
        val arms =
            CHANNEL_IDS.associate {
                it.name to
                    ChannelBanditArm(
                        alpha = RadioConfig.Bandit.PRIOR_ALPHA,
                        beta = RadioConfig.Bandit.PRIOR_BETA,
                        lastUpdatedAt = now,
                    )
            }
        val plan =
            Channels.plan(
                20,
                emptyList(),
                full,
                Channels.PlanOptions(bandit = arms, rng = RadioFixtures.seededRandom(7), now = now),
            )
        assertEquals(7, plan.quotas.getValue(ChannelId.A))
        assertEquals(5, plan.quotas.getValue(ChannelId.B))
    }

    @Test
    fun seededPlanIsReproducible() {
        fun run(): ChannelQuotaPlan =
            Channels.plan(
                12,
                List(5) { ChannelId.A },
                CHANNEL_IDS.associateWith { 3 },
                Channels.PlanOptions(rng = RadioFixtures.seededRandom(11), now = now),
            )
        assertEquals(run().quotas, run().quotas)
    }
}
