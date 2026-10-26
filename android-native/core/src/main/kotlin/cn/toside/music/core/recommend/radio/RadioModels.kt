package cn.toside.music.core.recommend.radio

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * 个性电台 M2 的数据模型 —— RN `core/recommend/types.ts` 的移植。
 *
 * 【M3 退化】`lang` / `langHint` 与语言桶配额依赖 `language.ts`（M3），
 * 这里整体缺席；候选与最终队列都不带语种字段，选曲不做语言硬配额。
 */
enum class ChannelId { A, B, C, D, E }

val CHANNEL_IDS: List<ChannelId> = listOf(ChannelId.A, ChannelId.B, ChannelId.C, ChannelId.D, ChannelId.E)

enum class RadioMode { RADIO, EXPLORE }

enum class PlayEndReason {
    NATURAL_END,
    USER_NEXT,
    USER_SELECT_OTHER,
    DISLIKE,
    PLAY_ERROR,
    LOAD_ERROR,
    APP_DESTROY,
    RADIO_SWITCH,
    UNKNOWN,
}

enum class CandidateSource { RELATED, CHART }

@Serializable
data class ChannelBanditArm(
    val alpha: Double,
    val beta: Double,
    val lastUpdatedAt: Long,
)

@Serializable
data class TrackPreference(
    val trackKey: String,
    val score: Double = 0.0,
    val playCount: Int = 0,
    val completeCount: Int = 0,
    val skipCount: Int = 0,
    val earlySkipCount: Int = 0,
    val likeCount: Int = 0,
    val dislikeCount: Int = 0,
    val repeatCount: Int = 0,
    val addToPlaylistCount: Int = 0,
    val averageListenRatio: Double = 0.0,
    val exposureCount: Int = 0,
    val lastPlayTime: Long = 0,
    val lastPositiveTime: Long = 0,
    val lastNegativeTime: Long = 0,
)

@Serializable
data class PlaylistPreference(
    val playlistId: String,
    val score: Double = 0.0,
    val positiveCount: Int = 0,
    val negativeCount: Int = 0,
    val positiveWeight: Double = 0.0,
    val negativeWeight: Double = 0.0,
    val lastDecayTime: Long = 0,
    val exposureCount: Int = 0,
    val consecutiveNegativeCount: Int = 0,
    val lastUsedTime: Long = 0,
    val distinctNegativeTracks: Int = 0,
    val lastNegativeTrackKey: String? = null,
    val cooldownUntil: Long? = null,
    val cooldownFactor: Double? = null,
    val instantSkipCount: Int = 0,
)

@Serializable
data class SessionTrack(
    val trackKey: String,
    val timestamp: Long,
    val listenRatio: Double? = null,
    val liked: Boolean? = null,
    val source: String? = null,
    val channel: ChannelId? = null,
    val sourcePlaylistId: String? = null,
    val sourceSeedTrackKey: String? = null,
    val sourceClusterId: String? = null,
    val sourceChartId: String? = null,
    val artistKeys: List<String> = emptyList(),
)

@Serializable
data class SessionPreference(
    val recentTracks: List<SessionTrack> = emptyList(),
    val recentChannels: List<ChannelId> = emptyList(),
)

@Serializable
data class Interval(
    val from: Long,
    val to: Long,
)

@Serializable
data class RadioPlayRecord(
    val playId: String,
    val trackKey: String,
    val channel: ChannelId? = null,
    val sourcePlaylistId: String? = null,
    val sourceSeedTrackKey: String? = null,
    val sourceClusterId: String? = null,
    val sourceChartId: String? = null,
    val platform: String? = null,
    val startedAt: Long,
    val endedAt: Long? = null,
    val intervals: List<Interval> = emptyList(),
    val listenedMs: Long = 0,
    val wallClockMs: Long = 0,
    val durationMs: Long? = null,
    val coverage: Double = 0.0,
    val endReason: PlayEndReason? = null,
    val nameTokens: List<String> = emptyList(),
    val artistKeys: List<String> = emptyList(),
    val explicitLike: Boolean? = null,
    val explicitDislike: Boolean? = null,
    val addToPlaylistListId: String? = null,
    val settled: Boolean = false,
    val settlementReasons: List<String> = emptyList(),
    val seekedToEnd: Boolean = false,
)

/**
 * 候选池条目。`channels` / `channelSourceId` 的 value 用通道名字符串，
 * 保证 JSON 落盘时 map key 是可序列化的字符串（kotlinx JSON 不接受枚举键）。
 */
