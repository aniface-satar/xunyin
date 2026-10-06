import { recommendationConfig } from './config.ts'
import { buildTrackKey, getArtistKeys, normalizeText } from './trackKey.ts'
import { buildTrackPlaylistIndex, computeCandidateCoOccurrence, computeProfileAffinity, groupSimilarPlaylists } from './similarity.ts'
import { buildPlaylistKeywords, pickChartBoard } from './profile.ts'
import { getLearnedStyleTokens } from './tokenFeedback.ts'
import { createPoolCandidate, mergePoolCandidates, planRefreshBudget } from './candidatePool.ts'
import { themeAffinityFactor, themeNetWeight } from './feedback.ts'
import { computePlayCountNumber, computeWeakThemeScore, normalizePlaylistKey, upsertObservedPlaylist, type PlaylistObservationInput } from './playlistIndex.ts'
import { getCatalogCapabilities, getChartBoards, getChartTracks, getPlaylistDetailPage, getPlaylistTags, getPlaylistsByTag, searchMusic, searchPlaylists } from './sdkCatalog.ts'
import type { DislikeRules } from './filter.ts'
import type { ChannelId, ObservedPlaylist, PoolCandidate, RadioProfile, RecommendationState } from './types.ts'

export interface KnownExternalPlaylist {
  id: string
  source: LX.OnlineSource
  sourceListId: string
  name?: string
}

export interface CatalogRefreshParams {
  source: LX.OnlineSource
  profile: RadioProfile
  state: RecommendationState
  libraryKeys: ReadonlySet<string>
  blocked: DislikeRules
  queuedTrackKeys: ReadonlySet<string>
  sessionTrackKeys: ReadonlySet<string>
  recentRadioTrackKeys: ReadonlySet<string>
  dislikedTrackKeys: ReadonlySet<string>
  knownExternalPlaylists?: readonly KnownExternalPlaylist[]
  signal?: { cancelled: boolean }
  now?: number
  budget?: number
  /** 轮换计数，避免每次只抓第一页/第一张榜。 */
  rotation?: number
}

export interface CatalogRefreshResult {
  candidates: PoolCandidate[]
  observedPlaylists: ObservedPlaylist[]
  requests: number
  reasons: string[]
}

const isExcluded = (
  musicInfo: LX.Music.MusicInfoOnline,
  params: CatalogRefreshParams,
) => {
  const trackKey = buildTrackKey(musicInfo)
  if (params.libraryKeys.has(trackKey)) return 'library'
  if (params.dislikedTrackKeys.has(trackKey)) return 'disliked'
  if (params.queuedTrackKeys.has(trackKey)) return 'queued'
  if (params.sessionTrackKeys.has(trackKey)) return 'session_played'
  if (params.recentRadioTrackKeys.has(trackKey)) return 'recent_radio_7d'
  const name = normalizeText(musicInfo.name)
  if (params.blocked.musicNames.has(name)) return 'blocked_song'
  for (const artist of getArtistKeys(musicInfo.singer)) {
    if (params.blocked.singerNames.has(artist)) return 'blocked_artist'
    if (params.blocked.names.has(`${name}@${artist}`)) return 'blocked_pair'
  }
  return undefined
}

export const playlistCoverageConfidence = (observed: Pick<ObservedPlaylist, 'coverage' | 'pagesFetched'>) => {
  return Math.max(0.15, Math.min(1, observed.coverage)) * (observed.pagesFetched > 0 ? 1 : 0.2)
}

