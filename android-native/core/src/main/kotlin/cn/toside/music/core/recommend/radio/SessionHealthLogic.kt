package cn.toside.music.core.recommend.radio

import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * 会话健康度与安全模式 —— RN `core/recommend/sessionHealth.ts` 的移植。
 *
 * 负反馈占比线性映射到探索额度系数；连续负反馈触发安全模式（撤下高风险已排队曲目）。
 * 随机性不在此处，bandit 的 rng 由调用方传入 [Channels.plan]。
 */
object SessionHealthLogic {
    private fun isSettledTrack(
        track: SessionTrack,
        dislikedTrackKeys: Set<String>,
    ): Boolean = track.liked == true || track.listenRatio != null || dislikedTrackKeys.contains(track.trackKey)

    private fun isNegativeTrack(
        track: SessionTrack,
        dislikedTrackKeys: Set<String>,
    ): Boolean {
        if (track.liked == true) return false
        if (dislikedTrackKeys.contains(track.trackKey)) return true
        val ratio = track.listenRatio
        return ratio != null && ratio < RadioConfig.SessionHealth.NEGATIVE_LISTEN_RATIO
    }

    fun mapNegativeRateToFactor(rate: Double): Double {
        if (rate <= RadioConfig.SessionHealth.EXPLORATION_THROTTLE_START) return 1.0
        if (rate >= RadioConfig.SessionHealth.EXPLORATION_THROTTLE_END) {
            return RadioConfig.SessionHealth.EXPLORATION_FACTOR_FLOOR
        }
        val span =
            RadioConfig.SessionHealth.EXPLORATION_THROTTLE_END -
                RadioConfig.SessionHealth.EXPLORATION_THROTTLE_START
        return 1.0 -
            (1.0 - RadioConfig.SessionHealth.EXPLORATION_FACTOR_FLOOR) *
            (rate - RadioConfig.SessionHealth.EXPLORATION_THROTTLE_START) / span
    }

    fun compute(
        session: SessionPreference,
        dislikedTrackKeys: Set<String>,
    ): SessionHealth {
        val tracks = session.recentTracks.take(RadioConfig.SessionHealth.WINDOW)
        var negativeStreak = 0
        for (track in tracks) {
            if (!isNegativeTrack(track, dislikedTrackKeys)) break
            negativeStreak += 1
        }
        var positiveStreak = 0
        for (track in tracks) {
            if (!isSettledTrack(track, dislikedTrackKeys) || isNegativeTrack(track, dislikedTrackKeys)) break
            positiveStreak += 1
        }
        val settled = tracks.filter { isSettledTrack(it, dislikedTrackKeys) }
        val negatives = settled.count { isNegativeTrack(it, dislikedTrackKeys) }
        val negativeRate = if (settled.isNotEmpty()) negatives.toDouble() / settled.size else 0.0
        val explorationSettled = settled.filter { it.channel == ChannelId.C || it.channel == ChannelId.D }
        val explorationNegatives = explorationSettled.count { isNegativeTrack(it, dislikedTrackKeys) }
        val explorationNegativeRate =
            if (explorationSettled.size >= RadioConfig.SessionHealth.MIN_EXPLORATION_SAMPLES && explorationSettled.isNotEmpty()) {
                explorationNegatives.toDouble() / explorationSettled.size
            } else {
                null
            }
        val baseFactor = mapNegativeRateToFactor(explorationNegativeRate ?: negativeRate)
        val boosted =
            if (positiveStreak >= RadioConfig.SessionHealth.POSITIVE_STREAK_THRESHOLD &&
                negativeStreak < RadioConfig.SessionHealth.STREAK_THRESHOLD
            ) {
                max(baseFactor, RadioConfig.SessionHealth.POSITIVE_EXPLORATION_BOOST)
            } else {
                baseFactor
            }
        return SessionHealth(
            negativeStreak = negativeStreak,
            positiveStreak = positiveStreak,
            negativeRate = negativeRate,
            explorationNegativeRate = explorationNegativeRate,
            explorationFactor = boosted,
            safeMode = negativeStreak >= RadioConfig.SessionHealth.STREAK_THRESHOLD,
            sampleSize = settled.size,
        )
    }

