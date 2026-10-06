import { recommendationConfig } from './config.ts'
import { getState, saveState, trimState } from './storage.ts'
import { saveCandidateCache } from './candidateStore.ts'
import { createPlaylistPreference, decayPlaylistPreference, applyThemeFeedback, settleExplicitFeedback, settlePlayRecord, computeEffectiveCoverage, shouldApplyImplicitSettlement, type LedgerEntry, type SettlementResult } from './feedback.ts'
import { pushSessionTrack } from './session.ts'
import { updateChannelBandit } from './bandit.ts'
import { applyNameTokenFeedback } from './tokenFeedback.ts'
import { applyArtistStatsFeedback } from './artistPrior.ts'
import { tokenizeTrackName } from './tokenize.ts'
import { buildTrackKey, getArtistKeys, getPrimaryArtist, normalizeText } from './trackKey.ts'
import type { ChannelId, RadioPlayRecord, TrackPreference } from './types.ts'

export interface BeginRadioPlayInput {
  playId: string
  trackKey: string
  musicInfo: LX.Music.MusicInfo
  channel?: ChannelId
  sourcePlaylistId?: string
  sourceSeedTrackKey?: string
  sourceClusterId?: string
  sourceChartId?: string
  platform?: string
}

const ensureTrack = (trackKey: string): TrackPreference => {
  const state = getState()
  let pref = state.tracks[trackKey]
  if (!pref) {
    pref = {
      trackKey,
      score: 0,
      playCount: 0,
      completeCount: 0,
      skipCount: 0,
      earlySkipCount: 0,
      likeCount: 0,
      dislikeCount: 0,
      repeatCount: 0,
      addToPlaylistCount: 0,
      averageListenRatio: 0,
      exposureCount: 0,
      lastPlayTime: 0,
    }
    state.tracks[trackKey] = pref
  }
  return pref
}

const ensurePlaylist = (playlistId: string) => {
  const state = getState()
  let pref = state.playlists[playlistId]
  if (!pref) {
    pref = createPlaylistPreference(playlistId)
    state.playlists[playlistId] = pref
  }
  return decayPlaylistPreference(pref)
}

const applyTrackEffect = (effect: NonNullable<SettlementResult['track']>) => {
  const pref = ensureTrack(effect.key)
  pref.score = Math.max(-30, Math.min(30, pref.score + effect.scoreDelta))
  if (effect.playCountDelta) pref.playCount += effect.playCountDelta
  if (effect.completeCountDelta) pref.completeCount += effect.completeCountDelta
  if (effect.skipCountDelta) pref.skipCount += effect.skipCountDelta
  if (effect.earlySkipCountDelta) pref.earlySkipCount += effect.earlySkipCountDelta
  if (effect.likeCountDelta) pref.likeCount = Math.max(0, pref.likeCount + effect.likeCountDelta)
  if (effect.dislikeCountDelta) pref.dislikeCount = Math.max(0, pref.dislikeCount + effect.dislikeCountDelta)
  if (effect.repeatDelta) pref.repeatCount += effect.repeatDelta
  if (effect.addToPlaylistDelta) pref.addToPlaylistCount += effect.addToPlaylistDelta
  if (effect.averageListenRatio != null) {
    const previousPlayCount = Math.max(1, pref.playCount - 1)
    pref.averageListenRatio = (pref.averageListenRatio * previousPlayCount + effect.averageListenRatio) / (previousPlayCount + 1)
  }
  if (effect.scoreDelta > 0) pref.lastPositiveTime = Date.now()
  if (effect.scoreDelta < 0) pref.lastNegativeTime = Date.now()
  return pref
}

const applyPlaylistEffect = (effect: NonNullable<SettlementResult['playlist']>, now = Date.now()) => {
  let pref = ensurePlaylist(effect.id)
  pref.positiveWeight = Math.max(0, pref.positiveWeight + effect.positiveDelta)
  pref.negativeWeight = Math.max(0, pref.negativeWeight + effect.negativeDelta)
  pref.positiveCount = Math.max(0, pref.positiveCount + (effect.positiveDelta > 0 ? 1 : effect.positiveDelta < 0 ? -1 : 0))
  pref.negativeCount = Math.max(0, pref.negativeCount + (effect.negativeDelta > 0 ? 1 : effect.negativeDelta < 0 ? -1 : 0))
  pref.lastUsedTime = now
  pref.lastDecayTime = now
  if (effect.negativeDelta > 0) {
    if (effect.negativeTrackKey && effect.negativeTrackKey != pref.lastNegativeTrackKey) {
      pref.distinctNegativeTracks = (pref.distinctNegativeTracks ?? 0) + 1
      pref.lastNegativeTrackKey = effect.negativeTrackKey
    }
    pref.consecutiveNegativeCount += 1
    // 单次负反馈不永久封禁；至少 3 首不同歌曲持续负反馈才进入临时冷却。
    if ((pref.distinctNegativeTracks ?? 0) >= 3 && pref.negativeWeight >= 0.75) {
      pref.cooldownUntil = now + recommendationConfig.playlistFeedback.cooldownMs
    }
  }
  if (effect.positiveDelta > 0) {
    pref.consecutiveNegativeCount = 0
    pref.cooldownUntil = undefined
  }
  getState().playlists[effect.id] = pref
  // 主题级学习：喜欢的歌加权其所在歌单的分类，不感兴趣让该分类整体降权
  const category = getState().observedPlaylists[effect.id]?.category
  const themeId = category ? normalizeText(category) : ''
  if (themeId && (effect.positiveDelta > 0 || effect.negativeDelta > 0)) {
    applyThemeFeedback(getState().themeWeights, themeId,
      Math.max(0, effect.positiveDelta), Math.max(0, effect.negativeDelta), now)
  }
  return pref
}

