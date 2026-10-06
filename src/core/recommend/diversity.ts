import { recommendationConfig } from './config.ts'
import type { ChannelQuotaPlan } from './channels.ts'
import { getArtistKeys, getPrimaryArtist } from './trackKey.ts'
import type { ChannelId } from './types.ts'

export const softmaxSample = <T,>(
  items: T[],
  scoreOf: (item: T) => number,
  temperature = recommendationConfig.softmax.temperature,
  random: () => number = Math.random,
): T | undefined => {
  if (!items.length) return undefined
  const temp = Math.max(
    recommendationConfig.softmax.minTemperature,
    Math.min(recommendationConfig.softmax.maxTemperature, temperature),
  )
  const maxScore = Math.max(...items.map(scoreOf))
  const weights = items.map(item => Math.max(Math.exp((scoreOf(item) - maxScore) / temp), recommendationConfig.softmax.minWeight))
  let total = 0
  for (const weight of weights) total += weight
  let roll = random() * total
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return items[i]
  }
  return items[items.length - 1]
}

export interface FinalQueueItem {
  key: string
  channels: ChannelId[]
  channelWeights?: Partial<Record<ChannelId, number>>
  primaryArtist: string
  artistKeys: string[]
  albumKey: string
  /** 作品级 key（忽略 Live/Remix 等版本差异），用于软降频而非硬排除。 */
  workKey?: string
  sourcePlaylistId?: string
  sourceSeedTrackKey?: string
  sourceClusterId?: string
  sourceChartId?: string
  groupIds?: string[]
  exposureCount?: number
  weight: number
}

export interface FinalQueueSelectionOptions {
  target: number
  recent?: readonly FinalQueueItem[]
  channelPlan: ChannelQuotaPlan
  rng?: () => number
  temperature?: number
  /** 相邻两个探索通道（C/D）曲目之间至少要隔多少首非探索曲目；0 表示不限制。 */
  explorationGap?: number
}

export interface SelectedFinalQueueItem<T extends FinalQueueItem = FinalQueueItem> {
  item: T
  channel: ChannelId
}

export interface FinalQueueSelectionResult<T extends FinalQueueItem = FinalQueueItem> {
  items: Array<SelectedFinalQueueItem<T>>
  pickedByChannel: Record<ChannelId, number>
  maxRelaxLevel: number
  reasons: string[]
}

interface RelaxConfig {
  artistGap: number
  sameArtistInLast30: number
  samePlaylistInLast20: number
  sameAlbumInLast20: number
  similarGroupRatioIn20: number
  sameSeedInLast20: number
  sameChartInLast20: number
}

const getRelaxConfigs = (): RelaxConfig[] => {
  const c = recommendationConfig.antiRepeat
  return [
    {
      artistGap: c.artistGap,
      sameArtistInLast30: c.sameArtistInLast30,
      samePlaylistInLast20: c.samePlaylistInLast20,
      sameAlbumInLast20: c.sameAlbumInLast20,
      similarGroupRatioIn20: c.similarGroupRatioIn20,
      sameSeedInLast20: c.sameSeedInLast20,
      sameChartInLast20: c.sameChartInLast20,
    },
    {
      artistGap: c.artistGap,
      sameArtistInLast30: c.sameArtistInLast30,
      samePlaylistInLast20: c.relaxSamePlaylistInLast20,
      sameAlbumInLast20: c.relaxSameAlbumInLast20,
      similarGroupRatioIn20: c.relaxSimilarGroupRatioIn20,
      sameSeedInLast20: c.sameSeedInLast20 + 1,
      sameChartInLast20: c.sameChartInLast20 + 1,
    },
    {
      artistGap: c.relaxArtistGaps[1] ?? 5,
      sameArtistInLast30: c.sameArtistInLast30,
      samePlaylistInLast20: c.relaxSamePlaylistInLast20,
      sameAlbumInLast20: c.relaxSameAlbumInLast20,
      similarGroupRatioIn20: c.relaxSimilarGroupRatioIn20,
      sameSeedInLast20: c.sameSeedInLast20 + 1,
      sameChartInLast20: c.sameChartInLast20 + 1,
    },
    {
      artistGap: c.relaxArtistGaps[2] ?? 3,
      sameArtistInLast30: c.sameArtistInLast30,
      samePlaylistInLast20: c.relaxSamePlaylistInLast20,
      sameAlbumInLast20: c.relaxSameAlbumInLast20,
      similarGroupRatioIn20: c.relaxSimilarGroupRatioIn20,
      sameSeedInLast20: c.sameSeedInLast20 + 1,
      sameChartInLast20: c.sameChartInLast20 + 1,
    },
    {
      artistGap: c.relaxArtistGaps[2] ?? 3,
      sameArtistInLast30: c.relaxSameArtistInLast30,
      samePlaylistInLast20: c.relaxSamePlaylistInLast20,
      sameAlbumInLast20: c.relaxSameAlbumInLast20,
      similarGroupRatioIn20: c.relaxSimilarGroupRatioIn20,
      sameSeedInLast20: c.sameSeedInLast20 + 2,
      sameChartInLast20: c.sameChartInLast20 + 2,
    },
  ]
}

