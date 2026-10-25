package cn.toside.music.core.recommend

import kotlinx.serialization.Serializable

/**
 * 分类（主题）/歌手/词面三类学习共用的偏好记录 —— 对照 RN
 * `core/recommend/types.ts` 的 `ThemePreference`（原样移植，字段名一致）。
 */
@Serializable
data class ThemePreference(
    val themeId: String,
    val positiveWeight: Double,
    val negativeWeight: Double,
    val lastDecayTime: Long,
    val lastUsedTime: Long,
)

/**
 * 踩雷规则 —— 对照 RN `core/recommend/filter.ts` 的 `DislikeRules`。
 * RN 用 `ReadonlySet`；Kotlin 用 `Set`，来源见 app 装配层（`@dislike_list` 的解析）。
 */
data class DislikeRules(
    val names: Set<String>,
    val musicNames: Set<String>,
    val singerNames: Set<String>,
) {
    companion object {
        val EMPTY = DislikeRules(emptySet(), emptySet(), emptySet())
    }
}

/**
 * 曲目级画像因子输入 —— 对照 RN `tabSections.ts` 的 `ProfileFactorState`。
 * 两张表缺任一张都按空表处理（因子恒 1，等于不过问）。
 */
data class ProfileFactorState(
    val artistStats: Map<String, ThemePreference>? = null,
    val tokenWeights: Map<String, ThemePreference>? = null,
)

/**
 * 推荐歌单排序的完整输入 —— 对照 RN `tabSections.ts` 的 `PlaylistRankState`。
 */
data class PlaylistRankState(
    val artistStats: Map<String, ThemePreference>? = null,
    val tokenWeights: Map<String, ThemePreference>? = null,
    val blocked: DislikeRules? = null,
    /** 被「不感兴趣」隐藏的歌单（normalizePlaylistKey → 隐藏时间戳）。 */
    val hidden: Map<String, Long>? = null,
)

/** M1 需要的配置子集 —— RN `core/recommend/config.ts` 对应三节的逐值移植。 */
object RecommendConfig {
    /** 词面级学习（歌名 token）。负向因子刻意大于正向——避开踩雷优先。 */
    val nameToken = NameTokenConfig()

    /** 长期歌手先验：半衰期比词面更长，管「一直」。 */
    val artistPrior = ArtistPriorConfig()

    /** 分类（主题）级学习：negativeFactor 刻意大于 positiveFactor。 */
    val themeFeedback = ThemeFeedbackConfig()

    class NameTokenConfig(
        val halfLifeDays: Double = 30.0,
        val maxWeight: Double = 6.0,
        val positiveFactor: Double = 0.15,
        val negativeFactor: Double = 0.35,
        val floor: Double = 0.5,
        val ceiling: Double = 1.25,
    )

    class ArtistPriorConfig(
        val halfLifeDays: Double = 45.0,
        val maxWeight: Double = 8.0,
        val positiveFactor: Double = 0.1,
        val negativeFactor: Double = 0.25,
        val floor: Double = 0.55,
        val ceiling: Double = 1.15,
    )

    class ThemeFeedbackConfig(
        val positiveFactor: Double = 0.6,
        val negativeFactor: Double = 1.5,
        val halfLifeDays: Double = 45.0,
    )
}