export const applySettlementResult = (result: SettlementResult) => {
  const state = getState()
  if (result.track) applyTrackEffect(result.track)
  if (result.playlist) applyPlaylistEffect(result.playlist)
  if (result.excludeTrackKey) state.dislikedTracks[result.excludeTrackKey] = Date.now()
  return result
}

export const getPlayRecord = (playId: string): RadioPlayRecord | undefined => {
  return getState().radioHistory.find(record => record.playId == playId)
}

export const isPlaySettled = (playId: string | undefined) => {
  if (!playId) return false
  return getState().settledPlayIds[playId] != null
}

/** 真正开始播放才记曝光；排队不算。 */
export const beginRadioPlay = (input: BeginRadioPlayInput): RadioPlayRecord => {
  const state = getState()
  const pref = ensureTrack(input.trackKey)
  const now = Date.now()
  pref.playCount += 1
  pref.lastPlayTime = now
  pref.exposureCount += 1
  state.exposureCounts[input.trackKey] = (state.exposureCounts[input.trackKey] ?? 0) + 1

  const record: RadioPlayRecord = {
    playId: input.playId,
    trackKey: input.trackKey,
    channel: input.channel,
    sourcePlaylistId: input.sourcePlaylistId,
    sourceSeedTrackKey: input.sourceSeedTrackKey,
    sourceClusterId: input.sourceClusterId,
    sourceChartId: input.sourceChartId,
    platform: input.platform,
    startedAt: now,
    intervals: [],
    listenedMs: 0,
    wallClockMs: 0,
    coverage: 0,
    settled: false,
    nameTokens: tokenizeTrackName(input.musicInfo.name),
    artistKeys: getArtistKeys(input.musicInfo.singer),
  }
  state.radioHistory.unshift(record)
  pushSessionTrack(state.session, {
    trackKey: input.trackKey,
    timestamp: now,
    channel: input.channel,
    sourcePlaylistId: input.sourcePlaylistId,
    sourceSeedTrackKey: input.sourceSeedTrackKey,
    sourceClusterId: input.sourceClusterId,
    sourceChartId: input.sourceChartId,
    artistKeys: getArtistKeys(input.musicInfo.singer),
  })
  trimState()
  saveState()
  return record
}

const setSessionTrackResult = (trackKey: string, ratio: number | undefined, liked?: boolean) => {
  const state = getState()
  const recent = state.session.recentTracks[0]
  if (!recent || recent.trackKey != trackKey) return
  recent.listenRatio = ratio
  if (liked != null) recent.liked = liked
}

/** 词面级反馈：结算信号记到歌名 token 上（DJ版/Live/风格词等），供后续打分乘性修正。 */
const applyTokenSettlement = (
  tokens: readonly string[] | undefined,
  ledger: LedgerEntry,
  now: number,
) => {
  if (!tokens?.length) return
  const tokenCfg = recommendationConfig.nameToken
  if (ledger.completion) applyNameTokenFeedback(getState().tokenWeights, tokens, tokenCfg.completePositive, 0, now)
  if (ledger.earlySkip) applyNameTokenFeedback(getState().tokenWeights, tokens, 0, tokenCfg.earlySkipNegative, now)
}

/** 长期歌手先验：同样的结算信号按歌手归因，半衰期更长，管"一直"而非"现在"。 */
const applyArtistSettlement = (
  artistKeys: readonly string[] | undefined,
  ledger: LedgerEntry,
  now: number,
) => {
  if (!artistKeys?.length) return
  const priorCfg = recommendationConfig.artistPrior
  if (ledger.completion) applyArtistStatsFeedback(getState().artistStats, artistKeys, priorCfg.completePositive, 0, now)
  if (ledger.earlySkip) applyArtistStatsFeedback(getState().artistStats, artistKeys, 0, priorCfg.earlySkipNegative, now)
}

