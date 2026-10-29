import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ComponentRef } from 'react'
import { TouchableOpacity, View } from 'react-native'
import PagerView, { type PagerViewOnPageSelectedEvent } from 'react-native-pager-view'
import OnlineList, { type OnlineListType, type OnlineListProps } from '@/components/OnlineList'
import { clearListDetail, getListDetail, setListDetail, setListDetailInfo } from '@/core/songlist'
import songlistState from '@/store/songlist/state'
import { handlePlay } from './listAction'
import Header, { type DetailInfo } from './Header'
import IntroTab from './IntroTab'
import { useListInfo } from './state'
import { isAlbumListId } from '@/utils/musicSdk/albumNormalizers'
import { BorderWidths } from '@/theme'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'

// 专辑页的标签：歌曲 / 介绍（对齐歌手详情页）
type AlbumTab = 'songs' | 'intro'
const ALBUM_TABS = [
  { id: 'songs', label: 'album_tab_songs' },
  { id: 'intro', label: 'album_tab_intro' },
] as const

export interface MusicListProps {
  componentId: string
  embedded?: boolean
  onBack?: () => void
}

export interface MusicListType {
  loadList: (source: LX.OnlineSource, listId: string) => void
  showMultiSelect: () => void
  exitMultiSelect: () => void
}

