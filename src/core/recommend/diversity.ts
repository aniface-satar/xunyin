import { recommendationConfig } from './config.ts'
import type { ChannelQuotaPlan } from './channels.ts'
import { consecutiveLangAllowed, instrumentalAllowed, langWithinCap } from './languageQuota.ts'
import type { LangCaps } from './languageQuota.ts'
import type { LangBucket } from './language.ts'
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
  /** 语种桶：配额与连播硬规则的唯一依据。undefined 与 unknown 同义——不受配额约束。 */
  lang?: LangBucket
  /** 语种判定的命中级别：0=判不出 1=接口字段 2=桶提示 3=歌手表 4=字面统计。只用于诊断日志。 */
  langLevel?: 0 | 1 | 2 | 3 | 4
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
  /** 语种硬配额：由调用方按问卷 + 最近窗口算好传入；缺席即代表本轮不设配额。 */
  langCaps?: LangCaps
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
  /** 本档是否仍卡语种配额。放开档只放开配额，连播与纯音乐上限恒守。 */
  langQuotaEnforced: boolean
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
      langQuotaEnforced: true,
    },
    {
      artistGap: c.artistGap,
      sameArtistInLast30: c.sameArtistInLast30,
      samePlaylistInLast20: c.relaxSamePlaylistInLast20,
      sameAlbumInLast20: c.relaxSameAlbumInLast20,
      similarGroupRatioIn20: c.relaxSimilarGroupRatioIn20,
      sameSeedInLast20: c.sameSeedInLast20 + 1,
      sameChartInLast20: c.sameChartInLast20 + 1,
      langQuotaEnforced: true,
    },
    {
      artistGap: c.relaxArtistGaps[1] ?? 6,
      sameArtistInLast30: c.sameArtistInLast30,
      samePlaylistInLast20: c.relaxSamePlaylistInLast20,
      sameAlbumInLast20: c.relaxSameAlbumInLast20,
      similarGroupRatioIn20: c.relaxSimilarGroupRatioIn20,
      sameSeedInLast20: c.sameSeedInLast20 + 1,
      sameChartInLast20: c.sameChartInLast20 + 1,
      langQuotaEnforced: true,
    },
    {
      artistGap: c.relaxArtistGaps[2] ?? 4,
      sameArtistInLast30: c.sameArtistInLast30,
      samePlaylistInLast20: c.relaxSamePlaylistInLast20,
      sameAlbumInLast20: c.relaxSameAlbumInLast20,
      similarGroupRatioIn20: c.relaxSimilarGroupRatioIn20,
      sameSeedInLast20: c.sameSeedInLast20 + 1,
      sameChartInLast20: c.sameChartInLast20 + 1,
      langQuotaEnforced: false,
    },
    {
      // 阶梯的字面值读法：档位 0/1 用 c.artistGap，档位 2/3 用 c.relaxArtistGaps[1]/[2]，末档直读 c.minArtistGap。
      // 最后一档：连"同歌手隔 4 首"都满足不了时才走到这里，但间隔不归零——同歌手连推是用户明确投诉过的观感问题。
      // 候选枯竭时的契约是宁可少出几首（并记 no_candidate_after_relaxation，见 selectFinalQueue 的 fallback 分支），
      // 不再靠把间隔归零把队列凑满。
      artistGap: c.minArtistGap,
      sameArtistInLast30: c.relaxSameArtistInLast30,
      samePlaylistInLast20: c.relaxSamePlaylistInLast20,
      sameAlbumInLast20: c.relaxSameAlbumInLast20,
      similarGroupRatioIn20: c.relaxSimilarGroupRatioIn20,
      sameSeedInLast20: c.sameSeedInLast20 + 2,
      sameChartInLast20: c.sameChartInLast20 + 2,
      langQuotaEnforced: false,
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

interface LangGuardState {
  /** 调用方是否真的设了配额（问卷全空时是 false）。 */
  enforced: boolean
  /** 本轮剩余额度，选走一首即减 1；缺席的桶代表不受约束。 */
  remaining: Partial<Record<LangBucket, number>>
  /** 与 history 同步维护的语种序列（旧→新），供连播与纯音乐规则读尾部。 */
  langs: Array<LangBucket | undefined>
}

const checkItemConstraints = (
  item: FinalQueueItem,
  history: readonly FinalQueueItem[],
  relax: RelaxConfig,
  langGuard: LangGuardState,
  ignoreConsecutiveLang = false,
) => {
  // 语种判定排在最前：它最便宜，且"连三四首中文"是用户最直接的感受，不该被后面的间隔检查稀释
  if (relax.langQuotaEnforced && langGuard.enforced && !langWithinCap(item.lang, langGuard.remaining)) return false
  if (!ignoreConsecutiveLang && !consecutiveLangAllowed(langGuard.langs, item.lang)) return false
  // instrumentalAllowed 只在候选本身是纯音乐时调用：否则"池里已有 2 首纯音乐"会卡住所有歌
  if (item.lang == 'instr' && !instrumentalAllowed(langGuard.langs)) return false
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
  const target = Math.max(0, options.target)
  const history: FinalQueueItem[] = (options.recent ?? []).slice(-60)
  // 必须克隆 caps：本函数是纯函数，直接扣 options.langCaps.caps 会把调用方的额度吃掉，
  // 第二次生成队列就少一批名额
  const langGuard: LangGuardState = {
    enforced: options.langCaps?.enforced === true,
    remaining: options.langCaps?.enforced ? { ...options.langCaps.caps } : {},
    langs: history.map(item => item.lang),
  }
  const picked: Array<SelectedFinalQueueItem<T>> = []
  const pickedByChannel: Record<ChannelId, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 }
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

  // 硬门槛（artistGap）之外的第二道闸：满足了最小间隔但仍离得很近的同一歌手，权重打折。
  // 只降权重不排除，避免"整池都是同一歌手"时被降频把唯一候选也打死。
  const recentArtistPenalty = (item: T) => {
    if (!item.artistKeys.length) return 1
    const sharesArtist = (entry: FinalQueueItem) => entry.artistKeys.some(artist => item.artistKeys.includes(artist))
    const c = recommendationConfig.antiRepeat
    if (countInLast(history, c.recentArtistWindow, sharesArtist) > 0) return c.recentArtistFactor
    if (countInLast(history, c.midArtistWindow, sharesArtist) > 0) return c.midArtistFactor
    return 1
  }

  const weightFor = (item: T, channel: ChannelId) => {
    const base = item.channelWeights?.[channel] ?? item.weight
    const exposurePenalty = 1 / (1 + Math.max(0, item.exposureCount ?? 0) * 0.35)
    // 同一作品的不同版本（Live/Remix 等）在最近 20 首出现过时软降频。
    const variantPenalty = item.workKey && countInLast(history, 20, entry => !!entry.workKey && entry.workKey == item.workKey) > 0
      ? recommendationConfig.antiRepeat.variantSoftFactor
      : 1
    return Math.max(recommendationConfig.softmax.minWeight, base * exposurePenalty * variantPenalty * recentArtistPenalty(item))
  }

  // 门槛只比较通道基础分（质量），不含曝光/同版本/同歌手这三种软降频：否则软降频会被门槛放大成硬排除。
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
        const eligible = [...unused].filter(item => item.channels.includes(channel) && checkItemConstraints(item, history, relax, langGuard))
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
      let pool = [...unused].filter(item => checkItemConstraints(item, history, fallbackRelax, langGuard))
      // 末档仍被连播规则卡死时，说明池里真的没有第二种语言可选。此时宁可连播同一语种
      // 也不要把队列截断（旧行为：整池同语种只出 2 首）；其余约束（配额/歌手/歌单等）照旧生效。
      let consecutiveRelaxed = false
      if (!pool.length) {
        pool = [...unused].filter(item => checkItemConstraints(item, history, fallbackRelax, langGuard, true))
        consecutiveRelaxed = pool.length > 0
      }
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
      if (consecutiveRelaxed && !reasons.includes('lang_consecutive_relaxed')) reasons.push('lang_consecutive_relaxed')
    }

    const { chosen, channel: chosenChannel, relaxLevel: chosenRelax } = ladder
    if (!chosen || !chosenChannel) break
    if (gapRelaxed && !reasons.includes('exploration_gap_relaxed')) reasons.push('exploration_gap_relaxed')
    unused.delete(chosen)
    picked.push({ item: chosen, channel: chosenChannel })
    pickedByChannel[chosenChannel] = (pickedByChannel[chosenChannel] ?? 0) + 1
    history.push(chosen)
    if (history.length > 60) history.splice(0, history.length - 60)
    langGuard.langs.push(chosen.lang)
    if (langGuard.langs.length > 60) langGuard.langs.splice(0, langGuard.langs.length - 60)
    // 必须在扣额度**之前**读：`langWithinCap` 判的是 cap > 0，扣完之后"合法用掉最后一个名额"
    // 和"本来就超额"都是 0，两者就分不开了（实测：caps {zh:1} 与 {zh:0} 会给出同一条线索）
    const langOverCapAtPickTime = langGuard.enforced && !langWithinCap(chosen.lang, langGuard.remaining)
    if (chosen.lang && chosen.lang != 'unknown') {
      const remaining = langGuard.remaining[chosen.lang]
      if (remaining !== undefined) langGuard.remaining[chosen.lang] = Math.max(0, remaining - 1)
    }
    // 这首是在"语种配额已放开"的档位下才收下的：日志要能看出配额本轮没兑现，而不是假装满足
    if (langOverCapAtPickTime && !relaxConfigs[chosenRelax].langQuotaEnforced &&
      !reasons.includes('lang_quota_relaxed')) {
      reasons.push('lang_quota_relaxed')
    }
    if (chosenRelax > maxRelaxLevel) {
      maxRelaxLevel = chosenRelax
      if (chosenRelax > 0 && !reasons.includes(`relax_level_${chosenRelax}`)) reasons.push(`relax_level_${chosenRelax}`)
    }
  }

  return { items: picked, pickedByChannel, maxRelaxLevel, reasons }
}

export const countFinalChannels = (items: Array<{ channel?: ChannelId }>): Record<ChannelId, number> => {
  const counts: Record<ChannelId, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 }
  for (const item of items) {
    if (item.channel) counts[item.channel] += 1
  }
  return counts
}

export { getArtistKeys, getPrimaryArtist }
