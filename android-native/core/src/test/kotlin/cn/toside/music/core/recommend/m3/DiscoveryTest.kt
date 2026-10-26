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
}
