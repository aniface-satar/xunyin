import { useCallback, useContext, useEffect, useRef, useState, type ComponentRef } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'
import PagerView, { type PagerViewOnPageSelectedEvent } from 'react-native-pager-view'
import { BorderWidths } from '@/theme'

import MusicList, { type MusicListType } from '@/screens/Home/Views/Mylist/MusicList'
import PageContent from '@/components/PageContent'
import StatusBar from '@/components/common/StatusBar'
import { setComponentId } from '@/core/common'
import { setActiveList } from '@/core/list'
import { DetailPageActiveContext } from '@/store/homeDetail/state'
import { COMPONENT_IDS, LIST_IDS, NAV_SHEAR_NATIVE_IDS } from '@/config/constant'
import PlayerBar from '@/components/player/PlayerBar'
import { PlayerOverlayProvider } from '@/components/player/PlayerOverlay'
import { createStyle } from '@/utils/tools'
import { pop } from '@/navigation'
import BottomTabBar from '@/screens/Home/Vertical/BottomTabBar'
import Header from './Header'
import HistoryList from '@/screens/Home/Views/Mylist/HistoryList'
import PlaylistHistoryList from '@/screens/Home/Views/Mylist/HistoryList/PlaylistHistoryList'
import PlaylistList from './PlaylistList'
import AlbumTab from './AlbumTab'
import ArtistTab from './ArtistTab'
import ListMusicSort, { type ListMusicSortType } from '@/screens/Home/Views/Mylist/MyList/ListMusicSort'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'

export interface MylistDetailInfo {
  id: string
  name: string
  mode?: 'music' | 'history'
}

type MylistDetailTab = 'music' | 'playlist' | 'album' | 'artist'
const TAB_LABELS = {
  music: 'mylist_music_tab',
  playlist: 'mylist_playlist_tab',
  album: 'mylist_album_tab',
  artist: 'mylist_artist_tab',
} as const
// 数组顺序即 PagerView 页码
const LOVE_TABS: MylistDetailTab[] = ['music', 'album', 'playlist', 'artist']
const HISTORY_TABS: MylistDetailTab[] = ['music', 'playlist']
const activeTabCache = new Map<string, MylistDetailTab>()

