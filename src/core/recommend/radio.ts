/* eslint-disable require-atomic-updates */
import playerState from '@/store/player/state'
import { addTempPlayList, removeTempPlayList } from '@/core/player/tempPlayList'
import { addPlayedList, removePlayedList } from '@/core/player/playedList'
import { playNext, playTempPlayList } from '@/core/player/player'
import { buildTrackKey } from './trackKey.ts'
import { hasUserTrackAfterRadio } from './tempQueueOrder.ts'
import { recommendationEngine } from './index'
import type { RadioMode, RecommendQueueItem } from './types.ts'

let radioActive = false
let radioMode: RadioMode = 'radio'
let listenerRegistered = false
let pending: RecommendQueueItem[] = []
let committedKeys = new Set<string>()
let radioTrackKeys = new Set<string>()
let lastError: string | null = null
let refilling = false
let reorderingTempList = false

const RADIO_COMMIT_AHEAD = 2
const PENDING_LOW_WATER = 4

export const isRadioActive = () => radioActive

export const getRadioMode = () => radioMode

export const isRadioQueuedMusicInfo = (musicInfo: LX.Player.PlayMusic | null) => {
  if (!musicInfo || 'progress' in musicInfo) return false
  return radioTrackKeys.has(buildTrackKey(musicInfo))
}

const keyOf = (item: RecommendQueueItem) => buildTrackKey(item.musicInfo)

const countCommitted = () => {
  const present = new Set(playerState.tempPlayList.map(item => {
    const musicInfo = item.musicInfo
    return musicInfo && !('progress' in musicInfo) ? buildTrackKey(musicInfo) : ''
  }))
  for (const key of [...committedKeys]) {
    if (!present.has(key)) committedKeys.delete(key)
  }
  let count = 0
  for (const key of committedKeys) if (present.has(key)) count += 1
  return count
}

// 电台补位曲必须排在用户手动"稍后播放"的歌曲之后，否则"下一首"会先弹出补位曲
const moveRadioTracksAfterUserTracks = () => {
  const radioEntries: Array<{ musicInfo: LX.Music.MusicInfo, listId: string | null }> = []
  const radioFlags = playerState.tempPlayList.map(item => {
    const musicInfo = item.musicInfo
    if (musicInfo && !('progress' in musicInfo) && radioTrackKeys.has(buildTrackKey(musicInfo))) {
      radioEntries.push({ musicInfo, listId: item.listId })
      return true
    }
    return false
  })
  if (!hasUserTrackAfterRadio(radioFlags)) return
  reorderingTempList = true
  try {
    for (let i = radioFlags.length - 1; i >= 0; i--) {
      if (radioFlags[i]) removeTempPlayList(i)
    }
    addTempPlayList(radioEntries.map(({ musicInfo, listId }) => ({ musicInfo, listId })))
  } finally {
    reorderingTempList = false
  }
}

const removeCommittedFromPlayerQueue = (trackKey?: string) => {
  const indexes: number[] = []
  playerState.tempPlayList.forEach((item, index) => {
    const musicInfo = item.musicInfo
    if (!musicInfo || 'progress' in musicInfo) return
    const key = buildTrackKey(musicInfo)
    if (!radioTrackKeys.has(key)) return
    if (trackKey && key != trackKey) return
    indexes.push(index)
  })
  for (let i = indexes.length - 1; i >= 0; i--) removeTempPlayList(indexes[i])
  if (trackKey) {
    committedKeys.delete(trackKey)
    radioTrackKeys.delete(trackKey)
  }
}

const clearRadioPlayHistory = () => {
  for (let i = playerState.playedList.length - 1; i >= 0; i--) {
    const item = playerState.playedList[i]
    const musicInfo = item.musicInfo
    if (!item.isTempPlay || !musicInfo || 'progress' in musicInfo) continue
    if (!radioTrackKeys.has(buildTrackKey(musicInfo))) continue
    removePlayedList(i)
  }
}

const refillPending = async(force = false) => {
  if (refilling) return
  if (!radioActive && !force) return
  if (pending.length > PENDING_LOW_WATER && !force) return
  refilling = true
  try {
    const items = await recommendationEngine.getRecommendations(10)
    pending.push(...items)
    lastError = null
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
    console.log('radio refill pending error', error)
  } finally {
    refilling = false
  }
  void ensureCommitted()
}

