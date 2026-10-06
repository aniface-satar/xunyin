import musicSdk from '@/utils/musicSdk'
import { toNewMusicInfo } from '@/utils'
import { runWithRetry, defaultRequestPolicy, type RunRequestOptions } from './requestPolicy.ts'
import { buildTrackKey } from './trackKey.ts'

export interface PlaylistSummary {
  id: string
  source: LX.OnlineSource
  name: string
  author?: string
  desc?: string
  playCount?: string | number | null
  total?: string | number | null
  category?: string
}

export interface PlaylistDetailResult {
  id: string
  source: LX.OnlineSource
  name?: string
  author?: string
  desc?: string
  playCount?: string | number | null
  category?: string
  total: number
  page: number
  tracks: LX.Music.MusicInfoOnline[]
}

export interface TagSummary {
  id: string
  name: string
  parentName?: string
}

export interface SortSummary {
  id: string
  name: string
  tid?: string
}

export interface ChartSummary {
  id: string
  name: string
  source: LX.OnlineSource
}

export interface ChartTracksResult {
  id: string
  source: LX.OnlineSource
  total: number
  page: number
  tracks: Array<{ musicInfo: LX.Music.MusicInfoOnline, rank: number }>
}

export interface CatalogCapabilities {
  source: LX.OnlineSource
  canSearchPlaylist: boolean
  canTags: boolean
  canList: boolean
  canDetail: boolean
  canChart: boolean
  canMusicSearch: boolean
  sorts: SortSummary[]
}

const resetRequestHandles = <T extends Record<string, unknown>>(context: T): T => {
  const clone: Record<string, unknown> = { ...context }
  for (const key of Object.keys(clone)) {
    if (key.startsWith('_requestObj') || key.startsWith('_request')) clone[key] = null
  }
  return clone as T
}

const getSongListContext = (source: LX.OnlineSource) => {
  const songList = (musicSdk as unknown as Record<string, { songList?: Record<string, unknown> } | undefined>)[source]?.songList
  if (!songList || typeof songList != 'object') return null
  return resetRequestHandles(songList)
}

const getLeaderboardContext = (source: LX.OnlineSource) => {
  const leaderboard = (musicSdk as unknown as Record<string, { leaderboard?: Record<string, unknown> } | undefined>)[source]?.leaderboard
  if (!leaderboard || typeof leaderboard != 'object') return null
  return resetRequestHandles(leaderboard)
}

const callMethod = async <T,>(
  context: Record<string, unknown> | null,
  method: string,
  args: unknown[],
  requestOptions?: RunRequestOptions,
): Promise<T> => {
  if (!context || typeof context[method] != 'function') {
    throw new Error(`source_capability_missing:${method}`)
  }
  const fn = context[method] as (...innerArgs: unknown[]) => T | Promise<T>
  return runWithRetry(async() => Promise.resolve(fn.apply(context, args)), requestOptions)
}

const normalizePlaylist = (item: Record<string, unknown>, source: LX.OnlineSource): PlaylistSummary => ({
  id: String(item.id ?? item.playlistid ?? ''),
  source,
  name: String(item.name ?? ''),
  author: item.author != null ? String(item.author) : undefined,
  desc: item.desc != null ? String(item.desc) : undefined,
  playCount: (item.play_count ?? item.playCount ?? null) as string | number | null,
  total: (item.total ?? item.songnum ?? null) as string | number | null,
  category: item.category != null ? String(item.category) : undefined,
})

export const getCatalogCapabilities = (source: LX.OnlineSource): CatalogCapabilities => {
  const songList = (musicSdk as unknown as Record<string, { songList?: Record<string, unknown> } | undefined>)[source]?.songList
  const leaderboard = (musicSdk as unknown as Record<string, { leaderboard?: Record<string, unknown> } | undefined>)[source]?.leaderboard
  const sourceSdk = (musicSdk as unknown as Record<string, { musicSearch?: unknown } | undefined>)[source]
  const sortsRaw = songList && Array.isArray((songList as { sortList?: unknown[] }).sortList)
    ? (songList as { sortList: Array<Record<string, unknown>> }).sortList
    : []
  const sorts: SortSummary[] = sortsRaw.map(sort => ({
    id: String(sort.id ?? sort.tid ?? ''),
    name: String(sort.name ?? ''),
    tid: sort.tid != null ? String(sort.tid) : undefined,
  }))
  return {
    source,
    canSearchPlaylist: typeof songList?.search == 'function',
    canTags: typeof songList?.getTags == 'function',
    canList: typeof songList?.getList == 'function',
    canDetail: typeof songList?.getListDetail == 'function',
    canChart: typeof leaderboard?.getBoards == 'function' && typeof leaderboard?.getList == 'function',
    canMusicSearch: !!sourceSdk?.musicSearch && typeof (sourceSdk.musicSearch as { search?: unknown }).search == 'function',
    sorts,
  }
}