export default ({ componentId, info, embedded = false, onBack }: {
  componentId: string
  info: MylistDetailInfo
  embedded?: boolean
  onBack?: () => void
}) => {
  const musicListRef = useRef<MusicListType>(null)
  const listMusicSortRef = useRef<ListMusicSortType>(null)
  const pagerRef = useRef<ComponentRef<typeof PagerView>>(null)
  const isHistory = info.mode === 'history'
  const theme = useTheme()
  const t = useI18n()
  const isLove = info.id === LIST_IDS.LOVE
  const showTabs = isLove || isHistory
  const tabs = isLove ? LOVE_TABS : HISTORY_TABS
  const [activeTab, setActiveTab] = useState<MylistDetailTab>(() => {
    const cached = activeTabCache.get(componentId)
    return cached && tabs.includes(cached) ? cached : 'music'
  })
  const infoIdRef = useRef(info.id)
  const [searchMode, setSearchMode] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false)
  const [isCustomSortMode, setIsCustomSortMode] = useState(false)
  const detailPageActive = useContext(DetailPageActiveContext)
  const wasPageActiveRef = useRef(false)

  const handleMultiSelectModeChange = useCallback((value: boolean) => {
    setIsMultiSelectMode(value)
  }, [])

  const handleCustomSortModeChange = useCallback((value: boolean) => {
    setIsCustomSortMode(value)
  }, [])

  const handleCustomSort = useCallback(() => {
    musicListRef.current?.enterCustomSort()
  }, [])

  const handleToggleMultiSelect = useCallback(() => {
    if (isMultiSelectMode) musicListRef.current?.exitMultiSelect()
    else musicListRef.current?.showMultiSelect()
  }, [isMultiSelectMode])

  const handleSelectAll = useCallback(() => {
    musicListRef.current?.selectAll(true)
  }, [])

  const handleShowSort = useCallback(() => {
    if (isCustomSortMode) {
      musicListRef.current?.exitCustomSort()
      return
    }
    listMusicSortRef.current?.show({
      id: isLove ? LIST_IDS.LOVE : info.id,
      name: info.name,
    })
  }, [info.id, info.name, isLove, isCustomSortMode])

  useEffect(() => {
    setSearchMode(false)
    setSearchKeyword('')
    musicListRef.current?.exitSearch()
  }, [info.id, activeTab])

  const handleShowSearch = useCallback(() => {
    if (isCustomSortMode) musicListRef.current?.exitCustomSort()
    setSearchMode(true)
    setSearchKeyword('')
    musicListRef.current?.showSearch()
  }, [isCustomSortMode])

  const handleSearch = useCallback((keyword: string) => {
    setSearchKeyword(keyword)
    if (!isHistory && (!isLove || activeTab == 'music')) {
      musicListRef.current?.search(keyword)
    }
  }, [activeTab, isHistory, isLove])

  const handleExitSearch = useCallback(() => {
    setSearchMode(false)
    setSearchKeyword('')
    musicListRef.current?.exitSearch()
  }, [])

  useEffect(() => {
    if (infoIdRef.current == info.id) return

    infoIdRef.current = info.id
    activeTabCache.set(componentId, 'music')
    setActiveTab('music')
    setIsCustomSortMode(false)
    musicListRef.current?.exitCustomSort()
  }, [componentId, info.id])

  useEffect(() => {
    if (wasPageActiveRef.current && !detailPageActive) {
      setIsCustomSortMode(false)
      musicListRef.current?.exitCustomSort()
    }
    wasPageActiveRef.current = detailPageActive
  }, [detailPageActive])

  const handleTabChange = useCallback((tab: MylistDetailTab) => {
    activeTabCache.set(componentId, tab)
    setActiveTab(tab)
    setIsCustomSortMode(false)
    musicListRef.current?.exitCustomSort()
    // 歌曲页在 PagerView 里一直挂着，离开时要退出多选，避免滑回来还停在选中态
    if (isMultiSelectMode && tab != activeTab) musicListRef.current?.exitMultiSelect()
  }, [activeTab, componentId, isMultiSelectMode])

  const handlePageSelected = useCallback(({ nativeEvent }: PagerViewOnPageSelectedEvent) => {
    const tab = tabs[nativeEvent.position]
    if (tab && tab != activeTab) handleTabChange(tab)
  }, [activeTab, handleTabChange, tabs])

  useEffect(() => {
    const index = tabs.indexOf(activeTab)
    if (index >= 0) pagerRef.current?.setPage(index)
  }, [activeTab, tabs])

  useEffect(() => {
    if (!embedded) setComponentId(COMPONENT_IDS.mylistDetail, componentId)
    if (!isHistory) setActiveList(info.id)
  }, [componentId, embedded, info.id, isHistory])

  const searchPlaceholder = t(
    activeTab == 'album'
      ? 'mylist_search_albums'
      : activeTab == 'artist'
        ? 'mylist_search_artists'
        : activeTab == 'playlist'
          ? 'mylist_search_playlists'
          : 'mylist_search_music',
  )
  const showDetailActions = showTabs && !isHistory && activeTab == 'music'
  const showPlaylistActions = !isHistory && !isLove
  // 多选态：左侧留空，右侧只剩「取消 / 全选」，批量操作栏仍在列表底部
  const actionButtons = isMultiSelectMode
    ? (
      <>
        <TouchableOpacity
          style={styles.tabAction}
          activeOpacity={0.7}
          onPress={handleToggleMultiSelect}
        >
          <Text size={14} color={theme['c-primary']}>{t('list_select_cancel')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.tabAction}
          activeOpacity={0.7}
          onPress={handleSelectAll}
        >
          <Text size={14} color={theme['c-primary']}>{t('list_select_all')}</Text>
        </TouchableOpacity>
      </>
      )
    : (
      <>
        <TouchableOpacity
          style={styles.tabAction}
          activeOpacity={0.7}
          onPress={handleToggleMultiSelect}
        >
          <Text size={14} color={theme['c-primary']}>{t('mylist_multi_select')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.tabAction}
          activeOpacity={0.7}
          onPress={handleShowSort}
        >
          <Text size={14} color={theme['c-primary']}>{t(isCustomSortMode ? 'list_custom_sort_done' : 'list_sort')}</Text>
        </TouchableOpacity>
      </>
      )
  const playlistActionBar = showPlaylistActions ? (
    <View style={{ ...styles.tabBar, borderBottomColor: theme['c-border-background'] }}>
      <View style={styles.tabActions}>{actionButtons}</View>
    </View>
  ) : null
  const tabBar = showTabs ? (
    <View style={{ ...styles.tabBar, borderBottomColor: theme['c-border-background'] }}>
      <ScrollView style={styles.tabScroll} horizontal={true} showsHorizontalScrollIndicator={false}>
        {tabs.map(tab => (
          <TouchableOpacity
            key={tab}
            style={[
              styles.tabButton,
              { borderBottomColor: activeTab == tab ? theme['c-primary-background-active'] : 'transparent' },
            ]}
            activeOpacity={0.8}
            onPress={() => { handleTabChange(tab) }}
          >
            <Text
              size={14}
              color={activeTab == tab ? theme['c-primary-font-active'] : theme['c-font']}
            >
              {t(TAB_LABELS[tab])}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {
        showDetailActions
          ? <View style={styles.tabActions}>{actionButtons}</View>
          : <View style={styles.tabActions} />
      }
    </View>
  ) : null

  const musicList = (
    <MusicList
      ref={musicListRef}
      onExitSearch={handleExitSearch}
      onMultiSelectModeChange={handleMultiSelectModeChange}
      onCustomSortModeChange={handleCustomSortModeChange}
      multiSelectUi="external"
    />
  )

  const renderTabPage = (tab: MylistDetailTab) => {
    if (isHistory) {
      return tab == 'playlist'
        ? <PlaylistHistoryList keyword={searchKeyword} />
        : <HistoryList keyword={searchKeyword} />
    }
    switch (tab) {
      case 'album':
        return <AlbumTab keyword={searchKeyword} active={activeTab == 'album'} />
      case 'playlist':
        return <PlaylistList keyword={searchKeyword} active={activeTab == 'playlist'} />
      case 'artist':
        return <ArtistTab keyword={searchKeyword} />
      default:
        return musicList
    }
  }

  // 标签页放进 PagerView 后每页常驻，滑动手势与标签点击共用 activeTab
  const content = showTabs
    ? (
      <PagerView
        ref={pagerRef}
        style={styles.pagerView}
        initialPage={Math.max(0, tabs.indexOf(activeTab))}
        onPageSelected={handlePageSelected}
      >
        {tabs.map(tab => (
          <View key={tab} collapsable={false} style={styles.page}>
            {renderTabPage(tab)}
          </View>
        ))}
      </PagerView>
      )
    : musicList

  if (embedded) {
    return (
      <View style={styles.content}>
        <Header
          componentId={componentId}
          name={info.name}
          showSearch
          searchMode={searchMode}
          searchPlaceholder={searchPlaceholder}
          onShowSearch={handleShowSearch}
          onSearch={handleSearch}
          onExitSearch={handleExitSearch}
          onBack={onBack}
        />
        {playlistActionBar}
        {tabBar}
        {content}
        <ListMusicSort ref={listMusicSortRef} onCustomSort={handleCustomSort} />
      </View>
    )
  }

  return (
    <PlayerOverlayProvider>
      <PageContent>
        <StatusBar />
        <View nativeID={NAV_SHEAR_NATIVE_IDS.mylistDetail_content} style={styles.content} collapsable={false}>
          <Header
            componentId={componentId}
            name={info.name}
            showSearch
            searchMode={searchMode}
            searchPlaceholder={searchPlaceholder}
            onShowSearch={handleShowSearch}
            onSearch={handleSearch}
            onExitSearch={handleExitSearch}
          />
          {playlistActionBar}
          {tabBar}
          {content}
          <ListMusicSort ref={listMusicSortRef} onCustomSort={handleCustomSort} />
        </View>
        <PlayerBar />
        <BottomTabBar onTabPress={() => { void pop(componentId) }} />
      </PageContent>
    </PlayerOverlayProvider>
  )
}

const styles = createStyle({
  content: {
    flex: 1,
  },
  pagerView: {
    flex: 1,
  },
  page: {
    flex: 1,
    overflow: 'hidden',
  },
  tabBar: {
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: BorderWidths.normal,
  },
  tabScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  tabButton: {
    justifyContent: 'center',
    height: 38,
    paddingLeft: 8,
    paddingRight: 8,
    borderBottomWidth: BorderWidths.normal3,
  },
  tabActions: {
    flexGrow: 1,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingRight: 6,
  },
  tabAction: {
    justifyContent: 'center',
    height: 38,
    paddingLeft: 8,
    paddingRight: 8,
  },
})
