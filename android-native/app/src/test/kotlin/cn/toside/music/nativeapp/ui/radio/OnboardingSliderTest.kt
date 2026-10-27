package cn.toside.music.nativeapp.ui.radio

import cn.toside.music.core.recommend.m3.Onboarding
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 问卷滑条的**持久化形状**样本表（W5-6）。
 *
 * 换控件时最容易悄悄改坏的是「落库到底写什么」：推荐侧的语种配额与分类播种
 * 只认这四个百分数（尤其 0% 会翻成负权、50% 会被 [Onboarding.sanitizeWeights] 丢掉），
 * 所以这里把 0..1 的滑条位置 → 落库值整张表钉死，并断言吸附结果**恒在四档内**。
 */
class OnboardingSliderTest {
    /** 滑条位置 → 期望落库百分数（四档均匀分布在 0、1/3、2/3、1）。 */
    private val snapCases =
        listOf(
            0.00f to 0.0,
            0.10f to 0.0,
            0.16f to 0.0,
            0.17f to 50.0,
            0.33f to 50.0,
            0.49f to 50.0,
            0.50f to 70.0,
            0.66f to 70.0,
            0.83f to 70.0,
            0.84f to 100.0,
            1.00f to 100.0,
        )

    @Test
    fun drag_positions_snap_to_the_four_tiers() {
        snapCases.forEach { (fraction, expected) ->
            assertEquals("fraction=$fraction", expected, snapTierPercent(fraction), 0.0)
        }
    }

    @Test
    fun out_of_range_positions_are_clamped_not_dropped() {
        assertEquals(0.0, snapTierPercent(-1f), 0.0)
        assertEquals(100.0, snapTierPercent(2f), 0.0)
    }

    /** 控件怎么换，落库集合必须还是这四个值（RN `onboarding.weights` 的四档口径）。 */
    @Test
    fun snapped_values_stay_inside_the_legacy_tier_set() {
        val legacy = setOf(0.0, 50.0, 70.0, 100.0)
        for (step in 0..100) {
            assertTrue(snapTierPercent(step / 100f) in legacy)
        }
    }

    /** 档位 ↔ 百分数双向一致，UI 才能把已保存的答案摆回正确的档位。 */
    @Test
    fun tier_index_round_trips() {
        listOf(0.0, 50.0, 70.0, 100.0).forEach { percent ->
            val index = tierIndexOf(percent)
            assertEquals(percent, percentOfTier(index), 0.0)
        }
        // 未保存过的选项回落到「无所谓」（RN 的 NEUTRAL_PERCENT）
        assertEquals(1, tierIndexOf(Onboarding.NEUTRAL_PERCENT.toDouble()))
        assertEquals(Onboarding.NEUTRAL_PERCENT.toDouble(), percentOfTier(1), 0.0)
    }

    /** 「无所谓」这一档在落库时会被移除——滑条换了，这个语义不能变。 */
    @Test
    fun neutral_tier_is_still_dropped_by_sanitize() {
        val answers = mapOf("zh" to snapTierPercent(1 / 3f), "pop" to snapTierPercent(0f))
        val sanitized = Onboarding.sanitizeWeights(answers)
        assertTrue(sanitized["zh"] == null)
        assertEquals(0.0, sanitized["pop"]!!, 0.0)
    }
}
