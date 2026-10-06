import { recommendationConfig as cfg } from './config.ts'
import { decayWeight } from './similarity.ts'
import type { ThemePreference } from './types.ts'

/**
 * 长期歌手先验：与词面级学习（tokenFeedback.ts）同构，但按歌手归因、半衰期更长。
 * 会话惩罚（sessionHealth.ts）只看最近 10 首，管"现在"；这里管"一直"——
 * 历史上总被切的歌手持续降权，总是听完的歌手小幅加分。软信号，不封禁。
 */

export type ArtistStatsMap = Record<string, ThemePreference>

const decayedWeights = (pref: ThemePreference | undefined, now: number) => {
  if (!pref) return { pos: 0, neg: 0 }
  const elapsed = Math.max(0, now - (pref.lastDecayTime || now))
  return {
    pos: decayWeight(pref.positiveWeight, elapsed, cfg.artistPrior.halfLifeDays),
    neg: decayWeight(pref.negativeWeight, elapsed, cfg.artistPrior.halfLifeDays),
  }
}

/** 结算/显式反馈按歌手归因记账；带半衰期衰减，品味漂移可被重新发现。 */
export const applyArtistStatsFeedback = (
  map: ArtistStatsMap,
  artistKeys: readonly string[] | undefined,
  positiveDelta: number,
  negativeDelta: number,
  now = Date.now(),
) => {
  if ((!positiveDelta && !negativeDelta) || !artistKeys?.length) return
  for (const artist of artistKeys) {
    if (!artist) continue
    const { pos, neg } = decayedWeights(map[artist], now)
    map[artist] = {
      themeId: artist,
      positiveWeight: Math.min(cfg.artistPrior.maxWeight, pos + Math.max(0, positiveDelta)),
      negativeWeight: Math.min(cfg.artistPrior.maxWeight, neg + Math.max(0, negativeDelta)),
      lastDecayTime: now,
      lastUsedTime: now,
    }
  }
}

/**
 * 候选歌手与先验命中后的乘性因子：取各歌手衰减后正/负权重最大值，
 * 负向因子更重，钳位 [floor, ceiling]。无数据或无命中为 1。
 */
export const artistPriorFactor = (
  map: ArtistStatsMap | undefined,
  artistKeys: readonly string[] | undefined,
  now = Date.now(),
) => {
  if (!map || !artistKeys?.length) return 1
  let maxPos = 0
  let maxNeg = 0
  for (const artist of artistKeys) {
    const { pos, neg } = decayedWeights(map[artist], now)
    maxPos = Math.max(maxPos, pos)
    maxNeg = Math.max(maxNeg, neg)
  }
  const factor = 1 + maxPos * cfg.artistPrior.positiveFactor - maxNeg * cfg.artistPrior.negativeFactor
  return Math.max(cfg.artistPrior.floor, Math.min(cfg.artistPrior.ceiling, factor))
}
