package cn.toside.music.core.recommend

import kotlinx.serialization.Serializable

/**
 * M1 画像装配的输入信号 —— 从原生已有数据取（对照 RN `index.ts`
 * `buildCurrentProfile` 的 M1 退化版）。
 *
 * 三路信号（全部真实数据，不造假）：
 * - [loveTracks]：收藏列表曲目（RN directionPrior.love = 1）；
 * - [userListTracks]：用户自建歌单曲目（RN directionPrior.playlist = 0.8）；
 * - [playHistory]：播放历史（RN directionPrior.track = 0.6，越新权重越高）。
 */
data class ProfileInput(
    val loveTracks: List<ProfileTrack>,
    val userListTracks: List<ProfileTrack>,
    val playHistory: List<ProfileHistoryEntry>,
)

/** 画像证据曲目：歌名 + 歌手即可（重排只按这两个字段打分）；`source` 供本地曲过滤（W5-13）。 */
data class ProfileTrack(
    val name: String?,
    val singer: String?,
    val source: String? = null,
)

/** 播放历史一条：曲目 + 播放时间（新近播放权重高）。 */
data class ProfileHistoryEntry(
    val track: ProfileTrack,
    val playTime: Long,
)

/** 装配出的画像：直接可喂给重排函数的表 + 定向关键词。 */
@Serializable
data class LearnedProfile(
    val artistStats: Map<String, ThemePreference> = emptyMap(),
    val tokenWeights: Map<String, ThemePreference> = emptyMap(),
    /** 定向关键词：歌手名在前、学到的风格词在后（对照 RN buildPlaylistKeywords 的次序）。 */
    val keywords: List<String> = emptyList(),
    /** 画像版本：信号变化后自增，UI 可据此决定是否重取。 */
    val revision: Int = 0,
)

/**
 * 画像装配纯规则 —— 把三路信号折算成歌手先验 + 词面权重 + 关键词。
 *
 * 【与 RN 结算链的差异（实证后有意为之）】RN 的 artistStats/tokenWeights 由
 * 电台播放结算（完播 +0.5 / 早切 -0.5 / 显式喜欢 +1 等，见 feedback.ts）逐笔喂；
 * M1 没有电台，改在「装配时」从静态信号一次性推导：
 * - 收藏曲目 = 强正反馈（对照 RN profile.weights.like = 3 × artistPrior.likePositive = 1）；
 * - 自建歌单收录 = 中等正反馈（profile.weights.addToPlaylist = 2 × 1）；
 * - 播放历史 = 弱正反馈（profile.weights.passivePlay = 0.2 × 1，最近 100 条内
 *   按 14 天半衰期折算新近度，对照 profile.recentListenHalfLifeDays）。
 * 表由装配函数整体重建（不累积），lastDecayTime 取装配时刻，权重从装配时刻起按
 * 45 天半衰期自然衰减——品味漂移由「信号本身过期」实现。
 */
object RecommendProfile {
    /** 对照 RN profile.weights 与 artistPrior.*Positive 的乘积。 */
    private const val LOVE_WEIGHT = 3.0
    private const val USER_LIST_WEIGHT = 2.0
    private const val HISTORY_BASE_WEIGHT = 0.2
    private const val HISTORY_HALF_LIFE_DAYS = 14.0
    private const val KEYWORD_LIMIT = 8
    private const val STYLE_TOKEN_LIMIT = 3

    /**
     * 装配画像。空输入产出空画像（冷启动），重排自动退化为原序。
     */
    fun build(
        input: ProfileInput,
        now: Long,
    ): LearnedProfile {
        val artistStats = mutableMapOf<String, ThemePreference>()
        val tokenWeights = mutableMapOf<String, ThemePreference>()

        fun credit(
            track: ProfileTrack,
            weight: Double,
        ) {
            val artists = TrackKeys.getArtistKeys(track.singer)
            if (artists.isNotEmpty()) {
                ArtistPrior.applyArtistStatsFeedback(artistStats, artists, weight, 0.0, now)
            }
            val tokens = NameTokenFeedback.tokenizeTrackName(track.name)
            if (tokens.isNotEmpty()) {
                NameTokenFeedback.applyNameTokenFeedback(tokenWeights, tokens, weight, 0.0, now)
            }
        }

        // 收藏 > 自建歌单 > 播放历史：按 RN directionPrior 的强度顺序记账
        for (track in input.loveTracks) credit(track, LOVE_WEIGHT)
        for (track in input.userListTracks) credit(track, USER_LIST_WEIGHT)
        for (entry in input.playHistory) {
            if (entry.playTime <= 0) continue
            val elapsed = (now - entry.playTime).coerceAtLeast(0L)
            val recency = decayWeight(1.0, elapsed, HISTORY_HALF_LIFE_DAYS)
            credit(entry.track, HISTORY_BASE_WEIGHT * recency)
        }

        val keywords = buildKeywords(artistStats, tokenWeights, now)
        return LearnedProfile(
            artistStats = artistStats,
            tokenWeights = tokenWeights,
            keywords = keywords,
            revision = 1,
        )
    }

    /**
     * 关键词池：强歌手 > 学到的风格词 —— 对照 RN `buildPlaylistKeywords` 的
     * M1 退化版（无方向名/种子歌名：那些依赖 profile.directions/seeds 的
     * 完整画像抽取属 M2，M1 只取 topArtists 与词面学习两条通道）。
     */
    private fun buildKeywords(
        artistStats: Map<String, ThemePreference>,
        tokenWeights: Map<String, ThemePreference>,
        now: Long,
    ): List<String> {
        val keywords = mutableListOf<String>()
        val strongArtists =
            artistStats.entries
                .sortedByDescending { it.value.positiveWeight }
        val topWeight = strongArtists.firstOrNull()?.value?.positiveWeight ?: 0.0
        // 对照 RN coldStart.strongArtistWeightRatio = 0.25：达到最高歌手 1/4 才算强歌手
        for ((artist, pref) in strongArtists) {
            if (pref.positiveWeight < topWeight * 0.25) break
            if (artist.isNotEmpty() && artist !in keywords) keywords.add(artist)
        }
        for (token in NameTokenFeedback.getLearnedStyleTokens(tokenWeights, STYLE_TOKEN_LIMIT, now)) {
            if (keywords.size >= KEYWORD_LIMIT) break
            if (token.isNotEmpty() && token !in keywords) keywords.add(token)
        }
        return keywords.take(KEYWORD_LIMIT)
    }

    /** 重排输入的快捷装配：画像 → [ProfileFactorState] / [PlaylistRankState]。 */
    fun factorState(profile: LearnedProfile): ProfileFactorState =
        ProfileFactorState(
            artistStats = profile.artistStats.ifEmpty { null },
            tokenWeights = profile.tokenWeights.ifEmpty { null },
        )

    fun rankState(
        profile: LearnedProfile,
        blocked: DislikeRules? = null,
        hidden: Map<String, Long>? = null,
    ): PlaylistRankState =
        PlaylistRankState(
            artistStats = profile.artistStats.ifEmpty { null },
            tokenWeights = profile.tokenWeights.ifEmpty { null },
            blocked = blocked,
            hidden = hidden,
        )
}
