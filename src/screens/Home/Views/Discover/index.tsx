import { useCallback, useEffect, useRef, useState } from 'react'
import { TouchableOpacity, View } from 'react-native'

import Leaderboard, { type LeaderboardType } from '../Leaderboard'
import SongList, { type SongListType } from '../SongList'
import SourceSelector, { type SourceSelectorType } from '@/components/SourceSelector'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import leaderboardState, { type InitState as LeaderboardState } from '@/store/leaderboard/state'
import songlistState from '@/store/songlist/state'
import { getLeaderboardSetting, saveLeaderboardSetting } from '@/utils/data'
import { createStyle } from '@/utils/tools'
import { BorderRadius, BorderWidths } from '@/theme'

const DISCOVER_TABS = [
  'leaderboard',
  'songlist',
] as const

type DiscoverTabId = typeof DISCOVER_TABS[number]
type LeaderboardSources = Readonly<LeaderboardState['sources']>
type DiscoverSources = LeaderboardSources

const ROOT_DISCOVER_TAB: DiscoverTabId = 'leaderboard'

let lastActiveTabId: DiscoverTabId = ROOT_DISCOVER_TAB

const discoverSources = leaderboardState.sources.filter(
  source => songlistState.sources.includes(source),
) as DiscoverSources

const Discover = () => {
  const [activeId, setActiveId] = useState<DiscoverTabId>(lastActiveTabId)
  const [mountedTabs, setMountedTabs] = useState<Record<DiscoverTabId, boolean>>({
    leaderboard: true,
    songlist: lastActiveTabId == 'songlist',
  })
  const theme = useTheme()
  const t = useI18n()
  const leaderboardRef = useRef<LeaderboardType>(null)
  const songListRef = useRef<SongListType>(null)
  const sourceSelectorRef = useRef<SourceSelectorType<LeaderboardSources>>(null)
  const sourceRef = useRef<LX.OnlineSource>(discoverSources[0] ?? 'kw')

  const changeTab = (id: DiscoverTabId) => {
    lastActiveTabId = id
    setActiveId(id)
    setMountedTabs(tabs => ({ ...tabs, [id]: true }))
  }

  useEffect(() => {
    const handleHomeTabReset = () => {
      lastActiveTabId = ROOT_DISCOVER_TAB
      setActiveId(id => id == ROOT_DISCOVER_TAB ? id : ROOT_DISCOVER_TAB)
      setMountedTabs(tabs => tabs[ROOT_DISCOVER_TAB] ? tabs : { ...tabs, [ROOT_DISCOVER_TAB]: true })
    }

    global.app_event.on('homeTabReset', handleHomeTabReset)
    return () => {
      global.app_event.off('homeTabReset', handleHomeTabReset)
    }
  }, [])

  const handleSourceChange = useCallback((source: LX.OnlineSource) => {
    sourceRef.current = source
    leaderboardRef.current?.setSource(source)
    songListRef.current?.setSource(source)
    void saveLeaderboardSetting({ source })
  }, [])

  useEffect(() => {
    let mounted = true
    void getLeaderboardSetting().then(({ source }) => {
      if (!mounted) return
      const activeSource = discoverSources.includes(source)
        ? source
        : discoverSources[0] ?? 'kw'
      sourceRef.current = activeSource
      sourceSelectorRef.current?.setSourceList(discoverSources, activeSource)
      if (activeSource != source) leaderboardRef.current?.setSource(activeSource)
    })

    return () => {
      mounted = false
    }
  }, [])

  return (
    <View style={styles.container}>
      <View style={{ ...styles.tabHeader, borderBottomColor: theme['c-border-background'] }}>
        {
          DISCOVER_TABS.map(id => {
            const active = activeId == id
            return (
              <TouchableOpacity
                key={id}
                style={{ ...styles.tabButton, backgroundColor: active ? theme['c-primary-background-active'] : 'transparent' }}
                onPress={() => { changeTab(id) }}
              >
                <Text size={14} color={active ? theme['c-primary-font-active'] : theme['c-font-label']}>{t(`discover_${id}`)}</Text>
              </TouchableOpacity>
            )
          })
        }
        <View style={styles.sourceSelector}>
          <SourceSelector
            ref={sourceSelectorRef}
            fontSize={14}
            onSourceChange={handleSourceChange}
          />
        </View>
      </View>
      <View style={styles.content}>
        <View style={{ ...styles.tabPage, display: activeId == 'leaderboard' ? 'flex' : 'none' }}>
          <Leaderboard ref={leaderboardRef} />
        </View>
        {
          mountedTabs.songlist
            ? <View style={{ ...styles.tabPage, display: activeId == 'songlist' ? 'flex' : 'none' }}>
                <SongList ref={songListRef} initialSource={sourceRef.current} />
              </View>
            : null
        }
      </View>
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
  tabHeader: {
    height: 38,
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: BorderWidths.normal,
  },
  tabButton: {
    height: 28,
    marginLeft: 10,
    paddingHorizontal: 12,
    borderRadius: BorderRadius.normal,
    justifyContent: 'center',
  },
  sourceSelector: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    minWidth: 72,
    maxWidth: 104,
    paddingLeft: 8,
    paddingRight: 4,
  },
  content: {
    flex: 1,
  },
  tabPage: {
    flex: 1,
  },
})

export default Discover