export const createPlaylistCandidates = (
  observed: ObservedPlaylist,
  tracks: readonly LX.Music.MusicInfoOnline[],
  params: CatalogRefreshParams,
  channel: ChannelId,
): PoolCandidate[] => {
  const candidates: PoolCandidate[] = []
  const profileSeedCount = Math.max(1, params.profile.seedKeys.size)
  const affinity = computeProfileAffinity(
    observed.seedOverlap,
    observed.weakThemeScore,
    profileSeedCount,
    Math.max(1, observed.fetchedTracks.length),
  )
  const themeFactor = themeAffinityFactor(themeNetWeight(
    params.state.themeWeights,
    observed.category ? normalizeText(observed.category) : undefined,
    params.now ?? Date.now(),
  ))
  for (const musicInfo of tracks) {
    if (isExcluded(musicInfo, params)) continue
    const artistKeys = getArtistKeys(musicInfo.singer)
    const artistAffinity = artistKeys.reduce((sum, artist) => {
      const top = params.profile.topArtists.find(item => item.artist == artist)
      return sum + (top?.weight ?? 0)
    }, 0)
    const reasons: string[] = [`playlist:${observed.id}`]
    if (observed.confirmed) reasons.push('seed_overlap_confirmed')
    else reasons.push('weak_theme_only')
    candidates.push(createPoolCandidate({
      musicInfo,
      channel,
      sourceId: observed.id,
      channels: observed.confirmed ? [channel] : [channel],
      playlistIds: [observed.id],
      seedTrackKeys: observed.seedTrackKeys,
      groupIds: observed.groupId ? [observed.groupId] : [],
      affinity: Math.max(0, Math.min(1, Math.max(affinity, artistAffinity * 0.5) * themeFactor)),
      coOccurrence: 0,
      exploration: 1 - observed.confidence,
      playCount: observed.playCount,
      confirmedSeedPlaylist: observed.confirmed,
      reason: reasons.join(','),
      now: params.now,
    }))
  }
  return candidates
}

export const createChartCandidates = (
  tracks: Array<{ musicInfo: LX.Music.MusicInfoOnline, rank: number }>,
  chartId: string,
  params: CatalogRefreshParams,
): PoolCandidate[] => {
  const candidates: PoolCandidate[] = []
  for (const track of tracks) {
    if (isExcluded(track.musicInfo, params)) continue
    const artistKeys = getArtistKeys(track.musicInfo.singer)
    const artistAffinity = artistKeys.reduce((sum, artist) => {
      const top = params.profile.topArtists.find(item => item.artist == artist)
      return sum + (top?.weight ?? 0)
    }, 0)
    candidates.push(createPoolCandidate({
      musicInfo: track.musicInfo,
      channel: 'D',
      sourceId: `${params.source}::chart::${chartId}`,
      channels: artistAffinity > 0 ? ['D', 'A'] : ['D'],
      chartId,
      chartRank: track.rank,
      exploration: 0.8,
      affinity: Math.max(0.15, artistAffinity * 0.6),
      confirmedSeedPlaylist: false,
      reason: 'chart_rotation',
      now: params.now,
    }))
  }
  return candidates
}

/**
 * 画像歌手热门歌直采：歌单共现是"别人怎么整理"的间接信号，
 * 画像强歌手自己的热门歌是"你喜欢的人的歌"直接信号，两者互补。
 */
export const createArtistHitCandidates = (
  tracks: readonly LX.Music.MusicInfoOnline[],
  artist: string,
  params: CatalogRefreshParams,
): PoolCandidate[] => {
  const top = params.profile.topArtists.find(item => item.artist == artist)
  const affinity = Math.max(0.5, Math.min(1, top?.weight ?? 0))
  const candidates: PoolCandidate[] = []
  for (const musicInfo of tracks) {
    if (isExcluded(musicInfo, params)) continue
    candidates.push(createPoolCandidate({
      musicInfo,
      channel: 'A',
      sourceId: `artist_hits:${artist}`,
      channels: ['A'],
      affinity,
      coOccurrence: 0,
      exploration: 0.2,
      confirmedSeedPlaylist: false,
      reason: `artist_hits:${artist}`,
      now: params.now,
    }))
  }
  return candidates
}

interface SummaryWithHints {
  id: string
  source: LX.OnlineSource
  name: string
  author?: string
  desc?: string
  playCount?: string | number | null
  total?: string | number | null
  category?: string
  hints: Set<ChannelId>
  keyword?: string
}

