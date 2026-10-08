import { setTempList } from '@/core/list'
import { playList } from '@/core/player/player'
import { getList } from '@/core/songlist'
import { LIST_IDS } from '@/config/constant'
import { recommendationEngine, type CuratedCategory, type CuratedNewSongs } from '@/core/recommend'
import { pickCardPlaylists } from '@/core/recommend/tabSections'
import { type ListInfoItem } from '@/store/songlist/state'

/**
 * 推荐 tab 两个新区块的数据层：只读引擎出口 + 音源分类目录，
 * 与电台队列互不干扰；画像每落一次反馈（revision 变化）或超过保鲜期后重新取数。
 * 两个区块各自单飞、各自记时，卡片上的刷新按钮只重取自己那一块。
 */

const CARD_SONG_COUNT = 3
const BOARD_PAGE_COUNT = 30
const CARD_PLAYLIST_COUNT = 6
const FRESH_MS = 10 * 60 * 1000
const MIN_SYNC_GAP_MS = 30 * 1000

const EMPTY_NEW_SONGS: CuratedNewSongs = { source: null, boardId: '', boardName: '', tracks: [] }

interface FeedState {
  loading: boolean
  newSongsLoading: boolean
  playlistsLoading: boolean
  loaded: boolean
  loadedAt: number
  revision: number
  newSongs: CuratedNewSongs
  category: CuratedCategory | null
  playlists: ListInfoItem[]
  cardPlaylists: ListInfoItem[]
  playlistPage: number
  playlistMaxPage: number
  playlistLoadingMore: boolean
}

const state: FeedState = {
  loading: false,
  newSongsLoading: false,
  playlistsLoading: false,
  loaded: false,
  loadedAt: 0,
  revision: -1,
  newSongs: EMPTY_NEW_SONGS,
  category: null,
  playlists: [],
  cardPlaylists: [],
  playlistPage: 0,
  playlistMaxPage: 1,
  playlistLoadingMore: false,
}

let newSongsLoadedAt = 0
let playlistsLoadedAt = 0

const listeners = new Set<() => void>()

const notify = () => {
  for (const listener of listeners) listener()
}

export const subscribeRecommendFeed = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export const getRecommendFeed = () => state

/** 榜单页与榜单 tab 用同一套 id，播同一张新歌榜时播放历史不会分裂成两条。 */
const boardListId = (boardId: string) => `board__${boardId}`

export const playCuratedNewSong = (index: number) => {
  const { source, boardId, boardName, tracks } = state.newSongs
  if (!source || !boardId || !tracks.length) return
  const listId = boardListId(boardId)
  void setTempList(listId, [...tracks], { source, sourceListId: listId, name: boardName }).then(() => {
    void playList(LIST_IDS.TEMP, index)
  })
}

const syncOverall = () => {
  state.loaded = newSongsLoadedAt > 0 && playlistsLoadedAt > 0
  state.loadedAt = Math.max(newSongsLoadedAt, playlistsLoadedAt)
  state.revision = recommendationEngine.getProfileRevision()
  state.loading = state.newSongsLoading || state.playlistsLoading
}

/**
 * 区块级保鲜判定：有内容才敢按 10 分钟保鲜，空过一次就只压 30 秒重试，
 * 否则一次网络抖动会把区块锁死到下次冷启动。
 * 电台推进时画像版本一变就立刻重取会连打几次榜单请求，所以版本一变保鲜期也缩短。
 */
const isSectionFresh = (loadedAt: number, hasContent: boolean) => {
  if (!loadedAt) return false
  const freshMs = hasContent
    ? (recommendationEngine.getProfileRevision() == state.revision ? FRESH_MS : MIN_SYNC_GAP_MS)
    : MIN_SYNC_GAP_MS
  return Date.now() - loadedAt < freshMs
}

let newSongsInflight: Promise<void> | null = null
let playlistsInflight: Promise<void> | null = null

const loadNewSongs = async() => {
  state.newSongsLoading = true
  state.loading = true
  notify()
  try {
    state.newSongs = await recommendationEngine.getCuratedNewSongs(BOARD_PAGE_COUNT)
  } catch {
    state.newSongs = EMPTY_NEW_SONGS
  }
  newSongsLoadedAt = Date.now()
  state.newSongsLoading = false
  syncOverall()
  notify()
}