export const searchPlaylists = async(
  source: LX.OnlineSource,
  keyword: string,
  page = 1,
  limit = 20,
  requestOptions?: RunRequestOptions,
): Promise<PlaylistSummary[]> => {
  const context = getSongListContext(source)
  const result = await callMethod<{ list?: Array<Record<string, unknown>> }>(context, 'search', [keyword, page, limit], requestOptions)
  return (result?.list ?? []).map(item => normalizePlaylist(item, source)).filter(item => item.id)
}

export const getPlaylistTags = async(
  source: LX.OnlineSource,
  requestOptions?: RunRequestOptions,
): Promise<TagSummary[]> => {
  const context = getSongListContext(source)
  const result = await callMethod<{
    tags?: Array<{ name?: string, list?: Array<Record<string, unknown>> }>
    hotTag?: Array<Record<string, unknown>>
  }>(context, 'getTags', [], requestOptions)
  const tags: TagSummary[] = []
  for (const group of result?.tags ?? []) {
    for (const tag of group.list ?? []) {
      const id = String(tag.id ?? '')
      if (id) tags.push({ id, name: String(tag.name ?? ''), parentName: group.name })
    }
  }
  for (const tag of result?.hotTag ?? []) {
    const id = String(tag.id ?? '')
    if (id && !tags.some(item => item.id == id)) tags.push({ id, name: String(tag.name ?? '') })
  }
  return tags
}

export const getPlaylistsByTag = async(
  source: LX.OnlineSource,
  tagId: string,
  sortId: string,
  page: number,
  requestOptions?: RunRequestOptions,
): Promise<PlaylistSummary[]> => {
  const context = getSongListContext(source)
  const result = await callMethod<{ list?: Array<Record<string, unknown>> }>(context, 'getList', [sortId, tagId, page], requestOptions)
  return (result?.list ?? []).map(item => normalizePlaylist(item, source)).filter(item => item.id)
}

export const getPlaylistDetailPage = async(
  source: LX.OnlineSource,
  id: string,
  page = 1,
  requestOptions?: RunRequestOptions,
): Promise<PlaylistDetailResult> => {
  const context = getSongListContext(source)
  const result = await callMethod<{
    list?: LX.Music.MusicInfoOnline[]
    total?: number
    page?: number
    info?: { name?: string, author?: string, desc?: string, play_count?: string | number | null }
  }>(context, 'getListDetail', [id, page], requestOptions)
  const tracks = (result?.list ?? []).map(musicInfo => toNewMusicInfo(musicInfo) as LX.Music.MusicInfoOnline)
  return {
    id,
    source,
    name: result?.info?.name,
    author: result?.info?.author,
    desc: result?.info?.desc,
    playCount: result?.info?.play_count ?? null,
    total: result?.total ?? tracks.length,
    page: result?.page ?? page,
    tracks,
  }
}

export const getChartBoards = async(
  source: LX.OnlineSource,
  requestOptions?: RunRequestOptions,
): Promise<ChartSummary[]> => {
  const context = getLeaderboardContext(source)
  const result = await callMethod<{ list?: Array<Record<string, unknown>> }>(context, 'getBoards', [], requestOptions)
  return (result?.list ?? []).map(board => ({
    id: String(board.id ?? board.bangid ?? ''),
    name: String(board.name ?? ''),
    source,
  })).filter(board => board.id)
}

export const getChartTracks = async(
  source: LX.OnlineSource,
  chartId: string,
  page = 1,
  requestOptions?: RunRequestOptions,
): Promise<ChartTracksResult> => {
  const context = getLeaderboardContext(source)
  const result = await callMethod<{
    list?: LX.Music.MusicInfoOnline[]
    total?: number
    page?: number
  }>(context, 'getList', [chartId, page], requestOptions)
  const tracks = (result?.list ?? []).map((musicInfo, index) => ({
    musicInfo: toNewMusicInfo(musicInfo) as LX.Music.MusicInfoOnline,
    rank: (page - 1) * ((result as unknown as { limit?: number }).limit ?? 30) + index + 1,
  }))
  return { id: chartId, source, total: result?.total ?? tracks.length, page: result?.page ?? page, tracks }
}

export const searchMusic = async(
  source: LX.OnlineSource,
  keyword: string,
  page = 1,
  limit = 20,
  requestOptions?: RunRequestOptions,
): Promise<LX.Music.MusicInfoOnline[]> => {
  const sdk = (musicSdk as unknown as Record<string, { musicSearch?: { search?: (...args: unknown[]) => Promise<{ list?: LX.Music.MusicInfoOnline[] }> } } | undefined>)[source]
  if (!sdk?.musicSearch || typeof sdk.musicSearch.search != 'function') throw new Error('source_capability_missing:musicSearch')
  return runWithRetry<LX.Music.MusicInfoOnline[]>(async() => {
    const result = await sdk.musicSearch!.search!(keyword, page, limit)
    return (result?.list ?? []).map(musicInfo => toNewMusicInfo(musicInfo) as LX.Music.MusicInfoOnline)
  }, requestOptions)
}

export const getSourceSorts = (source: LX.OnlineSource): SortSummary[] => getCatalogCapabilities(source).sorts

export { defaultRequestPolicy, buildTrackKey }
