import { recommendationConfig } from './config.ts'
import type { ObservedPlaylist, RadioPlayRecord, TrackPlaylistIndexEntry } from './types.ts'

export const computeCoOccurrence = (commonPlaylistCount: number, playlistCountA: number, playlistCountB: number) => {
  if (playlistCountA <= 0 || playlistCountB <= 0) return 0
  return commonPlaylistCount / Math.sqrt(playlistCountA * playlistCountB)
}

export const computePlaylistAffinity = (overlap: number, profileSize: number, playlistSize: number) => {
  if (profileSize <= 0 || playlistSize <= 0) return 0
  return overlap / Math.sqrt(profileSize * playlistSize)
}

export const decayWeight = (value: number, elapsedMs: number, halfLifeDays: number) => {
  if (value == 0) return 0
  const halfLifeMs = Math.max(1, halfLifeDays) * 86400000
  return value * Math.pow(0.5, Math.max(0, elapsedMs) / halfLifeMs)
}

/** 歌单反馈质量：初始 0.5，(2+P)/(4+P+N)。 */
export const computeFeedbackQuality = (
  positiveWeight: number,
  negativeWeight: number,
  positiveCount = 0,
  negativeCount = 0,
) => {
  const p = Math.max(0, positiveWeight) + positiveCount * 0
  const n = Math.max(0, negativeWeight) + negativeCount * 0
  return (2 + p) / (4 + p + n)
}

export const computeExposureScore = (exposureCount: number) => {
  const scale = recommendationConfig.playlistScore.explorationExposureScale
  return 1 / (1 + Math.max(0, exposureCount) / Math.max(1, scale))
}

export interface PlaylistScoreParts {
  affinity: number
  feedback: number
  exploration: number
}

export const computePlaylistScore = (
  affinity: number,
  positiveWeight: number,
  negativeWeight: number,
  exposureCount: number,
): { score: number, parts: PlaylistScoreParts } => {
  const weights = recommendationConfig.playlistScore.weights
  const parts: PlaylistScoreParts = {
    affinity: Math.max(0, Math.min(1, affinity)),
    feedback: Math.max(0, Math.min(1, computeFeedbackQuality(positiveWeight, negativeWeight))),
    exploration: computeExposureScore(exposureCount),
  }
  return {
    score: weights.affinity * parts.affinity + weights.feedback * parts.feedback + weights.exploration * parts.exploration,
    parts,
  }
}

export const computePlaylistSimilarity = (tracksA: readonly string[], tracksB: readonly string[]): number => {
  if (!tracksA.length || !tracksB.length) return 0
  const setA = new Set(tracksA)
  const setB = new Set(tracksB)
  let intersection = 0
  for (const key of setA) {
    if (setB.has(key)) intersection += 1
  }
  const union = setA.size + setB.size - intersection
  return union > 0 ? intersection / union : 0
}

/**
 * 以重合度对歌单做并查集分组；低覆盖采样时相似度会乘上置信度，避免过度合并。
 */
export const groupSimilarPlaylists = (
  playlists: readonly ObservedPlaylist[],
  threshold = recommendationConfig.candidatePool.similarPlaylistThreshold,
): Record<string, string> => {
  const parent: Record<string, string> = {}
  for (const playlist of playlists) parent[playlist.id] = playlist.id
  const find = (id: string): string => parent[id] == id ? id : (parent[id] = find(parent[id]))
  const union = (a: string, b: string) => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA != rootB) parent[rootB] = rootA
  }

  for (let i = 0; i < playlists.length; i++) {
    for (let j = i + 1; j < playlists.length; j++) {
      const a = playlists[i]
      const b = playlists[j]
      const similarity = computePlaylistSimilarity(a.fetchedTracks, b.fetchedTracks) *
        Math.min(1, Math.max(0.2, a.confidence)) *
        Math.min(1, Math.max(0.2, b.confidence))
      if (similarity >= threshold) union(a.id, b.id)
    }
  }

  const groups: Record<string, string> = {}
  for (const playlist of playlists) groups[playlist.id] = `group:${find(playlist.id)}`
  return groups
}

/**
 * 歌曲 -> 已观察歌单倒排索引，带容量上限。
 */
export const buildTrackPlaylistIndex = (
  playlists: readonly ObservedPlaylist[],
  maxEntries = recommendationConfig.storage.observedTrackIndexLimit,
): Record<string, TrackPlaylistIndexEntry> => {
  const index: Record<string, TrackPlaylistIndexEntry> = {}
  let entries = 0
  for (const playlist of playlists) {
    for (const trackKey of playlist.fetchedTracks) {
      let entry = index[trackKey]
      if (!entry) {
        if (entries >= maxEntries) continue
        entry = index[trackKey] = { playlistIds: [], updatedAt: Date.now() }
        entries += 1
      }
      if (!entry.playlistIds.includes(playlist.id)) entry.playlistIds.push(playlist.id)
    }
  }
  return index
}

/** 对出现在很多已观察歌单里的热门歌曲降低共现贡献。 */
export const computePopularityDamping = (observedPlaylistFrequency: number) => {
  const exponent = recommendationConfig.similarity.popularityDamping
  return 1 / Math.pow(1 + Math.log(1 + Math.max(0, observedPlaylistFrequency)), exponent)
}

export interface CoOccurrenceInput {
  seedTrackKeys: ReadonlySet<string>
  observedPlaylists: readonly ObservedPlaylist[]
  index: Readonly<Record<string, TrackPlaylistIndexEntry>>
  playlistWeights?: Readonly<Record<string, number>>
}

