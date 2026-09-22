import { type BoardItem } from '@/store/leaderboard/state'
import { type ListInfoItem } from '@/store/songlist/state'

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
  | { id: string, type: 'leaderboard', source: LX.OnlineSource, board: BoardItem }
  | { id: string, type: 'mylist', info: MylistDetailItem }

const state = {
  stack: [] as HomeDetailRoute[],
}

export default state
