import { recommendationConfig } from './config.ts'
import { buildTrackKey, exactPairKey, getArtistKeys, normalizeText } from './trackKey.ts'
import { buildTrackPlaylistIndex, computeCandidateCoOccurrence, computeProfileAffinity, groupSimilarPlaylists } from './similarity.ts'
import { buildPlaylistKeywords, pickChartBoard, selectArtistHitTargets } from './profile.ts'
import type { SimilarAlbumPick } from './profile.ts'
import { getLearnedStyleTokens } from './tokenFeedback.ts'
import { createPoolCandidate, mergePoolCandidates, planRefreshBudget, resolvePoolLang } from './candidatePool.ts'
import { themeAffinityFactor, themeNetWeight } from './feedback.ts'
import { computePlayCountNumber, computeWeakThemeScore, normalizePlaylistKey, upsertObservedPlaylist, type PlaylistObservationInput } from './playlistIndex.ts'
import { getCatalogCapabilities, getChartBoards, getChartTracks, getPlaylistDetailPage, getPlaylistTags, getPlaylistsByTag, searchMusic, searchPlaylists } from './sdkCatalog.ts'
import { computeBucketDetailReserve, countPoolLang } from './languageQuota.ts'
import { normalizeLangTagId, pickPlaylistSort, pickWeightedTag, planLangBucketFetch } from './tabSections.ts'
import type { LangTargets } from './languageQuota.ts'
import type { ArtistLangTable, LangBucket } from './language.ts'
import type { SortSummary, TagSummary } from './sdkCatalog.ts'
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
  libraryPairKeys?: ReadonlySet<string>
  blocked: DislikeRules
  queuedTrackKeys: ReadonlySet<string>
  sessionTrackKeys: ReadonlySet<string>
  recentRadioTrackKeys: ReadonlySet<string>
  dislikedTrackKeys: ReadonlySet<string>
  knownExternalPlaylists?: readonly KnownExternalPlaylist[]
  signal?: { cancelled: boolean }
  now?: number
  budget?: number
  /** 偏好问卷规范词（按强度降序），插在画像关键词之前参与 rotation 窗口。 */
  explicitKeywords?: readonly string[]
  /** 轮换计数，避免每次只抓第一页/第一张榜。 */
  rotation?: number
  /** 语种硬配额的目标数（由引擎按问卷算好传入）；本模块据此决定要不要补哪个语种的货。 */
  langTargets?: LangTargets
  /** 歌手语言表：算池内语种分布时做读时推导，老候选不至于全算成 unknown。 */
  artistLangTable?: ArtistLangTable
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
  if (params.libraryPairKeys?.size && params.libraryPairKeys.has(exactPairKey(musicInfo.name, musicInfo.singer))) return 'library'
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
  langHint?: LangBucket,
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
      langHint,
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
  // 这里不当地闸门用：这只是个下限，抬高它只会让直采曲更容易活过相对质量门槛，
  // 反向助攻"熟歌手占领 A 池"；真正减供给的杠杆在每轮直采人数×首数那里。
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

export interface SimilarArtistContribution {
  seedArtist: string
  artistName: string
  tracks: readonly LX.Music.MusicInfoOnline[]
}

/**
 * 相似歌手通道 E：候选是 kg 按 MB 规范名搜来的热门歌，没有来源歌单可算分，
 * 亲和度由种子歌手的画像权重传导（相似是间接信号，封顶 0.9）；
 * 探索度固定偏低——E 的职责是画像延伸，撞新仍归 C/D。
 */
export const createSimilarArtistCandidates = (
  contributions: readonly SimilarArtistContribution[],
  params: CatalogRefreshParams,
): PoolCandidate[] => {
  const candidates: PoolCandidate[] = []
  for (const contribution of contributions) {
    const seedWeight = params.profile.topArtists.find(item => item.artist == contribution.seedArtist)?.weight ?? 0.3
    const affinity = Math.max(0.3, Math.min(0.9, seedWeight * 0.8))
    for (const musicInfo of contribution.tracks) {
      if (isExcluded(musicInfo, params)) continue
      candidates.push(createPoolCandidate({
        musicInfo,
        channel: 'E',
        sourceId: `similar_artist:${contribution.seedArtist}`,
        channels: ['E'],
        affinity,
        coOccurrence: 0,
        exploration: 0.3,
        confirmedSeedPlaylist: false,
        reason: `similar_artist:${contribution.seedArtist}`,
        now: params.now,
      }))
    }
  }
  return candidates
}