const countInLast = <T,>(history: readonly T[], window: number, predicate: (item: T) => boolean) => {
  let count = 0
  const start = Math.max(0, history.length - window)
  for (let i = start; i < history.length; i++) {
    if (predicate(history[i])) count += 1
  }
  return count
}

const matchesAnyArtist = (item: FinalQueueItem, artist: string) => {
  return item.artistKeys.includes(artist)
}

const checkItemConstraints = (
  item: FinalQueueItem,
  history: readonly FinalQueueItem[],
  relax: RelaxConfig,
) => {
  // 合唱需要检查全部可靠识别出的参与歌手。
  for (const artist of item.artistKeys) {
    if (countInLast(history, relax.artistGap, entry => matchesAnyArtist(entry, artist)) > 0) return false
    if (countInLast(history, 30, entry => matchesAnyArtist(entry, artist)) >= relax.sameArtistInLast30) return false
  }
  if (item.sourcePlaylistId) {
    const count = countInLast(history, 20, entry => entry.sourcePlaylistId == item.sourcePlaylistId)
    if (count >= relax.samePlaylistInLast20) return false
  }
  const albumKey = item.albumKey || `album:unknown:${item.key}`
  if (countInLast(history, 20, entry => (entry.albumKey || `album:unknown:${entry.key}`) == albumKey) >= relax.sameAlbumInLast20) return false
  if (item.sourceSeedTrackKey) {
    const count = countInLast(history, 20, entry => entry.sourceSeedTrackKey == item.sourceSeedTrackKey)
    if (count >= relax.sameSeedInLast20) return false
  }
  if (item.sourceChartId) {
    const count = countInLast(history, 20, entry => entry.sourceChartId == item.sourceChartId)
    if (count >= relax.sameChartInLast20) return false
  }
  const groupIds = item.groupIds ?? []
  if (groupIds.length) {
    const window = Math.min(20, history.length + 1)
    const maxGroupCount = Math.max(1, Math.ceil(window * relax.similarGroupRatioIn20))
    for (const groupId of groupIds) {
      const count = countInLast(history, 20, entry => (entry.groupIds ?? []).includes(groupId))
      if (count >= maxGroupCount) return false
    }
  }
  return true
}

const isExplorationChannel = (channel: ChannelId | undefined) => channel == 'C' || channel == 'D'