export default forwardRef<MusicListType, MusicListProps>(({ componentId, embedded, onBack }, ref) => {
  const listRef = useRef<OnlineListType>(null)
  const isUnmountedRef = useRef(false)
  const theme = useTheme()
  const t = useI18n()
  const info = useListInfo()
  const isAlbum = isAlbumListId(info.id)
  const pagerRef = useRef<ComponentRef<typeof PagerView>>(null)
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false)
  const [activeTab, setActiveTab] = useState<AlbumTab>('songs')
  const [detailInfo, setDetailInfo] = useState<DetailInfo>({ name: '', author: isAlbum ? info.author : '', desc: '', playCount: '', imgUrl: info.img })

  const handleMultiSelectModeChange = useCallback((value: boolean) => {
    setIsMultiSelectMode(value)
  }, [])

  const handleTabChange = useCallback((tab: AlbumTab) => {
    setActiveTab(tab)
    // 歌曲页常驻在 PagerView 里，滑走时退出多选，避免滑回来还停在选中态
    if (isMultiSelectMode && tab != activeTab) listRef.current?.exitMultiSelect()
  }, [activeTab, isMultiSelectMode])

  const handlePageSelected = useCallback(({ nativeEvent }: PagerViewOnPageSelectedEvent) => {
    const tab = ALBUM_TABS[nativeEvent.position]?.id
    if (tab && tab != activeTab) handleTabChange(tab)
  }, [activeTab, handleTabChange])

  useEffect(() => {
    const index = ALBUM_TABS.findIndex(tab => tab.id == activeTab)
    if (index >= 0) pagerRef.current?.setPage(index)
  }, [activeTab])

  const handleToggleMultiSelect = useCallback(() => {
    // 多选作用于歌曲列表，专辑页切回「歌曲」标签再进多选
    handleTabChange('songs')
    if (isMultiSelectMode) listRef.current?.exitMultiSelect()
    else listRef.current?.showMultiSelect()
  }, [handleTabChange, isMultiSelectMode])

  useImperativeHandle(ref, () => ({
    async loadList(source, id) {
      clearListDetail()
      const listDetailInfo = songlistState.listDetailInfo
      listRef.current?.setList([])
      if (listDetailInfo.id == id && listDetailInfo.source == source && listDetailInfo.list.length) {
        requestAnimationFrame(() => {
          listRef.current?.setList(listDetailInfo.list)
          setDetailInfo({
            name: (info.name || listDetailInfo.info.name) ?? '',
            author: isAlbum ? (listDetailInfo.info.author ?? info.author) : '',
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
            desc: listDetailInfo.info.desc || info.desc || '',
            playCount: (info.play_count ?? listDetailInfo.info.play_count) ?? '',
            imgUrl: info.img ?? listDetailInfo.info.img,
          })
        })
      } else {
        listRef.current?.setStatus('loading')
        const page = 1
        setListDetailInfo(info.source, info.id)
        setDetailInfo({
          name: (info.name || listDetailInfo.info.name) ?? '',
          author: isAlbum ? (listDetailInfo.info.author ?? info.author) : '',
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          desc: listDetailInfo.info.desc || info.desc || '',
          playCount: (info.play_count ?? listDetailInfo.info.play_count) ?? '',
          imgUrl: info.img ?? listDetailInfo.info.img,
        })
        return getListDetail(id, source, page).then((listDetail) => {
          const result = setListDetail(listDetail, id, page)
          if (isUnmountedRef.current) return
          requestAnimationFrame(() => {
            setDetailInfo({
              name: (info.name || listDetailInfo.info.name) ?? '',
              author: isAlbum ? (listDetailInfo.info.author ?? info.author) : '',
              // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
              desc: listDetailInfo.info.desc || info.desc || '',
              playCount: (info.play_count ?? listDetailInfo.info.play_count) ?? '',
              imgUrl: info.img ?? listDetailInfo.info.img,
            })
            listRef.current?.setList(result.list)
            listRef.current?.setStatus(songlistState.listDetailInfo.maxPage <= page ? 'end' : 'idle')
          })
        }).catch(() => {
          if (songlistState.listDetailInfo.list.length && page == 1) clearListDetail()
          listRef.current?.setStatus('error')
        })
      }
    },
    showMultiSelect() {
      listRef.current?.showMultiSelect()
    },
    exitMultiSelect() {
      listRef.current?.exitMultiSelect()
    },
  }))

  useEffect(() => {
    isUnmountedRef.current = false
    return () => {
      isUnmountedRef.current = true
    }
  }, [])


  const handlePlayList: OnlineListProps['onPlayList'] = (index) => {
    const listDetailInfo = songlistState.listDetailInfo
    // console.log(songlistState.listDetailInfo)
    void handlePlay(listDetailInfo.id, listDetailInfo.source, listDetailInfo.list, index, {
      name: info.name,
      author: info.author,
      img: info.img,
    })
  }
  const handleRefresh: OnlineListProps['onRefresh'] = () => {
    const page = 1
    listRef.current?.setStatus('refreshing')
    getListDetail(songlistState.listDetailInfo.id, songlistState.listDetailInfo.source, page, true).then((listDetail) => {
      const result = setListDetail(listDetail, songlistState.listDetailInfo.id, page)
      if (isUnmountedRef.current) return
      listRef.current?.setList(result.list)
      listRef.current?.setStatus(songlistState.listDetailInfo.maxPage <= page ? 'end' : 'idle')
    }).catch(() => {
      if (songlistState.listDetailInfo.list.length && page == 1) clearListDetail()
      listRef.current?.setStatus('error')
    })
  }
  const handleLoadMore: OnlineListProps['onLoadMore'] = () => {
    listRef.current?.setStatus('loading')
    const page = songlistState.listDetailInfo.list.length ? songlistState.listDetailInfo.page + 1 : 1
    getListDetail(songlistState.listDetailInfo.id, songlistState.listDetailInfo.source, page).then((listDetail) => {
      const result = setListDetail(listDetail, songlistState.listDetailInfo.id, page)
      if (isUnmountedRef.current) return
      listRef.current?.setList(result.list, true)
      listRef.current?.setStatus(songlistState.listDetailInfo.maxPage <= page ? 'end' : 'idle')
    }).catch(() => {
      if (songlistState.listDetailInfo.list.length && page == 1) clearListDetail()
      listRef.current?.setStatus('error')
    })
  }

  const onlineList = (
    <OnlineList
      ref={listRef}
      onPlayList={handlePlayList}
      onRefresh={handleRefresh}
      onLoadMore={handleLoadMore}
      ListHeaderComponent={
        isAlbum
          ? undefined
          : (
            <Header
              componentId={componentId}
              embedded={embedded}
              onBack={onBack}
              isMultiSelectMode={isMultiSelectMode}
              onToggleMultiSelect={handleToggleMultiSelect}
              detailInfo={detailInfo}
            />
            )
      }
      multiSelectStyle="mylist"
      multiSelectBarPosition="header"
      onMultiSelectModeChange={handleMultiSelectModeChange}
      showLocateButton
      // progressViewOffset={}
     />
  )

  // 专辑页：头部固定（封面右侧不再显示简介），下方「歌曲 / 介绍」标签，简介只在「介绍」标签里展示
  if (isAlbum) {
    return (
      <View style={styles.container}>
        <Header
          componentId={componentId}
          embedded={embedded}
          onBack={onBack}
          detailInfo={detailInfo}
          hideDesc
          hideActionBar
        />
        <View style={{ ...styles.tabBar, borderBottomColor: theme['c-border-background'] }}>
          {ALBUM_TABS.map(tab => (
            <TouchableOpacity
              key={tab.id}
              style={styles.tabButton}
              activeOpacity={0.7}
              onPress={() => { handleTabChange(tab.id) }}
            >
              <Text
                style={{
                  ...styles.tabText,
                  borderBottomColor: activeTab == tab.id ? theme['c-primary-background-active'] : 'transparent',
                }}
                color={activeTab == tab.id ? theme['c-primary-font-active'] : theme['c-font']}
              >{t(tab.label)}</Text>
            </TouchableOpacity>
          ))}
          <View style={styles.tabBarSpacer} />
          <TouchableOpacity
            style={styles.multiSelectBtn}
            hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
            activeOpacity={0.7}
            onPress={handleToggleMultiSelect}
            accessibilityRole="button"
            accessibilityLabel={t(isMultiSelectMode ? 'list_select_cancel' : 'mylist_multi_select')}
          >
            <Text size={14} color={theme['c-primary']}>{t(isMultiSelectMode ? 'list_select_cancel' : 'mylist_multi_select')}</Text>
          </TouchableOpacity>
        </View>
        {
          // 标签页放进 PagerView 后每页常驻，滑动手势与标签点击共用 activeTab
        }
        <PagerView
          ref={pagerRef}
          style={styles.pagerView}
          initialPage={Math.max(0, ALBUM_TABS.findIndex(tab => tab.id == activeTab))}
          onPageSelected={handlePageSelected}
        >
          <View collapsable={false} style={styles.tabContent}>
            {onlineList}
          </View>
          <View collapsable={false} style={styles.tabContent}>
            <IntroTab desc={detailInfo.desc} />
          </View>
        </PagerView>
      </View>
    )
  }

  return onlineList
})

const styles = createStyle({
  container: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 6,
    borderBottomWidth: BorderWidths.normal,
  },
  tabButton: {
    paddingLeft: 10,
    paddingRight: 10,
    paddingTop: 10,
    paddingBottom: 6,
  },
  tabText: {
    fontSize: 14,
    paddingLeft: 2,
    paddingRight: 2,
    paddingBottom: 4,
    borderBottomWidth: BorderWidths.normal3,
  },
  tabBarSpacer: {
    flex: 1,
  },
  multiSelectBtn: {
    // 上 10 / 下 13 与 tabButton 的 10 + 4 + 3 + 6 齐平，文字基线与标签文字对齐
    paddingTop: 10,
    paddingBottom: 13,
    paddingLeft: 10,
    paddingRight: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pagerView: {
    flex: 1,
  },
  tabContent: {
    flex: 1,
    overflow: 'hidden',
  },
})
