package cn.toside.music.core.recommend.m3

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 语种补货的批次提示（L2）：提示直接来自问卷选项 id，而不是关键词反查。
 *
 * 「欧美」「小语种」不在 kg 的语种词表里，若走关键词反查会整批落 unknown；
 * 这两条用例锁住「选项 id → 桶」这条更准的路径。
 */
class DiscoveryRestockTest {
    @Test
    fun `明确想要的语种带上对应桶`() {
        val weights = mapOf("western" to 100.0, "ja" to 70.0)
        val picks = Discovery.restockPicks(weights)
        assertEquals(listOf("欧美", "日语"), picks.map { it.keyword })
        assertEquals(listOf(LangBucket.EN, LangBucket.JA), picks.map { it.langHint })
    }

    @Test
    fun `小语种选项也映射到 other 桶`() {
        val pick = Discovery.pickRestock(mapOf("other" to 100.0), rotation = 0)
        assertEquals("小语种", pick?.keyword)
        assertEquals(LangBucket.OTHER, pick?.langHint)
    }

    @Test
    fun `中性点与降权项不参与补货`() {
        // 50 是「没表态」，< 50 是「不想听」，都不能拿来补货
        assertTrue(Discovery.restockPicks(mapOf("zh" to 50.0, "ko" to 0.0)).isEmpty())
    }

    @Test
    fun `分类选项不参与语种补货`() {
        assertTrue(Discovery.restockPicks(mapOf("pop" to 100.0, "gufeng" to 100.0)).isEmpty())
        assertNull(Discovery.pickRestock(mapOf("pop" to 100.0), rotation = 3))
    }
}
