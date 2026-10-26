package cn.toside.music.core.recommend.radio

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.math.pow

/** M2 电台单测的公共夹具：可预测 RNG、musicInfo 构造、最终队列条目构造。 */
internal object RadioFixtures {
    const val NOW = 1_700_000_000_000L
    const val DAY = 86_400_000L

    fun musicInfo(
        id: String,
        name: String,
        singer: String,
        album: String = "",
        source: String = "kw",
    ): JsonObject =
        buildJsonObject {
            put("id", id)
            put("name", name)
            put("singer", singer)
            put("source", source)
            put("interval", "03:20")
            put(
                "meta",
                buildJsonObject {
                    put("songId", id)
                    put("albumName", album)
                },
            )
        }

    /** LCG，返回 [0,1)；相同种子在同一调用序列下完全可复现。 */
    fun seededRandom(seed: Long): () -> Double {
        var state = seed
        return {
            state = state * 6364136223846793005L + 1442695040888963407L
            (state ushr 11).toDouble() / 2.0.pow(53)
        }
    }

    fun finalItem(
        key: String,
        channels: List<ChannelId>,
        weight: Double = 1.0,
        artistKeys: List<String> = listOf(key),
        albumKey: String = "",
        playlistId: String? = null,
        seedKey: String? = null,
        chartId: String? = null,
    ): FinalQueueItem =
        FinalQueueItem(
            key = key,
            channels = channels,
            channelWeights = channels.associateWith { weight },
            channelSourceIds = emptyMap(),
            primaryArtist = artistKeys.firstOrNull().orEmpty(),
            artistKeys = artistKeys,
            albumKey = albumKey,
            sourcePlaylistId = playlistId,
            sourceSeedTrackKey = seedKey,
            sourceChartId = chartId,
            groupIds = emptyList(),
            exposureCount = 0,
            weight = weight,
        )

    fun quotaPlan(quotas: Map<ChannelId, Int>): ChannelQuotaPlan =
        ChannelQuotaPlan(
            quotas = Channels.emptyCounts().apply { putAll(quotas) },
            total = quotas.values.sum(),
            reasons = emptyMap(),
        )

    fun sessionTrack(
        key: String,
        ratio: Double? = null,
        liked: Boolean? = null,
        channel: ChannelId? = ChannelId.A,
        artistKeys: List<String> = emptyList(),
        playlistId: String? = null,
        timestamp: Long = NOW,
    ): SessionTrack =
        SessionTrack(
            trackKey = key,
            timestamp = timestamp,
            listenRatio = ratio,
            liked = liked,
            channel = channel,
            sourcePlaylistId = playlistId,
            artistKeys = artistKeys,
        )

    fun playRecord(
        endReason: PlayEndReason,
        intervals: List<Interval>,
        durationMs: Long? = 300_000,
        listenedMs: Long = intervals.sumOf { it.to - it.from },
        seekedToEnd: Boolean = false,
        playlistId: String? = "pl-1",
        trackKey: String = "ns:song__artist",
        channel: ChannelId? = ChannelId.A,
        playId: String = "play-1",
    ): RadioPlayRecord =
        RadioPlayRecord(
            playId = playId,
            trackKey = trackKey,
            channel = channel,
            sourcePlaylistId = playlistId,
            startedAt = NOW - 10 * 60_000,
            endedAt = NOW,
            intervals = intervals,
            listenedMs = listenedMs,
            wallClockMs = listenedMs,
            durationMs = durationMs,
            coverage = durationMs?.takeIf { it > 0 }?.let { (listenedMs.toDouble() / it).coerceAtMost(1.0) } ?: 0.0,
            endReason = endReason,
            seekedToEnd = seekedToEnd,
        )
}
