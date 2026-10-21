import { useEffect, useState } from 'react'
import commonState from '@/store/common/state'
import { getHomeDetailTabId, type HomeDetailRoute, type HomeDetailTabId } from './state'
import state from './state'

const resolveTabId = (tabId?: HomeDetailTabId) => tabId ?? getHomeDetailTabId(commonState.navActiveId, commonState.lastNavActiveId)

export const useHomeDetailStack = (tabId?: HomeDetailTabId) => {
  const [stack, setStack] = useState<HomeDetailRoute[]>(state.stacks[resolveTabId(tabId)])

  useEffect(() => {
    const update = () => {
      setStack(state.stacks[resolveTabId(tabId)])
    }

    update()
    global.state_event.on('homeDetailStacksUpdated', update)
    global.state_event.on('navActiveIdUpdated', update)
    return () => {
      global.state_event.off('homeDetailStacksUpdated', update)
      global.state_event.off('navActiveIdUpdated', update)
    }
  }, [tabId])

  return stack
}
