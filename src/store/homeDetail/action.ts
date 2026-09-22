import state, { type HomeDetailPushRoute, type HomeDetailRoute } from './state'

let routeId = 0

export default {
  push(route: HomeDetailPushRoute) {
    routeId += 1
    const next: HomeDetailRoute = { ...route, id: `home-detail-${routeId}` }
    state.stack = [...state.stack, next]
    global.state_event.homeDetailStackUpdated(state.stack)
    return next.id
  },
  pop() {
    if (!state.stack.length) return
    state.stack = state.stack.slice(0, -1)
    global.state_event.homeDetailStackUpdated(state.stack)
  },
  reset() {
    if (!state.stack.length) return
    state.stack = []
    global.state_event.homeDetailStackUpdated(state.stack)
  },
}
