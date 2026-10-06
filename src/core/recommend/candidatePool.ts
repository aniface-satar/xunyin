import { recommendationConfig } from './config.ts'
import { buildTrackKey, canonicalWorkKey, getAlbumName, getArtistKeys, getPrimaryArtist, normalizeText } from './trackKey.ts'
import { getExclusionReason, type ExclusionContext } from './filter.ts'
import { computePlaylistScore, computeProfileAffinity, decayWeight } from './similarity.ts'
import { sessionPenaltyFactor, sessionPenaltyScore, type SessionPenalties } from './sessionHealth.ts'
import { nameTokenFactor, type TokenWeightMap } from './tokenFeedback.ts'
import { artistPriorFactor, type ArtistStatsMap } from './artistPrior.ts'
import type { ChannelId, PlaylistPreference, PoolCandidate, ObservedPlaylist, RadioMode } from './types.ts'
import type { FinalQueueItem } from './diversity.ts'


/**
 * 抓取预算分区：详情读取是候选的唯一来源，必须先给它留出固定份额，
 * 剩下的才给搜索/标签/榜单这类发现型请求；预算过小时对半分，避免任一边归零。
 */
export const planRefreshBudget = (budget: number, detailFetches: number) => {
  const detailBudget = Math.min(detailFetches, Math.max(1, Math.floor(budget / 2)))
  return { detailBudget, discoveryBudget: Math.max(0, budget - detailBudget) }
}


export interface CreatePoolCandidateInput {
  musicInfo: LX.Music.MusicInfoOnline
  channel: ChannelId
  sourceId: string
  channels?: ChannelId[]
  playlistIds?: string[]
  seedTrackKeys?: string[]
  groupIds?: string[]
  chartId?: string
  chartRank?: number
  publishedTime?: number
  playCount?: number | null
  affinity?: number
  coOccurrence?: number
  exploration?: number
  confirmedSeedPlaylist?: boolean
  reason?: string
  now?: number
}

export const createPoolCandidate = (input: CreatePoolCandidateInput): PoolCandidate => {
  const trackKey = buildTrackKey(input.musicInfo)
  const channels = [...new Set([input.channel, ...(input.channels ?? [])])]
  const channelSourceId: Partial<Record<ChannelId, string>> = {}
  for (const channel of channels) channelSourceId[channel] = input.sourceId
  const primaryArtist = getPrimaryArtist(input.musicInfo)
  return {
    trackKey,
    musicInfo: input.musicInfo,
    channels,
    channelSourceId,
    playlistIds: [...new Set(input.playlistIds ?? [])],
    seedTrackKeys: [...new Set(input.seedTrackKeys ?? [])],
    groupIds: [...new Set(input.groupIds ?? [])],
    chartId: input.chartId,
    chartRank: input.chartRank,
    publishedTime: input.publishedTime,
    playCount: input.playCount ?? null,
    affinity: Math.max(0, Math.min(1, input.affinity ?? 0)),
    coOccurrence: Math.max(0, Math.min(1, input.coOccurrence ?? 0)),
    exploration: Math.max(0, Math.min(1, input.exploration ?? 0)),
    localFrequency: 1,
    observedPlaylistFrequency: input.playlistIds?.length ?? 0,
    exposureCount: 0,
    albumKey: normalizeText(getAlbumName(input.musicInfo)),
    artistKeys: getArtistKeys(input.musicInfo.singer),
    primaryArtist,
    addedAt: input.now ?? Date.now(),
    confirmedSeedPlaylist: input.confirmedSeedPlaylist ?? false,
    reasons: input.reason ? [input.reason] : [],
  }
}

/**
 * 合并来自多路/多歌单的同一首歌：通道、来源和种子合并，评分取较强者，不做无上限叠加。
 */