/** bandit 单次结算只记一笔；显式反馈与隐式结算共享该标记（LedgerEntry.banditCounted）。 */
const maybeCountBandit = (
  ledger: LedgerEntry,
  channel: ChannelId | undefined,
  outcome: 'positive' | 'negative' | null,
  now: number,
) => {
  if (!outcome || ledger.banditCounted) return
  updateChannelBandit(getState().channelBandit, channel, outcome, now)
  ledger.banditCounted = true
}

/** 播放结束结算：同一 playId 幂等；已收到显式反馈时不再叠加隐式完整奖励。 */
export const finishRadioPlay = (record: RadioPlayRecord, endReason: NonNullable<RadioPlayRecord['endReason']>) => {
  const state = getState()
  const now = Date.now()
  const coverage = computeEffectiveCoverage({ ...record, endReason })
  const merged: RadioPlayRecord = {
    ...record,
    endReason,
    endedAt: now,
    coverage,
  }
  const index = state.radioHistory.findIndex(item => item.playId == record.playId)
  if (index >= 0) state.radioHistory[index] = merged
  else state.radioHistory.unshift(merged)

  const ledger = state.settledPlayIds[record.playId]
  if (shouldApplyImplicitSettlement(ledger)) {
    const result = settlePlayRecord(merged)
    applySettlementResult(result)
    result.ledgerEntry.banditCounted = ledger?.banditCounted
    applyTokenSettlement(merged.nameTokens, result.ledgerEntry, now)
    applyArtistSettlement(merged.artistKeys, result.ledgerEntry, now)
    maybeCountBandit(
      result.ledgerEntry,
      merged.channel,
      result.ledgerEntry.completion ? 'positive' : result.ledgerEntry.earlySkip ? 'negative' : null,
      now,
    )
    state.settledPlayIds[record.playId] = {
      ...state.settledPlayIds[record.playId],
      ...result.ledgerEntry,
      timestamp: now,
    }
    merged.settled = true
    merged.settlementReasons = result.reasons
  } else {
    // 显式反馈优先：只补充播放记录，不再重复结算隐式奖励。
    merged.settled = true
    merged.settlementReasons = ['explicit_feedback_supersedes_implicit']
  }

  const ratio = merged.durationMs ? merged.listenedMs / merged.durationMs : undefined
  setSessionTrackResult(record.trackKey, ratio)
  if (endReason == 'play_error' || endReason == 'load_error') {
    // 播放失败只影响资源可用性，不写入偏好。
  }
  trimState()
  saveState()
  return merged
}

export interface ExplicitFeedbackInput {
  type: 'like' | 'unlike' | 'dislike' | 'add_to_playlist' | 'repeat'
  trackKey: string
  musicInfo?: LX.Music.MusicInfo
  /** dislike 来自遮罩时只有歌名/歌手，用于词面学习与歌手先验。 */
  name?: string
  singer?: string
  playId?: string
  sourcePlaylistId?: string
  channel?: ChannelId
  listId?: string
  timestamp?: number
}

