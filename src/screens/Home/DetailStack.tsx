import { useCallback, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'

import SonglistDetail from '@/screens/SonglistDetail'
import LeaderboardDetail from '@/screens/LeaderboardDetail'
import MylistDetail from '@/screens/MylistDetail'
import homeDetailActions from '@/store/homeDetail/action'
import { useHomeDetailStack } from '@/store/homeDetail/hook'
import { useTheme } from '@/store/theme/hook'
import { useBackHandler } from '@/utils/hooks/useBackHandler'
import { createStyle } from '@/utils/tools'

export default () => {
  const stack = useHomeDetailStack()
  const theme = useTheme()
  const topRoute = stack[stack.length - 1]
  const revealedRouteIdsRef = useRef(new Set<string>())
  const [revealedRouteId, setRevealedRouteId] = useState<string | null>(null)

  useEffect(() => {
    const topId = topRoute?.id
    if (!topId) return

    if (revealedRouteIdsRef.current.has(topId)) {
      setRevealedRouteId(topId)
      return
    }

    setRevealedRouteId(null)
    const frame = requestAnimationFrame(() => {
      revealedRouteIdsRef.current.add(topId)
      setRevealedRouteId(topId)
    })
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [topRoute?.id])

  const popDetail = useCallback(() => {
    homeDetailActions.pop()
  }, [])

  const back = useCallback(() => {
    if (!stack.length) return false
    popDetail()
    return true
  }, [popDetail, stack.length])

  useBackHandler(back)

  useEffect(() => {
    const handleNavChange = () => {
      homeDetailActions.reset()
    }

    global.state_event.on('navActiveIdUpdated', handleNavChange)
    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavChange)
    }
  }, [])

  if (!stack.length) return null

  const pages = stack.map((route, index) => {
    const isTop = index == stack.length - 1
    const isPendingTop = isTop && revealedRouteId != route.id
    return (
      <View
        key={route.id}
        style={{
          ...styles.page,
          display: isTop ? 'flex' : 'none',
          backgroundColor: isPendingTop
            ? theme['c-content-background']
            : theme['c-content-background'],
        }}
      >
        {isPendingTop
          ? null
          : route.type == 'songlist'
            ? <SonglistDetail componentId={route.id} info={route.info} embedded onBack={popDetail} />
            : route.type == 'leaderboard'
              ? (
                  <LeaderboardDetail
                    componentId={route.id}
                    source={route.source}
                    board={route.board}
                    embedded
                    onBack={popDetail}
                  />
                )
              : <MylistDetail componentId={route.id} info={route.info} embedded onBack={popDetail} />
        }
      </View>
    )
  })

  return (
    <View style={styles.container}>
      {pages}
    </View>
  )
}

const styles = createStyle({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  page: {
    flex: 1,
    overflow: 'hidden',
  },
})