@Serializable
data class PoolCandidate(
    val trackKey: String,
    val musicInfo: JsonObject,
    val channels: List<ChannelId> = emptyList(),
    val channelSourceId: Map<String, String> = emptyMap(),
    val playlistIds: List<String> = emptyList(),
    val seedTrackKeys: List<String> = emptyList(),
    val groupIds: List<String> = emptyList(),
    val chartId: String? = null,
    val chartRank: Int? = null,
    val publishedTime: Long? = null,
    val playCount: Long? = null,
    val affinity: Double = 0.0,
    val coOccurrence: Double = 0.0,
    val exploration: Double = 0.0,
    val localFrequency: Int = 1,
    val observedPlaylistFrequency: Int = 0,
    val exposureCount: Int = 0,
    val albumKey: String = "",
    val artistKeys: List<String> = emptyList(),
    val primaryArtist: String = "",
    val addedAt: Long = 0,
    val confirmedSeedPlaylist: Boolean = false,
    val reasons: List<String> = emptyList(),
)

/** 候选池里同一首歌的语料来源（歌单观察记录）。 */
@Serializable
data class ObservedPlaylist(
    val id: String,
    val source: String,
    val name: String = "",
    val author: String? = null,
    val desc: String? = null,
    val category: String? = null,
    val playCount: Long = 0,
    val totalTracks: Int = 0,
    val trackKeys: List<String> = emptyList(),
    val pagesFetched: Int = 0,
    val seedTrackKeys: List<String> = emptyList(),
    val seedOverlap: Int = 0,
    val weakThemeScore: Double = 0.0,
    val fetchedAt: Long = 0,
    val confidence: Double = 1.0,
    val groupId: String? = null,
    val confirmed: Boolean = false,
)

/** 最终队列评分项（对照 RN `diversity.ts` 的 FinalQueueItem；M3 的多样性字段不移植）。 */
data class FinalQueueItem(
    val key: String,
    val channels: List<ChannelId>,
    val channelWeights: Map<ChannelId, Double>,
    val channelSourceIds: Map<String, String>,
    val primaryArtist: String,
    val artistKeys: List<String>,
    val albumKey: String,
    val sourcePlaylistId: String?,
    val sourceSeedTrackKey: String?,
    val sourceChartId: String?,
    val groupIds: List<String>,
    val exposureCount: Int,
    val weight: Double,
)

@Serializable
data class RecommendQueueItem(
    val musicInfo: JsonObject,
    val source: CandidateSource = CandidateSource.RELATED,
    val channel: ChannelId = ChannelId.A,
    val sourcePlaylistId: String? = null,
    val sourceSeedTrackKey: String? = null,
    val sourceClusterId: String? = null,
    val sourceChartId: String? = null,
    val batchId: Int = 0,
    val playId: String? = null,
    val reason: String? = null,
)

data class ChannelQuotaPlan(
    val quotas: Map<ChannelId, Int>,
    val total: Int,
    val reasons: Map<ChannelId, String>,
)

data class SessionHealth(
    val negativeStreak: Int,
    val positiveStreak: Int,
    val negativeRate: Double,
    val explorationNegativeRate: Double?,
    val explorationFactor: Double,
    val safeMode: Boolean,
    val sampleSize: Int,
)

data class SessionPenalties(
    val artistPenalty: Map<String, Double>,
    val playlistPenalty: Map<String, Double>,
)

data class TrackEffect(
    val key: String,
    val scoreDelta: Double,
    val playCountDelta: Int? = null,
    val completeCountDelta: Int? = null,
    val skipCountDelta: Int? = null,
    val earlySkipCountDelta: Int? = null,
    val likeCountDelta: Int? = null,
    val dislikeCountDelta: Int? = null,
    val repeatDelta: Int? = null,
    val addToPlaylistDelta: Int? = null,
    val averageListenRatio: Double? = null,
)

data class PlaylistEffect(
    val id: String,
    val positiveDelta: Double,
    val negativeDelta: Double,
    val negativeTrackKey: String? = null,
    val instantSkip: Boolean = false,
)

@Serializable
data class LedgerEntry(
    val timestamp: Long,
    val trackReward: Double = 0.0,
    val playlistPositive: Double = 0.0,
    val playlistNegative: Double = 0.0,
    val explicitNegative: Boolean = false,
    val explicitLike: Boolean = false,
    val explicitAdd: Boolean = false,
    val explicitRepeat: Boolean = false,
    val completion: Boolean = false,
    val earlySkip: Boolean = false,
    val implicitSettled: Boolean = false,
    val banditCounted: Boolean = false,
)

data class SettlementResult(
    val ledgerEntry: LedgerEntry,
    val track: TrackEffect? = null,
    val playlist: PlaylistEffect? = null,
    val excludeTrackKey: String? = null,
    val reasons: List<String> = emptyList(),
)

/** 画像输入（RN `RadioProfile` 的 M2 子集；语种与方向证据属 M3，不移植）。 */
data class RadioProfile(
    val seedKeys: Set<String> = emptySet(),
    val seeds: List<RadioSeed> = emptyList(),
    val topArtists: List<RadioArtist> = emptyList(),
)

data class RadioSeed(
    val trackKey: String,
    val score: Double,
    val musicInfo: JsonObject,
    val primaryArtist: String,
)

data class RadioArtist(
    val artist: String,
    val weight: Double,
)