export const mergePoolCandidates = (
  existing: readonly PoolCandidate[],
  incoming: readonly PoolCandidate[],
  maxSize = recommendationConfig.candidatePool.maxSize,
): PoolCandidate[] => {
  const byKey = new Map<string, PoolCandidate>()
  for (const candidate of existing) byKey.set(candidate.trackKey, { ...candidate })
  for (const candidate of incoming) {
    const prev = byKey.get(candidate.trackKey)
    if (!prev) {
      byKey.set(candidate.trackKey, { ...candidate })
      continue
    }
    const mergedChannels = [...new Set([...prev.channels, ...candidate.channels])]
    const channelSourceId = { ...prev.channelSourceId }
    for (const channel of mergedChannels) {
      channelSourceId[channel] = candidate.channelSourceId[channel] ?? prev.channelSourceId[channel] ?? channelSourceId[channel]
    }
    byKey.set(candidate.trackKey, {
      ...prev,
      channels: mergedChannels,
      channelSourceId,
      playlistIds: [...new Set([...prev.playlistIds, ...candidate.playlistIds])],
      seedTrackKeys: [...new Set([...prev.seedTrackKeys, ...candidate.seedTrackKeys])],
      groupIds: [...new Set([...prev.groupIds, ...candidate.groupIds])],
      chartId: prev.chartId ?? candidate.chartId,
      chartRank: prev.chartRank ?? candidate.chartRank,
      publishedTime: prev.publishedTime ?? candidate.publishedTime,
      playCount: prev.playCount ?? candidate.playCount,
      affinity: Math.max(prev.affinity, candidate.affinity),
      coOccurrence: Math.max(prev.coOccurrence, candidate.coOccurrence),
      exploration: Math.max(prev.exploration, candidate.exploration),
      localFrequency: prev.localFrequency + 1,
      observedPlaylistFrequency: Math.max(prev.observedPlaylistFrequency, candidate.observedPlaylistFrequency),
      confirmedSeedPlaylist: prev.confirmedSeedPlaylist || candidate.confirmedSeedPlaylist,
      reasons: [...new Set([...prev.reasons, ...candidate.reasons])],
      addedAt: Math.min(prev.addedAt, candidate.addedAt),
    })
  }
  return capPoolSize([...byKey.values()], maxSize)
}

export const capPoolSize = (
  candidates: readonly PoolCandidate[],
  maxSize = recommendationConfig.candidatePool.maxSize,
): PoolCandidate[] => {
  if (candidates.length <= maxSize) return [...candidates]
  const sorted = [...candidates].sort((a, b) => {
    const scoreA = a.affinity + a.coOccurrence + a.exploration - a.exposureCount * 0.1
    const scoreB = b.affinity + b.coOccurrence + b.exploration - b.exposureCount * 0.1
    if (scoreA != scoreB) return scoreB - scoreA
    return b.addedAt - a.addedAt
  })
  return sorted.slice(0, maxSize)
}

export const filterPoolCandidates = (candidates: readonly PoolCandidate[], ctx: ExclusionContext): PoolCandidate[] => {
  return candidates.filter(candidate => {
    const reason = getExclusionReason({
      name: candidate.musicInfo.name,
      singer: candidate.musicInfo.singer,
      interval: candidate.musicInfo.interval,
      source: candidate.musicInfo.source,
      meta: candidate.musicInfo.meta,
    }, ctx)
    if (reason) {
      candidate.reasons = [...new Set([...candidate.reasons, `filtered:${reason}`])]
      return false
    }
    return true
  })
}

