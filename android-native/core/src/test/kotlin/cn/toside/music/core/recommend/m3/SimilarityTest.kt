package cn.toside.music.core.recommend.m3

import org.junit.Assert.assertEquals
import org.junit.Test

/** 相似度纯算术 —— 对照 RN `core/recommend/similarity.ts` + M3 新增的四路相似度。 */
class SimilarityTest {
    @Test
    fun `共现系数与歌单亲和力`() {
        // 3 / sqrt(4 * 9) = 3 / 6 = 0.5
        assertEquals(0.5, Similarity.computeCoOccurrence(3, 4, 9), 1e-9)
        assertEquals(0.0, Similarity.computeCoOccurrence(3, 0, 9), 1e-9)
        // 2 / sqrt(4 * 16) = 2 / 8 = 0.25
        assertEquals(0.25, Similarity.computePlaylistAffinity(2.0, 4, 16), 1e-9)
        assertEquals(0.0, Similarity.computePlaylistAffinity(2.0, 0, 16), 1e-9)
    }

    @Test
    fun `半衰期衰减一周期减半`() {
        val day = 86_400_000L
        assertEquals(10.0, Similarity.decayWeight(10.0, 0L, 30.0), 1e-9)
        assertEquals(5.0, Similarity.decayWeight(10.0, 30 * day, 30.0), 1e-9)
        assertEquals(2.5, Similarity.decayWeight(10.0, 60 * day, 30.0), 1e-9)
        assertEquals(0.0, Similarity.decayWeight(0.0, 60 * day, 30.0), 1e-9)
        // 负 elapsed 夹到 0（时钟回拨不放大权重）
        assertEquals(10.0, Similarity.decayWeight(10.0, -day, 30.0), 1e-9)
    }

    @Test
    fun `反馈质量初始 0_5 且正负单调`() {
        assertEquals(0.5, Similarity.computeFeedbackQuality(0.0, 0.0), 1e-9)
        // (2+2)/(4+2) = 4/6
        assertEquals(4.0 / 6.0, Similarity.computeFeedbackQuality(2.0, 0.0), 1e-9)
        // (2+0)/(4+2) = 2/6
        assertEquals(2.0 / 6.0, Similarity.computeFeedbackQuality(0.0, 2.0), 1e-9)
    }

    @Test
    fun `曝光分随曝光次数单调下降`() {
        assertEquals(1.0, Similarity.computeExposureScore(0), 1e-9)
        // scale = 4 → 1 / (1 + 4/4)
        assertEquals(0.5, Similarity.computeExposureScore(4), 1e-9)
        assertEquals(1.0 / 3.0, Similarity.computeExposureScore(8), 1e-9)
    }

    @Test
    fun `歌单分三项加权`() {
        val scored = Similarity.computePlaylistScore(1.0, 0.0, 0.0, 0)
        // 0.5×1 + 0.3×0.5 + 0.2×1 = 0.5 + 0.15 + 0.2
        assertEquals(0.85, scored.score, 1e-9)
        assertEquals(1.0, scored.parts.affinity, 1e-9)
        // 亲和力钳到 [0,1]
        assertEquals(1.0, Similarity.computePlaylistScore(9.0, 0.0, 0.0, 0).parts.affinity, 1e-9)
    }

    @Test
    fun `Jaccard 与带权 Jaccard`() {
        assertEquals(1.0, Similarity.jaccard(setOf("a", "b"), setOf("b", "a")), 1e-9)
        assertEquals(1.0 / 3.0, Similarity.jaccard(setOf("a", "b"), setOf("b", "c")), 1e-9)
        // 双空返回 0：两首都没有标签不代表相似
        assertEquals(0.0, Similarity.jaccard(emptySet(), emptySet()), 1e-9)

        // min(a)=1+0=1，max=1+2=3
        assertEquals(1.0 / 3.0, Similarity.weightedJaccard(mapOf("a" to 1.0, "b" to 2.0), mapOf("a" to 1.0)), 1e-9)
    }

    @Test
    fun `余弦相似度只算交集方向`() {
        assertEquals(1.0, Similarity.cosine(mapOf("a" to 1.0), mapOf("a" to 2.0)), 1e-9)
        assertEquals(0.0, Similarity.cosine(mapOf("a" to 1.0), mapOf("b" to 1.0)), 1e-9)
        assertEquals(0.0, Similarity.cosine(emptyMap(), mapOf("a" to 1.0)), 1e-9)
        // 完全反向的负权重不该被算成相似
        assertEquals(0.0, Similarity.cosine(mapOf("a" to 1.0), mapOf("a" to -1.0)), 1e-9)
    }

