package cn.toside.music.core.recommend.radio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** 播放时长跟踪（RN `listening.ts`）单元测试：区间累加、拖动不计、拖到结尾不算完播。 */
class RadioListeningTest {
    private val start = RadioFixtures.NOW
    private val durationMs = 100_000L

    private fun tracker() =
        RadioListening.createTracker(
            playId = "play-1",
            trackKey = "ns:晴天__周杰伦",
            startedAt = start,
            durationMs = durationMs,
            channel = ChannelId.A,
        )

    @Test
    fun continuousPlaybackAccumulatesInterval() {
        val state = tracker()
        RadioListening.observeSample(state, 0, playing = false, now = start)
        RadioListening.observeSample(state, 10_000, playing = true, now = start + 10_000)
        RadioListening.observeSample(state, 20_000, playing = true, now = start + 20_000)
        assertEquals(1, state.intervals.size)
        assertEquals(10_000L, state.intervals.first().from)
        assertEquals(20_000L, state.intervals.first().to)

        val record = RadioListening.finish(state, PlayEndReason.NATURAL_END, start + 20_500, positionMs = 20_000)
        assertEquals(10_000L, record.listenedMs)
        assertEquals(0.1, record.coverage, 1e-9)
        assertEquals(PlayEndReason.NATURAL_END, record.endReason)
    }

    @Test
    fun seekJumpIsNotCountedAsListening() {
        val state = tracker()
        RadioListening.observeSample(state, 10_000, playing = true, now = start)
        RadioListening.observeSample(state, 20_000, playing = true, now = start + 10_000)
        // 跳到 60 秒：实际增量远超「时间差 × 倍速」→ 判为拖动，不累区间
        RadioListening.observeSample(state, 60_000, playing = true, now = start + 20_000)
        assertEquals(1, state.intervals.size)
        assertEquals(60_000L, state.lastPositionMs)
    }

    @Test
    fun seekToTailMarksSeekedToEnd() {
        val state = tracker()
        RadioListening.observeSample(state, 10_000, playing = true, now = start)
        RadioListening.noteSeek(state, 95_000, start + 5_000)
        assertTrue(state.seekedToEnd)
        val record = RadioListening.finish(state, PlayEndReason.USER_NEXT, start + 6_000, positionMs = 95_000)
        assertTrue(record.seekedToEnd)
        assertEquals(0L, record.listenedMs)
    }

    @Test
    fun finishBridgesLastSampleForNaturalEnd() {
        val state = tracker()
        RadioListening.observeSample(state, 90_000, playing = true, now = start)
        RadioListening.observeSample(state, 99_000, playing = true, now = start + 9_000)
        val record = RadioListening.finish(state, PlayEndReason.NATURAL_END, start + 10_000, positionMs = 100_000)
        assertEquals(10_000L, record.listenedMs)
        assertEquals(0.1, record.coverage, 1e-9)
        assertTrue(record.settled.not())
    }

    @Test
    fun pausedSamplesDoNotAccumulate() {
        val state = tracker()
        RadioListening.observeSample(state, 5_000, playing = false, now = start)
        RadioListening.observeSample(state, 5_000, playing = false, now = start + 5_000)
        assertTrue(state.intervals.isEmpty())
        val record = RadioListening.finish(state, PlayEndReason.USER_NEXT, start + 6_000, positionMs = 5_000)
        assertEquals(0L, record.listenedMs)
    }

    @Test
    fun finishedTrackerIgnoresFurtherSamples() {
        val state = tracker()
        RadioListening.observeSample(state, 10_000, playing = true, now = start)
        RadioListening.observeSample(state, 20_000, playing = true, now = start + 10_000)
        RadioListening.finish(state, PlayEndReason.NATURAL_END, start + 11_000)
        RadioListening.observeSample(state, 40_000, playing = true, now = start + 20_000)
        assertEquals(1, state.intervals.size)
    }

    @Test
    fun unknownDurationKeepsCoverageZero() {
        val state = RadioListening.createTracker(playId = "p", trackKey = "k", startedAt = start)
        RadioListening.observeSample(state, 1_000, playing = true, now = start)
        RadioListening.observeSample(state, 11_000, playing = true, now = start + 10_000)
        val record = RadioListening.finish(state, PlayEndReason.UNKNOWN, start + 11_000)
        assertEquals(0.0, record.coverage, 1e-9)
        assertEquals(10_000L, record.listenedMs)
    }
}
