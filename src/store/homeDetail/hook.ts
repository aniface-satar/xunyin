import { useEffect, useState } from 'react'
import { type HomeDetailRoute } from './state'
import state from './state'

export const useHomeDetailStack = () => {
  const [stack, setStack] = useState<HomeDetailRoute[]>(state.stack)

  useEffect(() => {
    const update = (routes: HomeDetailRoute[]) => {
      setStack([...routes])
    }

    global.state_event.on('homeDetailStackUpdated', update)
    return () => {
      global.state_event.off('homeDetailStackUpdated', update)
    }
  }, [])

  return stack
}