    @Test
    fun `歌手亲和力命中权重归一`() {
        val profile = mapOf("周杰伦" to 2.0, "五月天" to 2.0)
        assertEquals(0.5, Similarity.artistAffinity(profile, listOf("周杰伦")), 1e-9)
        assertEquals(0.0, Similarity.artistAffinity(profile, listOf("邓紫棋")), 1e-9)
        // 画像为空时没有可比的方向，返回 0 而不是「0 除以 0」
        assertEquals(0.0, Similarity.artistAffinity(emptyMap(), listOf("周杰伦")), 1e-9)
    }

    @Test
    fun `语种相似度判不出时是中性的 0_5`() {
        val share = mapOf(LangBucket.ZH to 8.0, LangBucket.EN to 2.0)
        assertEquals(0.8, Similarity.langSimilarity(share, LangBucket.ZH), 1e-9)
        assertEquals(0.2, Similarity.langSimilarity(share, LangBucket.EN), 1e-9)
        assertEquals(0.0, Similarity.langSimilarity(share, LangBucket.JA), 1e-9)
        assertEquals(0.5, Similarity.langSimilarity(share, null), 1e-9)
        assertEquals(0.5, Similarity.langSimilarity(share, LangBucket.UNKNOWN), 1e-9)
        assertEquals(0.5, Similarity.langSimilarity(emptyMap(), LangBucket.ZH), 1e-9)
    }

    @Test
    fun `年代相似度按加权质心的距离衰减`() {
        val eras = mapOf(2000 to 1.0)
        assertEquals(1.0, Similarity.eraSimilarity(eras, 2000), 1e-9)
        // 窗口 ±15 年，线性衰减：|2007-2000| / 15
        assertEquals(1.0 - 7.0 / 15.0, Similarity.eraSimilarity(eras, 2007), 1e-9)
        assertEquals(0.0, Similarity.eraSimilarity(eras, 2020), 1e-9)
        assertEquals(0.5, Similarity.eraSimilarity(eras, null), 1e-9)
        assertEquals(0.5, Similarity.eraSimilarity(emptyMap(), 2000), 1e-9)
    }

    @Test
    fun `多路合成按权重归一 权重和为 0 时返回 0`() {
        assertEquals(0.5, Similarity.combine(listOf(1.0 to 0.5, 1.0 to 0.5)), 1e-9)
        assertEquals(1.0, Similarity.combine(listOf(3.0 to 1.0, 1.0 to 1.0)), 1e-9)
        assertEquals(0.0, Similarity.combine(emptyList()), 1e-9)
        assertEquals(0.0, Similarity.combine(listOf(0.0 to 1.0)), 1e-9)
        // 相似度钳到 [0,1]
        assertEquals(1.0, Similarity.combine(listOf(1.0 to 9.0)), 1e-9)
    }

    @Test
    fun `综合画像相似度四项加权`() {
        val profile =
            Similarity.profileSimilarity(
                profileArtists = mapOf("周杰伦" to 1.0),
                profileTags = mapOf("华语" to 1.0),
                profileLangShare = mapOf(LangBucket.ZH to 1.0),
                profileEras = mapOf(2005 to 1.0),
                candidate =
                    Similarity.CandidateProfile(
                        artistKeys = listOf("周杰伦"),
                        tags = listOf("华语"),
                        lang = LangBucket.ZH,
                        year = 2005,
                    ),
            )
        assertEquals(1.0, profile, 1e-9)

        // 完全不像的候选仍会拿到语种中性的那一份（0.15 × 0.5 = 0.075）
        val stranger =
            Similarity.profileSimilarity(
                profileArtists = mapOf("周杰伦" to 1.0),
                profileTags = mapOf("华语" to 1.0),
                profileLangShare = mapOf(LangBucket.ZH to 1.0),
                profileEras = mapOf(2005 to 1.0),
                candidate = Similarity.CandidateProfile(artistKeys = listOf("某新人"), tags = listOf("电子")),
            )
        assertEquals(0.15 * 0.5 + 0.15 * 0.5, stranger, 1e-9)
    }

    @Test
    fun `热门阻尼随频率单调下降`() {
        // 1 / (1 + ln(1 + freq))^exponent，exponent 默认 1
        assertEquals(1.0, Similarity.computePopularityDamping(0), 1e-9)
        assertEquals(1.0 / (1.0 + kotlin.math.ln(2.0)), Similarity.computePopularityDamping(1), 1e-9)
        assertEquals(1.0 / (1.0 + kotlin.math.ln(4.0)), Similarity.computePopularityDamping(3), 1e-9)
    }
}