export interface FinalQueueBuildOptions {
  playlistPreferences?: Readonly<Record<string, PlaylistPreference>>
  observedPlaylists?: Readonly<Record<string, ObservedPlaylist>>
  exposureCounts?: Readonly<Record<string, number>>
  /** 画像种子数，用于把歌单种子重合数归一化为亲和度。 */
  seedCount?: number
  now?: number
  channelOrder?: readonly ChannelId[]
  /** radio 模式给 C/D 候选加亲和度闸门，explore 模式保持纯新颖度排序。 */
  mode?: RadioMode
  /** 近期负反馈命中的歌手/歌单，用于打分降权。 */
  sessionPenalties?: SessionPenalties
  /** 用户自己的播放序列与种子歌的会话共现分（SAR 移植），A 通道加分。 */
  sessionCoOccurrence?: ReadonlyMap<string, number>
  /** 歌单音频亲和度（已分析歌曲与品味质心的余弦），A 通道加分。 */
  playlistAudioAffinity?: Readonly<Record<string, number>>
  /** 歌名 token 学习权重（DJ版/Live/风格词），全通道乘性修正。 */
  tokenWeights?: TokenWeightMap
  /** 长期歌手先验（完播/切歌统计），全通道乘性修正。 */
  artistStats?: ArtistStatsMap
  /** 时段画像因子（当前时段的歌手听感），画像通道温和加成。 */
  timeSlotFactor?: (artistKeys: readonly string[]) => number
}

const playlistScoreFor = (
  candidate: PoolCandidate,
  options: FinalQueueBuildOptions,
) => {
  const now = options.now ?? Date.now()
  let best = 0
  for (const playlistId of candidate.playlistIds) {
    const pref = options.playlistPreferences?.[playlistId]
    const observed = options.observedPlaylists?.[playlistId]
    if (!pref && !observed) continue
    const elapsed = Math.max(0, now - (pref?.lastDecayTime ?? now))
    const positive = decayWeight(pref?.positiveWeight ?? 0, elapsed, recommendationConfig.playlistScore.feedbackHalfLifeDays)
    const negative = decayWeight(pref?.negativeWeight ?? 0, elapsed, recommendationConfig.playlistScore.feedbackHalfLifeDays)
    const exposure = pref?.exposureCount ?? 0
    // 亲和度按种子重合/规模归一化到 0~1，避免原始重合数直接钳位。
    const affinity = observed
      ? computeProfileAffinity(
        observed.seedOverlap,
        observed.weakThemeScore,
        Math.max(1, options.seedCount ?? 8),
        Math.max(1, observed.fetchedTracks.length),
      )
      : candidate.affinity
    const score = computePlaylistScore(affinity, positive, negative, exposure).score
    best = Math.max(best, score)
  }
  return best
}

