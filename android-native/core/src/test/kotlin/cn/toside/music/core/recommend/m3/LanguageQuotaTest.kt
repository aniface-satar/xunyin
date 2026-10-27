package cn.toside.music.core.recommend.m3

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 语种配额的纯算术 —— 对照 RN `core/recommend/languageQuota.ts`。 */
class LanguageQuotaTest {
    @Test
    fun `窗口切片显式夹紧 0 与负数`() {
        val items = listOf(1, 2, 3, 4, 5)
        // takeLast(0) 返回空表（不会像 JS 的 slice(-0) 退化成整段）；负数必须夹到 0 而不是抛错
        assertEquals(emptyList<Int>(), LanguageQuota.windowSlice(items, 0))
        assertEquals(emptyList<Int>(), LanguageQuota.windowSlice(items, -3))
        assertEquals(listOf(3, 4, 5), LanguageQuota.windowSlice(items, 3))
        assertEquals(items, LanguageQuota.windowSlice(items, 99))
    }

    @Test
    fun `问卷全在中性点等于没表态`() {
        val targets = LanguageQuota.computeLangTargets(mapOf("zh" to 50.0, "rock" to 60.0), windowSize = 20)
        assertFalse(targets.enforced)
        assertEquals(20, targets.free)
        assertTrue(targets.targets.isEmpty())
    }

    @Test
    fun `两个语言各 30% 剩下算自由名额`() {
        val targets = LanguageQuota.computeLangTargets(mapOf("zh" to 30.0, "western" to 30.0), windowSize = 20)
        assertTrue(targets.enforced)
        assertEquals(6, targets.targets[LangBucket.ZH])
        assertEquals(6, targets.targets[LangBucket.EN])
        assertEquals(8, targets.free)
    }

    @Test
    fun `合计超 100 时全部名额给声明桶`() {
        val targets = LanguageQuota.computeLangTargets(mapOf("zh" to 80.0, "cantonese" to 80.0), windowSize = 20)
        assertTrue(targets.enforced)
        assertEquals(10, targets.targets[LangBucket.ZH])
        assertEquals(10, targets.targets[LangBucket.YUE])
        assertEquals(0, targets.free)
    }

    @Test
    fun `0% 是明确不要 不是缺席`() {
        val targets = LanguageQuota.computeLangTargets(mapOf("zh" to 0.0, "western" to 100.0), windowSize = 20)
        assertTrue(targets.enforced)
        // 0% 桶必须留在 targets 里，否则 caps 查不到它、按「缺席即不限」放行
        assertEquals(0, targets.targets[LangBucket.ZH])
        assertEquals(20, targets.targets[LangBucket.EN])

        val caps = LanguageQuota.computeLangCaps(targets, emptyMap(), tolerance = 1)
        assertEquals(0, caps.caps[LangBucket.ZH])
        // 0% 不加容差：加一格等于替用户改口
        assertFalse(LanguageQuota.langWithinCap(LangBucket.ZH, caps.caps))
        assertTrue(LanguageQuota.langWithinCap(LangBucket.EN, caps.caps))
    }

    @Test
    fun `容差只补给非零配额`() {
        val targets = LanguageQuota.LangTargets(mapOf(LangBucket.ZH to 2, LangBucket.EN to 5), free = 13, enforced = true)
        val caps = LanguageQuota.computeLangCaps(targets, mapOf(LangBucket.ZH to 2), tolerance = 1)
        // 2 - 2 == 0，但非零配额仍给一格容差；不给的话「刚好用掉最后一个名额」会被判超额
        assertEquals(1, caps.caps[LangBucket.ZH])
        assertEquals(6, caps.caps[LangBucket.EN])
    }

    @Test
    fun `判不出语种的歌一律放行`() {
        val caps = mapOf(LangBucket.ZH to 0)
        assertTrue(LanguageQuota.langWithinCap(null, caps))
        assertTrue(LanguageQuota.langWithinCap(LangBucket.UNKNOWN, caps))
        assertFalse(LanguageQuota.langWithinCap(LangBucket.ZH, caps))
        // 缺席的桶 = 不受约束
        assertTrue(LanguageQuota.langWithinCap(LangBucket.JA, caps))
    }

    @Test
    fun `按批次算上限时已滑出的上一批不算用量`() {
        val targets = LanguageQuota.LangTargets(mapOf(LangBucket.ZH to 10, LangBucket.EN to 10), free = 0, enforced = true)
        val recent = List(20) { LangBucket.ZH }
        // 窗口 20、批次 20：整窗都会被顶掉，overlap = 0，本轮不该扣任何已用量
        val batch = LanguageQuota.computeLangCapsForBatch(targets, recent, batchSize = 20, windowSize = 20, tolerance = 0)
        assertEquals(10, batch.caps[LangBucket.ZH])
        assertEquals(10, batch.caps[LangBucket.EN])
        // 批次 0（只补几首）时整窗都还在，已用 20 首中文必须扣掉
        val noBatch = LanguageQuota.computeLangCapsForBatch(targets, recent, batchSize = 0, windowSize = 20, tolerance = 0)
        assertEquals(0, noBatch.caps[LangBucket.ZH])
    }