const loadPlaylists = async(isRefresh: boolean) => {
  state.playlistsLoading = true
  state.loading = true
  notify()
  try {
    const category = await recommendationEngine.getCuratedPlaylistCategory()
    state.category = category
    if (!category) {
      state.playlists = []
      state.cardPlaylists = []
      state.playlistPage = 0
      state.playlistMaxPage = 1
    } else {
      const info = await getList(category.source, category.tagId, category.sortId, 1, isRefresh)
      // 取回整页后按画像重排；卡片只从画像靠前的候选里随机取一屏
      const ranked = await recommendationEngine.rankCuratedPlaylists(info.list)
      state.playlists = ranked
      state.cardPlaylists = pickCardPlaylists(ranked, CARD_PLAYLIST_COUNT)
      state.playlistPage = 1
      state.playlistMaxPage = info.maxPage || 1
    }
  } catch {
    state.playlists = []
    state.cardPlaylists = []
    state.playlistPage = 0
    state.playlistMaxPage = 1
  }
  playlistsLoadedAt = Date.now()
  state.playlistsLoading = false
  syncOverall()
  notify()
}

/**
 * 两个区块各自取数（各自单飞）：force 为 true 时跳过保鲜并重取。
 * 一次请求就够"更多"页用，所以按整页取，界面各自截取。
 */
const runNewSongs = async(force: boolean) => {
  if (!force && isSectionFresh(newSongsLoadedAt, state.newSongs.tracks.length > 0)) return
  if (newSongsInflight) return newSongsInflight
  newSongsInflight = loadNewSongs().finally(() => { newSongsInflight = null })
  return newSongsInflight
}

const runPlaylists = async(force: boolean) => {
  if (!force && isSectionFresh(playlistsLoadedAt, state.cardPlaylists.length > 0)) return
  if (playlistsInflight) return playlistsInflight
  playlistsInflight = loadPlaylists(force).finally(() => { playlistsInflight = null })
  return playlistsInflight
}

export const refreshRecommendFeed = async(force = false): Promise<void> => {
  await Promise.all([runNewSongs(force), runPlaylists(force)])
}

/** 卡片上的刷新按钮：只重取自己那一块，歌单还要绕过音源缓存换一批封面。 */
export const refreshCuratedNewSongs = async(): Promise<void> => runNewSongs(true)

export const refreshCuratedPlaylists = async(): Promise<void> => runPlaylists(true)

export const loadMoreRecommendPlaylists = async() => {
  const category = state.category
  if (!category || state.playlistLoadingMore || state.playlistPage >= state.playlistMaxPage) return
  state.playlistLoadingMore = true
  notify()
  try {
    const page = state.playlistPage + 1
    const info = await getList(category.source, category.tagId, category.sortId, page)
    const ranked = await recommendationEngine.rankCuratedPlaylists(info.list)
    const seen = new Set(state.playlists.map(item => item.id))
    state.playlists = [...state.playlists, ...ranked.filter(item => !seen.has(item.id))]
    state.playlistPage = page
    state.playlistMaxPage = info.maxPage || state.playlistMaxPage
  } catch {
    state.playlistMaxPage = state.playlistPage
  } finally {
    state.playlistLoadingMore = false
    notify()
  }
}

/**
 * 卡片长按「不感兴趣」：写引擎隐藏名单与负反馈（所属分类随之降权），
 * 并立刻从当前两个列表里移除；之后的取数会在引擎侧确定性跳过它。
 */
export const markPlaylistNotInterested = async(item: ListInfoItem): Promise<void> => {
  await recommendationEngine.dislikeCuratedPlaylist({
    source: item.source,
    id: item.id,
    category: state.category?.tagName,
  })
  const isHidden = (entry: ListInfoItem) => entry.id == item.id && entry.source == item.source
  state.playlists = state.playlists.filter(entry => !isHidden(entry))
  state.cardPlaylists = state.cardPlaylists.filter(entry => !isHidden(entry))
  notify()
}

export { CARD_SONG_COUNT, CARD_PLAYLIST_COUNT }
