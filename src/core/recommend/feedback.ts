import { recommendationConfig } from './config.ts'
import type { ChannelId, PlaylistPreference, RadioPlayRecord, ThemePreference } from './types.ts'

export type ExplicitFeedbackType = 'like' | 'unlike' | 'dislike' | 'add_to_playlist' | 'repeat'

export interface ExplicitFeedbackEvent {
  playId?: string
  trackKey: string
  type: ExplicitFeedbackType
  timestamp: number
  listId?: string
  sourcePlaylistId?: string
  channel?: ChannelId
}

export interface LedgerEntry {
  timestamp: number
  trackReward: number
  playlistPositive: number
  playlistNegative: number
  explicitNegative?: boolean
  explicitLike?: boolean
  explicitAdd?: boolean
  explicitRepeat?: boolean
  completion?: boolean
  earlySkip?: boolean
  /** 隐式结算是否已执行过一次（同一 playId 幂等）。 */
  implicitSettled?: boolean
  /** 该 playId 是否已为通道 bandit 记过一笔（显式/隐式共享，防止重复计数）。 */
  banditCounted?: boolean
}

export interface TrackEffect {
  key: string
  scoreDelta: number
  playCountDelta?: number
  completeCountDelta?: number
  skipCountDelta?: number
  earlySkipCountDelta?: number
  likeCountDelta?: number
  dislikeCountDelta?: number
  repeatDelta?: number
  addToPlaylistDelta?: number
  averageListenRatio?: number
}

export interface PlaylistEffect {
  id: string
  positiveDelta: number
  negativeDelta: number
  exposureDelta?: number
  negativeTrackKey?: string
  distinctNegativeTrackDelta?: number
  cooldownUntil?: number
}

export interface SettlementResult {
  ledgerEntry: LedgerEntry
  track?: TrackEffect
  playlist?: PlaylistEffect
  excludeTrackKey?: string
  reasons: string[]
  duplicate?: boolean
  suppressImplicit?: boolean
}

export const mergeIntervals = (intervals: ReadonlyArray<{ from: number, to: number }>) => {
  const sorted = intervals
    .map(interval => ({
      from: Math.max(0, Math.min(interval.from, interval.to)),
      to: Math.max(0, Math.max(interval.from, interval.to)),
    }))
    .sort((a, b) => a.from - b.from)
  const result: Array<{ from: number, to: number }> = []
  for (const interval of sorted) {
    const last = result[result.length - 1]
    if (!last || interval.from > last.to) result.push({ ...interval })
    else last.to = Math.max(last.to, interval.to)
  }
  return result
}

export const intervalsDuration = (intervals: ReadonlyArray<{ from: number, to: number }>) => {
  return mergeIntervals(intervals).reduce((total, interval) => total + Math.max(0, interval.to - interval.from), 0)
}

/**
 * 有效覆盖率：拖动/跳过区间不计入，反复播放同一区间只算一次。
 * 熄屏/后台 JS 定时器被暂停时，如果记录是自然播完且没有拖动到结尾，按可靠状态视为完整覆盖。
 */
export const computeEffectiveCoverage = (record: Pick<RadioPlayRecord, 'intervals' | 'durationMs' | 'endReason' | 'seekedToEnd' | 'listenedMs'>) => {
  const duration = record.durationMs ?? 0
  const unionListened = intervalsDuration(record.intervals)
  if (duration > 0) {
    const unionCoverage = Math.max(0, Math.min(1, unionListened / duration))
    if (record.endReason == 'natural_end' && !record.seekedToEnd && unionCoverage < 0.8) return Math.max(unionCoverage, 1)
    return unionCoverage
  }
  return record.listenedMs > 0 ? Math.min(1, record.listenedMs / Math.max(1, record.listenedMs + 30000)) : 0
}

export const isLowConfidenceDuration = (record: Pick<RadioPlayRecord, 'durationMs'>) => {
  const duration = record.durationMs ?? 0
  return duration <= 0 || duration < recommendationConfig.playlistFeedback.fullSongMinSeconds * 1000
}

/**
 * 隐式播放结束结算。幂等由调用方用 ledger 检查；同一 playId 只结算一次。
 */
