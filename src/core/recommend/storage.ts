/* eslint-disable require-atomic-updates */
import { getData, saveData, removeData } from '@/plugins/storage'
import { createDefaultState, migrateRecommendationState } from './stateSchema.ts'
import { recommendationConfig } from './config.ts'
import type { RecommendationState } from './types.ts'

const RECOMMEND_STATE_KEY = 'xunyin_recommend_state_v2'
const LEGACY_STATE_KEY = 'recommend_state_v1'

let state: RecommendationState | null = null

export const loadState = async(): Promise<RecommendationState> => {
  if (state) return state
  let loaded: Partial<RecommendationState> | null = null
  try {
    loaded = await getData<Partial<RecommendationState>>(RECOMMEND_STATE_KEY)
  } catch {
    loaded = null
  }
  if (!loaded) {
    try {
      loaded = await getData<Partial<RecommendationState>>(LEGACY_STATE_KEY)
    } catch {
      loaded = null
    }
  }
  // eslint-disable-next-line require-atomic-updates
  state = migrateRecommendationState(loaded)
  return state
}

export const getState = (): RecommendationState => {
  if (!state) throw new Error('recommend state not loaded')
  return state
}

export const setState = (next: RecommendationState) => {
  state = next
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

/** 落盘前剥离候选缓存，避免序列化超大数组。 */
const serializeState = () => {
  if (!state) return null
  return {
    ...state,
    candidateCache: [],
  }
}

export const saveState = () => {
  if (!state) return
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    const payload = serializeState()
    if (!payload) return
    void saveData(RECOMMEND_STATE_KEY, payload).catch(() => {})
  }, recommendationConfig.storage.saveDebounceMs)
}

export const saveStateNow = async() => {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  const payload = serializeState()
  if (!payload) return
  await saveData(RECOMMEND_STATE_KEY, payload).catch(() => {})
}

export const flushState = async() => {
  await saveStateNow()
}

export const resetState = async() => {
  state = createDefaultState()
  await removeData(RECOMMEND_STATE_KEY).catch(() => {})
}

/** 裁剪常驻状态，避免各索引无限增长。 */
export const trimState = () => {
  if (!state) return
  state.recentlyPlayed = state.recentlyPlayed.slice(0, recommendationConfig.storage.recentlyPlayedLimit)
  state.radioHistory = state.radioHistory.slice(0, recommendationConfig.storage.radioHistoryLimit)
  const now = Date.now()
  state.radioHistory = state.radioHistory.filter(record => now - (record.endedAt ?? record.startedAt) < recommendationConfig.storage.radioHistoryRetentionMs)
  const ledgerEntries = Object.entries(state.settledPlayIds)
  if (ledgerEntries.length > recommendationConfig.storage.feedbackLedgerLimit) {
    ledgerEntries.sort((a, b) => b[1].timestamp - a[1].timestamp)
    state.settledPlayIds = Object.fromEntries(ledgerEntries.slice(0, recommendationConfig.storage.feedbackLedgerLimit))
  }
  const observedEntries = Object.entries(state.observedPlaylists)
  if (observedEntries.length > recommendationConfig.storage.playlistObservationLimit) {
    observedEntries.sort((a, b) => b[1].lastFetchedAt - a[1].lastFetchedAt)
    state.observedPlaylists = Object.fromEntries(observedEntries.slice(0, recommendationConfig.storage.playlistObservationLimit))
  }
  const trackEntries = Object.entries(state.tracks)
  if (trackEntries.length > recommendationConfig.storage.trackPreferenceLimit) {
    trackEntries.sort((a, b) => (b[1].lastPlayTime ?? 0) - (a[1].lastPlayTime ?? 0))
    state.tracks = Object.fromEntries(trackEntries.slice(0, recommendationConfig.storage.trackPreferenceLimit))
  }
  const exposureKeys = Object.keys(state.exposureCounts)
  if (exposureKeys.length > recommendationConfig.storage.exposureCountLimit) {
    const currentExposure = state.exposureCounts
    state.exposureCounts = Object.fromEntries(exposureKeys.slice(-recommendationConfig.storage.exposureCountLimit).map(key => [key, currentExposure[key]]))
  }
  const dislikedEntries = Object.entries(state.dislikedTracks)
  if (dislikedEntries.length > recommendationConfig.storage.dislikedTrackLimit) {
    dislikedEntries.sort((a, b) => b[1] - a[1])
    state.dislikedTracks = Object.fromEntries(dislikedEntries.slice(0, recommendationConfig.storage.dislikedTrackLimit))
  }
  const themeEntries = Object.entries(state.themeWeights ?? {})
  if (themeEntries.length > recommendationConfig.storage.themeWeightLimit) {
    themeEntries.sort((a, b) =>
      (b[1].positiveWeight + b[1].negativeWeight) - (a[1].positiveWeight + a[1].negativeWeight))
    state.themeWeights = Object.fromEntries(themeEntries.slice(0, recommendationConfig.storage.themeWeightLimit))
  }
  const tokenEntries = Object.entries(state.tokenWeights ?? {})
  if (tokenEntries.length > recommendationConfig.storage.themeWeightLimit) {
    tokenEntries.sort((a, b) =>
      (b[1].positiveWeight + b[1].negativeWeight) - (a[1].positiveWeight + a[1].negativeWeight))
    state.tokenWeights = Object.fromEntries(tokenEntries.slice(0, recommendationConfig.storage.themeWeightLimit))
  }
  const artistStatEntries = Object.entries(state.artistStats ?? {})
  if (artistStatEntries.length > recommendationConfig.storage.artistStatsLimit) {
    artistStatEntries.sort((a, b) =>
      (b[1].positiveWeight + b[1].negativeWeight) - (a[1].positiveWeight + a[1].negativeWeight))
    state.artistStats = Object.fromEntries(artistStatEntries.slice(0, recommendationConfig.storage.artistStatsLimit))
  }
  const embeddingEntries = Object.entries(state.audioEmbeddings ?? {})
  if (embeddingEntries.length > recommendationConfig.audioFeature.embeddingLimit) {
    embeddingEntries.sort((a, b) => b[1].analyzedAt - a[1].analyzedAt)
    state.audioEmbeddings = Object.fromEntries(embeddingEntries.slice(0, recommendationConfig.audioFeature.embeddingLimit))
  }
  for (const key of Object.keys(state.trackPlaylists)) {
    state.trackPlaylists[key] = state.trackPlaylists[key].slice(0, 20)
  }
}

export const getStateKey = () => RECOMMEND_STATE_KEY