/**
 * 候选歌曲与画像种子的共现分：
 * - 只统计真正读取过、且确认包含种子歌曲的观察歌单；
 * - 按有效观察歌单规模归一化；
 * - 热门歌曲按观察频次降权；
 * - 多歌单贡献做饱和，避免重复收录无限叠加。
 */
export const computeCandidateCoOccurrence = (
  candidateTrackKey: string,
  input: CoOccurrenceInput,
): number => {
  const entry = input.index[candidateTrackKey]
  if (!entry?.playlistIds.length) return 0

  const observedById = new Map(input.observedPlaylists.map(playlist => [playlist.id, playlist]))
  let total = 0
  let maxSingle = 0
  let contributing = 0
  for (const playlistId of entry.playlistIds) {
    const playlist = observedById.get(playlistId)
    if (!playlist || !playlist.confirmed || playlist.seedOverlap <= 0) continue
    const effectiveSize = Math.max(1, playlist.fetchedTracks.length)
    const coverageConfidence = Math.max(0.15, playlist.confidence)
    const seedWeight = input.playlistWeights?.[playlistId] ?? playlist.seedOverlap
    const contribution = seedWeight * coverageConfidence / Math.sqrt(effectiveSize)
    total += contribution
    maxSingle = Math.max(maxSingle, contribution)
    contributing += 1
  }
  if (!total || !contributing) return 0

  const damping = computePopularityDamping(input.index[candidateTrackKey]?.playlistIds.length ?? contributing)
  const saturated = total / (1 + total)
  const withCap = maxSingle > 0
    ? Math.min(saturated, maxSingle * recommendationConfig.similarity.maxMultiPlaylistBoost * damping)
    : saturated
  return Math.max(0, Math.min(1, withCap))
}

export const computeProfileAffinity = (
  seedOverlapWeight: number,
  weakThemeScore: number,
  profileSeedCount: number,
  observedTrackCount: number,
) => {
  const seed = computePlaylistAffinity(
    seedOverlapWeight,
    Math.max(1, profileSeedCount),
    Math.max(1, observedTrackCount),
  )
  const weak = Math.max(0, Math.min(1, weakThemeScore))
  return Math.max(0, Math.min(1, seed * 0.65 + weak * 0.35))
}

export interface SessionCoOccurrenceOptions {
  now?: number
  sessionGapMs?: number
  halfLifeDays?: number
  maxRecords?: number
  anchorMinCoverage?: number
  memberMinCoverage?: number
}

/**
 * SAR（Smart Adaptive Recommendations）式会话共现的本地移植：
 * 同一场收听（播放间隔 ≤ sessionGapMs）内的歌构成一次 transaction，
 * 与"用户积极听完的画像种子歌"同场的候选获得加权共现分——
 * 这是歌单共现之外、完全来自用户自己播放序列的品味信号。
 * - anchor：种子歌且自身覆盖 ≥ anchorMinCoverage（真听完才算正样本）；
 * - member：非种子歌，覆盖 ≥ memberMinCoverage（早切的不吸收信号）；
 * - 权重 = anchor 覆盖 × 时间半衰期衰减，按 (session, anchor) 累加后饱和归一化到 0~1。
 */
export const buildSessionCoOccurrence = (
  radioHistory: readonly RadioPlayRecord[],
  seedKeys: ReadonlySet<string>,
  options: SessionCoOccurrenceOptions = {},
): Map<string, number> => {
  const cfg = recommendationConfig.sessionCoOccurrence
  const now = options.now ?? Date.now()
  const sessionGapMs = options.sessionGapMs ?? cfg.sessionGapMs
  const halfLifeDays = options.halfLifeDays ?? cfg.halfLifeDays
  const anchorMinCoverage = options.anchorMinCoverage ?? cfg.anchorMinCoverage
  const memberMinCoverage = options.memberMinCoverage ?? cfg.memberMinCoverage
  const maxRecords = options.maxRecords ?? cfg.maxRecords

  const neutralReasons = new Set(['natural_end', 'user_next', 'user_select_other'])
  const members = radioHistory
    .filter(record => {
      if (!record.endReason || !neutralReasons.has(record.endReason)) return false
      if (record.endReason == 'user_next' && record.coverage < memberMinCoverage) return false
      return record.coverage > 0 || record.endReason == 'natural_end'
    })
    .sort((a, b) => a.startedAt - b.startedAt)
    .slice(-maxRecords)
  if (!members.length || !seedKeys.size) return new Map()

  const sessions: RadioPlayRecord[][] = []
  for (const record of members) {
    const last = sessions[sessions.length - 1]
    const previous = last?.[last.length - 1]
    if (last && previous != null && record.startedAt - previous.startedAt <= sessionGapMs) last.push(record)
    else sessions.push([record])
  }

  const coOccurrence = new Map<string, number>()
  for (const session of sessions) {
    const anchors = session.filter(record => seedKeys.has(record.trackKey) && record.coverage >= anchorMinCoverage)
    if (!anchors.length) continue
    for (const record of session) {
      if (seedKeys.has(record.trackKey)) continue
      let total = 0
      for (const anchor of anchors) {
        const decay = Math.pow(0.5, Math.max(0, now - anchor.startedAt) / (Math.max(1, halfLifeDays) * 86400000))
        total += Math.min(1, anchor.coverage) * decay
      }
      coOccurrence.set(record.trackKey, (coOccurrence.get(record.trackKey) ?? 0) + total / anchors.length)
    }
  }
  const scores = new Map<string, number>()
  for (const [trackKey, total] of coOccurrence) scores.set(trackKey, Math.min(1, total / (1 + total)))
  return scores
}
