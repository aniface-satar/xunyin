import { type NAV_ID_Type, type COMPONENT_IDS } from '@/config/constant'


export interface InitState {
  fontSize: number
  statusbarHeight: number
  /**
   * 系统导航栏压在内容上的高度（dp）。Android 15 起强制边到边，三键导航会盖住贴底的操作区
   */
  navigationBarHeight: number
  componentIds: Partial<Record<COMPONENT_IDS, string>>
  navActiveId: NAV_ID_Type
  lastNavActiveId: NAV_ID_Type
  sourceNames: Record<LX.OnlineSource | 'all', string>
}

const initData = {}

const state: InitState = {
  fontSize: global.lx.fontSize,
  statusbarHeight: 0,
  navigationBarHeight: 0,
  componentIds: {},
  navActiveId: 'nav_discover',
  lastNavActiveId: 'nav_discover',
  sourceNames: initData as InitState['sourceNames'],
}


export default state
