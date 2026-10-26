package cn.toside.music.core.recommend.radio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 通道 bandit（RN `bandit.ts`）单元测试。
 *
 * 随机源全部经参数注入，用例锁同一 rng 即完全可复现 —— 这是 M2 不接受
 * `Math.random()` 的直接原因（不可注入的随机源会让统计类用例抖动）。
 */
class BanditTest {
    private val now = RadioFixtures.NOW

    @Test
    fun missingArmReadsAsPrior() {
        val arm = ChannelBandit.armOf(emptyMap(), ChannelId.B)
        assertEquals(RadioConfig.Bandit.PRIOR_ALPHA, arm.alpha, 1e-9)
        assertEquals(RadioConfig.Bandit.PRIOR_BETA, arm.beta, 1e-9)
        assertEquals(0L, arm.lastUpdatedAt)
    }

    @Test
    fun priorArmIsNeutralMultiplier() {
        // 观测数不足 MIN_OBSERVATIONS 时永远中性，不参与抽样
        assertEquals(1.0, ChannelBandit.thompsonMultiplier(emptyMap(), ChannelId.A, now) { 0.5 }, 1e-9)
    }

    @Test
    fun positiveAndNegativeOutcomesCountSeparately() {
        val arms = mutableMapOf<String, ChannelBanditArm>()
        repeat(3) { ChannelBandit.update(arms, ChannelId.A, BanditOutcome.POSITIVE, now) }
        val afterPositive = arms.getValue(ChannelId.A.name)
        assertEquals(RadioConfig.Bandit.PRIOR_ALPHA + 3, afterPositive.alpha, 1e-9)
        assertEquals(RadioConfig.Bandit.PRIOR_BETA, afterPositive.beta, 1e-9)
        assertEquals(now, afterPositive.lastUpdatedAt)

        ChannelBandit.update(arms, ChannelId.A, BanditOutcome.NEGATIVE, now)
        val afterNegative = arms.getValue(ChannelId.A.name)
        assertEquals(RadioConfig.Bandit.PRIOR_ALPHA + 3, afterNegative.alpha, 1e-9)
        assertEquals(RadioConfig.Bandit.PRIOR_BETA + 1, afterNegative.beta, 1e-9)
    }

    @Test
    fun nullChannelIsIgnored() {
        val arms = mutableMapOf<String, ChannelBanditArm>()
        ChannelBandit.update(arms, null, BanditOutcome.POSITIVE, now)
        assertTrue(arms.isEmpty())
    }

    @Test
    fun countsAreCappedAtMaxCount() {
        val arms = mutableMapOf<String, ChannelBanditArm>()
        repeat(60) { ChannelBandit.update(arms, ChannelId.E, BanditOutcome.POSITIVE, now) }
        assertEquals(RadioConfig.Bandit.MAX_COUNT, arms.getValue(ChannelId.E.name).alpha, 1e-9)
    }

    @Test
    fun multiplierStaysInsideBoostBounds() {
        val arms =
            mapOf(
                ChannelId.A.name to ChannelBanditArm(alpha = 20.0, beta = 1.0, lastUpdatedAt = now),
                ChannelId.B.name to ChannelBanditArm(alpha = 1.0, beta = 20.0, lastUpdatedAt = now),
            )
        val best = ChannelBandit.thompsonMultiplier(arms, ChannelId.A, now) { 0.999 }
        val worst = ChannelBandit.thompsonMultiplier(arms, ChannelId.B, now) { 0.999 }
        assertTrue(best in RadioConfig.Bandit.MIN_BOOST..RadioConfig.Bandit.MAX_BOOST)
        assertTrue(worst in RadioConfig.Bandit.MIN_BOOST..RadioConfig.Bandit.MAX_BOOST)
        assertTrue(best > worst)
    }

    @Test
    fun decayPullsArmBackTowardsPrior() {
        // 同一 rng 下：30 天半衰期后 alpha 的观测增量打对折，乘数随之下移
        val fresh = mapOf(ChannelId.C.name to ChannelBanditArm(alpha = 11.0, beta = 1.0, lastUpdatedAt = now))
        val freshValue = ChannelBandit.thompsonMultiplier(fresh, ChannelId.C, now) { 0.5 }
        val staleValue =
            ChannelBandit.thompsonMultiplier(fresh, ChannelId.C, now + 30L * RadioFixtures.DAY) { 0.5 }
        assertTrue(freshValue > staleValue)
    }

    @Test
    fun minObservationsGateHoldsAtBoundary() {
        // 4 次正反馈 < 5 → 中性；第 5 次后才开始抽样
        val four = mapOf(ChannelId.D.name to ChannelBanditArm(alpha = 5.0, beta = 1.0, lastUpdatedAt = now))
        assertEquals(1.0, ChannelBandit.thompsonMultiplier(four, ChannelId.D, now) { 0.3 }, 1e-9)
        val five = mapOf(ChannelId.D.name to ChannelBanditArm(alpha = 6.0, beta = 1.0, lastUpdatedAt = now))
        assertTrue(ChannelBandit.thompsonMultiplier(five, ChannelId.D, now) { 0.3 } > 1.0)
    }

    @Test
    fun sameSeedProducesSameMultiplier() {
        val arms = mapOf(ChannelId.A.name to ChannelBanditArm(alpha = 8.0, beta = 3.0, lastUpdatedAt = now))
        val first = ChannelBandit.thompsonMultiplier(arms, ChannelId.A, now, RadioFixtures.seededRandom(42))
        val second = ChannelBandit.thompsonMultiplier(arms, ChannelId.A, now, RadioFixtures.seededRandom(42))
        val other = ChannelBandit.thompsonMultiplier(arms, ChannelId.A, now, RadioFixtures.seededRandom(43))
        assertEquals(first, second, 1e-12)
        assertTrue(first != other)
    }
}
