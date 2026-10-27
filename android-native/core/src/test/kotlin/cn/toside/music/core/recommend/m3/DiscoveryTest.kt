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
 * - 「最新」排序按 RN `newestListRatio = 0.7`（最新:最热 7:3）轮换；W7 语义修正：
 *   Wave5 曾移植成 0.3 且在调用处抬到 1.0，实证 RN 源码后改回 0.7（见 lane 报告）；
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
        // ratio 0.7 → 轮次模 10 落在 0..6 时走最新（RN 最新:最热 7:3）
        for (rotation in 0..6) {
            val pick = Discovery.pickSort(sorts, rotation, hotSortId = "hot")
            assertEquals("new", pick.sortId)
            assertTrue(pick.useNew)
        }
        for (rotation in 7..9) {
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
     * 5 个步骤里只有第 4 步是发现通道。
     *
     * W7 语义修正：前会话据此维持 ratio = 1.0，理由是「RN 的 0.3 在原生预算下断供」；
     * 读 RN 源码实证后推翻 —— RN `candidatePool.newestListRatio = 0.7`（config.ts:212、
     * candidate.ts:252 同一个 `rotation % 10` 判据），0.3 是 Wave5 移植时读反。
     *
     * 但「0.7 就一定 7:3」在原生预算下不成立：发现步只在 `rotation % 5 ∈ {2,3,4}` 时命中，
     * 与 `rotation % 10 < 7` 的交集是 {2,3,4} 三种，所以 **C 通道实际是 30 轮最新 / 30 轮热门
     * （50:50）**，而不是 42/18。供给仍然充足：0.3 时交集只有 {2}，仅 10 轮最新；0.7 把
     * 最新供给提到 3 倍，同时不再像 1.0 那样把 C 变成纯新歌通道。要严格 7:3 得给 C 单独
     * 记一个调用计数（RN 里 C 每轮都跑，天然均匀），本波按 RN 同构保留全局 rotation。
     */
    @Test
    fun newestSupplyUnderNativeBudget() {
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

        val atRatio = newestRounds(Discovery.NEWEST_RATIO)
        val atFull = newestRounds(1.0)
        // 100 轮里发现通道命中 60 轮；与 0.7 阈值交集后 30 轮出「最新」、30 轮出热门
        assertEquals(60, atFull)
        assertEquals(30, atRatio)
        // 原生预算下 0.7 不会断供（此前 0.3 只剩 10 轮，是移植错误的推论而非 RN 语义）
        assertTrue("0.7 成新率下 C 通道最新歌单供给充足", atRatio * 3 > atFull)
    }
}
