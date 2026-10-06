import type { PlayEndReason, RadioPlayRecord } from './types.ts'
import { intervalsDuration, mergeIntervals } from './feedback.ts'

export interface PlaybackTrackerState {
  playId: string
  trackKey: string
  startedAt: number
  durationMs?: number
  lastPositionMs: number
  lastSampleAt: number
  lastPlaying: boolean
  lastPlaybackRate: number
  intervals: Array<{ from: number, to: number }>
  wallClockMs: number
  seekedToEnd: boolean
  lastSeek?: { from: number, to: number, at: number }
  ended: boolean
  channel?: RadioPlayRecord['channel']
  sourcePlaylistId?: string
  sourceSeedTrackKey?: string
  sourceClusterId?: string
  sourceChartId?: string
  platform?: string
}

export interface PlaybackSampleInput {
  positionMs: number
  durationMs?: number
  playing: boolean
  now?: number
  playbackRate?: number
}

export const createPlaybackTracker = (input: {
  playId: string
  trackKey: string
  startedAt?: number
  durationMs?: number
  channel?: RadioPlayRecord['channel']
  sourcePlaylistId?: string
  sourceSeedTrackKey?: string
  sourceClusterId?: string
  sourceChartId?: string
  platform?: string
}): PlaybackTrackerState => {
  const now = input.startedAt ?? Date.now()
  return {
    playId: input.playId,
    trackKey: input.trackKey,
    startedAt: now,
    durationMs: input.durationMs,
    lastPositionMs: 0,
    lastSampleAt: now,
    lastPlaying: false,
    lastPlaybackRate: 1,
    intervals: [],
    wallClockMs: 0,
    seekedToEnd: false,
    ended: false,
    channel: input.channel,
    sourcePlaylistId: input.sourcePlaylistId,
    sourceSeedTrackKey: input.sourceSeedTrackKey,
    sourceClusterId: input.sourceClusterId,
    sourceChartId: input.sourceChartId,
    platform: input.platform,
  }
}

const isSeekJump = (actualDelta: number, expectedDelta: number) => {
  if (actualDelta < -500) return true
  return actualDelta > Math.max(3000, expectedDelta * 3 + 3000)
}

/** 记录显式拖动进度；拖到结尾不允许按完整收结算。 */
export const notePlaybackSeek = (tracker: PlaybackTrackerState, targetMs: number, now = Date.now()) => {
  const from = tracker.lastPositionMs
  tracker.lastSeek = { from, to: targetMs, at: now }
  if (tracker.durationMs && targetMs >= tracker.durationMs * 0.9) tracker.seekedToEnd = true
  tracker.lastPositionMs = Math.max(0, targetMs)
  tracker.lastSampleAt = now
}

export const observePlaybackSample = (tracker: PlaybackTrackerState, sample: PlaybackSampleInput) => {
  if (tracker.ended) return
  const now = sample.now ?? Date.now()
  if (sample.durationMs && sample.durationMs > 0) tracker.durationMs = sample.durationMs
  const position = Math.max(0, sample.positionMs)
  const rate = sample.playbackRate && sample.playbackRate > 0 ? sample.playbackRate : tracker.lastPlaybackRate

  if (tracker.lastPlaying && sample.playing) {
    const gap = Math.max(0, now - tracker.lastSampleAt)
    const expectedDelta = gap * rate
    const actualDelta = position - tracker.lastPositionMs

    if (isSeekJump(actualDelta, expectedDelta)) {
      // 拖动或循环跳转：跳过的区间不算听过。
      if (tracker.durationMs && position >= tracker.durationMs * 0.9 && actualDelta > 0) tracker.seekedToEnd = true
    } else if (actualDelta > 0) {
      tracker.intervals.push({ from: tracker.lastPositionMs, to: position })
      tracker.wallClockMs += Math.min(gap, Math.max(0, actualDelta / rate) + 2000)
    } else if (actualDelta >= 0) {
      tracker.wallClockMs += Math.min(gap, 2000)
    }
  }

  if (sample.playing && !tracker.lastPlaying) {
    // 从暂停/缓冲恢复：不把之前的空白算作收听。
    tracker.wallClockMs += 0
  }

  tracker.lastPositionMs = position
  tracker.lastSampleAt = now
  tracker.lastPlaying = sample.playing
  tracker.lastPlaybackRate = rate
}

export interface FinishPlaybackInput {
  endReason: PlayEndReason
  now?: number
  positionMs?: number
  durationMs?: number
  playing?: boolean
  playbackRate?: number
}

export const finishPlaybackTracker = (
  tracker: PlaybackTrackerState,
  input: FinishPlaybackInput,
): RadioPlayRecord => {
  const now = input.now ?? Date.now()
  tracker.ended = true
  if (input.durationMs && input.durationMs > 0) tracker.durationMs = input.durationMs
  const finalPosition = input.positionMs != null ? Math.max(0, input.positionMs) : undefined
  if (finalPosition != null && tracker.lastPlaying) {
    // 自然结束时把最后一次采样到结尾的区间补上；拖动到结尾的标记由 notePlaybackSeek/observe 负责。
    if (!tracker.seekedToEnd && finalPosition > tracker.lastPositionMs) {
      tracker.intervals.push({ from: tracker.lastPositionMs, to: finalPosition })
    }
  }
  if (input.endReason == 'natural_end' && tracker.durationMs && (finalPosition ?? tracker.lastPositionMs) >= tracker.durationMs * 0.9) {
    // 自然播完且没有 seekedToEnd 标记时允许 feedback 层按完整收听结算。
  }
  const intervals = mergeIntervals(tracker.intervals)
  const listenedMs = intervalsDuration(intervals)
  const durationMs = tracker.durationMs
  const record: RadioPlayRecord = {
    playId: tracker.playId,
    trackKey: tracker.trackKey,
    channel: tracker.channel,
    sourcePlaylistId: tracker.sourcePlaylistId,
    sourceSeedTrackKey: tracker.sourceSeedTrackKey,
    sourceClusterId: tracker.sourceClusterId,
    sourceChartId: tracker.sourceChartId,
    platform: tracker.platform,
    startedAt: tracker.startedAt,
    endedAt: now,
    intervals,
    listenedMs,
    wallClockMs: tracker.wallClockMs,
    durationMs,
    coverage: durationMs ? Math.max(0, Math.min(1, listenedMs / durationMs)) : 0,
    endReason: input.endReason,
    seekedToEnd: tracker.seekedToEnd,
    settled: false,
  }
  tracker.lastPositionMs = finalPosition ?? tracker.lastPositionMs
  tracker.lastSampleAt = now
  return record
}
