import { recommendationConfig } from './config.ts'
import { QUOTA_LANG_BUCKETS } from './language.ts'
import type { LangBucket } from './language.ts'

/**
 * 语种硬配额的纯算术层：问卷百分比 → 窗口目标数 → 本轮可选上限。
 * 执行点在 diversity.ts 的筛子里（消费 caps/连播），供给侧在 candidate.ts（消费缺口）。
 */

export const OPTION_TO_BUCKET: Record<string, LangBucket> = {
  zh: 'zh',
  cantonese: 'yue',
  western: 'en',
  ja: 'ja',
  ko: 'ko',
  other: 'other',
}

/**
 * 取队列尾部 windowSize 首。必须显式处理 0/负数：`arr.slice(-0)` 等于 `arr.slice(0)`，
 * 不夹紧就会把"本轮没有窗口"算成"整段历史都是本轮用量"。
 */
const windowSlice = <T>(items: readonly T[], windowSize: number): readonly T[] => {
  const size = Math.max(0, Math.floor(windowSize))
  return size === 0 ? [] : items.slice(-size)
}

export interface LangTargets {
  /** 已声明桶的目标首数；未声明的桶不在这里。 */
  targets: Partial<Record<LangBucket, number>>
  /** 窗口里没被任何声明桶占走的名额。 */
  free: number
  /** 问卷没滑过任何语言时为 false，本轮不设配额。 */
  enforced: boolean
}

/** 最大余数法：按占比把 total 首分给声明桶，同余数按声明顺序排前（照 channels.ts allocateByWeights）。 */
const allocateByPercents = (total: number, percents: Partial<Record<LangBucket, number>>): Partial<Record<LangBucket, number>> => {
  const result: Partial<Record<LangBucket, number>> = {}
  const buckets = QUOTA_LANG_BUCKETS.filter(bucket => (percents[bucket] ?? 0) > 0)
  const sum = buckets.reduce((acc, bucket) => acc + (percents[bucket] ?? 0), 0)
  if (sum <= 0 || total <= 0) return result
  const remainders: Array<{ bucket: LangBucket, remainder: number }> = []
  let allocated = 0
  for (const bucket of buckets) {
    const exact = total * (percents[bucket] ?? 0) / sum
    result[bucket] = Math.floor(exact)
    allocated += result[bucket]
    remainders.push({ bucket, remainder: exact - result[bucket] })
  }
  remainders.sort((a, b) => b.remainder - a.remainder)
  for (let i = allocated; i < total; i++) {
    const bucket = remainders[(i - allocated) % remainders.length].bucket
    result[bucket] = (result[bucket] ?? 0) + 1
  }
  return result
}

export const computeLangTargets = (
  weights: Record<string, number>,
  windowSize: number = recommendationConfig.channels.windowSize,
): LangTargets => {
  const percents: Partial<Record<LangBucket, number>> = {}
  for (const [optionId, raw] of Object.entries(weights)) {
    const bucket = OPTION_TO_BUCKET[optionId]
    if (!bucket || typeof raw != 'number' || !Number.isFinite(raw)) continue
    percents[bucket] = (percents[bucket] ?? 0) + Math.max(0, Math.min(100, raw))
  }
  const sum = QUOTA_LANG_BUCKETS.reduce((acc, bucket) => acc + (percents[bucket] ?? 0), 0)
  if (sum <= 0) return { targets: {}, free: Math.max(0, Math.floor(windowSize)), enforced: false }

  const window = Math.max(0, Math.floor(windowSize))
  // 合计 >100 时全部名额都给声明桶；<100 时只给占比对应的那一段，剩下算自由名额
  const declared = Math.min(window, Math.round(window * Math.min(sum, 100) / 100))
  const targets = allocateByPercents(declared, percents)
  const given = QUOTA_LANG_BUCKETS.reduce((acc, bucket) => acc + (targets[bucket] ?? 0), 0)
  return { targets, free: Math.max(0, window - given), enforced: true }
}

export const countLangUsed = (
  recentLangs: ReadonlyArray<LangBucket | undefined>,
  windowSize: number = recommendationConfig.channels.windowSize,
): Partial<Record<LangBucket, number>> => {
  const counts: Partial<Record<LangBucket, number>> = {}
  for (const lang of windowSlice(recentLangs, windowSize)) {
    if (!lang || lang == 'unknown') continue
    counts[lang] = (counts[lang] ?? 0) + 1
  }
  return counts
}

export interface LangCaps {
  enforced: boolean
  /** 只包含已声明桶；缺席即代表该桶不受配额约束。 */
  caps: Partial<Record<LangBucket, number>>
}

export const computeLangCaps = (
  targets: LangTargets,
  used: Partial<Record<LangBucket, number>>,
  tolerance: number = recommendationConfig.language.capTolerance,
): LangCaps => {
  if (!targets.enforced) return { enforced: false, caps: {} }
  const caps: Partial<Record<LangBucket, number>> = {}
  for (const bucket of QUOTA_LANG_BUCKETS) {
    const target = targets.targets[bucket]
    if (target === undefined) continue
    caps[bucket] = Math.max(0, target - (used[bucket] ?? 0)) + Math.max(0, Math.floor(tolerance))
  }
  return { enforced: true, caps }
}

/** 判不出语言的歌（unknown / undefined）放行：它既不能凑配额也不该被当成另一种语言卡住。 */
export const langWithinCap = (lang: LangBucket | undefined, caps: Partial<Record<LangBucket, number>>): boolean => {
  if (!lang || lang == 'unknown') return true
  const cap = caps[lang]
  if (cap === undefined) return true
  return cap > 0
}

/** 连播硬规则：只看队列尾部的同语言连续段，与窗口配额无关。 */
export const consecutiveLangAllowed = (
  recentLangs: ReadonlyArray<LangBucket | undefined>,
  lang: LangBucket | undefined,
  maxConsecutive: number = recommendationConfig.language.maxConsecutiveSameLang,
): boolean => {
  if (!lang || lang == 'unknown') return true
  let run = 0
  for (let i = recentLangs.length - 1; i >= 0; i--) {
    if (recentLangs[i] != lang) break
    run += 1
  }
  return run < Math.max(1, Math.floor(maxConsecutive))
}

export const instrumentalAllowed = (
  recentLangs: ReadonlyArray<LangBucket | undefined>,
  windowSize: number = recommendationConfig.channels.windowSize,
  maxPerWindow: number = recommendationConfig.language.instrumentalPerWindow,
): boolean => {
  let count = 0
  for (const lang of windowSlice(recentLangs, windowSize)) {
    if (lang == 'instr') count += 1
  }
  return count < Math.max(0, Math.floor(maxPerWindow))
}

/** 池内各桶现有多少首：L1 的 lang 优先，判不出才退 L2 的桶召回提示。 */
export const countPoolLang = (
  candidates: ReadonlyArray<{ lang?: LangBucket, langHint?: LangBucket }>,
): Partial<Record<LangBucket, number>> => {
  const counts: Partial<Record<LangBucket, number>> = {}
  for (const candidate of candidates) {
    const bucket = candidate.lang ?? candidate.langHint ?? 'unknown'
    counts[bucket] = (counts[bucket] ?? 0) + 1
  }
  return counts
}
