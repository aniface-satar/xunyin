import { createSession } from './session.ts'
import { createPlaylistPreference } from './feedback.ts'
import { applySeedWeights, computeSeedWeights, revokeSeedWeights } from './onboarding.ts'
import type { RecommendationState, PlaylistPreference, OnboardingState, ThemePreference } from './types.ts'

export const STATE_VERSION = 9

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
  // 但保留旧答案与其播种分量，重新提交时仍能精确回退旧初值。
  // v9 起这份播种分量会在下面被按新公式重播替换：真正跨版本留下的只有百分比原值 weights。
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
  const themeWeights: Record<string, ThemePreference> = { ...(raw.themeWeights ?? {}) }
  // v9 起问卷播种以 50% 为中轴（10% 要产生负权）。存量用户不会再过问卷，
  // 所以这里先用他们记录在案的老分量精确退掉，再拿一直没丢的百分比原值按新公式重播。
  // 只改代码不加这条闸门，这次修正对他们永远不落地。
  if ((raw.version ?? 0) < 9 && Object.keys(onboarding.weights).length > 0) {
    revokeSeedWeights(themeWeights, onboarding.seededThemeWeights)
    const seeds = computeSeedWeights(onboarding.weights)
    applySeedWeights(themeWeights, seeds)
    onboarding.seededThemeWeights = seeds
  }
  // 版本问卷（曾写到 v10/v11）已整体下线，回到两问版。只回退代码不够：那一版往状态里塞了三样东西，
  // 不在读档时擦掉，推荐会比两问版更窄，用户看到的还是"回不去"。
  // ① weights 里的 no_* 勾选（两问版没有这些选项，留着永远清不掉）；
  // ② 拆出去的 remix 风格滑条——两问版原本由 dj 一条覆盖，值并回 dj 才不丢偏好；
  // ③ seededTokenWeights 那份负初值已经累加进 tokenWeights（dj/remix/live/翻唱…），
  //    不退掉会继续压这些歌名词的排序权重，属于"代码回去了、分数没回去"。
  const weights: Record<string, number> = { ...onboarding.weights }
  for (const key of Object.keys(weights)) {
    if (key.startsWith('no_')) delete weights[key]
  }
  if (weights.remix != null) {
    if (weights.dj == null) weights.dj = weights.remix
    delete weights.remix
  }
  onboarding.weights = weights
  const tokenWeights: Record<string, ThemePreference> = { ...(raw.tokenWeights ?? {}) }
  const legacySeededTokens = (raw.onboarding as (OnboardingState & { seededTokenWeights?: Record<string, number> }) | undefined)?.seededTokenWeights
  if (legacySeededTokens) revokeSeedWeights(tokenWeights, legacySeededTokens)
  return {
    ...base,
    ...raw,
    version: STATE_VERSION,
    tracks: raw.tracks ?? {},
    playlists,
    themeWeights,
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
    tokenWeights,
    channelBandit: raw.channelBandit ?? {},
    artistStats: raw.artistStats ?? {},
    audioEmbeddings: raw.audioEmbeddings ?? {},
    audioAnalysis: raw.audioAnalysis ?? { dayKey: '', dayCount: 0, lastRunAt: 0 },
    onboarding,
  }
}

