import { useMemo, useRef, useState, useEffect, useContext, forwardRef, useImperativeHandle, type ReactElement } from 'react'
import { FlatList, type FlatListProps, RefreshControl, View } from 'react-native'

import { DetailPageActiveContext } from '@/store/homeDetail/state'

// import { useMusicList } from '@/store/list/hook'
import ListItem, { ITEM_HEIGHT } from './ListItem'
import LocateButton from '@/components/common/LocateButton'
import { usePlayMusicInfo } from '@/store/player/hook'
import { createStyle, getRowInfo, type RowInfoType } from '@/utils/tools'
import type { Position } from './ListMenu'
import type { SelectMode } from './MultipleModeBar'
import { useTheme } from '@/store/theme/hook'
import { MULTI_SELECT_BAR_HEIGHT } from './MultipleModeBar'
import { useI18n } from '@/lang'
import Text from '@/components/common/Text'
import { handlePlay } from './listAction'
import { getListPressAction } from './pressAction'
import { useSettingValue } from '@/store/setting/hook'

type FlatListType = FlatListProps<LX.Music.MusicInfoOnline>

export type {
  RowInfoType,
}

export interface ListProps {
  onShowMenu: (musicInfo: LX.Music.MusicInfoOnline, index: number, position: Position) => void
  onMuiltSelectMode: () => void
  onSelectAll: (isAll: boolean) => void
  onRefresh: () => void
  onLoadMore: () => void
  onPlayList?: (index: number) => void
  progressViewOffset?: number
  ListHeaderComponent?: FlatListType['ListEmptyComponent']
  checkHomePagerIdle: boolean
  rowType?: RowInfoType
  onSelectedListChange?: (list: LX.Music.MusicInfoOnline[]) => void
  showLocateButton?: boolean
}
export interface ListType {
  setList: (list: LX.Music.MusicInfoOnline[], isAppend: boolean, showSource: boolean) => void
  setIsMultiSelectMode: (isMultiSelectMode: boolean) => void
  setSelectMode: (mode: SelectMode) => void
  selectAll: (isAll: boolean) => void
  getSelectedList: () => LX.Music.MusicInfoOnline[]
  getList: () => LX.Music.MusicInfoOnline[]
  setStatus: (val: Status) => void
}
export type Status = 'loading' | 'refreshing' | 'end' | 'error' | 'idle'


