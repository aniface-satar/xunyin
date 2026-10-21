import { memo, useState, useRef, useMemo, useEffect, type ComponentRef } from 'react'
import { View, AppState } from 'react-native'

import Header from './components/Header'
// import Aside from './components/Aside'
// import Main from './components/Main'
import Player from './Player'
import PagerView, { type PagerViewOnPageScrollEvent, type PagerViewOnPageSelectedEvent } from 'react-native-pager-view'
import Pic from './Pic'
import Lyric from './Lyric'
import CoverBackdrop from '@/components/player/CoverBackdrop'
import { useCoverStage } from '@/components/player/CoverStageProvider'
import { useLyricToolMode } from '@/utils/hooks/useLyricToolMode'
import { setLyricToolMode } from '@/core/lyricCopy'
import { screenkeepAwake, screenUnkeepAwake } from '@/utils/nativeModules/utils'
import commonState, { type InitState as CommonState } from '@/store/common/state'
import { createStyle } from '@/utils/tools'
// import { useTheme } from '@/store/theme/hook'

const LyricPage = ({ activeIndex }: { activeIndex: number }) => {
  const initedRef = useRef(false)
  const lyric = useMemo(() => <Lyric />, [])
  switch (activeIndex) {
    // case 3:
    case 1:
      if (!initedRef.current) initedRef.current = true
      return lyric
    default:
      return initedRef.current ? lyric : null
  }
  // return activeIndex == 0 || activeIndex == 1 ? setting : null
}

// global.iskeep = false
export default memo(() => {
  // const theme = useTheme()
  const [pageIndex, setPageIndex] = useState(0)
  const showLyricRef = useRef(false)
  const pagerRef = useRef<ComponentRef<typeof PagerView>>(null)
  const lyricToolMode = useLyricToolMode()
  const { dim: stageDim } = useCoverStage()

  const onPageSelected = ({ nativeEvent }: PagerViewOnPageSelectedEvent) => {
    setPageIndex(nativeEvent.position)
    // 分台布光：落定这一帧把压暗层钉到该台的端值。中途跟手是 onPageScroll 的事，
    // 这里兜的是"没收到 scroll 序列"（例如 setPage 直接跳页）时也一定落在正确的台上。
    stageDim.setValue(nativeEvent.position == 1 ? 1 : 0)
    showLyricRef.current = nativeEvent.position == 1
    if (!showLyricRef.current) setLyricToolMode(false)
    if (showLyricRef.current) {
      screenkeepAwake()
    } else {
      screenUnkeepAwake()
    }
  }

  // 翻页中途连续跟手：灯光滑向歌词台，不是翻完才硬切。position+offset 在两页布局里就是 0~1。
  const onPageScroll = ({ nativeEvent }: PagerViewOnPageScrollEvent) => {
    stageDim.setValue(Math.min(1, Math.max(0, nativeEvent.position + nativeEvent.offset)))
  }

  useEffect(() => {
    let appstateListener = AppState.addEventListener('change', (state) => {
      switch (state) {
        case 'active':
          if (showLyricRef.current && !commonState.componentIds.comment) screenkeepAwake()
          break
        case 'background':
          screenUnkeepAwake()
          break
      }
    })

    const handleComponentIdsChange = (ids: CommonState['componentIds']) => {
      if (ids.comment) screenUnkeepAwake()
      else if (AppState.currentState == 'active') screenkeepAwake()
    }

    global.state_event.on('componentIdsUpdated', handleComponentIdsChange)

    return () => {
      global.state_event.off('componentIdsUpdated', handleComponentIdsChange)
      appstateListener.remove()
      screenUnkeepAwake()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <CoverBackdrop />
      <Header pageIndex={pageIndex} onPageSelected={(page: number) => pagerRef.current?.setPage(page)} />
      <View style={styles.container}>
        <PagerView
          ref={pagerRef}
          initialPage={0}
          onPageSelected={onPageSelected}
          onPageScroll={onPageScroll}
          // onPageScrollStateChanged={onPageScrollStateChanged}
          style={styles.pagerView}
        >
          <View collapsable={false}>
            <Pic />
          </View>
          <View collapsable={false}>
            <LyricPage activeIndex={pageIndex} />
          </View>
        </PagerView>
        {/* <View style={styles.pageIndicator} nativeID={NAV_SHEAR_NATIVE_IDS.playDetail_pageIndicator}>
          <View style={{ ...styles.pageIndicatorItem, backgroundColor: pageIndex == 0 ? theme['c-primary-light-100-alpha-700'] : theme['c-primary-alpha-900'] }}></View>
          <View style={{ ...styles.pageIndicatorItem, backgroundColor: pageIndex == 1 ? theme['c-primary-light-100-alpha-700'] : theme['c-primary-alpha-900'] }}></View>
        </View> */}
        {!lyricToolMode ? <Player showMusicInfo={false} /> : null}
      </View>
    </>
  )
})

const styles = createStyle({
  container: {
    flex: 1,
    flexDirection: 'column',
  },
  pagerView: {
    flex: 1,
  },
  // pageIndicator: {
  //   flex: 0,
  //   flexDirection: 'row',
  //   justifyContent: 'center',
  //   paddingTop: 10,
  //   // backgroundColor: 'rgba(0,0,0,0.1)',
  // },
  // pageIndicatorItem: {
  //   height: 3,
  //   width: '5%',
  //   marginLeft: 2,
  //   marginRight: 2,
  //   borderRadius: 2,
  // },
})