const channelWeightsFor = (
  candidate: PoolCandidate,
  options: FinalQueueBuildOptions,
): Partial<Record<ChannelId, number>> => {
  const now = options.now ?? Date.now()
  const playlistScore = playlistScoreFor(candidate, options)
  const exposure = options.exposureCounts?.[candidate.trackKey] ?? candidate.exposureCount
  const lowExposure = 1 / (1 + Math.max(0, exposure) * 0.5)
  const chartNovelty = candidate.chartRank != null
    ? Math.max(0.1, 1 - candidate.chartRank / 100)
    : 0.5
  const playCountNovelty = candidate.playCount == null
    ? 0.6
    : 1 / (1 + Math.log(1 + candidate.playCount / 100000))
  const localNovelty = 1 / (1 + Math.max(0, candidate.localFrequency - 1) * 0.25)
  // SAR 会话共现：与种子歌同场被积极听过的候选，在画像通道获得额外加分
  const sessionCoOcc = Math.max(0, Math.min(1, options.sessionCoOccurrence?.get(candidate.trackKey) ?? 0))
  // 音频品味传导：候选来源歌单里被分析过的歌曲与收听质心的平均相似度
  let audioAffinity = 0
  for (const playlistId of candidate.playlistIds) {
    audioAffinity = Math.max(audioAffinity, options.playlistAudioAffinity?.[playlistId] ?? 0)
  }
  const tokenFactor = nameTokenFactor(options.tokenWeights, candidate.musicInfo.name, now)
  const artistFactor = artistPriorFactor(options.artistStats, candidate.artistKeys, now)
  const weights: Partial<Record<ChannelId, number>> = {}
  for (const channel of candidate.channels) {
    let raw = 0
    switch (channel) {
      case 'A':
        raw = candidate.affinity * 0.4 + playlistScore * 0.22 + candidate.coOccurrence * 0.14 + sessionCoOcc * 0.14 + audioAffinity * 0.1
        // 时段画像：当前时段里你常听完的歌手获得温和加成
        if (options.timeSlotFactor) raw *= options.timeSlotFactor(candidate.artistKeys)
        break
      case 'B':
        raw = playlistScore * 0.6 + candidate.affinity * 0.25 + 0.15
        break
      case 'C':
        raw = candidate.exploration * 0.4 + lowExposure * 0.25 + playCountNovelty * 0.2 + localNovelty * 0.15
        break
      case 'D':
        raw = candidate.exploration * 0.35 + chartNovelty * 0.3 + lowExposure * 0.2 + candidate.affinity * 0.15
        break
    }
    // radio 模式下探索通道不做纯盲推：亲和度闸门让画像内候选优先于完全陌生的歌
    if ((channel == 'C' || channel == 'D') && options.mode != 'explore') {
      const floor = recommendationConfig.channels.explorationAffinityFloor
      raw = raw * (floor + (1 - floor) * candidate.affinity)
    }
    // 近期被连切/不喜欢的歌手与歌单，其剩余候选整体降分（软惩罚，不封死）
    raw *= sessionPenaltyFactor(sessionPenaltyScore(candidate.artistKeys, candidate.playlistIds, options.sessionPenalties))
    // 词面级学习：历史上总被切的"DJ版/翻唱"等降权，常被听完的风格词加分
    raw *= tokenFactor
    // 长期歌手先验：历史上总被切的歌手持续降权，常听完的歌手加分
    raw *= artistFactor
    if (candidate.playlistIds.some(playlistId => (options.playlistPreferences?.[playlistId]?.cooldownUntil ?? 0) > now)) raw *= 0.25
    weights[channel] = Math.max(0.01, Math.min(1, raw))
  }
  return weights
}

export const buildFinalQueueItems = (
  candidates: readonly PoolCandidate[],
  options: FinalQueueBuildOptions = {},
): FinalQueueItem[] => {
  return candidates.map(candidate => {
    const channelWeights = channelWeightsFor(candidate, options)
    const channels = (Object.keys(channelWeights) as ChannelId[]).filter(channel => channelWeights[channel] != null)
    const exposureCount = options.exposureCounts?.[candidate.trackKey] ?? candidate.exposureCount
    const maxWeight = channels.reduce((max, channel) => Math.max(max, channelWeights[channel] ?? 0), 0)
    return {
      key: candidate.trackKey,
      channels: channels.length ? channels : candidate.channels,
      channelWeights,
      channelSourceIds: candidate.channelSourceId,
      primaryArtist: candidate.primaryArtist,
      artistKeys: candidate.artistKeys,
      albumKey: candidate.albumKey,
      workKey: canonicalWorkKey(candidate.musicInfo.name, candidate.musicInfo.singer),
      sourcePlaylistId: candidate.playlistIds[0],
      sourceSeedTrackKey: candidate.seedTrackKeys[0],
      sourceClusterId: undefined,
      sourceChartId: candidate.chartId,
      groupIds: candidate.groupIds,
      exposureCount,
      weight: maxWeight || candidate.affinity || 0.1,
    }
  })
}

export const poolStats = (candidates: readonly PoolCandidate[]) => {
  const byChannel: Record<ChannelId, number> = { A: 0, B: 0, C: 0, D: 0 }
  for (const candidate of candidates) {
    for (const channel of candidate.channels) byChannel[channel] += 1
  }
  return {
    total: candidates.length,
    byChannel,
    confirmed: candidates.filter(candidate => candidate.confirmedSeedPlaylist).length,
  }
}
