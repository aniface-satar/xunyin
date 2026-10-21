import { CHANNEL_IDS } from './types.ts'
import { QUOTA_LANG_BUCKETS } from './language.ts'
import type { ChannelId } from './types.ts'
import type { LangBucket } from './language.ts'

export interface QualitySelectedTrack {
  channel: ChannelId
  lang?: LangBucket
  /** 该曲此前真正播放过的次数；0 表示对用户仍是新歌。 */
  exposureCount: number
}

export interface QualityDiagnosticsInput {
  requested: number
  channelPlan: Partial<Record<ChannelId, number>>
  selected: readonly QualitySelectedTrack[]
  langCaps?: { enforced: boolean, caps: Partial<Record<LangBucket, number>> }
  /** 池里一首都没有的已声明语种桶：配额没兑现时用来区分"没货"和"判不出"。 */
  langUnmet?: readonly LangBucket[]
  reasons: readonly string[]
  maxRelaxLevel: number
  pool: { total: number, byLang?: Partial<Record<LangBucket, number>> }
  negativeRate: number | null
}

export interface ChannelFulfillment {
  target: number
  picked: number
  /** 目标为 0 时没有达成率可言，报 null 而不是除以 0。 */
  rate: number | null
}

export interface QualityDiagnosticsSummary {
  requested: number
  selected: number
  fillRate: number
  channels: Record<ChannelId, ChannelFulfillment>
  channelShortfall: number
  channelOverflow: number
  langEnforced: boolean
  langs: Partial<Record<LangBucket, { cap: number, picked: number, met: boolean }>>
  langUnmet: LangBucket[]
  /** 判不出语言（unknown / undefined）的占比；没有入选曲目时为 null。 */
  unknownShare: number | null
  noveltyRate: number | null
  relaxation: {
    maxLevel: number
    quotaRelaxed: boolean
    consecutiveRelaxed: boolean
    fallbackChannel: boolean
    starvation: boolean
    reasons: Record<string, number>
  }
  pool: { total: number, unknownShare: number | null }
  skipRate: number | null
}

const share = (part: number, total: number): number | null => total > 0 ? part / total : null

/**
 * 本地推荐质量汇总：只看这一轮生成的结果，不上传、不依赖后端。
 * 指标选择对应验收时要回答的问题：通道/语种配额兑现了吗、放开了哪些闸、
 * 新歌占比多少、会话负反馈有多高、池子够不够。
 */
export const buildQualityDiagnostics = (input: QualityDiagnosticsInput): QualityDiagnosticsSummary => {
  const selected = input.selected
  const channels: Record<ChannelId, ChannelFulfillment> = {
    A: { target: 0, picked: 0, rate: null },
    B: { target: 0, picked: 0, rate: null },
    C: { target: 0, picked: 0, rate: null },
    D: { target: 0, picked: 0, rate: null },
    E: { target: 0, picked: 0, rate: null },
  }
  let channelShortfall = 0
  let channelOverflow = 0
  for (const channel of CHANNEL_IDS) {
    const target = Math.max(0, input.channelPlan[channel] ?? 0)
    const picked = selected.filter(item => item.channel == channel).length
    channels[channel] = {
      target,
      picked,
      rate: target > 0 ? picked / target : null,
    }
    channelShortfall += Math.max(0, target - picked)
    channelOverflow += Math.max(0, picked - target)
  }

  const langCaps = input.langCaps
  const langEnforced = langCaps?.enforced === true
  const langs: QualityDiagnosticsSummary['langs'] = {}
  if (langEnforced) {
    for (const bucket of QUOTA_LANG_BUCKETS) {
      const cap = langCaps.caps[bucket]
      if (cap === undefined) continue
      const picked = selected.filter(item => item.lang == bucket).length
      langs[bucket] = { cap, picked, met: picked <= cap }
    }
  }

  const unknownSelected = selected.filter(item => !item.lang || item.lang == 'unknown').length
  const fresh = selected.filter(item => (item.exposureCount ?? 0) <= 0).length
  const reasons: Record<string, number> = {}
  for (const reason of input.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1

  return {
    requested: input.requested,
    selected: selected.length,
    fillRate: input.requested > 0 ? selected.length / input.requested : 0,
    channels,
    channelShortfall,
    channelOverflow,
    langEnforced,
    langs,
    langUnmet: [...(input.langUnmet ?? [])],
    unknownShare: share(unknownSelected, selected.length),
    noveltyRate: share(fresh, selected.length),
    relaxation: {
      maxLevel: input.maxRelaxLevel,
      quotaRelaxed: (reasons.lang_quota_relaxed ?? 0) > 0,
      consecutiveRelaxed: (reasons.lang_consecutive_relaxed ?? 0) > 0,
      fallbackChannel: (reasons.fallback_channel ?? 0) > 0,
      starvation: (reasons.no_candidate_after_relaxation ?? 0) > 0,
      reasons,
    },
    pool: {
      total: input.pool.total,
      unknownShare: share(input.pool.byLang?.unknown ?? 0, input.pool.total),
    },
    skipRate: input.negativeRate,
  }
}

const percent = (value: number | null) => value == null ? 'na' : `${Math.round(value * 100)}%`

/** 压成一行，供设置-日志页直接阅读；字段顺序固定，便于 grep。 */
export const formatQualityDiagnostics = (summary: QualityDiagnosticsSummary): string => {
  const channels = CHANNEL_IDS
    .map(channel => `${channel}${summary.channels[channel].picked}/${summary.channels[channel].target}`)
    .join(' ')
  const langs = QUOTA_LANG_BUCKETS
    .filter(bucket => summary.langs[bucket])
    .map(bucket => {
      const entry = summary.langs[bucket]!
      return `${bucket}${entry.picked}/${entry.cap}`
    })
    .join(' ') || 'none'
  const unmet = summary.langUnmet.join(',') || 'none'
  const relax = [
    summary.relaxation.quotaRelaxed && 'quota',
    summary.relaxation.consecutiveRelaxed && 'consecutive',
    summary.relaxation.fallbackChannel && 'fallback',
    summary.relaxation.starvation && 'starvation',
  ].filter(Boolean).join('+') || 'none'
  return `fill=${summary.selected}/${summary.requested} channels=${channels} short=${summary.channelShortfall} over=${summary.channelOverflow} langs=${langs} unmet=${unmet} unknown=${percent(summary.unknownShare)} novelty=${percent(summary.noveltyRate)} skip=${percent(summary.skipRate)} relax=${relax} level=${summary.relaxation.maxLevel} pool=${summary.pool.total}/unknown=${percent(summary.pool.unknownShare)}`
}