export const settlePlayRecord = (
  record: RadioPlayRecord,
  config = recommendationConfig.playlistFeedback,
): SettlementResult => {
  const reasons: string[] = []
  const ledgerEntry: LedgerEntry = {
    timestamp: record.endedAt ?? Date.now(),
    trackReward: 0,
    playlistPositive: 0,
    playlistNegative: 0,
    implicitSettled: true,
  }
  const lowConfidence = isLowConfidenceDuration(record)
  const coverage = computeEffectiveCoverage(record)
  const endReason = record.endReason ?? 'unknown'
  const listenedMs = record.listenedMs
  const playlistId = record.sourcePlaylistId
  const result: SettlementResult = { ledgerEntry, reasons }

  if (endReason == 'dislike' || endReason == 'play_error' || endReason == 'load_error' || endReason == 'app_destroy') {
    reasons.push(`neutral_end:${endReason}`)
    return result
  }

  const isManualNegative = endReason == 'user_next' || endReason == 'user_select_other' || endReason == 'radio_switch'
  if (isManualNegative) {
    if (lowConfidence) {
      reasons.push('skip_low_confidence_duration')
      return result
    }
    // 听不足 10 秒、或进度不到 15% 就切走，都算早切（后者覆盖"三分钟的歌听了 25 秒就切"）
    if (listenedMs < config.earlySkipMaxSeconds * 1000 || coverage < config.earlySkipMaxCoverage) {
      ledgerEntry.trackReward = -Math.abs(recommendationConfig.behavior.earlySkip)
      ledgerEntry.playlistNegative = config.earlySkip
      result.track = { key: record.trackKey, scoreDelta: ledgerEntry.trackReward, earlySkipCountDelta: 1 }
      if (playlistId) {
        result.playlist = {
          id: playlistId,
          positiveDelta: 0,
          negativeDelta: config.earlySkip,
          negativeTrackKey: record.trackKey,
        }
      }
      ledgerEntry.earlySkip = true
      reasons.push('early_skip')
      return result
    }
    if (coverage >= config.coverageCompleteThreshold) {
      ledgerEntry.trackReward = recommendationConfig.behavior.complete
      ledgerEntry.playlistPositive = config.listenOver80
      result.track = { key: record.trackKey, scoreDelta: ledgerEntry.trackReward, completeCountDelta: 1, averageListenRatio: coverage }
      if (playlistId) result.playlist = { id: playlistId, positiveDelta: config.listenOver80, negativeDelta: 0 }
      ledgerEntry.completion = true
      reasons.push('listen_over_80')
      return result
    }
    reasons.push('partial_skip_neutral')
    return result
  }

  if (endReason == 'natural_end') {
    if (lowConfidence) {
      reasons.push('complete_low_confidence_neutral')
      return result
    }
    if (coverage >= config.coverageCompleteThreshold && !record.seekedToEnd) {
      ledgerEntry.trackReward = recommendationConfig.behavior.complete
      ledgerEntry.playlistPositive = config.listenOver80
      result.track = { key: record.trackKey, scoreDelta: ledgerEntry.trackReward, completeCountDelta: 1, averageListenRatio: coverage }
      if (playlistId) result.playlist = { id: playlistId, positiveDelta: config.listenOver80, negativeDelta: 0 }
      ledgerEntry.completion = true
      reasons.push('complete')
      return result
    }
    reasons.push(record.seekedToEnd ? 'seek_to_end_not_complete' : 'complete_low_coverage_neutral')
    return result
  }

  reasons.push(`neutral_end:${endReason}`)
  return result
}

export const createPlaylistPreference = (playlistId: string, now = Date.now()): PlaylistPreference => ({
  playlistId,
  score: 0,
  positiveCount: 0,
  negativeCount: 0,
  positiveWeight: 0,
  negativeWeight: 0,
  lastDecayTime: now,
  exposureCount: 0,
  consecutiveNegativeCount: 0,
  lastUsedTime: now,
})

/** 反馈计数按 30 天半衰期衰减；显式歌曲屏蔽不存于歌单计数，因此不受影响。 */
export const decayPlaylistPreference = (
  pref: PlaylistPreference,
  now = Date.now(),
  halfLifeDays = recommendationConfig.playlistScore.feedbackHalfLifeDays,
): PlaylistPreference => {
  if (!pref.lastDecayTime) return { ...pref, lastDecayTime: now }
  const elapsed = Math.max(0, now - pref.lastDecayTime)
  if (elapsed < 60000) return pref
  return {
    ...pref,
    positiveWeight: decayWeight(pref.positiveWeight, elapsed, halfLifeDays),
    negativeWeight: decayWeight(pref.negativeWeight, elapsed, halfLifeDays),
    lastDecayTime: now,
  }
}

const decayWeight = (value: number, elapsedMs: number, halfLifeDays: number) => {
  if (!value) return 0
  return value * Math.pow(0.5, elapsedMs / (Math.max(1, halfLifeDays) * 86400000))
}

