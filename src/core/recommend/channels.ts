import { recommendationConfig } from './config.ts'
import type { ChannelBandit, ChannelId, RadioMode } from './types.ts'
import { CHANNEL_IDS } from './types.ts'
import { thompsonMultiplier } from './bandit.ts'

export interface ChannelQuotaPlan {
  quotas: Record<ChannelId, number>
  total: number
  reasons: Partial<Record<ChannelId, string>>
}

export const emptyChannelCounts = (): Record<ChannelId, number> => ({ A: 0, B: 0, C: 0, D: 0 })

export const countChannels = (channels: ReadonlyArray<ChannelId | undefined>): Record<ChannelId, number> => {
  const counts = emptyChannelCounts()
  for (const channel of channels) {
    if (channel) counts[channel] += 1
  }
  return counts
}

const allocateByWeights = (total: number, weights: Record<ChannelId, number>): Record<ChannelId, number> => {
  const result = emptyChannelCounts()
  const sum = CHANNEL_IDS.reduce((acc, channel) => acc + Math.max(0, weights[channel]), 0)
  if (sum <= 0 || total <= 0) return result
  const remainders: Array<{ channel: ChannelId, remainder: number }> = []
  let allocated = 0
  for (const channel of CHANNEL_IDS) {
    const exact = total * Math.max(0, weights[channel]) / sum
    result[channel] = Math.floor(exact)
    allocated += result[channel]
    remainders.push({ channel, remainder: exact - result[channel] })
  }
  remainders.sort((a, b) => b.remainder - a.remainder)
  for (let i = allocated; i < total; i++) {
    result[remainders[(i - allocated) % remainders.length].channel] += 1
  }
  return result
}

/**
 * 滚动窗口配额缺口调度：
 * - 电台默认每 20 首 A9/B5/C4/D2，探索模式改用 A3/B1/C9/D7；
 * - 按最近窗口的实际通道计数补缺口，再按目标占比填充剩余额度；
 * - explorationFactor < 1 时按比例收缩 C/D 目标份额（会话负反馈触发），让出的额度按占比流回 A/B；
 * - 某通道没有合格候选时把额度让给其他外部通道，并记录降级原因；
 * - 冷启动没有 B 反馈时，B 额度临时分给 C/D/A。
 */
export const planChannelQuotas = (
  target: number,
  recentChannels: ReadonlyArray<ChannelId | undefined>,
  availability: Record<ChannelId, number>,
  options: {
    coldStart?: boolean
    mode?: RadioMode
    explorationFactor?: number
    /** Thompson bandit 通道计数：按实际完播/切歌表现调制各通道目标份额。 */
    bandit?: ChannelBandit
    rng?: () => number
    now?: number
  } = {},
): ChannelQuotaPlan => {
  const cfg = recommendationConfig.channels
  const explore = options.mode == 'explore'
  const base = (explore ? cfg.exploreTargetPerWindow : cfg.targetPerWindow) as Record<ChannelId, number>
  const totalTarget = Math.max(0, Math.floor(target))
  // 负反馈收缩（<1）与正反馈解锁扩张（>1，上限 bandit.maxBoost）共用一个入口
  const explorationFactor = Math.max(0, Math.min(recommendationConfig.bandit.maxBoost, options.explorationFactor ?? 1))
  const weights: Record<ChannelId, number> = { ...base }
  if (explorationFactor != 1) {
    weights.C = base.C * explorationFactor
    weights.D = base.D * explorationFactor
  }
  if (options.bandit) {
    const now = options.now ?? Date.now()
    const rng = options.rng ?? Math.random
    for (const channel of CHANNEL_IDS) {
      weights[channel] = Math.max(0, weights[channel] * thompsonMultiplier(options.bandit, channel, now, rng))
    }
  }
  const baseAllocation = allocateByWeights(totalTarget, weights)
  const recent = recentChannels.slice(-cfg.windowSize)
  const counts = countChannels(recent)
  const quotas = emptyChannelCounts()
  const reasons: Partial<Record<ChannelId, string>> = {}

  for (const channel of CHANNEL_IDS) {
    quotas[channel] = Math.max(0, baseAllocation[channel] - counts[channel])
  }

  for (const channel of CHANNEL_IDS) {
    if (quotas[channel] <= availability[channel]) continue
    quotas[channel] = Math.max(0, availability[channel])
    reasons[channel] = availability[channel] <= 0
      ? (channel == 'B' && options.coldStart ? 'cold_start' : 'no_candidate')
      : 'insufficient_candidate'
  }

  let remaining = totalTarget - CHANNEL_IDS.reduce((sum, channel) => sum + quotas[channel], 0)
  const fallbackOrder = explore
    ? cfg.exploreFallbackOrder
    : options.coldStart && availability.B <= 0
      ? cfg.coldStartFallbackOrder
      : cfg.fallbackOrder
  let guard = 0
  while (remaining > 0 && guard < totalTarget * 4) {
    guard += 1
    let best: ChannelId | undefined
    let bestScore = -Infinity
    const after = emptyChannelCounts()
    for (const channel of CHANNEL_IDS) after[channel] = counts[channel] + quotas[channel]
    const afterTotal = recent.length + CHANNEL_IDS.reduce((sum, channel) => sum + quotas[channel], 0)
    const weightsSum = CHANNEL_IDS.reduce((sum, channel) => sum + weights[channel], 0)
    for (const channel of fallbackOrder) {
      if (availability[channel] <= quotas[channel]) continue
      if (options.coldStart && channel == 'B' && availability.B <= 0) continue
      const desiredShare = weights[channel] / weightsSum
      const currentShare = afterTotal > 0 ? after[channel] / afterTotal : 0
      const score = desiredShare - currentShare
      if (score > bestScore) {
        bestScore = score
        best = channel
      }
    }
    if (!best) {
      for (const channel of CHANNEL_IDS) {
        if (availability[channel] > 0) continue
        reasons[channel] = channel == 'B' && options.coldStart ? 'cold_start' : 'no_candidate'
      }
      break
    }
    quotas[best] += 1
    remaining -= 1
  }

  return {
    quotas,
    total: CHANNEL_IDS.reduce((sum, channel) => sum + quotas[channel], 0),
    reasons,
  }
}

