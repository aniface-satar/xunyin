import { useCallback, useRef, useEffect, useState } from 'react'
import { type LayoutChangeEvent, View } from 'react-native'

// import music from '@/utils/musicSdk'
// import InsetShadow from 'react-native-inset-shadow'
// import TipList from './components/TipList'
// import MusicList from './components/MusicList'
import HeaderBar, { type HeaderBarProps, type HeaderBarType } from './HeaderBar'
import searchState, { type SearchType } from '@/store/search/state'
import searchMusicState from '@/store/search/music/state'
import searchSonglistState from '@/store/search/songlist/state'
import searchAlbumState from '@/store/search/album/state'
import searchArtistState from '@/store/search/artist/state'
import { getSearchSetting, saveSearchSetting } from '@/utils/data'
import { createStyle } from '@/utils/tools'
import TipList, { type TipListType } from './TipList'
import List, { type ListType } from './List'
import { addHistoryWord, setSearchText } from '@/core/search/search'
import SearchTypeSelector from './SearchTypeSelector'
import { shouldShowSearchType } from './searchTypeVisibility'
import { useBackHandler } from '@/utils/hooks/useBackHandler'
import commonState from '@/store/common/state'
import homeDetailState from '@/store/homeDetail/state'


interface SearchInfo {
  temp_source: LX.OnlineSource
  source: LX.OnlineSource | 'all'
  searchType: SearchType
}

const getSearchSources = (type: SearchType) => {
  switch (type) {
    case 'songlist':
      return searchSonglistState.sources
    case 'album':
      return searchAlbumState.sources
    case 'artist':
      return searchArtistState.sources
    default:
      return searchMusicState.sources
  }
}

export default () => {
  const headerBarRef = useRef<HeaderBarType>(null)
  const searchTipListRef = useRef<TipListType>(null)
  const listRef = useRef<ListType>(null)
  const layoutHeightRef = useRef<number>(0)
  const contentRef = useRef<View>(null)
  // 下拉面板贴在这块 content 的顶边，糊底要按它在窗口里的坐标铺图
  const contentOffsetRef = useRef({ x: 0, y: 0 })
  const [showSearchType, setShowSearchType] = useState(shouldShowSearchType(searchState.searchText))
  const [searchType, setSearchType] = useState<SearchType>('music')
  const searchInfo = useRef<SearchInfo>({ temp_source: 'kw', source: 'kw', searchType: 'music' })
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  // 标签点击和左右滑动都走这里：切换类型、换源、加载该类型的结果
  const handleTypeChange = useCallback((type: SearchType) => {
    if (type == searchInfo.current.searchType) return
    searchInfo.current.searchType = type
    setSearchType(type)
    const sources = getSearchSources(type)
    if (!sources.includes(searchInfo.current.source)) {
      searchInfo.current.source = sources[0]
      void saveSearchSetting({ source: searchInfo.current.source })
    }
    void saveSearchSetting({ type })
    headerBarRef.current?.setSourceList(sources, searchInfo.current.source)
    listRef.current?.loadList(searchState.searchText, searchInfo.current.source, type)
  }, [])

  useEffect(() => {
    void getSearchSetting().then(info => {
      // info.type = 'music'
      searchInfo.current.temp_source = info.temp_source
      searchInfo.current.source = info.source
      searchInfo.current.searchType = info.type
      setSearchType(info.type)
      headerBarRef.current?.setSourceList(getSearchSources(info.type), info.source)
      headerBarRef.current?.setText(searchState.searchText)
      listRef.current?.loadList(searchState.searchText, searchInfo.current.source, searchInfo.current.searchType)
    })

    const handleHomeTabReset = () => {
      searchTipListRef.current?.hide()
      setShowSearchType(shouldShowSearchType(searchState.searchText))
    }
    global.app_event.on('homeTabReset', handleHomeTabReset)

    return () => {
      global.app_event.off('homeTabReset', handleHomeTabReset)
    }
  }, [])


  // 页面在 PagerView 里、切标签时布局不会重新触发，所以每次要弹下拉前再量一次，
  // 免得糊底用着切换前的横坐标（会整块错开一个页宽）
  const measureContent = useCallback(() => {
    contentRef.current?.measureInWindow((x, y) => {
      contentOffsetRef.current = { x, y }
    })
  }, [])

  const handleLayout = (e: LayoutChangeEvent) => {
    layoutHeightRef.current = e.nativeEvent.layout.height
    measureContent()
  }

  const handleSourceChange: HeaderBarProps['onSourceChange'] = (source) => {
    searchInfo.current.source = source
    void saveSearchSetting({ source })
    listRef.current?.loadList(searchState.searchText, source, searchInfo.current.searchType)
  }
  const handleTipSearch: HeaderBarProps['onTipSearch'] = (text) => {
    measureContent()
    setTimeout(() => {
      searchTipListRef.current?.search(text, layoutHeightRef.current, contentOffsetRef.current)
    }, 500)
  }
  const handleHideTipList = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    searchTipListRef.current?.hide()
  }, [])
  const handleSearch = useCallback((text: string) => {
    setSearchText(text)
    handleHideTipList()
    measureContent()
    searchTipListRef.current?.search(text, layoutHeightRef.current, contentOffsetRef.current)
    setShowSearchType(shouldShowSearchType(text))
    headerBarRef.current?.setText(text)
    headerBarRef.current?.blur()
    void addHistoryWord(text)
    // 手动搜索总是重新拉取，滑动切标签才复用已加载结果
    listRef.current?.loadList(text, searchInfo.current.source, searchInfo.current.searchType, true)
  }, [handleHideTipList, measureContent])
  const handleShowTipList: HeaderBarProps['onShowTipList'] = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    measureContent()
    timeoutRef.current = setTimeout(() => {
      searchTipListRef.current?.show(layoutHeightRef.current, contentOffsetRef.current)
    }, 500)
  }

  // 结果页按系统返回：回到"输入框无输入"的空白态（与点输入框清空按钮同一条路径）。
  // 搜索 tab 不在前台、或详情页还压在上面时不能抢返回键。
  const handleBack = useCallback(() => {
    if (commonState.navActiveId != 'nav_search') return false
    if (homeDetailState.stacks.nav_search.length) return false
    if (!searchState.searchText) return false
    handleSearch('')
    return true
  }, [handleSearch])
  useBackHandler(handleBack)

  return (
    <View style={styles.container}>
      <HeaderBar
        ref={headerBarRef}
        onSourceChange={handleSourceChange}
        onTipSearch={handleTipSearch}
        onSearch={handleSearch}
        onHideTipList={handleHideTipList}
        onShowTipList={handleShowTipList}
      />
      {showSearchType ? <SearchTypeSelector style={styles.searchTypeSelector} type={searchType} onTypeChange={handleTypeChange} /> : null}
      <View ref={contentRef} collapsable={false} style={styles.content} onLayout={handleLayout}>
        <TipList ref={searchTipListRef} onSearch={handleSearch} />
        <List ref={listRef} onSearch={handleSearch} type={searchType} onTypeChange={handleTypeChange} />
      </View>
    </View>
  )
}

const styles = createStyle({
  container: {
    width: '100%',
    flex: 1,
  },
  content: {
    flex: 1,
  },
  searchTypeSelector: {
    width: '100%',
    height: 32,
  },
})
