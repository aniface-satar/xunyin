import { useCallback, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'

import SonglistDetail from '@/screens/SonglistDetail'
import ArtistDetail from '@/screens/ArtistDetail'
import LeaderboardDetail from '@/screens/LeaderboardDetail'
import MylistDetail from '@/screens/MylistDetail'
import RecommendNewSongs from '@/screens/RecommendDetail/NewSongs'
import RecommendPlaylists from '@/screens/RecommendDetail/Playlists'
import Download from '@/screens/Home/Views/Download'
import MusicRecognition from '@/screens/MusicRecognition'
import MusicRecognitionHistory from '@/screens/MusicRecognition/History'
import homeDetailActions from '@/store/homeDetail/action'
import { HOME_DETAIL_TAB_IDS, DetailPageActiveContext, type HomeDetailTabId } from '@/store/homeDetail/state'
import { useHomeDetailStack } from '@/store/homeDetail/hook'
import { type InitState as CommonState } from '@/store/common/state'
import { useTheme } from '@/store/theme/hook'
import { useBackHandler } from '@/utils/hooks/useBackHandler'
import { createStyle } from '@/utils/tools'

const DetailStack = ({ navId, active }: {
  navId: HomeDetailTabId
  active: boolean
}) => {
  const stack = useHomeDetailStack(navId)
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
    homeDetailActions.pop(navId)
  }, [navId])

  const back = useCallback(() => {
    // 三个 tab 的详情栈都保持挂载，只有当前 tab 能消费系统返回键
    if (!active || !stack.length) return false
    popDetail()
    return true
  }, [active, popDetail, stack.length])

  useBackHandler(back)

  if (!stack.length) return null

  const pages = stack.map((route, index) => {
    const isTop = index == stack.length - 1
    // 已经露过面的页面不再走 pending：pop 回来时不能先卸载再挂回，
    // 否则页面里的 PagerView 重建会落回第 0 页
    const revealed = revealedRouteId == route.id || revealedRouteIdsRef.current.has(route.id)
    const isPendingTop = isTop && !revealed
    return (
      <DetailPageActiveContext.Provider key={route.id} value={active && isTop && revealed}>
        <View
          style={[styles.page, isTop ? null : styles.pageBehind, { backgroundColor: theme['c-content-background'] }]}
          pointerEvents={isTop ? 'auto' : 'none'}
        >
          {isPendingTop
            ? null
            : route.type == 'songlist'
              ? <SonglistDetail componentId={route.id} info={route.info} embedded onBack={popDetail} />
              : route.type == 'artist'
                ? <ArtistDetail info={route.info} onBack={popDetail} />
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
                  : route.type == 'recommendNewSongs'
                    ? <RecommendNewSongs onBack={popDetail} />
                    : route.type == 'recommendPlaylists'
                      ? <RecommendPlaylists onBack={popDetail} />
                      : route.type == 'download'
                        ? <Download onBack={popDetail} />
                        : route.type == 'musicRecognition'
                          ? <MusicRecognition onBack={popDetail} />
                          : route.type == 'musicRecognitionHistory'
                            ? <MusicRecognitionHistory onBack={popDetail} />
                            : <MylistDetail componentId={route.id} info={route.info} embedded onBack={popDetail} />
          }
        </View>
      </DetailPageActiveContext.Provider>
    )
  })

  return (
    <View
      style={[styles.container, active ? styles.stackActive : styles.stackHidden]}
      pointerEvents={active ? 'auto' : 'none'}
    >
      {pages}
    </View>
  )
}

export const HomeDetailStacks = ({ activeId }: {
  activeId: CommonState['navActiveId']
}) => {
  return (
    <>
      {HOME_DETAIL_TAB_IDS.map(id => (
        <DetailStack key={id} navId={id} active={activeId == id} />
      ))}
    </>
  )
}

export default DetailStack

const styles = createStyle({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  // 隐藏只能用 opacity，不能 display:'none'：
  // 详情页里可能挂着 PagerView（如「我喜欢」的歌曲/专辑/歌单/创作者标签），
  // 一旦退出布局再回来，ViewPager2 会画出第 0 页并回调 onPageSelected(0)，
  // 把标签状态一起改回「歌曲」
  stackActive: {
    zIndex: 1,
  },
  stackHidden: {
    opacity: 0,
  },
  page: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  // 被上层详情页遮住的页面保留布局：摘掉会让页面内的 PagerView 复位
  pageBehind: {
    opacity: 0,
  },
})