const ensureCommitted = async() => {
  if (!radioActive) return
  let ahead = countCommitted()
  while (ahead < RADIO_COMMIT_AHEAD && pending.length) {
    const item = pending.shift()!
    const key = keyOf(item)
    if (radioTrackKeys.has(key)) continue
    committedKeys.add(key)
    radioTrackKeys.add(key)
    addTempPlayList([{ musicInfo: item.musicInfo, listId: null }])
    ahead += 1
  }
  if (pending.length <= PENDING_LOW_WATER) void refillPending()
}

const registerListeners = () => {
  if (listenerRegistered) return
  listenerRegistered = true
  global.state_event.on('playTempPlayListChanged', () => {
    if (!radioActive || reorderingTempList) return
    moveRadioTracksAfterUserTracks()
    void ensureCommitted()
  })
  global.app_event.on('musicToggled', () => {
    if (!radioActive) return
    const playMusicInfo = playerState.playMusicInfo
    const musicInfo = playMusicInfo.musicInfo
    if (!musicInfo || 'progress' in musicInfo) return
    if (!playMusicInfo.isTempPlay && playMusicInfo.listId) {
      stopRadio()
      return
    }
    if (playMusicInfo.isTempPlay && radioTrackKeys.has(buildTrackKey(musicInfo))) {
      addPlayedList({ musicInfo, listId: playMusicInfo.listId ?? '', isTempPlay: true })
    }
  })
  recommendationEngine.registerPendingProvider(() => pending)
  recommendationEngine.onTrackRemoved(trackKey => {
    pending = pending.filter(item => keyOf(item) != trackKey)
    removeCommittedFromPlayerQueue(trackKey)
  })
}

export const startRadio = async(mode: RadioMode = 'radio') => {
  registerListeners()
  if (radioActive && radioMode == mode) return
  if (radioActive) stopRadio()
  removeCommittedFromPlayerQueue()
  clearRadioPlayHistory()
  committedKeys = new Set()
  radioTrackKeys = new Set()
  pending = []
  lastError = null
  refilling = false
  radioActive = true
  radioMode = mode
  // stopRadio 会注销 pending provider，而 registerListeners 只在首次生效，重新开播时必须重新注册
  recommendationEngine.registerPendingProvider(() => pending)
  await recommendationEngine.startSession(mode)
  try {
    await recommendationEngine.warmUp(20)
    pending = await recommendationEngine.getRecommendations(20)
  } catch (error) {
    radioActive = false
    lastError = error instanceof Error ? error.message : String(error)
    throw error
  }
  if (!radioActive) return
  await ensureCommitted()
  if (committedKeys.size) {
    if (playerState.playMusicInfo.musicInfo && playerState.tempPlayList.length) {
      void playNext()
    } else {
      void playTempPlayList(0)
    }
  } else {
    radioActive = false
    const error = new Error(lastError ?? 'no_candidates')
    lastError = error.message
    throw error
  }
  void refillPending()
}

export const stopRadio = () => {
  refilling = false
  radioActive = false
  pending = []
  recommendationEngine.registerPendingProvider(null)
  removeCommittedFromPlayerQueue()
  clearRadioPlayHistory()
  committedKeys = new Set()
  radioTrackKeys = new Set()
  recommendationEngine.endSession()
}

export const getRadioQueueSummary = (count = 3) => {
  return recommendationEngine.peekQueue(count).map(item => item.musicInfo.name)
}

export interface RadioTrackHint {
  kind: 'artist' | 'playlist' | 'chart' | 'search' | 'radio'
  param?: string
}

/** 电台曲目的人话推荐线索（在队或最近播放过的都能查到）；非电台曲目返回 null。 */
export const getRadioTrackHint = (musicInfo: LX.Music.MusicInfo | null): RadioTrackHint | null => {
  if (!musicInfo || 'progress' in musicInfo) return null
  try {
    return recommendationEngine.explainTrack(buildTrackKey(musicInfo))
  } catch {
    return null
  }
}

export const getRadioStatus = () => {
  const engine = recommendationEngine.getRadioSummary()
  return {
    active: radioActive,
    pending: pending.length,
    committed: committedKeys.size,
    error: lastError,
    poolSize: engine.poolSize,
    queueSize: engine.queueSize,
    channels: engine.channels,
    channelShare: engine.channelShare,
    sessionHealth: engine.sessionHealth,
    recentArtistCounts: engine.recentArtistCounts,
    reasons: engine.reasons,
  }
}

export const resetRadioPreference = async() => {
  stopRadio()
  await recommendationEngine.resetProfile()
}