const List = forwardRef<ListType, ListProps>(({
  onShowMenu,
  onMuiltSelectMode,
  onSelectAll,
  onRefresh,
  onLoadMore,
  onPlayList,
  progressViewOffset,
  ListHeaderComponent,
  checkHomePagerIdle,
  rowType,
  onSelectedListChange,
  showLocateButton,
}, ref) => {
  // const t = useI18n()
  const theme = useTheme()
  const flatListRef = useRef<FlatList>(null)
  const [currentList, setList] = useState<LX.Music.MusicInfoOnline[]>([])
  const [showSource, setShowSource] = useState(false)
  const isMultiSelectModeRef = useRef(false)
  const [isMultiSelectMode, setIsMultiSelectModeState] = useState(false)
  const selectModeRef = useRef<SelectMode>('single')
  const prevSelectIndexRef = useRef(-1)
  const [selectedList, setSelectedList] = useState<LX.Music.MusicInfoOnline[]>([])
  const selectedListRef = useRef<LX.Music.MusicInfoOnline[]>([])
  const [visibleMultiSelect, setVisibleMultiSelect] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const rowInfo = useRef(getRowInfo(rowType))
  const isShowAlbumName = useSettingValue('list.isShowAlbumName')
  const isShowInterval = useSettingValue('list.isShowInterval')
  // const currentListIdRef = useRef('')
  // console.log('render music list')

  useImperativeHandle(ref, () => ({
    setList(list, isAppend, showSource) {
      setList(list)
      setShowSource(showSource)
      if (!isAppend) {
        if (selectedListRef.current.length) setSelectedList(selectedListRef.current = [])
        // 换一份歌曲列表（歌单、榜单、搜索结果）就从顶部看起，不继承上一份列表的滚动位置
        flatListRef.current?.scrollToOffset({ offset: 0, animated: false })
      }
    },
    setIsMultiSelectMode(isMultiSelectMode) {
      isMultiSelectModeRef.current = isMultiSelectMode
      setIsMultiSelectModeState(isMultiSelectMode)
      if (!isMultiSelectMode) {
        prevSelectIndexRef.current = -1
        handleUpdateSelectedList([])
      }
      setVisibleMultiSelect(isMultiSelectMode)
    },
    setSelectMode(mode) {
      selectModeRef.current = mode
    },
    selectAll(isAll) {
      let list: LX.Music.MusicInfoOnline[]
      if (isAll) {
        list = [...currentList]
      } else {
        list = []
      }
      selectedListRef.current = list
      setSelectedList(list)
      onSelectedListChange?.(list)
    },
    getSelectedList() {
      return selectedListRef.current
    },
    getList() {
      return currentList
    },
    setStatus(val) {
      setStatus(val)
    },
  }))

  const detailPageActive = useContext(DetailPageActiveContext)
  const wasPageActiveRef = useRef(false)
  useEffect(() => {
    const becameActive = detailPageActive && !wasPageActiveRef.current
    wasPageActiveRef.current = detailPageActive
    if (becameActive) flatListRef.current?.scrollToOffset({ offset: 0, animated: false })
  }, [detailPageActive])


  const handleUpdateSelectedList = (newList: LX.Music.MusicInfoOnline[]) => {
    if (selectedListRef.current.length && newList.length == currentList.length) onSelectAll(true)
    else if (selectedListRef.current.length == currentList.length) onSelectAll(false)
    selectedListRef.current = newList
    setSelectedList(newList)
    onSelectedListChange?.(newList)
  }
  const handleSelect = (item: LX.Music.MusicInfoOnline, pressIndex: number) => {
    let newList: LX.Music.MusicInfoOnline[]
    if (selectModeRef.current == 'single') {
      prevSelectIndexRef.current = pressIndex
      const index = selectedListRef.current.indexOf(item)
      if (index < 0) {
        newList = [...selectedListRef.current, item]
      } else {
        newList = [...selectedListRef.current]
        newList.splice(index, 1)
      }
    } else {
      if (selectedListRef.current.length) {
        const prevIndex = prevSelectIndexRef.current
        const currentIndex = pressIndex
        if (prevIndex == currentIndex) {
          newList = []
        } else if (currentIndex > prevIndex) {
          newList = currentList.slice(prevIndex, currentIndex + 1)
        } else {
          newList = currentList.slice(currentIndex, prevIndex + 1)
          newList.reverse()
        }
      } else {
        newList = [item]
        prevSelectIndexRef.current = pressIndex
      }
    }

    handleUpdateSelectedList(newList)
  }

  const handlePress = (item: LX.Music.MusicInfoOnline, index: number) => {
    requestAnimationFrame(() => {
      if (checkHomePagerIdle && !global.lx.homePagerIdle) return
      if (isMultiSelectModeRef.current) {
        handleSelect(item, index)
      } else {
        const pressAction = getListPressAction(currentList[index], index, onPlayList)
        if (pressAction.kind == 'sourceList') {
          pressAction.onPlayList(pressAction.index)
        } else {
          // console.log(currentList[index])
          handlePlay(pressAction.musicInfo)
        }
      }
    })
  }

  const handleLongPress = (item: LX.Music.MusicInfoOnline, index: number) => {
    if (isMultiSelectModeRef.current) return
    prevSelectIndexRef.current = index
    handleUpdateSelectedList([item])
    onMuiltSelectMode()
  }

  const handleLoadMore = () => {
    if (status != 'idle') return
    onLoadMore()
  }

  const playMusicInfo = usePlayMusicInfo()
  const activeIndex = useMemo(() => {
    const id = playMusicInfo.musicInfo?.id
    if (!id) return -1
    return currentList.findIndex(m => m.id == id)
  }, [currentList, playMusicInfo.musicInfo?.id])
  const headerHeightRef = useRef(0)
  const viewportHeightRef = useRef(0)
  const handleLocate = () => {
    if (activeIndex < 0) return
    const row = Math.floor(activeIndex / (rowInfo.current.rowNum ?? 1))
    const offset = Math.max(0, headerHeightRef.current + row * ITEM_HEIGHT - viewportHeightRef.current * 0.3)
    flatListRef.current?.scrollToOffset({ offset, animated: true })
  }

  const locateHeaderComponent = useMemo(() => (
    ListHeaderComponent
      ? (
          <View onLayout={e => { headerHeightRef.current = e.nativeEvent.layout.height }}>
            {ListHeaderComponent as ReactElement}
          </View>
        )
      : null
  ), [ListHeaderComponent])


  const renderItem: FlatListType['renderItem'] = ({ item, index }) => (
    <ListItem
      item={item}
      index={index}
      showSource={showSource}
      onPress={handlePress}
      onLongPress={handleLongPress}
      onShowMenu={onShowMenu}
      selectedList={selectedList}
      rowInfo={rowInfo.current}
      isShowAlbumName={isShowAlbumName}
      isShowInterval={isShowInterval}
      isMultiSelectMode={isMultiSelectMode}
      activeIndex={activeIndex}
    />
  )
  const getkey: FlatListType['keyExtractor'] = item => item.id
  const getItemLayout: FlatListType['getItemLayout'] = (data, index) => {
    return { length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index }
  }
  const refreshControl = useMemo(() => (
    <RefreshControl
      colors={[theme['c-primary']]}
      // progressBackgroundColor={theme.primary}
      refreshing={status == 'refreshing'}
      onRefresh={onRefresh} />
  ), [status, onRefresh, theme])
  const footerComponent = useMemo(() => {
    let label: FooterLabel
    switch (status) {
      case 'refreshing': return null
      case 'loading':
        label = 'list_loading'
        break
      case 'end':
        label = 'list_end'
        break
      case 'error':
        label = 'list_error'
        break
      case 'idle':
        label = null
        break
    }
    return (
      <View style={{ width: '100%', paddingBottom: visibleMultiSelect ? MULTI_SELECT_BAR_HEIGHT : 0 }} >
        <Footer label={label} onLoadMore={onLoadMore} />
      </View>
    )
  }, [onLoadMore, status, visibleMultiSelect])

  return (
    <View style={styles.container} onLayout={e => { viewportHeightRef.current = e.nativeEvent.layout.height }}>
      <FlatList
        ref={flatListRef}
        style={styles.list}
        data={currentList}
        numColumns={rowInfo.current.rowNum}
        horizontal={false}
        maxToRenderPerBatch={4}
        // updateCellsBatchingPeriod={80}
        windowSize={8}
        removeClippedSubviews={true}
        initialNumToRender={12}
        renderItem={renderItem}
        keyExtractor={getkey}
        getItemLayout={getItemLayout}
        // onRefresh={onRefresh}
        // refreshing={refreshing}
        onEndReachedThreshold={0.5}
        onEndReached={handleLoadMore}
        progressViewOffset={progressViewOffset}
        ListHeaderComponent={showLocateButton ? locateHeaderComponent : ListHeaderComponent}
        refreshControl={refreshControl}
        ListFooterComponent={footerComponent}
      />
      {
        showLocateButton && activeIndex > -1 && !isMultiSelectMode
          ? <LocateButton onPress={handleLocate} />
          : null
      }
    </View>
  )
})

type FooterLabel = 'list_loading' | 'list_end' | 'list_error' | null
const Footer = ({ label, onLoadMore }: {
  label: FooterLabel
  onLoadMore: () => void
}) => {
  const theme = useTheme()
  const t = useI18n()
  const handlePress = () => {
    if (label != 'list_error') return
    onLoadMore()
  }
  return (
    label
      ? (
          <View>
            <Text onPress={handlePress} style={styles.footer} color={theme['c-font-label']}>{t(label)}</Text>
          </View>
        )
      : null
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
  list: {
    flexGrow: 1,
    flexShrink: 1,
  },
  footer: {
    textAlign: 'center',
    padding: 10,
  },
})

export default List
