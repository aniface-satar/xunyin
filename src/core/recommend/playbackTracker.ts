import BackgroundTimer from 'react-native-background-timer'
import playerState from '@/store/player/state'
import { getDuration, getPosition } from '@/plugins/player'
import { createPlaybackTracker, finishPlaybackTracker, notePlaybackSeek, observePlaybackSample, type PlaybackTrackerState } from './listening.ts'
import { getDurationMs } from './trackKey.ts'
import type { RadioPlayRecord } from './types.ts'

export interface StartedTrackMeta {
  playId: string
  trackKey: string
  musicInfo: LX.Music.MusicInfo
  channel?: RadioPlayRecord['channel']
  sourcePlaylistId?: string
  sourceSeedTrackKey?: string
  sourceClusterId?: string
  sourceChartId?: string
  platform?: string
}

let tracker: PlaybackTrackerState | null = null
let sampleTimer: number | null = null
let listenersRegistered = false
let nativePlaying = false
let lastKnownDurationMs = 0
let finishPromise: Promise<RadioPlayRecord | null> | null = null

const readNativeProgress = async(): Promise<{ positionMs: number, durationMs: number, playing: boolean }> => {
  try {
    const [position, duration] = await Promise.all([
      getPosition().catch(() => 0),
      getDuration().catch(() => 0),
    ])
    const durationMs = duration && duration > 0 ? duration * 1000 : lastKnownDurationMs
    if (durationMs > 0) lastKnownDurationMs = durationMs
    return {
      positionMs: Math.max(0, (position || 0) * 1000),
      durationMs,
      playing: nativePlaying,
    }
  } catch {
    return { positionMs: tracker?.lastPositionMs ?? 0, durationMs: lastKnownDurationMs, playing: nativePlaying }
  }
}

const sampleNow = async() => {
  if (!tracker) return
  const progress = await readNativeProgress()
  observePlaybackSample(tracker, {
    positionMs: progress.positionMs,
    durationMs: progress.durationMs,
    playing: progress.playing,
    now: Date.now(),
    playbackRate: playerState.playRate || 1,
  })
}

const startSampler = () => {
  if (sampleTimer != null) return
  sampleTimer = BackgroundTimer.setInterval(() => {
    void sampleNow()
  }, 1500)
  void sampleNow()
}

const stopSampler = () => {
  if (sampleTimer == null) return
  BackgroundTimer.clearInterval(sampleTimer)
  sampleTimer = null
}

const registerPlayerListeners = () => {
  if (listenersRegistered) return
  listenersRegistered = true
  global.app_event.on('playerPlaying', () => {
    nativePlaying = true
    startSampler()
    void sampleNow()
  })
  global.app_event.on('pause', () => {
    nativePlaying = false
    void sampleNow()
  })
  global.app_event.on('playerPause', () => {
    nativePlaying = false
    void sampleNow()
  })
  global.app_event.on('playerWaiting', () => {
    // 缓冲不计入有效收听区间。
    nativePlaying = false
  })
  global.app_event.on('setProgress', (progress: number) => {
    if (!tracker) return
    notePlaybackSeek(tracker, Math.max(0, progress * 1000), Date.now())
  })
  global.app_event.on('stop', () => {
    nativePlaying = false
  })
}

const initialDurationMs = (musicInfo: LX.Music.MusicInfo): number | undefined => {
  const track = musicInfo as { interval?: string | null, meta?: { interval?: string | null } | null }
  return getDurationMs(track)
}

export const startRadioPlaybackTracking = (meta: StartedTrackMeta) => {
  registerPlayerListeners()
  finishPromise = null
  stopSampler()
  lastKnownDurationMs = initialDurationMs(meta.musicInfo) ?? 0
  nativePlaying = false
  if (tracker && !tracker.ended && tracker.playId != meta.playId) {
    // 切换歌曲时旧记录尚未结算，先由调用方 finish；这里仅标记，避免丢记录。
  }
  tracker = createPlaybackTracker({
    playId: meta.playId,
    trackKey: meta.trackKey,
    startedAt: Date.now(),
    durationMs: lastKnownDurationMs || undefined,
    channel: meta.channel,
    sourcePlaylistId: meta.sourcePlaylistId,
    sourceSeedTrackKey: meta.sourceSeedTrackKey,
    sourceClusterId: meta.sourceClusterId,
    sourceChartId: meta.sourceChartId,
    platform: meta.platform,
  })
  startSampler()
  return tracker
}

export const finishRadioPlaybackTracking = async(
  endReason: NonNullable<RadioPlayRecord['endReason']>,
): Promise<RadioPlayRecord | null> => {
  if (finishPromise) return finishPromise
  finishPromise = (async() => {
    if (!tracker || tracker.ended) return null
    const progress = await readNativeProgress()
    const record = finishPlaybackTracker(tracker, {
      endReason,
      now: Date.now(),
      positionMs: progress.positionMs,
      durationMs: progress.durationMs,
      playing: progress.playing,
      playbackRate: playerState.playRate || 1,
    })
    tracker = null
    nativePlaying = false
    stopSampler()
    return record
  })()
  return finishPromise.finally(() => { finishPromise = null })
}

export const getActivePlaybackTracker = () => tracker

export const hasActiveRadioPlayback = () => tracker != null

export const cancelRadioPlaybackTracking = () => {
  tracker = null
  nativePlaying = false
  stopSampler()
}
