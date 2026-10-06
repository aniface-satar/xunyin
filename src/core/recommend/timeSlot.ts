import { recommendationConfig as cfg } from './config.ts'
import type { RadioPlayRecord } from './types.ts'

/**
 * 时段画像（轻量版）：从播放历史（radioHistory，自带 artistKeys 与结算信息）
 * 实时聚合"当前时段"的歌手正负信号，给候选歌手一个温和的时段加成因子。
 * 不新增持久化状态——radioHistory 本身就是存储；旧记录无 artistKeys 自动跳过，
 * 随新播放逐步积累。样本不足时全部返回 1（不干预）。
 */

export type TimeSlot = 'morning' | 'afternoon' | 'evening' | 'night'

export const getTimeSlot = (now: number): TimeSlot => {
  const hour = new Date(now).getHours()
  const { morningStart, afternoonStart, eveningStart } = cfg.timeSlot
  if (hour >= morningStart && hour < afternoonStart) return 'morning'
  if (hour >= afternoonStart && hour < eveningStart) return 'afternoon'
  if (hour >= eveningStart && hour < 24) return 'evening'
  return 'night'
}

const NEUTRAL_REASONS = new Set(['natural_end', 'user_next', 'user_select_other'])

export interface TimeSlotAffinity {
  currentSlot: TimeSlot
  /** 候选歌手在当前时段的历史听感因子，钳位 [floor, ceiling]；无数据为 1。 */
  factorFor: (artistKeys: readonly string[]) => number
  sampleSize: number
}

export const computeTimeSlotAffinity = (
  radioHistory: readonly RadioPlayRecord[],
  now = Date.now(),
): TimeSlotAffinity => {
  const cfgSlot = cfg.timeSlot
  const currentSlot = getTimeSlot(now)
  const positive = new Map<string, number>()
  const negative = new Map<string, number>()
  let sampleSize = 0
  for (const record of radioHistory) {
    if (!record.artistKeys?.length) continue
    if (!record.endReason || !NEUTRAL_REASONS.has(record.endReason)) continue
    if (getTimeSlot(record.startedAt) != currentSlot) continue
    const isPositive = record.endReason == 'natural_end' && record.coverage >= cfgSlot.positiveMinCoverage
    const isNegative = record.endReason == 'user_next' && record.coverage < cfgSlot.negativeMaxCoverage
    if (!isPositive && !isNegative) continue
    sampleSize += 1
    for (const artist of record.artistKeys) {
      if (!artist) continue
      const map = isPositive ? positive : negative
      map.set(artist, (map.get(artist) ?? 0) + 1)
    }
  }
  return {
    currentSlot,
    sampleSize,
    factorFor: (artistKeys) => {
      if (sampleSize < cfgSlot.minSamples || !artistKeys?.length) return 1
      let pos = 0
      let neg = 0
      for (const artist of artistKeys) {
        pos = Math.max(pos, positive.get(artist) ?? 0)
        neg = Math.max(neg, negative.get(artist) ?? 0)
      }
      if (pos + neg <= 0) return 1
      // 温和：净倾向按总量归一后映射到 [floor, ceiling]
      const net = (pos - neg) / (pos + neg)
      const factor = 1 + net * (net >= 0 ? cfgSlot.factorCeiling - 1 : 1 - cfgSlot.factorFloor)
      return Math.max(cfgSlot.factorFloor, Math.min(cfgSlot.factorCeiling, factor))
    },
  }
}
