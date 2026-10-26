package cn.toside.music.core.recommend.radio

import kotlin.math.max
import kotlin.math.min

/**
 * 播放时长跟踪 —— RN `core/recommend/listening.ts` 原样移植。
 *
 * 采样把"实际在放的进度增量"累成收听区间：拖动/循环跳转不计入，
 * 拖到结尾单独标记（不允许按完整收结算）。所有时间由参数传入，测试可锁时钟。
 */
class PlaybackTrackerState(
    val playId: String,
    val trackKey: String,
    val startedAt: Long,
    var durationMs: Long?,
    val channel: ChannelId?,
    val sourcePlaylistId: String?,
    val sourceSeedTrackKey: String?,
    val sourceClusterId: String?,
    val sourceChartId: String?,
    val platform: String?,
) {
    var lastPositionMs: Long = 0
    var lastSampleAt: Long = startedAt
    var lastPlaying: Boolean = false
    var lastPlaybackRate: Double = 1.0
    val intervals: MutableList<Interval> = mutableListOf()
    var wallClockMs: Long = 0
    var seekedToEnd: Boolean = false
    var lastSeek: SeekMark? = null
    var ended: Boolean = false

    data class SeekMark(
        val from: Long,
        val to: Long,
        val at: Long,
    )
}

object RadioListening {
    fun createTracker(
        playId: String,
        trackKey: String,
        startedAt: Long,
        durationMs: Long? = null,
        channel: ChannelId? = null,
        sourcePlaylistId: String? = null,
        sourceSeedTrackKey: String? = null,
        sourceClusterId: String? = null,
        sourceChartId: String? = null,
        platform: String? = null,
    ): PlaybackTrackerState =
        PlaybackTrackerState(
            playId = playId,
            trackKey = trackKey,
            startedAt = startedAt,
            durationMs = durationMs,
            channel = channel,
            sourcePlaylistId = sourcePlaylistId,
            sourceSeedTrackKey = sourceSeedTrackKey,
            sourceClusterId = sourceClusterId,
            sourceChartId = sourceChartId,
            platform = platform,
        )

    private fun isSeekJump(
        actualDelta: Long,
        expectedDelta: Long,
    ): Boolean {
        if (actualDelta < -500) return true
        return actualDelta > max(3000.0, expectedDelta * 3.0 + 3000).toLong()
    }

    /** 记录显式拖动进度；拖到结尾不允许按完整收结算。 */
    fun noteSeek(
        tracker: PlaybackTrackerState,
        targetMs: Long,
        now: Long,
    ) {
        tracker.lastSeek = PlaybackTrackerState.SeekMark(tracker.lastPositionMs, targetMs, now)
        val duration = tracker.durationMs
        if (duration != null && targetMs >= duration * 0.9) tracker.seekedToEnd = true
        tracker.lastPositionMs = max(0L, targetMs)
        tracker.lastSampleAt = now
    }

    fun observeSample(
        tracker: PlaybackTrackerState,
        positionMs: Long,
        playing: Boolean,
        now: Long,
        durationMs: Long? = null,
        playbackRate: Double? = null,
    ) {
        if (tracker.ended) return
        if (durationMs != null && durationMs > 0) tracker.durationMs = durationMs
        val position = max(0L, positionMs)
        val rate =
            if (playbackRate != null && playbackRate > 0) {
                playbackRate
            } else {
                tracker.lastPlaybackRate
            }

        if (tracker.lastPlaying && playing) {
            val gap = max(0L, now - tracker.lastSampleAt)
            val expectedDelta = (gap * rate).toLong()
            val actualDelta = position - tracker.lastPositionMs

            if (isSeekJump(actualDelta, expectedDelta)) {
                // 拖动或循环跳转：跳过的区间不算听过
                val duration = tracker.durationMs
                if (duration != null && position >= duration * 0.9 && actualDelta > 0) tracker.seekedToEnd = true
            } else if (actualDelta > 0) {
                tracker.intervals.add(Interval(tracker.lastPositionMs, position))
                tracker.wallClockMs += min(gap, max(0L, (actualDelta / rate).toLong()) + 2000)
            } else if (actualDelta >= 0) {
                tracker.wallClockMs += min(gap, 2000)
            }
        }

        tracker.lastPositionMs = position
        tracker.lastSampleAt = now
        tracker.lastPlaying = playing
        tracker.lastPlaybackRate = rate
    }

    fun finish(
        tracker: PlaybackTrackerState,
        endReason: PlayEndReason,
        now: Long,
        positionMs: Long? = null,
        durationMs: Long? = null,
    ): RadioPlayRecord {
        tracker.ended = true
        if (durationMs != null && durationMs > 0) tracker.durationMs = durationMs
        val finalPosition = positionMs?.let { max(0L, it) }
        if (finalPosition != null && tracker.lastPlaying) {
            // 自然结束时把最后一次采样到结尾的区间补上；拖动到结尾的标记由 noteSeek/observe 负责
            if (!tracker.seekedToEnd && finalPosition > tracker.lastPositionMs) {
                tracker.intervals.add(Interval(tracker.lastPositionMs, finalPosition))
            }
        }
        val intervals = RadioFeedback.mergeIntervals(tracker.intervals)
        val listenedMs = RadioFeedback.intervalsDuration(intervals)
        val duration = tracker.durationMs
        val record =
            RadioPlayRecord(
                playId = tracker.playId,
                trackKey = tracker.trackKey,
                channel = tracker.channel,
                sourcePlaylistId = tracker.sourcePlaylistId,
                sourceSeedTrackKey = tracker.sourceSeedTrackKey,
                sourceClusterId = tracker.sourceClusterId,
                sourceChartId = tracker.sourceChartId,
                platform = tracker.platform,
                startedAt = tracker.startedAt,
                endedAt = now,
                intervals = intervals,
                listenedMs = listenedMs,
                wallClockMs = tracker.wallClockMs,
                durationMs = duration,
                coverage = if (duration != null && duration > 0) min(1.0, listenedMs.toDouble() / duration) else 0.0,
                endReason = endReason,
                seekedToEnd = tracker.seekedToEnd,
                settled = false,
            )
        tracker.lastPositionMs = finalPosition ?: tracker.lastPositionMs
        tracker.lastSampleAt = now
        return record
    }
}
