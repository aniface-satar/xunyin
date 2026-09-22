import { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'
import { BorderWidths } from '@/theme'

import MusicList, { type MusicListType } from '@/screens/Home/Views/Mylist/MusicList'
import PageContent from '@/components/PageContent'
import StatusBar from '@/components/common/StatusBar'
import { setComponentId } from '@/core/common'
import { setActiveList } from '@/core/list'
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
import ListMusicSort, { type ListMusicSortType } from '@/screens/Home/Views/Mylist/MyList/ListMusicSort'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'

export interface MylistDetailInfo {
  id: string
  name: string
  mode?: 'music' | 'history'
}

type MylistDetailTab = 'music' | 'playlist'
const activeTabCache = new Map<string, MylistDetailTab>()

export default ({ componentId, info, embedded = false, onBack }: {
  componentId: string
  info: MylistDetailInfo
  embedded?: boolean
  onBack?: () => void
}) => {
  const musicListRef = useRef<MusicListType>(null)
  const listMusicSortRef = useRef<ListMusicSortType>(null)
  const isHistory = info.mode === 'history'
  const theme = useTheme()
  const t = useI18n()
  const isLove = info.id === LIST_IDS.LOVE
  const [activeTab, setActiveTab] = useState<MylistDetailTab>(
    activeTabCache.get(componentId) ?? 'music',
  )
  const infoIdRef = useRef(info.id)
  const [searchMode, setSearchMode] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false)

  const handleMultiSelectModeChange = useCallback((value: boolean) => {
    setIsMultiSelectMode(value)
  }, [])

  const handleToggleMultiSelect = useCallback(() => {
    if (isMultiSelectMode) musicListRef.current?.exitMultiSelect()
    else musicListRef.current?.showMultiSelect()
  }, [isMultiSelectMode])

  const handleShowSort = useCallback(() => {
    listMusicSortRef.current?.show({
      id: isLove ? LIST_IDS.LOVE : info.id,
      name: info.name,
    })
  }, [t, info.id, info.name, isLove])

  useEffect(() => {
    setSearchMode(false)
    setSearchKeyword('')
    musicListRef.current?.exitSearch()
  }, [info.id, activeTab])

  const handleShowSearch = useCallback(() => {
    setSearchMode(true)
    setSearchKeyword('')
    musicListRef.current?.showSearch()
  }, [])

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
  }, [componentId, info.id])

  const handleTabChange = useCallback((tab: MylistDetailTab) => {
    activeTabCache.set(componentId, tab)
    setActiveTab(tab)
  }, [componentId])

  useEffect(() => {
    if (!embedded) setComponentId(COMPONENT_IDS.mylistDetail, componentId)
    if (!isHistory) setActiveList(info.id)
  }, [componentId, embedded, info.id, isHistory])

  const showTabs = isLove || isHistory
  const showDetailActions = showTabs && !isHistory && activeTab == 'music'
  const showPlaylistActions = !isHistory && !isLove
  const playlistActionBar = showPlaylistActions ? (
    <View style={{ ...styles.tabBar, borderBottomColor: theme['c-border-background'] }}>
      <View style={styles.tabActions}>
        <TouchableOpacity
          style={styles.tabAction}
          activeOpacity={0.7}
          onPress={handleToggleMultiSelect}
        >
          <Text size={14} color={theme['c-primary']}>
            {t(isMultiSelectMode ? 'list_select_cancel' : 'mylist_multi_select')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={{ ...styles.tabAction, opacity: isMultiSelectMode ? 0.3 : 1 }}
          activeOpacity={0.7}
          disabled={isMultiSelectMode}
          onPress={handleShowSort}
        >
          <Text size={14} color={theme['c-primary']}>{t('list_sort')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  ) : null
  const tabBar = showTabs ? (
    <View style={{ ...styles.tabBar, borderBottomColor: theme['c-border-background'] }}>
      <ScrollView style={styles.tabScroll} horizontal={true} showsHorizontalScrollIndicator={false}>
        {(['music', 'playlist'] as const).map(tab => (
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
              {t(tab == 'music' ? 'mylist_music_tab' : 'mylist_playlist_tab')}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {
        showDetailActions
          ? (
            <View style={styles.tabActions}>
              <TouchableOpacity
                style={styles.tabAction}
                activeOpacity={0.7}
                onPress={handleToggleMultiSelect}
              >
                <Text size={14} color={theme['c-primary']}>
                  {t(isMultiSelectMode ? 'list_select_cancel' : 'mylist_multi_select')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ ...styles.tabAction, opacity: isMultiSelectMode ? 0.3 : 1 }}
                activeOpacity={0.7}
                disabled={isMultiSelectMode}
                onPress={handleShowSort}
              >
                <Text size={14} color={theme['c-primary']}>{t('list_sort')}</Text>
              </TouchableOpacity>
            </View>
            )
          : <View style={styles.tabActions} />
      }
    </View>
  ) : null

  const content = isHistory
    ? activeTab == 'playlist'
      ? <PlaylistHistoryList keyword={searchKeyword} />
      : <HistoryList keyword={searchKeyword} />
    : isLove && activeTab == 'playlist'
      ? <PlaylistList keyword={searchKeyword} />
      : <MusicList ref={musicListRef} onExitSearch={handleExitSearch} onMultiSelectModeChange={handleMultiSelectModeChange} />

  if (embedded) {
    return (
      <View style={styles.content}>
        <Header
          componentId={componentId}
          name={info.name}
          showSearch
          searchMode={searchMode}
          searchPlaceholder={t(activeTab == 'playlist' ? 'mylist_search_playlists' : 'mylist_search_music')}
          onShowSearch={handleShowSearch}
          onSearch={handleSearch}
          onExitSearch={handleExitSearch}
          onBack={onBack}
        />
        {playlistActionBar}
        {tabBar}
        {content}
        <ListMusicSort ref={listMusicSortRef} />
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
            searchPlaceholder={t(activeTab == 'playlist' ? 'mylist_search_playlists' : 'mylist_search_music')}
            onShowSearch={handleShowSearch}
            onSearch={handleSearch}
            onExitSearch={handleExitSearch}
          />
          {playlistActionBar}
          {tabBar}
          {content}
          <ListMusicSort ref={listMusicSortRef} />
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
