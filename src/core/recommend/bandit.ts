import { recommendationConfig as cfg } from './config.ts'
import type { ChannelBandit, ChannelBanditArm, ChannelId } from './types.ts'

const armOf = (map: ChannelBandit, channel: ChannelId): ChannelBanditArm => {
  return map[channel] ?? { alpha: cfg.bandit.priorAlpha, beta: cfg.bandit.priorBeta, lastUpdatedAt: 0 }
}

/**
 * 通道配额的 Thompson bandit：完播/喜欢记 alpha，早切/不喜欢记 beta。
 * 播放越多采样越收敛，配额自动贴向实际表现；半衰期衰减让品味漂移可被重新探索。
 */
export const updateChannelBandit = (
  map: ChannelBandit,
  channel: ChannelId | undefined,
  outcome: 'positive' | 'negative',
  now = Date.now(),
) => {
  if (!channel) return
  const arm = armOf(map, channel)
  if (outcome == 'positive') {
    map[channel] = {
      alpha: Math.min(cfg.bandit.maxCount, arm.alpha + 1),
      beta: arm.beta,
      lastUpdatedAt: now,
    }
  } else {
    map[channel] = {
      alpha: arm.alpha,
      beta: Math.min(cfg.bandit.maxCount, arm.beta + 1),
      lastUpdatedAt: now,
    }
  }
}

/** Beta(alpha,beta) 用整数形状的 Gamma 之和近似：Gamma(k,1) = -Σln(u)。 */
const sampleGamma = (shape: number, rng: () => number) => {
  const k = Math.max(1, Math.round(shape))
  let sum = 0
  for (let i = 0; i < k; i++) sum += -Math.log(Math.max(rng(), 1e-9))
  return sum
}

/** 读取时按半衰期衰减计数（先验部分不衰减），实现品味漂移下的自动重新探索。 */
const decayedArm = (map: ChannelBandit, channel: ChannelId, now: number) => {
  const arm = armOf(map, channel)
  if (!arm.lastUpdatedAt) return arm
  const elapsed = Math.max(0, now - arm.lastUpdatedAt)
  const factor = Math.pow(0.5, elapsed / (Math.max(1, cfg.bandit.halfLifeDays) * 86400000))
  return {
    alpha: cfg.bandit.priorAlpha + (arm.alpha - cfg.bandit.priorAlpha) * factor,
    beta: cfg.bandit.priorBeta + (arm.beta - cfg.bandit.priorBeta) * factor,
    lastUpdatedAt: arm.lastUpdatedAt,
  }
}

const clampMultiplier = (value: number) =>
  Math.max(cfg.bandit.minBoost, Math.min(cfg.bandit.maxBoost, value))

/** p ∈ [0,1] 线性映射到 [minBoost, maxBoost]；p=0.5（先验均值）时恰好中性。 */
export const thompsonMultiplier = (
  map: ChannelBandit,
  channel: ChannelId,
  now = Date.now(),
  rng: () => number = Math.random,
) => {
  const { alpha, beta } = decayedArm(map, channel, now)
  const observations = (alpha - cfg.bandit.priorAlpha) + (beta - cfg.bandit.priorBeta)
  if (observations < cfg.bandit.minObservations) return 1
  const x = sampleGamma(alpha, rng)
  const y = sampleGamma(beta, rng)
  return clampMultiplier(cfg.bandit.minBoost + (x / (x + y)) * (cfg.bandit.maxBoost - cfg.bandit.minBoost))
}
