package cn.toside.music.core.recommend.radio

import cn.toside.music.core.recommend.ThemePreference
import kotlinx.serialization.Serializable

/**
 * 电台持久化状态 —— RN `core/recommend/storage.ts` 的 RecommendationState 子集。
 *
 * 落盘由 app 层用 [cn.toside.music.core.storage.ShardedKvStore] 完成；
 * 这里只做内存态与容量裁剪。通道键一律用 `ChannelId.name` 字符串，
 * 避免 kotlinx JSON 的枚举键问题。
 */
@Serializable
data class RadioState(
    val tracks: Map<String, TrackPreference> = emptyMap(),
    val playlists: Map<String, PlaylistPreference> = emptyMap(),
    val observedPlaylists: Map<String, ObservedPlaylist> = emptyMap(),
    val candidateCache: List<PoolCandidate> = emptyList(),
    val candidateCacheFetchedAt: Long = 0,
    val exposureCounts: Map<String, Long> = emptyMap(),
    val dislikedTracks: Map<String, Long> = emptyMap(),
    val themeWeights: Map<String, ThemePreference> = emptyMap(),
    val tokenWeights: Map<String, ThemePreference> = emptyMap(),
    val artistStats: Map<String, ThemePreference> = emptyMap(),

    /**
     * 问卷答案（选项 id → 百分比）与其**已播种分量**（分类键 → 初值分量）。
     * 两者必须与 [themeWeights] 同生共死：重答问卷时先按 [onboardingSeeded] 对称回退再播新的，
     * 否则「把华语从 100% 改成 0%」只会再叠一层负权，第一次表态永远撤不掉。
     * 跨重启也靠这里保证幂等 —— 重启后重播一次 = 先退旧再播同值，净变化为零。
     */
    val onboardingWeights: Map<String, Double> = emptyMap(),
    val onboardingSeeded: Map<String, Double> = emptyMap(),
    val channelBandit: Map<String, ChannelBanditArm> = emptyMap(),
    val settledPlayIds: Map<String, LedgerEntry> = emptyMap(),
    val radioHistory: List<RadioPlayRecord> = emptyList(),
    val session: SessionPreference = SessionPreference(),
    val sourceCooldowns: Map<String, Long> = emptyMap(),
) {
    fun ensureTrack(trackKey: String): TrackPreference = tracks[trackKey] ?: TrackPreference(trackKey = trackKey)

    fun ensurePlaylist(
        playlistId: String,
        now: Long,
    ): PlaylistPreference =
        RadioFeedback.decayPlaylistPreference(
            playlists[playlistId] ?: RadioFeedback.createPlaylistPreference(playlistId, now),
            now,
        )

    /** RN `trimState` 的容量裁剪；顺序与 RN 一致，便于对照。 */
    fun trim(now: Long): RadioState {
        val historyThreshold = now - RadioConfig.Storage.RADIO_HISTORY_RETENTION_MS
        val trimmedHistory =
            radioHistory
                .filter { (it.endedAt ?: it.startedAt) >= historyThreshold }
                .take(RadioConfig.Storage.RADIO_HISTORY_LIMIT)

        fun <K, V> takeBy(
            map: Map<K, V>,
            limit: Int,
            weight: (V) -> Double,
        ): Map<K, V> {
            if (map.size <= limit) return map
            return map.entries
                .sortedByDescending { weight(it.value) }
                .take(limit)
                .associate { it.key to it.value }
        }

        fun takeWeighted(
            map: Map<String, ThemePreference>,
            limit: Int,
        ): Map<String, ThemePreference> = takeBy(map, limit) { it.positiveWeight + it.negativeWeight }

        return copy(
            radioHistory = trimmedHistory,
            settledPlayIds = RadioFeedback.trimLedger(settledPlayIds),
            observedPlaylists = takeBy(observedPlaylists, 100) { it.fetchedAt.toDouble() },
            tracks = takeBy(tracks, RadioConfig.Storage.TRACK_PREFERENCE_LIMIT) { it.lastPlayTime.toDouble() },
            exposureCounts = takeBy(exposureCounts, RadioConfig.Storage.EXPOSURE_COUNT_LIMIT) { it.toDouble() },
            dislikedTracks = takeBy(dislikedTracks, RadioConfig.Storage.DISLIKED_TRACK_LIMIT) { it.toDouble() },
            themeWeights = takeWeighted(themeWeights, RadioConfig.Storage.THEME_WEIGHT_LIMIT),
            tokenWeights = takeWeighted(tokenWeights, RadioConfig.Storage.THEME_WEIGHT_LIMIT),
            artistStats = takeWeighted(artistStats, RadioConfig.Storage.ARTIST_STATS_LIMIT),
            candidateCache = RadioPool.capPoolSize(candidateCache),
        )
    }
}
