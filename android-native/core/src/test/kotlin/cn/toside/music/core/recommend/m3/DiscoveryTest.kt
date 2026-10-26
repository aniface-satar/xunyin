package cn.toside.music.core.recommend.m3

import cn.toside.music.core.songlist.SonglistSort
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 探索通道 C 的纯选择规则（任务 8）。
 *
 * 两条关键语义：
 * - 「最新」排序不是每轮都刷（RN 0.3 成新率），原生侧因一次刷新只跑 1~3 步而在
 *   调用处把成新率抬到 1.0 —— 纯函数本身仍按比例算，改比例不改行为；
 * - 语种补货只认**明确想要**（> 中性点 50%）的语言项：0% 是「不想听」，
 *   拿它去补货等于逆着用户表态推歌。
 */
class DiscoveryTest {
    private val sorts =
        listOf(
            SonglistSort(id = "hot", name = "最热"),
            SonglistSort(id = "new", name = "最新"),
            SonglistSort(id = "collect", name = "收藏"),
        )

    @Test
    fun detectsNewestSortByNameAndTid() {
        assertTrue(Discovery.isNewestSort(SonglistSort(id = "1", name = "最新歌单")))
        assertTrue(Discovery.isNewestSort(SonglistSort(id = "new", name = "新歌")))
        assertTrue(Discovery.isNewestSort(SonglistSort(id = "newest", name = "排序", tid = "New")))
        assertFalse(Discovery.isNewestSort(SonglistSort(id = "hot", name = "最热")))
    }

    @Test
    fun newestSortReturnsNullWhenSourceHasNone() {
        assertNull(Discovery.newestSort(listOf(SonglistSort(id = "hot", name = "最热"))))
        assertEquals("new", Discovery.newestSort(sorts)?.id)
    }

    @Test
    fun rotationBelowThresholdUsesNewestSort() {
        // ratio 0.3 → 轮次模 10 落在 0/1/2 时走最新
        for (rotation in 0..2) {
            val pick = Discovery.pickSort(sorts, rotation, hotSortId = "hot")
            assertEquals("new", pick.sortId)
            assertTrue(pick.useNew)
        }
        for (rotation in 3..9) {
            val pick = Discovery.pickSort(sorts, rotation, hotSortId = "hot")
            assertEquals("hot", pick.sortId)
            assertFalse(pick.useNew)
        }
    }

    @Test
    fun rotationWrapsEveryTenRounds() {
        val pick = Discovery.pickSort(sorts, rotation = 12, hotSortId = "hot")
        assertEquals("new", pick.sortId)
        assertTrue(pick.useNew)
    }

    @Test
    fun negativeRotationIsFlooredNotNegated() {
        // 轮次理论上非负，但 Math.floorMod 保证负数也落在 0..9，不会取到负下标
        val pick = Discovery.pickSort(sorts, rotation = -1, hotSortId = "hot")
        assertFalse(pick.useNew)
        assertEquals("hot", pick.sortId)
    }

    @Test
    fun forcedRatioAlwaysUsesNewestWhenAvailable() {
        // 原生侧 C 步长 1.0：轮次多远都取最新排序
        for (rotation in 0..12) {
            val pick = Discovery.pickSort(sorts, rotation, hotSortId = "hot", ratio = 1.0)
            assertEquals("new", pick.sortId)
            assertTrue(pick.useNew)
        }
    }

    @Test
    fun fallsBackToHotThenFirstSortId() {
        val noNewest = listOf(SonglistSort(id = "hot", name = "最热"), SonglistSort(id = "x", name = "随便"))
        assertEquals("hot", Discovery.pickSort(noNewest, 0, hotSortId = "hot").sortId)
        assertEquals("hot", Discovery.pickSort(noNewest, 0).sortId)
        assertEquals("", Discovery.pickSort(emptyList(), 0).sortId)
    }

    @Test
    fun restockKeywordsOnlyKeepExplicitWants() {
        val weights =
            mapOf(
                "zh" to 100.0,
                "ja" to 80.0,
                "western" to 0.0,
                "cantonese" to 50.0,
                "rock" to 100.0,
            )
        // 分类项不参与语种补货；0% 与中性点 50% 都不算「想要」
        assertEquals(listOf("华语", "日语"), Discovery.restockKeywords(weights))
    }

    @Test
    fun restockKeywordsIgnoreZeroPercentLanguage() {
        assertEquals(emptyList<String>(), Discovery.restockKeywords(mapOf("western" to 0.0)))
    }

    @Test
    fun restockKeywordRotatesOverWants() {
        val weights = mapOf("zh" to 100.0, "ko" to 70.0)
        assertEquals("华语", Discovery.pickRestockKeyword(weights, 0))
        assertEquals("韩语", Discovery.pickRestockKeyword(weights, 1))
        assertEquals("华语", Discovery.pickRestockKeyword(weights, 2))
        assertNull(Discovery.pickRestockKeyword(emptyMap(), 0))
    }

    @Test
    fun sanitizedWeightsFeedRestockWithoutRoundTripLoss() {
        // 问卷落盘的百分比经过 sanitize 后仍是百分数（10 的倍数），补货侧直接吃
        val sanitized = Onboarding.sanitizeWeights(mapOf("ja" to 66.0))
        assertEquals(mapOf("ja" to 70.0), sanitized)
        assertEquals(listOf("日语"), Discovery.restockKeywords(sanitized))
    }

    @Test
    fun stepsFollowBudgetAndSupplementFlag() {
        assertEquals(3, Discovery.planSteps(budget = 14))
        assertEquals(2, Discovery.planSteps(budget = 8))
        assertEquals(1, Discovery.planSteps(budget = 2))
        assertEquals(1, Discovery.planSteps(budget = 14, supplement = true))
    }

    /**
     * 成新率的实证（W7 任务 2）：原生一轮刷新的抓取预算只有 14（steps = 3），
     * 5 个步骤里只有第 4 步是发现通道，所以「最新」歌单的供给远低于 RN。
     *
     * RN 的 0.3 是给「一次刷新读十几张歌单」设计的：一轮 ≈ 10 × 0.3 = 3 张新鲜歌单。
     * 原生一轮最多 1 张、且只在 60% 的轮次里跑到，按 0.3 折算只剩 0.1 张/轮 ——
     * C 通道事实上断供。所以调用侧维持 1.0（见 `RadioRuntime.fetchDiscoveryPlaylist`），
     * 本用例锁住这两个数字。
     */
    @Test
    fun newestSupplyUnderNativeBudgetIsStarvedByRnRatio() {
        val rounds = 100
        val steps = Discovery.planSteps(budget = 14)
        val discoveryStep = 4

        fun newestRounds(ratio: Double): Int {
            var count = 0
            for (rotation in 0 until rounds) {
                val hitDiscovery = (0 until steps).any { offset -> (rotation + offset) % 5 == discoveryStep }
                if (!hitDiscovery) continue
                if (Discovery.pickSort(sorts, rotation, hotSortId = "hot", ratio = ratio).useNew) count += 1
            }
            return count
        }

        val atFull = newestRounds(1.0)
        val atRn = newestRounds(Discovery.NEWEST_RATIO)
        // 100 轮里发现通道命中 60 轮；成新率 1.0 时 60 轮都出「最新」歌单，
        // 0.3 时只有轮次同时落在「模 10 < 3」与「发现步」上的 10 轮出得了
        assertEquals(60, atFull)
        assertEquals(10, atRn)
        assertTrue("原生 C 通道的绝对供给本就远低于 RN，按 0.3 折算会断供", atRn * 10 < atFull * 3)
    }
}
