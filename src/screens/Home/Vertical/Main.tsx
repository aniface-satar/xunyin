import { useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react'
import { View } from 'react-native'
import PagerView from 'react-native-pager-view'

import Discover from '../Views/Discover'
import Mylist from '../Views/Mylist'
import Search from '../Views/Search'
import Setting from '../Views/Setting'
import commonState, { type InitState as CommonState } from '@/store/common/state'
import { useNavActiveId } from '@/store/common/hook'
import { useHomeDetailStack } from '@/store/homeDetail/hook'
import { createStyle } from '@/utils/tools'


const NavPage = ({ id, render }: {
  id: CommonState['navActiveId']
  render: () => ReactNode
}) => {
  const [mounted, setMounted] = useState(commonState.navActiveId == id)
  const component = useMemo(() => render(), [])

  useEffect(() => {
    const handleNavIdUpdate = (navId: CommonState['navActiveId']) => {
      if (navId == id) {
        requestAnimationFrame(() => {
          setMounted(true)
        })
      }
    }

    global.state_event.on('navActiveIdUpdated', handleNavIdUpdate)
    return () => {
      global.state_event.off('navActiveIdUpdated', handleNavIdUpdate)
    }
  }, [id])

  return mounted ? component : null
}

const viewMap: Partial<Record<CommonState['navActiveId'], number>> = {
  nav_discover: 0,
  nav_love: 1,
  nav_search: 2,
}

const Main = () => {
  const pagerViewRef = useRef<ComponentRef<typeof PagerView>>(null)
  const activeId = useNavActiveId()
  const hasDetail = useHomeDetailStack().length > 0
  const activeIndexRef = useRef(viewMap[commonState.navActiveId] ?? 0)

  useEffect(() => {
    const handleUpdate = (id: CommonState['navActiveId']) => {
      const index = viewMap[id]
      if (index == null || activeIndexRef.current == index) return
      activeIndexRef.current = index
      pagerViewRef.current?.setPageWithoutAnimation(index)
    }

    global.state_event.on('navActiveIdUpdated', handleUpdate)
    return () => {
      global.state_event.off('navActiveIdUpdated', handleUpdate)
    }
  }, [])

  useEffect(() => {
    const index = viewMap[activeId]
    if (index == null) return
    activeIndexRef.current = index
    // PagerView may restore its first page while hidden behind Settings.
    pagerViewRef.current?.setPageWithoutAnimation(index)
    // Detail pages also hide Main on Android, so sync the page again when they close.
  }, [activeId, hasDetail])

  return (
    <View style={styles.container}>
      <View
        style={[styles.pagerContainer, activeId == 'nav_setting' ? styles.pagerHidden : null]}
        pointerEvents={activeId == 'nav_setting' ? 'none' : 'auto'}
      >
        <PagerView
          ref={pagerViewRef}
          initialPage={activeIndexRef.current}
          offscreenPageLimit={2}
          scrollEnabled={false}
          style={styles.pagerView}
        >
          <View collapsable={false} key="nav_discover" style={styles.pageStyle}>
            <NavPage id="nav_discover" render={() => <Discover />} />
          </View>
          <View collapsable={false} key="nav_love" style={styles.pageStyle}>
            <NavPage id="nav_love" render={() => <Mylist />} />
          </View>
          <View collapsable={false} key="nav_search" style={styles.pageStyle}>
            <NavPage id="nav_search" render={() => <Search />} />
          </View>
        </PagerView>
      </View>
      {
        activeId == 'nav_setting'
          ? <View style={styles.settingOverlay}><Setting /></View>
          : null
      }
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
  pagerContainer: {
    flex: 1,
  },
  pagerHidden: {
    opacity: 0,
  },
  settingOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 1,
  },
  pagerView: {
    flex: 1,
    overflow: 'hidden',
  },
  pageStyle: {},
})


export default Main