    fun buildPenalties(
        session: SessionPreference,
        dislikedTrackKeys: Set<String>,
    ): SessionPenalties {
        val artistPenalty = mutableMapOf<String, Double>()
        val playlistPenalty = mutableMapOf<String, Double>()
        session.recentTracks.take(RadioConfig.SessionHealth.WINDOW).forEachIndexed { index, track ->
            if (!isNegativeTrack(track, dislikedTrackKeys)) return@forEachIndexed
            val weight = RadioConfig.SessionHealth.PENALTY_RECENCY_DECAY.pow(index.toDouble())
            for (artist in track.artistKeys) {
                artistPenalty[artist] = (artistPenalty[artist] ?: 0.0) + weight
            }
            val playlistId = track.sourcePlaylistId
            if (!playlistId.isNullOrEmpty()) {
                playlistPenalty[playlistId] = (playlistPenalty[playlistId] ?: 0.0) + weight
            }
        }
        val cap = RadioConfig.SessionHealth.PENALTY_CAP
        for (key in artistPenalty.keys.toList()) artistPenalty[key] = min(cap, artistPenalty.getValue(key))
        for (key in playlistPenalty.keys.toList()) playlistPenalty[key] = min(cap, playlistPenalty.getValue(key))
        return SessionPenalties(artistPenalty, playlistPenalty)
    }

    fun penaltyScore(
        artistKeys: List<String>?,
        playlistIds: List<String>?,
        penalties: SessionPenalties?,
    ): Double {
        if (penalties == null) return 0.0
        var maxArtist = 0.0
        for (artist in artistKeys.orEmpty()) maxArtist = max(maxArtist, penalties.artistPenalty[artist] ?: 0.0)
        var maxPlaylist = 0.0
        for (playlistId in playlistIds.orEmpty()) maxPlaylist = max(maxPlaylist, penalties.playlistPenalty[playlistId] ?: 0.0)
        return min(RadioConfig.SessionHealth.PENALTY_CAP, maxArtist) * RadioConfig.SessionHealth.ARTIST_PENALTY_WEIGHT +
            min(RadioConfig.SessionHealth.PENALTY_CAP, maxPlaylist) * RadioConfig.SessionHealth.PLAYLIST_PENALTY_WEIGHT
    }

    fun penaltyFactor(score: Double): Double = 1.0 / (1.0 + max(0.0, score))

    fun shouldDeferQueuedItem(
        artistKeys: List<String>?,
        playlistId: String?,
        penalties: SessionPenalties?,
    ): Boolean {
        if (penalties == null) return false
        var maxArtist = 0.0
        for (artist in artistKeys.orEmpty()) maxArtist = max(maxArtist, penalties.artistPenalty[artist] ?: 0.0)
        val maxPlaylist = if (playlistId.isNullOrEmpty()) 0.0 else penalties.playlistPenalty[playlistId] ?: 0.0
        return maxArtist >= RadioConfig.SessionHealth.DEFER_PENALTY_THRESHOLD ||
            maxPlaylist >= RadioConfig.SessionHealth.DEFER_PENALTY_THRESHOLD
    }

    data class Exploration(
        val explorationFactor: Double,
        val explorationGap: Int,
    )

    /** 探索额度的唯一收敛点：电台恒定偏熟悉，探索模式原样放行、间隔取消。 */
    fun resolveExploration(
        mode: RadioMode,
        explorationFactor: Double,
        explorationGap: Int,
    ): Exploration =
        if (mode == RadioMode.EXPLORE) {
            Exploration(explorationFactor, 0)
        } else {
            Exploration(
                min(explorationFactor, RadioConfig.RadioExploration.FACTOR_CAP),
                max(explorationGap, RadioConfig.RadioExploration.GAP),
            )
        }
}