/** 显式反馈立即生效；重复事件按 playId 幂等，不重复叠加完整奖励。 */
export const applyExplicitFeedback = (input: ExplicitFeedbackInput) => {
  const state = getState()
  const timestamp = input.timestamp ?? Date.now()
  const playId = input.playId
  const previous = playId ? state.settledPlayIds[playId] : undefined
  const record = playId ? getPlayRecord(playId) : undefined
  const result = settleExplicitFeedback({
    playId,
    trackKey: input.trackKey,
    type: input.type,
    timestamp,
    listId: input.listId,
    sourcePlaylistId: input.sourcePlaylistId ?? record?.sourcePlaylistId,
    channel: input.channel ?? record?.channel,
  }, previous as LedgerEntry | undefined, record)

  applySettlementResult(result)
  if (playId) {
    state.settledPlayIds[playId] = {
      ...(previous ?? result.ledgerEntry),
      ...result.ledgerEntry,
      timestamp,
    }
    const historyRecord = state.radioHistory.find(item => item.playId == playId)
    if (historyRecord) {
      if (input.type == 'like') historyRecord.explicitLike = true
      if (input.type == 'unlike') historyRecord.explicitLike = false
      if (input.type == 'dislike') historyRecord.explicitDislike = true
      if (input.type == 'add_to_playlist') historyRecord.addToPlaylistListId = input.listId
    }
  }

  // 词面学习：显式信号比隐式结算更响
  const tokens = input.musicInfo?.name
    ? tokenizeTrackName(input.musicInfo.name)
    : input.name
      ? tokenizeTrackName(input.name)
      : (record?.nameTokens ?? undefined)
  const artistKeys = input.musicInfo
    ? getArtistKeys(input.musicInfo.singer)
    : input.singer
      ? getArtistKeys(input.singer)
      : record?.artistKeys ?? undefined
  const tokenCfg = recommendationConfig.nameToken
  const priorCfg = recommendationConfig.artistPrior
  if (input.type == 'like') {
    applyNameTokenFeedback(state.tokenWeights, tokens, tokenCfg.likePositive, 0, timestamp)
    applyArtistStatsFeedback(state.artistStats, artistKeys, priorCfg.likePositive, 0, timestamp)
  }
  if (input.type == 'add_to_playlist') {
    applyNameTokenFeedback(state.tokenWeights, tokens, tokenCfg.addToPlaylistPositive, 0, timestamp)
    applyArtistStatsFeedback(state.artistStats, artistKeys, priorCfg.addToPlaylistPositive, 0, timestamp)
  }
  if (input.type == 'dislike') {
    applyNameTokenFeedback(state.tokenWeights, tokens, 0, tokenCfg.dislikeNegative, timestamp)
    applyArtistStatsFeedback(state.artistStats, artistKeys, 0, priorCfg.dislikeNegative, timestamp)
  }

  // bandit：显式正/负反馈各记一笔（幂等由 ledger 标记保证）
  const channel = input.channel ?? record?.channel
  const outcome = input.type == 'like' || input.type == 'add_to_playlist'
    ? 'positive'
    : input.type == 'dislike' ? 'negative' : null
  if (outcome && channel && !previous?.banditCounted) {
    updateChannelBandit(state.channelBandit, channel, outcome, timestamp)
    if (playId) state.settledPlayIds[playId] = { ...state.settledPlayIds[playId], banditCounted: true }
  }

  if (input.type == 'like') setSessionTrackResult(input.trackKey, undefined, true)
  if (input.type == 'dislike') {
    state.candidateCache = state.candidateCache.filter(candidate => candidate.trackKey != input.trackKey)
    saveCandidateCache(state.candidateCache)
  }
  if (input.type == 'unlike') saveCandidateCache(state.candidateCache)
  trimState()
  saveState()
  return result
}

/**
 * 导入来源归因：本地收藏/自建歌单里的歌来自某个网络歌单时，给来源歌单记一次打折正反馈。
 * 电台推荐路径已对同一首歌全额归因，excludedPlaylistId 避免一次喜欢记两次。
 */
export const creditImportedOrigins = (
  origins: readonly string[],
  kind: 'like' | 'add_to_playlist',
  excludedPlaylistId?: string,
) => {
  const feedback = recommendationConfig.playlistFeedback
  // kind 沿用显式反馈的命名（add_to_playlist），配置键是 addToPlaylist，直接索引会得到 undefined → NaN 污染权重
  const delta = (kind == 'like' ? feedback.like : feedback.addToPlaylist) * feedback.importedOriginDiscount
  if (delta <= 0) return 0
  let credited = 0
  for (const origin of origins) {
    if (!origin || origin == excludedPlaylistId) continue
    applyPlaylistEffect({ id: origin, positiveDelta: delta, negativeDelta: 0 })
    credited++
  }
  if (credited) {
    trimState()
    saveState()
  }
  return credited
}

/** 收藏/加入歌单后，把该歌曲从未播放候选和本地队列移除。 */
export const removeTrackFromCandidates = (trackKey: string) => {
  const state = getState()
  const before = state.candidateCache.length
  state.candidateCache = state.candidateCache.filter(candidate => candidate.trackKey != trackKey)
  if (state.candidateCache.length != before) saveCandidateCache(state.candidateCache)
}

export const getRecentRadioTrackKeys = (days = recommendationConfig.exclusions.recentRadioDays, now = Date.now()): Set<string> => {
  const state = getState()
  const threshold = now - days * 86400000
  const keys = new Set<string>()
  for (const record of state.radioHistory) {
    if ((record.endedAt ?? record.startedAt) < threshold) continue
    keys.add(record.trackKey)
  }
  return keys
}

export const isRecentlyRadioPlayed = (trackKey: string, now = Date.now()) => {
  return getRecentRadioTrackKeys(recommendationConfig.exclusions.recentRadioDays, now).has(trackKey)
}

export const setSourceCooldown = (source: string, until = Date.now() + recommendationConfig.request.sourceCooldownMs) => {
  getState().sourceCooldowns[source] = until
  saveState()
}

export const isSourceCoolingDown = (source: string, now = Date.now()) => {
  return (getState().sourceCooldowns[source] ?? 0) > now
}


export { buildTrackKey, getPrimaryArtist }