export const createThemePreference = (themeId: string, now = Date.now()): ThemePreference => ({
  themeId,
  positiveWeight: 0,
  negativeWeight: 0,
  lastDecayTime: now,
  lastUsedTime: now,
})

export const decayThemePreference = (
  pref: ThemePreference,
  now = Date.now(),
  halfLifeDays = recommendationConfig.themeFeedback.halfLifeDays,
): ThemePreference => {
  if (!pref.lastDecayTime) return { ...pref, lastDecayTime: now }
  const elapsed = Math.max(0, now - pref.lastDecayTime)
  if (elapsed < 60000) return pref
  return {
    ...pref,
    positiveWeight: decayWeight(pref.positiveWeight, elapsed, halfLifeDays),
    negativeWeight: decayWeight(pref.negativeWeight, elapsed, halfLifeDays),
    lastDecayTime: now,
  }
}

/** 把歌单级正/负增量按系数折算进所属分类；直接改动传入的 map（与状态存储共享引用）。 */
export const applyThemeFeedback = (
  themes: Record<string, ThemePreference>,
  themeId: string,
  positiveDelta: number,
  negativeDelta: number,
  now = Date.now(),
): ThemePreference => {
  const cfg = recommendationConfig.themeFeedback
  const base = decayThemePreference(themes[themeId] ?? createThemePreference(themeId, now), now)
  const pref: ThemePreference = {
    ...base,
    positiveWeight: Math.max(0, base.positiveWeight + positiveDelta * cfg.positiveFactor),
    negativeWeight: Math.max(0, base.negativeWeight + negativeDelta * cfg.negativeFactor),
    lastUsedTime: now,
  }
  themes[themeId] = pref
  return pref
}

export const themeNetWeight = (themes: Record<string, ThemePreference>, themeId: string | undefined, now = Date.now()): number => {
  if (!themeId) return 0
  const pref = themes[themeId]
  if (!pref) return 0
  const decayed = decayThemePreference(pref, now)
  return decayed.positiveWeight - decayed.negativeWeight
}

/** 主题净权重对亲和力的乘性偏置：正反馈最多 +affinityBias，负反馈按 1.5 倍幅度降权。 */
export const themeAffinityFactor = (net: number): number => {
  const cfg = recommendationConfig.themeFeedback
  const normalized = Math.max(-1, Math.min(1, net / cfg.saturation))
  const factor = normalized >= 0
    ? 1 + cfg.affinityBias * normalized
    : 1 + cfg.affinityBias * 1.5 * normalized
  return Math.max(0.1, factor)
}

const maxPositiveDelta = (target: number, applied: number) => Math.max(0, target - applied)

/**
 * 显式反馈结算。明确反馈优先于隐式反馈：同一 playId 上只补差，不重复叠加完整奖励。
 * 返回的 delta 是相对已有 ledger 的增量。
 */
