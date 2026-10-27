import { createContext } from 'react'
import { type NAV_ID_Type } from '@/config/constant'
import { type BoardItem } from '@/store/leaderboard/state'
import { type ListInfoItem } from '@/store/songlist/state'
import { type ArtistSearchItem } from '@/utils/musicSdk/artistNormalizers'

export interface MylistDetailItem {
  id: string
  name: string
  mode?: 'music' | 'history'
}

export type HomeDetailPushRoute = HomeDetailRoute extends infer Route
  ? Route extends { id: string } ? Omit<Route, 'id'> : never
  : never

export type HomeDetailRoute =
  | { id: string, type: 'songlist', info: ListInfoItem }
  | { id: string, type: 'artist', info: ArtistSearchItem }
  | { id: string, type: 'leaderboard', source: LX.OnlineSource, board: BoardItem }
  | { id: string, type: 'mylist', info: MylistDetailItem }
  | { id: string, type: 'recommendNewSongs' }
  | { id: string, type: 'recommendPlaylists' }
  | { id: string, type: 'download' }
  | { id: string, type: 'musicRecognition' }
  | { id: string, type: 'musicRecognitionHistory' }

export const HOME_DETAIL_TAB_IDS = ['nav_discover', 'nav_love', 'nav_search'] as const
export type HomeDetailTabId = typeof HOME_DETAIL_TAB_IDS[number]
export type HomeDetailStacks = Record<HomeDetailTabId, HomeDetailRoute[]>

const createHomeDetailStacks = (): HomeDetailStacks => ({
  nav_discover: [],
  nav_love: [],
  nav_search: [],
})

/**
 * 设置页是覆盖在 Home 上的一层，不属于三个 tab 的详情栈；
 * 在设置里产生 push 时归到进入设置前所在的 tab。
 */
export const getHomeDetailTabId = (
  navActiveId: NAV_ID_Type,
  lastNavActiveId: NAV_ID_Type,
): HomeDetailTabId => {
  const id = navActiveId == 'nav_setting' ? lastNavActiveId : navActiveId
  if (id == 'nav_love') return 'nav_love'
  if (id == 'nav_search') return 'nav_search'
  return 'nav_discover'
}

const state = {
  stacks: createHomeDetailStacks(),
}

// 详情栈里被遮住的下层页面不卸载（DetailStack 用 display:'none' 藏着），列表要靠这个值知道"自己又露出来了"
// 默认 false：栈外的实例（原生 push 的详情页、搜索结果页）收不到上升沿，行为不变
export const DetailPageActiveContext = createContext(false)

export default state
