import { recommendationConfig } from './config.ts'
import type { SessionPreference, SessionTrack } from './types.ts'

export interface SessionHealth {
  /** 最近连续负反馈（早切/低完成度/不喜欢）条数。 */
  negativeStreak: number
  /** 最近连续正反馈（完播/喜欢）条数，用于临时放大探索额度。 */
  positiveStreak: number
  /** 观察窗口内已结算曲目的负反馈占比。 */
  negativeRate: number
  /** C/D 通道自身的负反馈占比；样本不足时为 null（退回总体占比）。 */
  explorationNegativeRate: number | null
  /** 探索通道（C/D）配额缩放；负反馈收缩到 floor，正反馈连击可解锁到 boost（>1）。 */
  explorationFactor: number
  /** 触发安全模式：撤下高风险已排队曲目并转画像优先。 */
  safeMode: boolean
  /** 参与统计的已结算曲目数。 */
  sampleSize: number
}

export interface SessionPenalties {
  /** 歌手 -> 近期负反馈权重（按新近程度衰减）。 */
  artistPenalty: Record<string, number>
  /** 来源歌单 -> 近期负反馈权重。 */
  playlistPenalty: Record<string, number>
}

type SessionHealthConfig = typeof recommendationConfig.sessionHealth

const isSettledTrack = (track: SessionTrack, dislikedTrackKeys: ReadonlySet<string>) => {
  return track.liked === true || track.listenRatio != null || dislikedTrackKeys.has(track.trackKey)
}

const isNegativeTrack = (track: SessionTrack, dislikedTrackKeys: ReadonlySet<string>, config: SessionHealthConfig) => {
  if (track.liked === true) return false
  if (dislikedTrackKeys.has(track.trackKey)) return true
  return track.listenRatio != null && track.listenRatio < config.negativeListenRatio
}

/** 负反馈占比线性映射到探索额度系数；低于起点不收缩，高于终点压到下限。 */
export const mapNegativeRateToFactor = (rate: number, config: SessionHealthConfig = recommendationConfig.sessionHealth) => {
  if (rate <= config.explorationThrottleStart) return 1
  if (rate >= config.explorationThrottleEnd) return config.explorationFactorFloor
  const span = config.explorationThrottleEnd - config.explorationThrottleStart
  return 1 - (1 - config.explorationFactorFloor) * (rate - config.explorationThrottleStart) / span
}

export const computeSessionHealth = (
  session: Pick<SessionPreference, 'recentTracks'>,
  dislikedTrackKeys: ReadonlySet<string>,
  config: SessionHealthConfig = recommendationConfig.sessionHealth,
): SessionHealth => {
  const tracks = session.recentTracks.slice(0, config.window)
  let negativeStreak = 0
  for (const track of tracks) {
    if (!isNegativeTrack(track, dislikedTrackKeys, config)) break
    negativeStreak += 1
  }
  let positiveStreak = 0
  for (const track of tracks) {
    if (!isSettledTrack(track, dislikedTrackKeys) || isNegativeTrack(track, dislikedTrackKeys, config)) break
    positiveStreak += 1
  }
  const settled = tracks.filter(track => isSettledTrack(track, dislikedTrackKeys))
  const negatives = settled.filter(track => isNegativeTrack(track, dislikedTrackKeys, config)).length
  const negativeRate = settled.length ? negatives / settled.length : 0
  const explorationSettled = settled.filter(track => track.channel == 'C' || track.channel == 'D')
  const explorationNegatives = explorationSettled.filter(track => isNegativeTrack(track, dislikedTrackKeys, config)).length
  const explorationNegativeRate = explorationSettled.length >= config.minExplorationSamples && explorationSettled.length > 0
    ? explorationNegatives / explorationSettled.length
    : null
  // 双向调节：负反馈收缩（≤1）；正反馈连击且不在安全模式时解锁扩张（>1）
  const baseFactor = mapNegativeRateToFactor(explorationNegativeRate ?? negativeRate, config)
  const boosted = positiveStreak >= config.positiveStreakThreshold && negativeStreak < config.streakThreshold
    ? Math.max(baseFactor, config.positiveExplorationBoost)
    : baseFactor
  return {
    negativeStreak,
    positiveStreak,
    negativeRate,
    explorationNegativeRate,
    explorationFactor: boosted,
    safeMode: negativeStreak >= config.streakThreshold,
    sampleSize: settled.length,
  }
}

export const buildSessionPenalties = (
  session: Pick<SessionPreference, 'recentTracks'>,
  dislikedTrackKeys: ReadonlySet<string>,
  config: SessionHealthConfig = recommendationConfig.sessionHealth,
): SessionPenalties => {
  const artistPenalty: Record<string, number> = {}
  const playlistPenalty: Record<string, number> = {}
  const tracks = session.recentTracks.slice(0, config.window)
  tracks.forEach((track, index) => {
    if (!isNegativeTrack(track, dislikedTrackKeys, config)) return
    const weight = Math.pow(config.penaltyRecencyDecay, index)
    for (const artist of track.artistKeys ?? []) {
      artistPenalty[artist] = (artistPenalty[artist] ?? 0) + weight
    }
    if (track.sourcePlaylistId) {
      playlistPenalty[track.sourcePlaylistId] = (playlistPenalty[track.sourcePlaylistId] ?? 0) + weight
    }
  })
  const capAt = (value: number) => Math.min(config.penaltyCap, value)
  for (const key of Object.keys(artistPenalty)) artistPenalty[key] = capAt(artistPenalty[key])
  for (const key of Object.keys(playlistPenalty)) playlistPenalty[key] = capAt(playlistPenalty[key])
  return { artistPenalty, playlistPenalty }
}

/** 候选与近期负反馈的命中强度：歌手/歌单各取最大命中后按配置权重合成。 */
export const sessionPenaltyScore = (
  artistKeys: readonly string[] | undefined,
  playlistIds: readonly string[] | undefined,
  penalties: SessionPenalties | undefined,
  config: SessionHealthConfig = recommendationConfig.sessionHealth,
) => {
  if (!penalties) return 0
  let maxArtist = 0
  for (const artist of artistKeys ?? []) maxArtist = Math.max(maxArtist, penalties.artistPenalty[artist] ?? 0)
  let maxPlaylist = 0
  for (const playlistId of playlistIds ?? []) maxPlaylist = Math.max(maxPlaylist, penalties.playlistPenalty[playlistId] ?? 0)
  return Math.min(config.penaltyCap, maxArtist) * config.artistPenaltyWeight +
    Math.min(config.penaltyCap, maxPlaylist) * config.playlistPenaltyWeight
}

/** 打分侧乘性惩罚：无命中为 1，满命中约 0.25。 */
export const sessionPenaltyFactor = (score: number) => 1 / (1 + Math.max(0, score))

/** 撤队判定比降分更严格：歌手或歌单命中达到阈值才把已排队曲目撤下来。 */
export const shouldDeferQueuedItem = (
  artistKeys: readonly string[] | undefined,
  playlistId: string | undefined,
  penalties: SessionPenalties | undefined,
  config: SessionHealthConfig = recommendationConfig.sessionHealth,
) => {
  if (!penalties) return false
  let maxArtist = 0
  for (const artist of artistKeys ?? []) maxArtist = Math.max(maxArtist, penalties.artistPenalty[artist] ?? 0)
  const maxPlaylist = playlistId ? penalties.playlistPenalty[playlistId] ?? 0 : 0
  return maxArtist >= config.deferPenaltyThreshold || maxPlaylist >= config.deferPenaltyThreshold
}