export const settleExplicitFeedback = (
  event: ExplicitFeedbackEvent,
  previous?: LedgerEntry,
  record?: Pick<RadioPlayRecord, 'sourcePlaylistId'>,
): SettlementResult => {
  const reasons: string[] = []
  const playlistId = event.sourcePlaylistId ?? record?.sourcePlaylistId
  const base: LedgerEntry = previous
    ? { ...previous }
    : { timestamp: event.timestamp, trackReward: 0, playlistPositive: 0, playlistNegative: 0 }
  base.timestamp = event.timestamp
  const result: SettlementResult = { ledgerEntry: base, reasons }
  const wasNegative = previous?.explicitNegative === true
  const playlistDelta = { positiveDelta: 0, negativeDelta: 0 }

  const applyTrackReward = (target: number) => {
    const delta = Math.max(target - base.trackReward, 0)
    base.trackReward = Math.max(base.trackReward, target)
    return delta
  }
  const applyPlaylistPositive = (target: number) => {
    const delta = maxPositiveDelta(target, base.playlistPositive)
    base.playlistPositive = Math.max(base.playlistPositive, target)
    playlistDelta.positiveDelta += delta
  }
  const applyPlaylistNegative = (target: number) => {
    const delta = Math.max(target - base.playlistNegative, 0)
    base.playlistNegative = Math.max(base.playlistNegative, target)
    playlistDelta.negativeDelta += delta
  }

  switch (event.type) {
    case 'like': {
      if (wasNegative) {
        // 明确喜欢撤回同一次播放的明确不喜欢；这是撤回，不是负反馈。
        const trackDelta = recommendationConfig.behavior.like - base.trackReward
        playlistDelta.positiveDelta += recommendationConfig.playlistFeedback.like - base.playlistPositive
        playlistDelta.negativeDelta -= base.playlistNegative
        base.trackReward = recommendationConfig.behavior.like
        base.playlistPositive = recommendationConfig.playlistFeedback.like
        base.playlistNegative = 0
        base.explicitNegative = false
        base.explicitLike = true
        result.track = { key: event.trackKey, scoreDelta: trackDelta, likeCountDelta: 1 }
        result.excludeTrackKey = undefined
        reasons.push('explicit_like_after_dislike_retract')
      } else {
        const trackDelta = applyTrackReward(recommendationConfig.behavior.like)
        applyPlaylistPositive(recommendationConfig.playlistFeedback.like)
        result.track = { key: event.trackKey, scoreDelta: trackDelta, likeCountDelta: 1 }
        base.explicitLike = true
        reasons.push(trackDelta ? 'explicit_like' : 'explicit_like_already_counted')
      }
      break
    }
    case 'unlike': {
      const trackDelta = -base.trackReward
      playlistDelta.positiveDelta -= base.playlistPositive
      base.trackReward = 0
      base.playlistPositive = 0
      base.explicitLike = false
      result.track = { key: event.trackKey, scoreDelta: trackDelta, likeCountDelta: -1 }
      reasons.push('explicit_unlike_withdraw')
      break
    }
    case 'add_to_playlist': {
      const trackDelta = applyTrackReward(recommendationConfig.behavior.addToPlaylist)
      applyPlaylistPositive(recommendationConfig.playlistFeedback.addToPlaylist)
      base.explicitAdd = true
      result.track = { key: event.trackKey, scoreDelta: trackDelta, addToPlaylistDelta: 1 }
      reasons.push(trackDelta ? 'explicit_add_to_playlist' : 'explicit_add_already_counted')
      break
    }
    case 'repeat': {
      const trackDelta = applyTrackReward(recommendationConfig.behavior.repeat)
      base.explicitRepeat = true
      result.track = { key: event.trackKey, scoreDelta: trackDelta, repeatDelta: 1 }
      reasons.push(trackDelta ? 'explicit_repeat' : 'explicit_repeat_already_counted')
      break
    }
    case 'dislike': {
      const targetTrack = -Math.abs(recommendationConfig.behavior.dislike)
      const trackDelta = targetTrack - base.trackReward
      playlistDelta.positiveDelta -= base.playlistPositive
      applyPlaylistNegative(recommendationConfig.playlistFeedback.dislike)
      base.trackReward = targetTrack
      base.playlistPositive = 0
      base.explicitNegative = true
      result.track = { key: event.trackKey, scoreDelta: trackDelta, dislikeCountDelta: 1 }
      result.excludeTrackKey = event.trackKey
      reasons.push('explicit_dislike')
      break
    }
  }

  if (playlistId && (playlistDelta.positiveDelta || playlistDelta.negativeDelta)) {
    result.playlist = {
      id: playlistId,
      positiveDelta: playlistDelta.positiveDelta,
      negativeDelta: playlistDelta.negativeDelta,
      negativeTrackKey: event.type == 'dislike' ? event.trackKey : undefined,
    }
  }
  result.ledgerEntry = base
  return result
}

export const shouldSuppressImplicitSettlement = (entry?: LedgerEntry) => {
  if (!entry) return false
  return entry.explicitNegative === true || entry.explicitLike === true || entry.explicitAdd === true || entry.explicitRepeat === true || entry.completion === true
}

/** 隐式结算只执行一次；重复播放结束事件不重复记账（幂等由 playId 账本保证）。 */
export const shouldApplyImplicitSettlement = (entry?: LedgerEntry) => {
  if (entry?.implicitSettled) return false
  return !shouldSuppressImplicitSettlement(entry)
}

export const isDuplicatePlayId = (
  ledger: Readonly<Record<string, LedgerEntry>>,
  playId: string | undefined,
) => {
  if (!playId) return false
  return ledger[playId] != null
}

export const trimLedger = (
  ledger: Record<string, LedgerEntry>,
  limit = recommendationConfig.storage.feedbackLedgerLimit,
) => {
  const entries = Object.entries(ledger)
  if (entries.length <= limit) return ledger
  entries.sort((a, b) => b[1].timestamp - a[1].timestamp)
  const next: Record<string, LedgerEntry> = {}
  for (const [playId, entry] of entries.slice(0, limit)) next[playId] = entry
  return next
}