export const selectFinalQueue = <T extends FinalQueueItem>(
  candidates: readonly T[],
  options: FinalQueueSelectionOptions,
): FinalQueueSelectionResult<T> => {
  const rng = options.rng ?? Math.random
  const temperature = options.temperature ?? recommendationConfig.softmax.temperature
  const explorationGap = Math.max(0, options.explorationGap ?? 0)
  const relaxConfigs = getRelaxConfigs()
  relaxConfigs[relaxConfigs.length - 1].artistGap = 0
  const target = Math.max(0, options.target)
  const history: FinalQueueItem[] = (options.recent ?? []).slice(-60)
  const picked: Array<SelectedFinalQueueItem<T>> = []
  const pickedByChannel: Record<ChannelId, number> = { A: 0, B: 0, C: 0, D: 0 }
  const reasons: string[] = []
  const unused = new Set(candidates)
  if (!unused.size && target > 0) reasons.push('no_candidate_after_relaxation')
  let maxRelaxLevel = 0

  const baseQuotas = options.channelPlan.quotas
  const remainingChannels = () => {
    return (Object.keys(baseQuotas) as ChannelId[])
      .filter(channel => baseQuotas[channel] - pickedByChannel[channel] > 0)
      .sort((a, b) => {
        const remainder = (baseQuotas[b] - pickedByChannel[b]) - (baseQuotas[a] - pickedByChannel[a])
        if (remainder != 0) return remainder
        return recommendationConfig.channels.targetPerWindow[b] - recommendationConfig.channels.targetPerWindow[a]
      })
  }

  // 间隔约束按"历史末尾是否刚出现过探索曲目"判断，命中时本轮先挑非探索通道
  const explorationBlocked = () => {
    if (explorationGap <= 0) return false
    const start = Math.max(0, history.length - explorationGap)
    for (let i = history.length - 1; i >= start; i--) {
      if ((history[i].channels ?? []).some(isExplorationChannel)) return true
    }
    return false
  }

  const weightFor = (item: T, channel: ChannelId) => {
    const base = item.channelWeights?.[channel] ?? item.weight
    const exposurePenalty = 1 / (1 + Math.max(0, item.exposureCount ?? 0) * 0.35)
    // 同一作品的不同版本（Live/Remix 等）在最近 20 首出现过时软降频。
    const variantPenalty = item.workKey && countInLast(history, 20, entry => !!entry.workKey && entry.workKey == item.workKey) > 0
      ? recommendationConfig.antiRepeat.variantSoftFactor
      : 1
    return Math.max(recommendationConfig.softmax.minWeight, base * exposurePenalty * variantPenalty)
  }

  // 门槛只比较通道基础分（质量），不含曝光/同版本的软降频：否则软降频会被门槛放大成硬排除。
  const qualityWeightOf = (item: T, channel: ChannelId) => item.channelWeights?.[channel] ?? item.weight

  const applyQualityGate = (pool: T[], channel: ChannelId) => {
    const ratio = recommendationConfig.softmax.qualityGateRatio
    if (!(ratio > 0) || ratio >= 1) return pool
    let best = 0
    for (const item of pool) best = Math.max(best, qualityWeightOf(item, channel))
    if (best <= 0) return pool
    const gated = pool.filter(item => qualityWeightOf(item, channel) >= best * ratio)
    return gated.length ? gated : pool
  }

  const runChannelLadder = (channelList: ChannelId[]) => {
    for (let relaxLevel = 0; relaxLevel < relaxConfigs.length; relaxLevel++) {
      const relax = relaxConfigs[relaxLevel]
      for (const channel of channelList) {
        const eligible = [...unused].filter(item => item.channels.includes(channel) && checkItemConstraints(item, history, relax))
        if (!eligible.length) continue
        const pool = applyQualityGate(eligible, channel)
        return { chosen: softmaxSample(pool, item => weightFor(item, channel), temperature, rng), channel, relaxLevel }
      }
    }
    return null
  }

  while (picked.length < target && unused.size > 0) {
    const allChannels = remainingChannels()
    const gapBlocked = explorationBlocked()
    let ladder: { chosen: T | undefined, channel: ChannelId | undefined, relaxLevel: number } | null = null
    let gapRelaxed = false
    if (gapBlocked) {
      const nonExploration = allChannels.filter(channel => !isExplorationChannel(channel))
      if (nonExploration.length) ladder = runChannelLadder(nonExploration)
      // 只剩探索通道有额度时放宽间隔，保证配额不因间隔约束而饿死
      if (!ladder && allChannels.length) {
        ladder = runChannelLadder(allChannels)
        gapRelaxed = ladder != null
      }
    } else {
      ladder = runChannelLadder(allChannels)
    }

    if (!ladder) {
      const fallbackRelax = relaxConfigs[relaxConfigs.length - 1]
      const pool = [...unused].filter(item => checkItemConstraints(item, history, fallbackRelax))
      if (!pool.length) {
        reasons.push('no_candidate_after_relaxation')
        break
      }
      const chosen = softmaxSample(pool, item => {
        const channel = item.channels[0] ?? 'D'
        return weightFor(item, channel)
      }, temperature, rng)
      ladder = { chosen, channel: chosen?.channels[0], relaxLevel: relaxConfigs.length - 1 }
      reasons.push('fallback_channel')
    }

    const { chosen, channel: chosenChannel, relaxLevel: chosenRelax } = ladder
    if (!chosen || !chosenChannel) break
    if (gapRelaxed && !reasons.includes('exploration_gap_relaxed')) reasons.push('exploration_gap_relaxed')
    unused.delete(chosen)
    picked.push({ item: chosen, channel: chosenChannel })
    pickedByChannel[chosenChannel] = (pickedByChannel[chosenChannel] ?? 0) + 1
    history.push(chosen)
    if (history.length > 60) history.splice(0, history.length - 60)
    if (chosenRelax > maxRelaxLevel) {
      maxRelaxLevel = chosenRelax
      if (chosenRelax > 0 && !reasons.includes(`relax_level_${chosenRelax}`)) reasons.push(`relax_level_${chosenRelax}`)
    }
  }

  return { items: picked, pickedByChannel, maxRelaxLevel, reasons }
}

export const countFinalChannels = (items: Array<{ channel?: ChannelId }>): Record<ChannelId, number> => {
  const counts: Record<ChannelId, number> = { A: 0, B: 0, C: 0, D: 0 }
  for (const item of items) {
    if (item.channel) counts[item.channel] += 1
  }
  return counts
}

export { getArtistKeys, getPrimaryArtist }
