import { createSession } from './session.ts'
import { createPlaylistPreference } from './feedback.ts'
import type { RecommendationState, PlaylistPreference, OnboardingState } from './types.ts'

export const STATE_VERSION = 8

export const createDefaultOnboarding = (): OnboardingState => ({
  completed: false,
  weights: {},
  seededThemeWeights: {},
})

export const createDefaultState = (): RecommendationState => ({
  version: STATE_VERSION,
  tracks: {},
  playlists: {},
  themeWeights: {},
  trackPlaylists: {},
  dislikedTracks: {},
  hiddenPlaylists: {},
  recentlyPlayed: [],
  session: createSession(),
  radioHistory: [],
  settledPlayIds: {},
  observedPlaylists: {},
  trackPlaylistIndex: {},
  candidateCache: [],
  candidateCacheFetchedAt: 0,
  sourceCooldowns: {},
  exposureCounts: {},
  tokenWeights: {},
  channelBandit: {},
  artistStats: {},
  audioEmbeddings: {},
  audioAnalysis: { dayKey: '', dayCount: 0, lastRunAt: 0 },
  onboarding: createDefaultOnboarding(),
})

const migratePlaylistPreference = (playlistId: string, raw: Partial<PlaylistPreference> | undefined): PlaylistPreference => {
  const base = createPlaylistPreference(playlistId)
  if (!raw) return base
  const positiveWeight = raw.positiveWeight ?? raw.positiveCount ?? 0
  const negativeWeight = raw.negativeWeight ?? raw.negativeCount ?? 0
  return {
    ...base,
    ...raw,
    playlistId,
    positiveWeight,
    negativeWeight,
    lastDecayTime: raw.lastDecayTime ?? Date.now(),
  }
}

/** 兼容旧版 v1 数据，避免升级后清空学习结果。 */
export const migrateRecommendationState = (raw: Partial<RecommendationState> | null | undefined): RecommendationState => {
  const base = createDefaultState()
  if (!raw || typeof raw != 'object') return base
  const session = raw.session
    ? { ...base.session, ...raw.session, recentChannels: raw.session.recentChannels ?? [] }
    : base.session
  const playlists: Record<string, PlaylistPreference> = {}
  for (const [playlistId, pref] of Object.entries(raw.playlists ?? {})) {
    playlists[playlistId] = migratePlaylistPreference(playlistId, pref)
  }
  // v3 召回与限额逻辑已校准，旧候选池按作废处理；学习数据（tracks/playlists/session）保留
  const dropLegacyCandidates = (raw.version ?? 0) < 3
  // v8（1.1.0）起问卷升级为"人人填一次"：低版本存量数据一律重置 completed，
  // 但保留旧答案与其播种分量，重新提交时仍能精确回退旧初值
  const onboarding: OnboardingState = (raw.version ?? 0) >= 8 && raw.onboarding
    ? {
        completed: !!raw.onboarding.completed,
        weights: raw.onboarding.weights ?? {},
        seededThemeWeights: raw.onboarding.seededThemeWeights ?? {},
      }
    : {
        completed: false,
        weights: raw.onboarding?.weights ?? {},
        seededThemeWeights: raw.onboarding?.seededThemeWeights ?? {},
      }
  return {
    ...base,
    ...raw,
    version: STATE_VERSION,
    tracks: raw.tracks ?? {},
    playlists,
    themeWeights: raw.themeWeights ?? {},
    trackPlaylists: raw.trackPlaylists ?? {},
    dislikedTracks: raw.dislikedTracks ?? {},
    hiddenPlaylists: raw.hiddenPlaylists ?? {},
    recentlyPlayed: raw.recentlyPlayed ?? [],
    session,
    radioHistory: raw.radioHistory ?? [],
    settledPlayIds: raw.settledPlayIds ?? {},
    observedPlaylists: raw.observedPlaylists ?? {},
    trackPlaylistIndex: raw.trackPlaylistIndex ?? {},
    candidateCache: dropLegacyCandidates ? [] : raw.candidateCache ?? [],
    candidateCacheFetchedAt: dropLegacyCandidates ? 0 : raw.candidateCacheFetchedAt ?? 0,
    sourceCooldowns: raw.sourceCooldowns ?? {},
    exposureCounts: raw.exposureCounts ?? {},
    tokenWeights: raw.tokenWeights ?? {},
    channelBandit: raw.channelBandit ?? {},
    artistStats: raw.artistStats ?? {},
    audioEmbeddings: raw.audioEmbeddings ?? {},
    audioAnalysis: raw.audioAnalysis ?? { dayKey: '', dayCount: 0, lastRunAt: 0 },
    onboarding,
  }
}