/**
 * 相似专辑扩展：种子歌手被显式收藏说明其目录已听得差不多，再从相似歌手的热门歌里
 * 挑一张"还有未入库曲目"的专辑取详情。亲和度同样由种子歌手权重传导并封顶 0.9。
 */
export const createSimilarAlbumCandidates = (
  albumPick: SimilarAlbumPick,
  tracks: readonly LX.Music.MusicInfoOnline[],
  params: CatalogRefreshParams,
): PoolCandidate[] => {
  const seedWeight = params.profile.topArtists.find(item => item.artist == albumPick.seedArtist)?.weight ?? 0.5
  const affinity = Math.max(0.3, Math.min(0.9, seedWeight * 0.8))
  const sourceId = `similar_album:${albumPick.seedArtist}:${albumPick.albumId}`
  const candidates: PoolCandidate[] = []
  for (const musicInfo of tracks) {
    if (isExcluded(musicInfo, params)) continue
    candidates.push(createPoolCandidate({
      musicInfo,
      channel: 'E',
      sourceId,
      channels: ['E'],
      affinity,
      coOccurrence: 0,
      exploration: 0.3,
      confirmedSeedPlaylist: false,
      reason: `similar_album:${albumPick.artistName}:${albumPick.albumName || albumPick.albumId}`,
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
  langHint?: LangBucket
}

/**
 * 分类/语种桶两条列表召回共用的排序档：最新:最热守 newestListRatio，
 * 源没有"最新"档时降级到最热，并如实报 useNew=false（让调用方把摘要归到 D 而不是冒充 C）。
 */
const pickListSort = (sorts: readonly SortSummary[], rotation: number): { sortId: string, useNew: boolean } => {
  const newSort = sorts.find(sort => /最新|新歌|new/i.test(`${sort.name} ${sort.tid ?? ''}`))
  const useNew = rotation % 10 < Math.round(recommendationConfig.candidatePool.newestListRatio * 10) && newSort != null
  return { sortId: (useNew ? newSort : pickPlaylistSort(sorts))?.id ?? '', useNew }
}

export const refreshExternalCandidates = async(params: CatalogRefreshParams): Promise<CatalogRefreshResult> => {
  const budget = params.budget ?? recommendationConfig.request.maxRequestsPerRefresh
  const { detailBudget, discoveryBudget } = planRefreshBudget(budget, recommendationConfig.candidatePool.detailFetchesPerRefresh)
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

  const addSummary = (summary: { id: string, source: LX.OnlineSource, name?: string, author?: string, desc?: string, playCount?: string | number | null, total?: string | number | null, category?: string }, hints: ChannelId[], keyword?: string, langHint?: LangBucket): SummaryWithHints | null => {
    if (!summary.id) return null
    const normalizedId = String(summary.id)
    const key = normalizePlaylistKey(source, normalizedId)
    const existing = summaries.find(item => normalizePlaylistKey(item.source, item.id) == key)
    if (existing) {
      for (const hint of hints) existing.hints.add(hint)
      // 同一张歌单也可能被别的步骤先登记过：语种提示只在缺席时补，不让后续批次覆盖
      if (langHint && !existing.langHint) existing.langHint = langHint
      return existing
    }
    if (summaryKeys.has(key)) return null
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
      langHint,
    })
    return summaries[summaries.length - 1]
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
    ...(params.explicitKeywords ?? []),
    ...positivePlaylistNames.slice(0, 2),
    ...buildPlaylistKeywords(params.profile, recommendationConfig.candidatePool.searchSeedsPerRefresh * 2,
      getLearnedStyleTokens(params.state.tokenWeights, 3),
      // 收藏歌手的歌单大多是"他的热门合集"，与推荐目标（相似歌手/专辑）相反，别搜回来
      (params.profile.likedArtists ?? []).map(item => item.name)),
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

  // 3. 分类歌单列表轮换：按学习到的分类权重抽样，按 最新:最热=7:3 抓列表，让小众新歌单更多。
  let catalogTags: TagSummary[] = []
  if (caps.canTags && caps.canList) {
    try {
      ensureDiscoveryBudget()
      const tags = await getPlaylistTags(source, { signal: params.signal })
      if (tags.length) {
        catalogTags = tags
        const tagNet = (name: string | undefined) => themeNetWeight(params.state.themeWeights, name ? normalizeText(name) : undefined, now)
        const tag = pickWeightedTag(tags, params.state.themeWeights, {
          rotation,
          temperature: recommendationConfig.antiRepeat.categoryRotationTemperature,
          now,
        })
        if (tag) {
          const tagNetWeight = tagNet(tag.name)
          const { sortId, useNew } = pickListSort(caps.sorts, rotation)
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

  // 4.5 语种桶缺口召回：配额能不能兑现取决于池里有没有货，所以先按缺口补货再读详情。
  const bucketSummaries: SummaryWithHints[] = []
  let unknownShare = 0
  if (params.langTargets?.enforced) {
    const poolCandidates = params.state.candidateCache
    const poolCounts = countPoolLang(poolCandidates.map(candidate => ({
      lang: resolvePoolLang(candidate, params.artistLangTable).bucket,
    })))
    // 缺口折算要垫到 targetSize（池还小时也得按满池的目标推），
    // 但 unknown 占比必须用真实长度：分母垫到 500 会让 spec §3.3 的"unknown > 30% 优先补货"
    // 在冷启动阶段永远够不着阈值，而那正是 unknown 最浓、最需要 L1 补货的时候。
    const poolSize = Math.max(poolCandidates.length, recommendationConfig.candidatePool.targetSize)
    unknownShare = poolCandidates.length ? (poolCounts.unknown ?? 0) / poolCandidates.length : 0
    const plan = planLangBucketFetch({
      source,
      targets: params.langTargets,
      poolCounts,
      poolSize,
      windowSize: recommendationConfig.channels.windowSize,
      maxBuckets: recommendationConfig.candidatePool.bucketFetchesPerRefresh,
      knownTagIds: catalogTags.length ? new Set(catalogTags.map(tag => normalizeLangTagId(source, String(tag.id)))) : undefined,
    })
    for (const entry of plan) {
      if (params.signal?.cancelled) break
      try {
        ensureDiscoveryBudget()
        const { sortId, useNew } = pickListSort(caps.sorts, rotation)
        // 分类归属要用目录里的真名：summary.category 缺失时若写 `lang:en` 这种合成串，
        // 它会经 observedPlaylists.category 进到 behavior.ts 的点赞学习里，
        // 而这个键永远匹配不到任何目录分类名——等于把这次学习信号扔进一个死键。
        const bucketTagName = catalogTags.find(tag => normalizeLangTagId(source, String(tag.id)) == entry.tagId)?.name
        const playlists = await getPlaylistsByTag(source, entry.tagId, sortId, 1 + (rotation % 3), { signal: params.signal })
        let added = 0
        for (const summary of playlists) {
          if (added >= recommendationConfig.candidatePool.bucketPlaylistsPerBucket) break
          const registered = addSummary({ ...summary, category: summary.category ?? bucketTagName ?? `lang:${entry.bucket}` }, [useNew ? 'C' : 'D'], undefined, entry.bucket)
          // 只有真的带上本桶语种提示才算数：被别的步骤先登记成无提示摘要时不重复排队
          if (registered?.langHint == entry.bucket && !bucketSummaries.includes(registered)) {
            bucketSummaries.push(registered)
            added += 1
          }
        }
        reasons.push(`lang_bucket:${entry.bucket}:${entry.tagId}:lists=${added}`)
        if (!added) reasons.push(`lang_bucket_empty:${entry.bucket}`)
      } catch (error) {
        reasons.push(`lang_bucket_failed:${entry.bucket}`)
        if ((error as Error).message == 'request_cancelled' || (error as Error).message == 'request_budget_exhausted') break
      }
    }
  }

  // 5. 分批读取歌单详情，记录覆盖情况；只有读取详情后才确认是否包含种子歌曲。
  const playlistCandidates: PoolCandidate[] = []
  let detailFetches = 0
  // 给 C 通道预留一个详情位：否则详情额度永远被已知/搜索摘要吃光，最新/低曝光池恒为空
  // 语种桶召回同样要从这份常规份额里让位（bucketReserve），常规摘要永远至少留一格
  // 只预留真要用的格子：没召回到桶摘要时（问卷没滑语言的整轮、池里不缺货的整轮都算）预留必须是 0。
  // 详情读是这个候选池唯一的进货口，白扣一格等于给**全体用户**（含没开配额的）砍掉固定份额，
  // 而且桶只召回到 1 张时也要把没用完的格子还给常规摘要。
  const bucketReserve = bucketSummaries.length
    ? Math.min(bucketSummaries.length, computeBucketDetailReserve({
      detailBudget,
      unknownShare,
      escalateAt: recommendationConfig.candidatePool.unknownShareEscalate,
      base: recommendationConfig.candidatePool.bucketDetailReserve,
      escalateTo: recommendationConfig.candidatePool.bucketDetailReserveWhenUnknownHigh,
    }))
    : 0
  const cSummaries = summaries.filter(summary => summary.hints.has('C') && !summary.langHint)
  const mainSummaries = summaries.filter(summary => !summary.hints.has('C') && !summary.langHint)
  const bucketPicks: SummaryWithHints[] = []
  if (bucketReserve > 0) {
    // 从轮换位起连续取，第一轮落空的那张会在下一轮被取到——这就是"空歌单换下一张"的实现方式
    const start = Math.abs(rotation) % bucketSummaries.length
    for (let i = 0; i < bucketReserve; i++) bucketPicks.push(bucketSummaries[(start + i) % bucketSummaries.length])
  }
  const regularPicks = [
    ...mainSummaries.slice(0, Math.max(1, detailBudget - (cSummaries.length ? 1 : 0) - bucketReserve)),
    ...(cSummaries.length ? [cSummaries[Math.abs(rotation) % cSummaries.length]] : []),
  ]
  // spec §3.3："池内 unknown 占比超过 30% 时，本轮预算优先给 kg/tx 的桶召回"。
  // 优先级要体现在**读取顺序**上：详情循环是按 orderedSummaries 顺序走到预算上限就 break 的，
  // 桶摘要排在最后时总预算一紧就先被牺牲掉的正是刚补进来的那几格，与"优先"相反。
  const orderedSummaries = bucketPicks.length && unknownShare > recommendationConfig.candidatePool.unknownShareEscalate
    ? [...bucketPicks, ...regularPicks]
    : [...regularPicks, ...bucketPicks]
  // 空歌单不等于该桶无货：tx 闽南语/小语种的头部歌单就可能没有曲目。
  // 把同桶的备选摘要留在队里，读空时排到队尾再试一张——只在还有详情额度时才真的发请求。
  const summaryQueue = [...orderedSummaries]
  const queuedSummaryIds = new Set(summaryQueue.map(summary => summary.id))
  const bucketAlternates = new Map<LangBucket, SummaryWithHints[]>()
  for (const summary of bucketSummaries) {
    if (!summary.langHint) continue
    const list = bucketAlternates.get(summary.langHint)
    if (list) list.push(summary)
    else bucketAlternates.set(summary.langHint, [summary])
  }
  const observedList = Object.values(params.state.observedPlaylists)
  for (let queueIndex = 0; queueIndex < summaryQueue.length; queueIndex++) {
    const summary = summaryQueue[queueIndex]
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
      if (!uniqueTracks.length && summary.langHint) {
        reasons.push(`lang_playlist_empty:${summary.id}`)
        const alternate = (bucketAlternates.get(summary.langHint) ?? [])
          .find(item => !queuedSummaryIds.has(item.id))
        if (alternate) {
          queuedSummaryIds.add(alternate.id)
          summaryQueue.push(alternate)
        }
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
      const created = createPlaylistCandidates(observed, uniqueTracks, params, primaryChannel, summary.langHint)
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

  // 5.5 画像歌手热门歌直采：rotation 在强歌手列表上滑动，每轮只采 1 人 8 首，
  // 避免单轮就往池里灌一批同歌手候选（配 diversity 的软惩罚一起治连推）。
  // 收藏歌手被排除：他的目录用户基本都听过，该走 E 的相似扩展。
  const picked = caps.canMusicSearch
    ? selectArtistHitTargets(params.profile, rotation, params.blocked.singerNames,
      recommendationConfig.candidatePool.artistHitsPerRefresh)
    : []
  if (picked.length) {
    for (const artistEntry of picked) {
      if (requests >= budget) break
      try {
        ensureDiscoveryBudget()
        const tracks = await searchMusic(source, artistEntry.artist, 1, 8, { signal: params.signal })
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