    @Test
    fun `连播硬规则只看尾部同语言连续段`() {
        assertTrue(LanguageQuota.consecutiveLangAllowed(emptyList(), LangBucket.ZH))
        assertTrue(LanguageQuota.consecutiveLangAllowed(listOf(LangBucket.ZH), LangBucket.ZH))
        assertFalse(LanguageQuota.consecutiveLangAllowed(listOf(LangBucket.ZH, LangBucket.ZH), LangBucket.ZH))
        // 中间插了别的语言就重新计数
        assertTrue(LanguageQuota.consecutiveLangAllowed(listOf(LangBucket.ZH, LangBucket.ZH, LangBucket.EN), LangBucket.ZH))
        // unknown 不参与连播判定
        assertTrue(LanguageQuota.consecutiveLangAllowed(listOf(LangBucket.UNKNOWN, LangBucket.UNKNOWN), LangBucket.UNKNOWN))
    }

    @Test
    fun `纯音乐按窗口上限单独管 不占语言名额`() {
        assertTrue(LanguageQuota.instrumentalAllowed(listOf(LangBucket.INSTR)))
        assertFalse(LanguageQuota.instrumentalAllowed(List(2) { LangBucket.INSTR }))
        // 已用量统计照 RN 原样计入 instr（只有 unknown 被跳过），但 instr 不在 QUOTA_LANG_BUCKETS，
        // 所以它永远拿不到 cap —— 「不占语言名额」是靠桶表而不靠这里过滤。
        val used = LanguageQuota.countLangUsed(List(3) { LangBucket.INSTR }, windowSize = 20)
        assertEquals(3, used[LangBucket.INSTR])
        val caps =
            LanguageQuota.computeLangCaps(
                LanguageQuota.LangTargets(mapOf(LangBucket.ZH to 5), free = 15, enforced = true),
                used,
            )
        assertFalse(caps.caps.containsKey(LangBucket.INSTR))
    }

    @Test
    fun `池内语种计数优先用 L1 再退 L2 提示`() {
        val counts =
            LanguageQuota.countPoolLang(
                listOf(
                    LanguageQuota.PoolLangInput(LangBucket.ZH, LangBucket.JA),
                    LanguageQuota.PoolLangInput(null, LangBucket.JA),
                    LanguageQuota.PoolLangInput(null, null),
                ),
            )
        assertEquals(1, counts[LangBucket.ZH])
        assertEquals(1, counts[LangBucket.JA])
        assertEquals(1, counts[LangBucket.UNKNOWN])
    }

    @Test
    fun `桶召回没召回到歌单时预留必须是 0`() {
        // 详情读是候选池唯一的进货口：没召回到桶歌单还白扣一格 = 给全体用户砍固定份额
        val plan =
            LanguageQuota.planBucketReserve(
                LanguageQuota.BucketReserveOptions(detailBudget = 4, poolCounts = mapOf(LangBucket.UNKNOWN to 90), poolSize = 100),
            )
        assertEquals(0, plan.reserve)
        assertEquals(0.9, plan.unknownShare, 1e-9)
        assertTrue(plan.prioritizeBuckets)
    }

    @Test
    fun `桶召回预留一格并在 unknown 偏高时扩到两格`() {
        val low =
            LanguageQuota.planBucketReserve(
                LanguageQuota.BucketReserveOptions(
                    detailBudget = 4,
                    poolCounts = mapOf(LangBucket.UNKNOWN to 10, LangBucket.ZH to 90),
                    poolSize = 100,
                    bucketSummaries = 2,
                ),
            )
        assertEquals(1, low.reserve)
        assertEquals(0.1, low.unknownShare, 1e-9)
        assertFalse(low.prioritizeBuckets)

        val high =
            LanguageQuota.planBucketReserve(
                LanguageQuota.BucketReserveOptions(
                    detailBudget = 4,
                    poolCounts = mapOf(LangBucket.UNKNOWN to 50, LangBucket.ZH to 50),
                    poolSize = 100,
                    bucketSummaries = 2,
                ),
            )
        assertEquals(2, high.reserve)
        assertTrue(high.prioritizeBuckets)
    }

    @Test
    fun `桶只召回一张时未用完的格子还给常规摘要`() {
        val plan =
            LanguageQuota.planBucketReserve(
                LanguageQuota.BucketReserveOptions(detailBudget = 4, poolSize = 100, bucketSummaries = 1),
            )
        assertEquals(1, plan.reserve)
        // 详情额度只有 1 格时常规摘要优先：桶让位会让画像通道（A/B）饿死
        assertEquals(
            0,
            LanguageQuota
                .planBucketReserve(
                    LanguageQuota.BucketReserveOptions(detailBudget = 1, poolSize = 100, bucketSummaries = 3),
                ).reserve,
        )
    }

    @Test
    fun `池内上限按目标首数放大并乘宽松系数`() {
        val targets = LanguageQuota.LangTargets(mapOf(LangBucket.ZH to 2), free = 18, enforced = true)
        val limits =
            LanguageQuota.computePoolBucketLimits(
                LanguageQuota.PoolBucketLimitOptions(targets, maxSize = 80, windowSize = 20, slack = 1.5),
            )
        // 2 × (80/20) × 1.5 = 12
        assertEquals(12, limits[LangBucket.ZH])
        val unenforced =
            LanguageQuota.computePoolBucketLimits(
                LanguageQuota.PoolBucketLimitOptions(
                    LanguageQuota.LangTargets(emptyMap(), 20, enforced = false),
                    maxSize = 80,
                    windowSize = 20,
                    slack = 1.5,
                ),
            )
        assertTrue(unenforced.isEmpty())
    }
}
