package cn.toside.music.core.recommend.radio

import cn.toside.music.core.recommend.ThemeFeedback
import cn.toside.music.core.recommend.ThemePreference
import kotlinx.serialization.json.JsonObject
import kotlin.math.max
import kotlin.math.min

/**
 * 候选创建 —— RN `core/recommend/candidate.ts` 的纯规则子集。
 *
 * RN 的 `refreshExternalCandidates` 把网络抓取与候选构建混在一起；Kotlin 侧把
 * 「抓」留给 app 的 RadioRuntime，「建」保持纯函数，便于 JVM 单测与黄金 fixture。
 *
 * 【M3 退化】`similarity.ts` 的共现/分组不移植：`coOccurrence` 恒为 0，
 * 分组只认歌单自带 groupId；语种桶（L1~L4）整体缺席，不产出 langHint。
 */
data class CandidateBuildParams(
    val profile: RadioProfile,
    val now: Long,
    val exclusion: ExclusionContext,
    val themeWeights: Map<String, ThemePreference> = emptyMap(),
)

data class SimilarArtistContribution(
    val seedArtist: String,
    val artistName: String,
    val tracks: List<JsonObject>,
)

object RadioCandidates {
    private fun clamp01(value: Double): Double = max(0.0, min(1.0, value))

    fun isExcluded(
        musicInfo: JsonObject,
        params: CandidateBuildParams,
    ): Boolean = RadioFilter.getExclusionReason(musicInfo, params.exclusion) != null

    /** 自建歌单覆盖率置信度（RN `playlistCoverageConfidence`）。 */
    fun playlistCoverageConfidence(
        coverage: Double,
        pagesFetched: Int,
    ): Double = max(0.15, min(1.0, coverage)) * if (pagesFetched > 0) 1.0 else 0.2

    fun createPlaylistCandidates(
        observed: ObservedPlaylist,
        tracks: List<JsonObject>,
        params: CandidateBuildParams,
        channel: ChannelId,
    ): List<PoolCandidate> {
        val candidates = mutableListOf<PoolCandidate>()
        val profileSeedCount = max(1, params.profile.seedKeys.size)
        val affinity = RadioPool.observedAffinity(observed, profileSeedCount, 0.0)
        val themeFactor =
            RadioFeedback.themeAffinityFactor(
                ThemeFeedback.themeNetWeight(
                    params.themeWeights,
                    observed.category?.let { RadioTrackKeys.normalizeText(it) },
                    params.now,
                ),
            )
        for (musicInfo in tracks) {
            if (isExcluded(musicInfo, params)) continue
            val artistKeys = RadioTrackKeys.getArtistKeys(musicInfo)
            val artistAffinity =
                artistKeys.sumOf { artist ->
                    params.profile.topArtists
                        .firstOrNull { it.artist == artist }
                        ?.weight ?: 0.0
                }
            val reasons =
                if (observed.confirmed || observed.seedTrackKeys.isNotEmpty()) {
                    listOf("playlist:${observed.id}", "seed_overlap_confirmed")
                } else {
                    listOf("playlist:${observed.id}", "weak_theme_only")
                }
            candidates.add(
                RadioPool.createCandidate(
                    CreatePoolCandidateInput(
                        musicInfo = musicInfo,
                        channel = channel,
                        sourceId = observed.id,
                        now = params.now,
                        playlistIds = listOf(observed.id),
                        seedTrackKeys = observed.seedTrackKeys,
                        groupIds = observed.groupId?.let { listOf(it) } ?: emptyList(),
                        affinity = clamp01(max(affinity, artistAffinity * 0.5) * themeFactor),
                        coOccurrence = 0.0,
                        exploration = 1 - observed.confidence,
                        playCount = observed.playCount,
                        confirmedSeedPlaylist = observed.confirmed || observed.seedTrackKeys.isNotEmpty(),
                        reason = reasons.joinToString(","),
                    ),
                ),
            )
        }
        return candidates
    }

    fun createChartCandidates(
        tracks: List<Pair<JsonObject, Int>>,
        chartId: String,
        params: CandidateBuildParams,
    ): List<PoolCandidate> {
        val candidates = mutableListOf<PoolCandidate>()
        for ((musicInfo, rank) in tracks) {
            if (isExcluded(musicInfo, params)) continue
            val artistAffinity =
                RadioTrackKeys.getArtistKeys(musicInfo).sumOf { artist ->
                    params.profile.topArtists
                        .firstOrNull { it.artist == artist }
                        ?.weight ?: 0.0
                }
            val channels = if (artistAffinity > 0) listOf(ChannelId.D, ChannelId.A) else listOf(ChannelId.D)
            candidates.add(
                RadioPool.createCandidate(
                    CreatePoolCandidateInput(
                        musicInfo = musicInfo,
                        channel = ChannelId.D,
                        sourceId = "chart::$chartId",
                        now = params.now,
                        channels = channels,
                        chartId = chartId,
                        chartRank = rank,
                        exploration = 0.8,
                        affinity = max(0.15, artistAffinity * 0.6),
                        confirmedSeedPlaylist = false,
                        reason = "chart_rotation",
                    ),
                ),
            )
        }
        return candidates
    }

    /** 画像歌手热门歌直采：歌单共现是间接信号，强歌手自己的热门歌是直接信号。 */
    fun createArtistHitCandidates(
        tracks: List<JsonObject>,
        artist: String,
        params: CandidateBuildParams,
    ): List<PoolCandidate> {
        val top = params.profile.topArtists.firstOrNull { it.artist == artist }
        val affinity = max(0.5, min(1.0, top?.weight ?: 0.0))
        val candidates = mutableListOf<PoolCandidate>()
        for (musicInfo in tracks) {
            if (isExcluded(musicInfo, params)) continue
            candidates.add(
                RadioPool.createCandidate(
                    CreatePoolCandidateInput(
                        musicInfo = musicInfo,
                        channel = ChannelId.A,
                        sourceId = "artist_hits:$artist",
                        now = params.now,
                        affinity = affinity,
                        coOccurrence = 0.0,
                        exploration = 0.2,
                        confirmedSeedPlaylist = false,
                        reason = "artist_hits:$artist",
                    ),
                ),
            )
        }
        return candidates
    }

    /**
     * 相似歌手通道 E：候选按种子歌手画像权重传导亲和度（封顶 0.9）；
     * 探索度固定偏低——E 的职责是画像延伸，撞新仍归 C/D。
     */
    fun createSimilarArtistCandidates(
        contributions: List<SimilarArtistContribution>,
        params: CandidateBuildParams,
    ): List<PoolCandidate> {
        val candidates = mutableListOf<PoolCandidate>()
        for (contribution in contributions) {
            val seedWeight =
                params.profile.topArtists
                    .firstOrNull { it.artist == contribution.seedArtist }
                    ?.weight ?: 0.3
            val affinity = max(0.3, min(0.9, seedWeight * 0.8))
            for (musicInfo in contribution.tracks) {
                if (isExcluded(musicInfo, params)) continue
                candidates.add(
                    RadioPool.createCandidate(
                        CreatePoolCandidateInput(
                            musicInfo = musicInfo,
                            channel = ChannelId.E,
                            sourceId = "similar_artist:${contribution.seedArtist}",
                            now = params.now,
                            affinity = affinity,
                            coOccurrence = 0.0,
                            exploration = 0.3,
                            confirmedSeedPlaylist = false,
                            reason = "similar_artist:${contribution.seedArtist}",
                        ),
                    ),
                )
            }
        }
        return candidates
    }
}
