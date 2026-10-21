import commonState from '@/store/common/state'
import state, {
  getHomeDetailTabId,
  type HomeDetailPushRoute,
  type HomeDetailRoute,
  type HomeDetailTabId,
} from './state'

let routeId = 0

const getActiveTabId = () => getHomeDetailTabId(commonState.navActiveId, commonState.lastNavActiveId)

const setStack = (tabId: HomeDetailTabId, stack: HomeDetailRoute[]) => {
  state.stacks = {
    ...state.stacks,
    [tabId]: stack,
  }
  global.state_event.homeDetailStacksUpdated(state.stacks)
}

export default {
  push(route: HomeDetailPushRoute, tabId: HomeDetailTabId = getActiveTabId()) {
    routeId += 1
    const next: HomeDetailRoute = { ...route, id: `home-detail-${routeId}` }
    setStack(tabId, [...state.stacks[tabId], next])
    return next.id
  },
  pop(tabId: HomeDetailTabId = getActiveTabId()) {
    const stack = state.stacks[tabId]
    if (!stack.length) return
    setStack(tabId, stack.slice(0, -1))
  },
  reset(tabId: HomeDetailTabId = getActiveTabId()) {
    if (!state.stacks[tabId].length) return
    setStack(tabId, [])
  },
}
