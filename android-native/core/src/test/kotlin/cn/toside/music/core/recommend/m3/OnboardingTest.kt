package cn.toside.music.core.recommend.m3

import cn.toside.music.core.recommend.ThemeFeedback
import cn.toside.music.core.recommend.ThemePreference
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 问卷纯函数 —— 对照 RN `core/recommend/onboarding.ts`。 */
class OnboardingTest {
    @Test
    fun `写侧只留合法 id 钳到 0-100 取整到 10 的倍数`() {
        val sanitized =
            Onboarding.sanitizeWeights(
                mapOf(
                    "zh" to 56.0,
                    "rock" to 50.0,
                    "pop" to 7.0,
                    "notAnOption" to 90.0,
                ),
            )
        assertEquals(60.0, sanitized.getValue("zh"), 1e-9)
        // 停在中性点 50% 算没表态，丢掉
        assertFalse(sanitized.containsKey("rock"))
        assertEquals(10.0, sanitized.getValue("pop"), 1e-9)
        // 表外 id 不落盘
        assertFalse(sanitized.containsKey("notAnOption"))
    }

    @Test
    fun `0% 保留 因为它是最强负分量`() {
        val sanitized = Onboarding.sanitizeWeights(mapOf("rock" to 0.0))
        assertEquals(0.0, sanitized.getValue("rock"), 1e-9)
    }

    @Test
    fun `播种分量以 50% 为中轴 负支只取一半幅度`() {
        val saturation = 4.0
        val full = Onboarding.computeSeedWeights(mapOf("zh" to 100.0), saturation)
        assertEquals(4.0, full.getValue("华语"), 1e-9)
        assertEquals(4.0, full.getValue("国语"), 1e-9)
        assertEquals(4.0, full.getValue("内地"), 1e-9)

        val zero = Onboarding.computeSeedWeights(mapOf("zh" to 0.0), saturation)
        assertEquals(-2.0, zero.getValue("华语"), 1e-9)

        // 50% 恰为 0，不播种
        assertTrue(Onboarding.computeSeedWeights(mapOf("zh" to 50.0), saturation).isEmpty())
    }

    @Test
    fun `多别名各占一键 归一化后才进表`() {
        val seeds = Onboarding.computeSeedWeights(mapOf("western" to 80.0), 4.0)
        // (80-50)/50*4 = 2.4
        assertEquals(2.4, seeds.getValue("欧美"), 1e-9)
        assertEquals(2.4, seeds.getValue("英文"), 1e-9)
        assertEquals(2.4, seeds.getValue("西洋"), 1e-9)
        // 别名归一化走 TrackKeys.normalizeText（小写），所以 R&B 这类会带符号但不会变成大写
        val rnb = Onboarding.computeSeedWeights(mapOf("rnb" to 100.0), 4.0)
        assertEquals(4.0, rnb.getValue("r&b"), 1e-9)
    }

    @Test
    fun `播种并入正负两侧 且可对称回退`() {
        val themes = mutableMapOf<String, ThemePreference>()
        val seeds = Onboarding.computeSeedWeights(mapOf("zh" to 100.0, "dj" to 0.0), 4.0)
        Onboarding.applySeedWeights(themes, seeds, now = 1_000L)
        assertEquals(4.0, themes.getValue("华语").positiveWeight, 1e-9)
        assertEquals(2.0, themes.getValue("串烧").negativeWeight, 1e-9)

        // 用户真实反馈叠在播种之上
        themes["华语"] = themes.getValue("华语").copy(positiveWeight = 5.0)
        Onboarding.revokeSeedWeights(themes, seeds)
        assertEquals(1.0, themes.getValue("华语").positiveWeight, 1e-9)
        // 负支减到 0 且正侧也是 0 才删条目
        assertFalse(themes.containsKey("串烧"))
    }

    @Test
    fun `关键词池只收 20% 以上 且排除中性点`() {
        val keywords = Onboarding.computePreferenceKeywords(mapOf("pop" to 60.0, "rock" to 30.0, "zh" to 50.0, "folk" to 10.0))
        assertEquals(listOf("流行", "摇滚"), keywords)
    }

    @Test
    fun `问卷规范词排在画像关键词之前并去重`() {
        val merged = Onboarding.mergePreferenceKeywords(listOf("周杰伦", "流行"), listOf("流行", "摇滚"))
        assertEquals(listOf("流行", "摇滚", "周杰伦"), merged)
    }

    @Test
    fun `未被问卷声明的选项不参与任何计算`() {
        val seeds = Onboarding.computeSeedWeights(emptyMap(), 4.0)
        assertTrue(seeds.isEmpty())
        assertTrue(Onboarding.computePreferenceKeywords(emptyMap()).isEmpty())
        // ThemeFeedback 的构造器复用检查：播种需要的空条目走 createThemePreference
        assertEquals(0.0, ThemeFeedback.createThemePreference("x", 0L).positiveWeight, 1e-9)
    }
}