export const refreshExternalCandidates = async(params: CatalogRefreshParams): Promise<CatalogRefreshResult> => {
  const budget = params.budget ?? recommendationConfig.request.maxRequestsPerRefresh
  const { discoveryBudget } = planRefreshBudget(budget, recommendationConfig.candidatePool.detailFetchesPerRefresh)
  const reasons: string[] = []
  let requests = 0
  let discoveryRequests = 0
  const source = params.source
  const caps = getCatalogCapabilities(source)
  const now = params.now ?? Date.now()
  const rotation = params.rotation ?? 0
  const observedById: Record<string, ObservedPlaylist> = {}
  const summaries: SummaryWithHints[] = []
  const summaryKeys = new Set<string>()

  const ensureBudget = () => {
    if (params.signal?.cancelled) throw new Error('request_cancelled')
    if (requests >= budget) throw new Error('request_budget_exhausted')
    requests += 1
  }
  const ensureDiscoveryBudget = () => {
    if (params.signal?.cancelled) throw new Error('request_cancelled')
    if (discoveryRequests >= discoveryBudget) throw new Error('request_budget_exhausted')
    discoveryRequests += 1
    requests += 1
  }

  const addSummary = (summary: { id: string, source: LX.OnlineSource, name?: string, author?: string, desc?: string, playCount?: string | number | null, total?: string | number | null, category?: string }, hints: ChannelId[], keyword?: string) => {
    if (!summary.id) return
    const normalizedId = String(summary.id)
    const key = normalizePlaylistKey(source, normalizedId)
    const existing = summaries.find(item => normalizePlaylistKey(item.source, item.id) == key)
    if (existing) {
      for (const hint of hints) existing.hints.add(hint)
      return
    }
    if (summaryKeys.has(key)) return
    summaryKeys.add(key)
    summaries.push({
      id: normalizedId,
      source,
      name: summary.name ?? '',
      author: summary.author,
      desc: summary.desc,
      playCount: summary.playCount,
      total: summary.total,
      category: summary.category,
      hints: new Set(hints),
      keyword,
    })
  }

  // 1. 已在本地记录过 source/sourceListId 的外部歌单（用户歌单同步来源）。
  for (const known of params.knownExternalPlaylists ?? []) {
    if (known.source != source) continue
    addSummary({
      id: known.sourceListId,
      source,
      name: known.name,
    }, ['A'])
  }

  // 2. 用种子歌名/歌手/自建歌单名/正反馈来源歌单名搜索候选歌单；搜索只用于发现歌单，详情读取后才确认种子重合。
  const positivePlaylistNames = Object.values(params.state.playlists)
    .filter(pref => pref.positiveWeight > 0)
    .sort((a, b) => b.positiveWeight - a.positiveWeight)
    .map(pref => normalizeText(params.state.observedPlaylists[pref.playlistId]?.name ?? ''))
    .filter(name => name)
  const keywordPool = [...new Set([
    ...positivePlaylistNames.slice(0, 2),
    ...buildPlaylistKeywords(params.profile, recommendationConfig.candidatePool.searchSeedsPerRefresh * 2,
      getLearnedStyleTokens(params.state.tokenWeights, 3)),
  ])]
  // 搜索窗口随 rotation 在关键词池中滑动，避免每轮固定抓同一批搜索结果
  const searchCount = Math.min(recommendationConfig.candidatePool.searchSeedsPerRefresh, keywordPool.length)
  const keywordStart = keywordPool.length ? Math.abs(rotation) % keywordPool.length : 0
  const keywords = Array.from({ length: searchCount },
    (_, i) => keywordPool[(keywordStart + i) % keywordPool.length])
  if (caps.canSearchPlaylist) {
    for (const keyword of keywords) {
      try {
        ensureDiscoveryBudget()
        const found = await searchPlaylists(source, keyword, 1, 15, { signal: params.signal })
        for (const summary of found) {
          // 保留接口返回的真实分类（category），主题学习依赖它；关键词只作发现线索
          addSummary(summary, ['A'], keyword)
        }
      } catch (error) {
        reasons.push(`playlist_search_failed:${keyword}`)
        if ((error as Error).message == 'request_cancelled' || (error as Error).message == 'request_budget_exhausted') break
      }
      if (params.signal?.cancelled) break
    }
  }

  // 3. 分类歌单列表轮换：优先画像加权过的分类，按 最新:最热=7:3 抓列表，让小众新歌单更多。
  if (caps.canTags && caps.canList) {
    try {
      ensureDiscoveryBudget()
      const tags = await getPlaylistTags(source, { signal: params.signal })
      if (tags.length) {
        const tagNet = (name: string | undefined) => themeNetWeight(params.state.themeWeights, name ? normalizeText(name) : undefined, now)
        const preferredTags = tags
          .map(tag => ({ tag, net: tagNet(tag.name) }))
          .filter(item => item.net > 0)
          .sort((a, b) => b.net - a.net)
        // 每 4 轮留 1 轮按全局轮换探索未加权分类，避免分类视野锁死
        const tag = preferredTags.length && rotation % 4 != 3
          ? preferredTags[rotation % preferredTags.length].tag
          : tags[rotation % tags.length]
        const tagNetWeight = tagNet(tag.name)
        const sorts = caps.sorts
        const newSort = sorts.find(sort => /最新|新歌|new/i.test(`${sort.name} ${sort.tid ?? ''}`))
        const hotSort = sorts.find(sort => /最热|热歌|热门|popular|hot/i.test(`${sort.name} ${sort.tid ?? ''}`)) ?? sorts[0]
        const wantNew = rotation % 10 < Math.round(recommendationConfig.candidatePool.newestListRatio * 10)
        // 源没有"最新"排序时降级：取到的热门列表按 D（宽范围探索）归位，不冒充 C 通道。
        const useNew = wantNew && newSort != null
        const sortId = (useNew ? newSort : hotSort)?.id ?? ''
        const page = 1 + (rotation % 3)
        ensureDiscoveryBudget()
        const playlists = await getPlaylistsByTag(source, tag.id, sortId, page, { signal: params.signal })
        for (const summary of playlists) {
          const hints: ChannelId[] = [useNew ? 'C' : 'D']
          // 自带分类缺失时落到 tag 名，保证主题学习有归属
          const category = summary.category ?? tag.name
          if (tagNetWeight > 0) hints.push('A')
          addSummary({ ...summary, category }, hints, tag.name)
        }
      }
    } catch (error) {
      reasons.push('playlist_list_failed')
    }
  }

  // 4. 榜单定向化：按画像关键词（含学到的风格词）选最贴合的榜单，无命中时退回轮换。
  let chartCandidates: PoolCandidate[] = []
  if (caps.canChart) {
    try {
      ensureDiscoveryBudget()
      const boards = await getChartBoards(source, { signal: params.signal })
      if (boards.length) {
        const board = pickChartBoard(boards, keywordPool, rotation)
        if (board) {
          ensureDiscoveryBudget()
          const page = await getChartTracks(source, board.id, 1 + (rotation % 2), { signal: params.signal })
          chartCandidates = createChartCandidates(page.tracks, board.id, params)
          reasons.push(`chart_rotated:${board.name || board.id}`)
        }
      }
    } catch (error) {
      reasons.push('chart_failed')
    }
  }

  // 5. 分批读取歌单详情，记录覆盖情况；只有读取详情后才确认是否包含种子歌曲。
  const playlistCandidates: PoolCandidate[] = []
  let detailFetches = 0
  // 给 C 通道预留一个详情位：否则 4 个额度永远被已知/搜索摘要吃光，最新/低曝光池恒为空
  const detailBudget = recommendationConfig.candidatePool.detailFetchesPerRefresh
  const cSummaries = summaries.filter(summary => summary.hints.has('C'))
  const mainSummaries = summaries.filter(summary => !summary.hints.has('C'))
  const orderedSummaries = [
    ...mainSummaries.slice(0, Math.max(1, detailBudget - (cSummaries.length ? 1 : 0))),
    ...(cSummaries.length ? [cSummaries[Math.abs(rotation) % cSummaries.length]] : []),
  ]
  const observedList = Object.values(params.state.observedPlaylists)
  for (const summary of orderedSummaries) {
    if (detailFetches >= detailBudget) break
    if (params.signal?.cancelled) break
    try {
      ensureBudget()
      detailFetches += 1
      const firstPage = await getPlaylistDetailPage(source, summary.id, 1, { signal: params.signal })
      let tracks = firstPage.tracks
      let pagesFetched = 1
      const total = Math.max(firstPage.total, tracks.length)
      const maxPages = Math.min(
        recommendationConfig.candidatePool.maxPagesPerPlaylist,
        Math.max(1, Math.ceil(total / Math.max(1, tracks.length || recommendationConfig.candidatePool.playlistFetchTracks))),
      )
      for (let page = 2; page <= maxPages; page++) {
        if (requests >= budget) break
        ensureBudget()
        const next = await getPlaylistDetailPage(source, summary.id, page, { signal: params.signal })
        if (!next.tracks.length) break
        tracks = tracks.concat(next.tracks)
        pagesFetched += 1
      }
      // 去重后按本地读取量记录覆盖，不把局部采样当完整歌单。
      const uniqueTracks: LX.Music.MusicInfoOnline[] = []
      const seenTracks = new Set<string>()
      for (const track of tracks) {
        const key = buildTrackKey(track)
        if (seenTracks.has(key)) continue
        seenTracks.add(key)
        uniqueTracks.push(track)
      }
      const seedTrackKeys: string[] = []
      let seedOverlap = 0
      for (const track of uniqueTracks) {
        const key = buildTrackKey(track)
        if (!params.profile.seedKeys.has(key)) continue
        seedTrackKeys.push(key)
        const seed = params.profile.seeds.find(item => item.trackKey == key)
        seedOverlap += seed?.score ?? 1
      }
      const weakThemeScore = computeWeakThemeScore({
        name: summary.name,
        author: summary.author,
        desc: summary.desc,
        category: summary.category,
      }, keywordPool)
      const observationInput: PlaylistObservationInput = {
        id: normalizePlaylistKey(source, summary.id),
        source,
        name: firstPage.name ?? summary.name,
        author: firstPage.author ?? summary.author,
        desc: firstPage.desc ?? summary.desc,
        category: summary.category,
        playCount: computePlayCountNumber(firstPage.playCount ?? summary.playCount ?? null),
        totalTracks: total,
        tracks: uniqueTracks.map(track => buildTrackKey(track)),
        pagesFetched,
        seedTrackKeys,
        seedOverlap,
        weakThemeScore,
        fetchedAt: now,
      }
      const existing = params.state.observedPlaylists[observationInput.id] ?? observedById[observationInput.id]
      const observed = upsertObservedPlaylist(existing, observationInput, now)
      observedById[observationInput.id] = observed

      const hints = new Set<ChannelId>(summary.hints)
      if (observed.confirmed) hints.add('A')
      const playlistPref = params.state.playlists[observationInput.id]
      if (playlistPref && (playlistPref.positiveWeight > 0 || playlistPref.positiveCount > 0)) hints.add('B')
      if (weakThemeScore > 0 && !observed.confirmed) hints.add('D')
      if (!hints.size) hints.add('C')
      // 最新/low-exposure 歌单归 C；已确认种子重合的强关联归 A。
      if (summary.hints.has('C')) hints.add('C')
      const primaryChannel = hints.has('A') ? 'A' : hints.has('B') ? 'B' : hints.has('D') ? 'D' : 'C'
      const created = createPlaylistCandidates(observed, uniqueTracks, params, primaryChannel)
      for (const candidate of created) {
        candidate.channels = [...new Set([...candidate.channels, ...hints])]
        candidate.observedPlaylistFrequency = Math.max(1, candidate.observedPlaylistFrequency)
      }
      playlistCandidates.push(...created)
      reasons.push(`detail_loaded:${summary.id}:${uniqueTracks.length}/${total}:${observed.confirmed ? 'confirmed' : 'weak'}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      reasons.push(`detail_failed:${summary.id}:${message}`)
      if (message == 'request_cancelled' || message == 'request_budget_exhausted') break
    }
  }

  // 6. 更新分组/倒排索引，并重新计算共现贡献。
  const combinedObserved = [
    ...observedList.filter(item => !observedById[item.id]),
    ...Object.values(observedById),
  ]
  const groupMap = groupSimilarPlaylists(combinedObserved)
  for (const observed of combinedObserved) {
    observed.groupId = groupMap[observed.id]
  }
  const trackPlaylistIndex = buildTrackPlaylistIndex(combinedObserved)
  let mergedCandidates = mergePoolCandidates([...playlistCandidates, ...chartCandidates], [], recommendationConfig.candidatePool.maxSize)
  for (const candidate of mergedCandidates) {
    candidate.coOccurrence = computeCandidateCoOccurrence(candidate.trackKey, {
      seedTrackKeys: params.profile.seedKeys,
      observedPlaylists: combinedObserved,
      index: trackPlaylistIndex,
    })
    candidate.observedPlaylistFrequency = trackPlaylistIndex[candidate.trackKey]?.playlistIds.length ?? 0
    for (const playlistId of candidate.playlistIds) {
      const observed = combinedObserved.find(item => item.id == playlistId)
      if (observed?.groupId) candidate.groupIds = [...new Set([...candidate.groupIds, observed.groupId])]
    }
  }

  // 5.5 画像歌手热门歌直采：rotation 在强歌手列表上滑动，每轮只采 2 人避免重复抓同批人
  const topWeight = params.profile.topArtists[0]?.weight ?? 0
  const strongArtists = params.profile.topArtists
    .filter(artist => artist.weight >= topWeight * recommendationConfig.profile.coldStart.strongArtistWeightRatio && artist.weight > 0)
    .filter(artist => !params.blocked.singerNames.has(artist.artist))
  const artistHitsPerRefresh = recommendationConfig.candidatePool.artistHitsPerRefresh
  if (strongArtists.length && caps.canMusicSearch) {
    const start = strongArtists.length ? Math.abs(rotation) % strongArtists.length : 0
    const picked = Array.from({ length: Math.min(artistHitsPerRefresh, strongArtists.length) },
      (_, i) => strongArtists[(start + i) % strongArtists.length])
    for (const artistEntry of picked) {
      if (requests >= budget) break
      try {
        ensureDiscoveryBudget()
        const tracks = await searchMusic(source, artistEntry.artist, 1, 15, { signal: params.signal })
        mergedCandidates = mergePoolCandidates(
          mergedCandidates,
          createArtistHitCandidates(tracks, artistEntry.artist, params),
          recommendationConfig.candidatePool.maxSize,
        )
        reasons.push(`artist_hits:${artistEntry.artist}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        reasons.push(`artist_hits_failed:${artistEntry.artist}:${message}`)
        if (message == 'request_cancelled' || message == 'request_budget_exhausted') break
      }
    }
  }

  if (mergedCandidates.length < recommendationConfig.candidatePool.minCacheForInstantStart && caps.canMusicSearch && requests < budget) {
    const keyword = params.profile.seeds[0]?.musicInfo.name ?? params.profile.seeds[0]?.primaryArtist
    if (keyword) {
      try {
        ensureBudget()
        const tracks = await searchMusic(source, keyword, 1, 20, { signal: params.signal })
        const supplements: PoolCandidate[] = []
        for (const musicInfo of tracks) {
          if (isExcluded(musicInfo, params)) continue
          supplements.push(createPoolCandidate({
            musicInfo,
            channel: 'A',
            sourceId: `music_search:${keyword}`,
            channels: ['A'],
            seedTrackKeys: params.profile.seeds.filter(seed => seed.musicInfo.name == musicInfo.name).map(seed => seed.trackKey),
            affinity: 0.45,
            coOccurrence: 0,
            exploration: 0.5,
            confirmedSeedPlaylist: false,
            reason: `music_search:${keyword}`,
            now,
          }))
        }
        mergedCandidates = mergePoolCandidates(mergedCandidates, supplements, recommendationConfig.candidatePool.maxSize)
        reasons.push('music_search_supplement')
      } catch {
        reasons.push('music_search_supplement_failed')
      }
    }
  }

  reasons.push(`refresh_stats:${JSON.stringify({ summaries: summaries.length, details: detailFetches, candidates: mergedCandidates.length })}`)
  return {
    candidates: mergedCandidates.slice(0, recommendationConfig.candidatePool.maxSize),
    observedPlaylists: combinedObserved,
    requests,
    reasons,
  }
}
