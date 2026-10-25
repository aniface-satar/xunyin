package cn.toside.music.core.recommend

import kotlin.math.max

/**
 * 分类（主题）级反馈学习 —— RN `core/recommend/feedback.ts` 的 M1 子集：
 * 仅 `createThemePreference` / `decayThemePreference` / `themeNetWeight` 三个纯函数。
 *
 * （任务书按立项评估明确「feedback（仅 themeNetWeight）」；applyThemeFeedback、
 * 显式反馈结算、歌单偏好状态机属 M2 电台结算，本波不移植。）
 */
object ThemeFeedback {
    fun createThemePreference(
        themeId: String,
        now: Long,
    ): ThemePreference =
        ThemePreference(
            themeId = themeId,
            positiveWeight = 0.0,
            negativeWeight = 0.0,
            lastDecayTime = now,
            lastUsedTime = now,
        )

    /**
     * 按半衰期衰减正负权重。RN 语义：lastDecayTime 为 0（缺失）时补 now；
     * 距上次衰减不足 60 秒时原样返回（避免高频调用反复改写时间戳）。
     */
    fun decayThemePreference(
        pref: ThemePreference,
        now: Long,
        halfLifeDays: Double = RecommendConfig.themeFeedback.halfLifeDays,
    ): ThemePreference {
        if (pref.lastDecayTime == 0L) return pref.copy(lastDecayTime = now)
        val elapsed = max(0L, now - pref.lastDecayTime)
        if (elapsed < 60_000) return pref
        return pref.copy(
            positiveWeight = decayWeight(pref.positiveWeight, elapsed, halfLifeDays),
            negativeWeight = decayWeight(pref.negativeWeight, elapsed, halfLifeDays),
            lastDecayTime = now,
        )
    }

    /** 主题净权重 = 衰减后正权重 - 衰减后负权重；无记录为 0。 */
    fun themeNetWeight(
        themes: Map<String, ThemePreference>,
        themeId: String?,
        now: Long,
    ): Double {
        if (themeId.isNullOrEmpty()) return 0.0
        val pref = themes[themeId] ?: return 0.0
        val decayed = decayThemePreference(pref, now)
        return decayed.positiveWeight - decayed.negativeWeight
    }
}
