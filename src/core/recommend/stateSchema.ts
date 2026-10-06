import { createSession } from './session.ts'
import { createPlaylistPreference } from './feedback.ts'
import type { RecommendationState, PlaylistPreference } from './types.ts'

export const STATE_VERSION = 6

export const createDefaultState = (): RecommendationState => ({
  version: STATE_VERSION,
  tracks: {},
  playlists: {},
  themeWeights: {},
  trackPlaylists: {},
  dislikedTracks: {},
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
  return {
    ...base,
    ...raw,
    version: STATE_VERSION,
    tracks: raw.tracks ?? {},
    playlists,
    themeWeights: raw.themeWeights ?? {},
    trackPlaylists: raw.trackPlaylists ?? {},
    dislikedTracks: raw.dislikedTracks ?? {},
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
  }
}

