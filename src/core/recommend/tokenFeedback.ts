import { recommendationConfig as cfg } from './config.ts'
import { decayWeight } from './similarity.ts'
import { tokenizeTrackName } from './tokenize.ts'
import type { ThemePreference } from './types.ts'

export type TokenWeightMap = Record<string, ThemePreference>

const decayedWeights = (pref: ThemePreference | undefined, now: number) => {
  if (!pref) return { pos: 0, neg: 0 }
  const elapsed = Math.max(0, now - (pref.lastDecayTime || now))
  return {
    pos: decayWeight(pref.positiveWeight, elapsed, cfg.nameToken.halfLifeDays),
    neg: decayWeight(pref.negativeWeight, elapsed, cfg.nameToken.halfLifeDays),
  }
}

/** 结算出的正/负反馈记到歌名 token 上；带半衰期衰减，防止历史词汇永久压制。 */
export const applyNameTokenFeedback = (
  map: TokenWeightMap,
  tokens: readonly string[] | undefined,
  positiveDelta: number,
  negativeDelta: number,
  now = Date.now(),
) => {
  if ((!positiveDelta && !negativeDelta) || !tokens?.length) return
  for (const token of tokens) {
    const { pos, neg } = decayedWeights(map[token], now)
    map[token] = {
      themeId: token,
      positiveWeight: Math.min(cfg.nameToken.maxWeight, pos + Math.max(0, positiveDelta)),
      negativeWeight: Math.min(cfg.nameToken.maxWeight, neg + Math.max(0, negativeDelta)),
      lastDecayTime: now,
      lastUsedTime: now,
    }
  }
}

/**
 * 候选歌名与学习过的 token 命中后的乘性因子：
 * 取各 token 衰减后正/负权重的最大值，负向因子更重（避开踩雷优先），
 * 结果钳位在 [floor, ceiling]。无学习数据或无命中时为 1。
 */
export const nameTokenFactor = (
  map: TokenWeightMap | undefined,
  name: string | undefined,
  now = Date.now(),
) => {
  if (!map || !name) return 1
  const tokens = tokenizeTrackName(name)
  if (!tokens.length) return 1
  let maxPos = 0
  let maxNeg = 0
  for (const token of tokens) {
    const { pos, neg } = decayedWeights(map[token], now)
    maxPos = Math.max(maxPos, pos)
    maxNeg = Math.max(maxNeg, neg)
  }
  const factor = 1 + maxPos * cfg.nameToken.positiveFactor - maxNeg * cfg.nameToken.negativeFactor
  return Math.max(cfg.nameToken.floor, Math.min(cfg.nameToken.ceiling, factor))
}

/**
 * 从词面学习中提取"被验证过的好风格词"（按衰减后正权重排序、剔除带负权重的
 * 坏标记如 DJ版/Live），供发现搜索的关键词池使用——正反馈学习反哺召回。
 */
export const getLearnedStyleTokens = (
  map: TokenWeightMap | undefined,
  limit = 4,
  now = Date.now(),
): string[] => {
  if (!map) return []
  return Object.entries(map)
    .map(([token, pref]) => {
      const { pos, neg } = decayedWeights(pref, now)
      return { token, pos, neg }
    })
    .filter(item => item.pos > 0 && item.neg <= 0)
    .sort((a, b) => b.pos - a.pos)
    .slice(0, limit)
    .map(item => item.token)
}
