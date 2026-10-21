import { playList } from '@/core/player/player'
import { useMemo, useRef, useState, useEffect, useContext, forwardRef, useImperativeHandle, useCallback } from 'react'
import { Animated, FlatList, View, type FlatListProps, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'

import listState from '@/store/list/state'
import playerState from '@/store/player/state'
import { DetailPageActiveContext } from '@/store/homeDetail/state'
import { getListPrevSelectId } from '@/utils/data'
// import { useMusicList } from '@/store/list/hook'
import { getListMusics, setActiveList, updateListMusicPosition } from '@/core/list'
import ListItem, { ITEM_HEIGHT } from './ListItem'
import { getCustomSortOffset, getCustomSortTargetIndex, moveItemToIndex } from './customSort'
import Text from '@/components/common/Text'
import LocateButton from '@/components/common/LocateButton'
import { createStyle, getRowInfo } from '@/utils/tools'
import { useI18n } from '@/lang'
import { usePlayMusicInfo } from '@/store/player/hook'
import { useTheme } from '@/store/theme/hook'
import type { Position, SelectInfo } from './ListMenu'
import type { SelectMode } from './MultipleModeBar'
import { useSettingValue } from '@/store/setting/hook'

type FlatListType = FlatListProps<LX.Music.MusicInfo>

interface DragState {
  item: LX.Music.MusicInfo
  fromIndex: number
  targetIndex: number
}

export interface ListProps {
  isCustomSortMode: boolean
  onShowMenu: (musicInfo: LX.Music.MusicInfo, index: number, position: Position) => void
  onMuiltSelectMode: () => void
  onSelectAll: (isAll: boolean) => void
  onSelectedListChange: (selectedList: LX.List.ListMusics) => void
}
export interface ListType {
  setIsMultiSelectMode: (isMultiSelectMode: boolean) => void
  setSelectMode: (mode: SelectMode) => void
  selectAll: (isAll: boolean) => void
  getSelectedList: () => LX.List.ListMusics
  getSelectedInfo: () => SelectInfo | null
  scrollToInfo: (info: LX.Music.MusicInfo) => void
  scrollToTop: () => void
}

const List = forwardRef<ListType, ListProps>(({ isCustomSortMode, onShowMenu, onMuiltSelectMode, onSelectAll, onSelectedListChange }, ref) => {
  const theme = useTheme()
  const t = useI18n()
  const flatListRef = useRef<FlatList>(null)
  const [currentList, setList] = useState<LX.List.ListMusics>([])
  const isMultiSelectModeRef = useRef(false)
  const [isMultiSelectMode, setIsMultiSelectModeState] = useState(false)
  const selectModeRef = useRef<SelectMode>('single')
  const prevSelectIndexRef = useRef(-1)
  const [selectedList, setSelectedList] = useState<LX.List.ListMusics>([])
  const selectedListRef = useRef<LX.List.ListMusics>([])
  const currentListIdRef = useRef('')
  const currentListRef = useRef<LX.List.ListMusics>([])
  currentListRef.current = currentList
  const [dragState, setDragState] = useState<DragState | null>(null)
  const dragStateRef = useRef<DragState | null>(null)
  const dragRef = useRef<{ item: LX.Music.MusicInfo, fromIndex: number, dy: number, startScrollOffset: number } | null>(null)
  const ghostTranslateY = useRef(new Animated.Value(0)).current
  const scrollOffsetRef = useRef(0)
  const containerRef = useRef<View>(null)
  const containerMetricsRef = useRef({ top: 0, height: 0 })
  const autoScrollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const autoScrollDirRef = useRef(0)
  const rowInfo = useRef(getRowInfo())
  const onSelectedListChangeRef = useRef(onSelectedListChange)
  const isShowAlbumName = useSettingValue('list.isShowAlbumName')
  const isShowInterval = useSettingValue('list.isShowInterval')
  // console.log('render music list')

  useEffect(() => {
    onSelectedListChangeRef.current = onSelectedListChange
  }, [onSelectedListChange])

  const applyDragState = useCallback((next: DragState | null) => {
    dragStateRef.current = next
    setDragState(next)
  }, [])

  const stopAutoScroll = useCallback(() => {
    autoScrollDirRef.current = 0
    if (autoScrollTimerRef.current != null) {
      clearInterval(autoScrollTimerRef.current)
      autoScrollTimerRef.current = null
    }
  }, [])

  const cancelDrag = useCallback(() => {
    stopAutoScroll()
    dragRef.current = null
    applyDragState(null)
  }, [applyDragState, stopAutoScroll])

  const syncDragTarget = useCallback(() => {
    const drag = dragRef.current
    if (!drag) return
    const targetIndex = getCustomSortTargetIndex(
      drag.fromIndex,
      drag.dy,
      scrollOffsetRef.current - drag.startScrollOffset,
      ITEM_HEIGHT,
      currentListRef.current.length,
    )
    if (dragStateRef.current?.targetIndex == targetIndex) return
    applyDragState({ item: drag.item, fromIndex: drag.fromIndex, targetIndex })
  }, [applyDragState])

  const updateAutoScroll = useCallback((moveY: number) => {
    const { top, height } = containerMetricsRef.current
    const edge = 56
    const dir = height > 0 && moveY < top + edge
      ? -1
      : height > 0 && moveY > top + height - edge ? 1 : 0
    if (dir == autoScrollDirRef.current) return
    autoScrollDirRef.current = dir
    if (autoScrollTimerRef.current != null) {
      clearInterval(autoScrollTimerRef.current)
      autoScrollTimerRef.current = null
    }
    if (!dir) return
    autoScrollTimerRef.current = setInterval(() => {
      if (!dragRef.current) {
        stopAutoScroll()
        return
      }
      const maxOffset = Math.max(0, currentListRef.current.length * ITEM_HEIGHT - containerMetricsRef.current.height)
      const nextOffset = Math.min(maxOffset, Math.max(0, scrollOffsetRef.current + dir * 10))
      if (nextOffset == scrollOffsetRef.current) return
      scrollOffsetRef.current = nextOffset
      flatListRef.current?.scrollToOffset({ offset: nextOffset, animated: false })
      syncDragTarget()
    }, 16)
  }, [stopAutoScroll, syncDragTarget])

  const handleDragStart = useCallback((item: LX.Music.MusicInfo, index: number) => {
    stopAutoScroll()
    dragRef.current = {
      item,
      fromIndex: index,
      dy: 0,
      startScrollOffset: scrollOffsetRef.current,
    }
    ghostTranslateY.setValue(index * ITEM_HEIGHT - scrollOffsetRef.current)
    applyDragState({ item, fromIndex: index, targetIndex: index })
    containerRef.current?.measureInWindow((x, y, width, height) => {
      containerMetricsRef.current = { top: y, height }
    })
  }, [applyDragState, ghostTranslateY, stopAutoScroll])

  const handleDragMove = useCallback((dy: number, moveY: number) => {
    const drag = dragRef.current
    if (!drag) return
    drag.dy = dy
    ghostTranslateY.setValue(drag.fromIndex * ITEM_HEIGHT - drag.startScrollOffset + dy)
    syncDragTarget()
    updateAutoScroll(moveY)
  }, [ghostTranslateY, syncDragTarget, updateAutoScroll])

  const handleDragEnd = useCallback(() => {
    const drag = dragRef.current
    if (!drag) return
    const targetIndex = getCustomSortTargetIndex(
      drag.fromIndex,
      drag.dy,
      scrollOffsetRef.current - drag.startScrollOffset,
      ITEM_HEIGHT,
      currentListRef.current.length,
    )
    cancelDrag()
    if (targetIndex == drag.fromIndex) return
    const listId = currentListIdRef.current
    if (!listId) return
    const nextList = moveItemToIndex(currentListRef.current, drag.fromIndex, targetIndex)
    currentListRef.current = nextList
    setList(nextList)
    void updateListMusicPosition(listId, targetIndex, [drag.item.id])
  }, [cancelDrag])

  const handleListScroll = useCallback(({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffsetRef.current = nativeEvent.contentOffset.y
    if (dragRef.current) syncDragTarget()
  }, [syncDragTarget])

  const handleContainerLayout = useCallback(() => {
    containerRef.current?.measureInWindow((x, y, width, height) => {
      containerMetricsRef.current = { top: y, height }
    })
  }, [])

  useEffect(() => {
    if (!isCustomSortMode && dragRef.current) cancelDrag()
  }, [isCustomSortMode, cancelDrag])

  useEffect(() => {
    return () => {
      stopAutoScroll()
    }
  }, [stopAutoScroll])

  useImperativeHandle(ref, () => ({
    setIsMultiSelectMode(isMultiSelectMode) {
      isMultiSelectModeRef.current = isMultiSelectMode
      setIsMultiSelectModeState(isMultiSelectMode)
      if (!isMultiSelectMode) {
        prevSelectIndexRef.current = -1
        handleUpdateSelectedList([])
      }
    },
    setSelectMode(mode) {
      selectModeRef.current = mode
    },
    selectAll(isAll) {
      let list: LX.List.ListMusics
      if (isAll) {
        list = [...currentList]
      } else {
        list = []
      }
      handleUpdateSelectedList(list)
    },
    getSelectedList() {
      return selectedListRef.current
    },
    getSelectedInfo() {
      if (!selectedListRef.current.length) return null
      const musicInfo = selectedListRef.current[0]
      const index = currentList.findIndex(m => m.id == musicInfo.id)
      return {
        musicInfo,
        index: index < 0 ? 0 : index,
        listId: listState.activeListId,
        selectedList: selectedListRef.current,
        single: false,
      }
    },
    scrollToInfo(info) {
      void getListMusics(listState.activeListId).then((list) => {
        const index = list.findIndex(m => m.id == info.id)
        if (index < 0) return
        flatListRef.current?.scrollToIndex({ index: Math.floor(index / (rowInfo.current.rowNum ?? 1)), viewPosition: 0.3, animated: true })
      })
    },
    scrollToTop() {
      flatListRef.current?.scrollToOffset({
        offset: 0,
        animated: true,
      })
    },
  }))

  useEffect(() => {
    const updateList = (id: string) => {
      cancelDrag()
      if (currentListIdRef.current == id) return
      setList([])
      currentListIdRef.current = id
      void getListMusics(id).then((list) => {
        requestAnimationFrame(() => {
          if (currentListIdRef.current != id) return
          selectedListRef.current = []
          setSelectedList([])
          onSelectedListChangeRef.current([])
          if (__DEV__) {
            console.log('[LIST_DEBUG] ui load', { id, length: list.length, ids: list.slice(0, 8).map(item => item.id) })
          }
          setList([...list])
          requestAnimationFrame(() => {
            // 换歌单一律从顶部看起：滚动位置不再被记住，定位只由右下角的浮窗按钮发起
            flatListRef.current?.scrollToOffset({ offset: 0, animated: false })
          })
        })
      })
    }
    const handleChange = (ids: string[]) => {
      cancelDrag()
      if (!ids.includes(listState.activeListId)) return
      const id = listState.activeListId
      void getListMusics(id).then((list) => {
        if (currentListIdRef.current != id) return
        selectedListRef.current = []
        setSelectedList([])
        onSelectedListChangeRef.current([])
        if (__DEV__) {
          console.log('[LIST_DEBUG] ui change', { id, length: list.length, ids: list.slice(0, 8).map(item => item.id) })
        }
        setList([...list])
      })
    }

    const handleOpenPlayingList = () => {
      requestAnimationFrame(() => {
        const listId = playerState.playMusicInfo.listId
        if (!listId) return
        if (listId != listState.activeListId) setActiveList(listId)
      })
    }
    const openPlayingList = global.lx.jumpMyListPosition
    global.lx.jumpMyListPosition = false
    if (openPlayingList && playerState.playMusicInfo.listId) {
      updateList(playerState.playMusicInfo.listId)
    } else void getListPrevSelectId().then(updateList)

    global.state_event.on('mylistToggled', updateList)
    global.app_event.on('myListMusicUpdate', handleChange)
    global.app_event.on('jumpListPosition', handleOpenPlayingList)

    return () => {
      global.state_event.off('mylistToggled', updateList)
      global.app_event.off('myListMusicUpdate', handleChange)
      global.app_event.off('jumpListPosition', handleOpenPlayingList)
    }
  }, [cancelDrag])

  const detailPageActive = useContext(DetailPageActiveContext)
  const wasPageActiveRef = useRef(false)
  useEffect(() => {
    const becameActive = detailPageActive && !wasPageActiveRef.current
    wasPageActiveRef.current = detailPageActive
    if (becameActive) flatListRef.current?.scrollToOffset({ offset: 0, animated: false })
    if (!detailPageActive) cancelDrag()
  }, [detailPageActive, cancelDrag])

  const playMusicInfo = usePlayMusicInfo()
  const activeIndex = useMemo(() => {
    const id = playMusicInfo.musicInfo?.id
    if (!id) return -1
    return currentList.findIndex(m => m.id == id)
  }, [currentList, playMusicInfo.musicInfo?.id])
  const handleLocate = () => {
    if (activeIndex < 0) return
    try {
      flatListRef.current?.scrollToIndex({ index: Math.floor(activeIndex / (rowInfo.current.rowNum ?? 1)), viewPosition: 0.3, animated: true })
    } catch {}
  }
  const handlePlay = (index: number) => {
    void playList(listState.activeListId, index)
  }

  const handleUpdateSelectedList = (newList: LX.List.ListMusics) => {
    if (selectedListRef.current.length && newList.length == currentList.length) onSelectAll(true)
    else if (selectedListRef.current.length == currentList.length) onSelectAll(false)
    selectedListRef.current = newList
    setSelectedList(newList)
    onSelectedListChange(newList)
  }
  const handleSelect = (item: LX.Music.MusicInfo, pressIndex: number) => {
    let newList: LX.List.ListMusics
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

  const handlePress = (item: LX.Music.MusicInfo, index: number) => {
    // console.log(global.lx.homePagerIdle)
    requestAnimationFrame(() => {
      // console.log(global.lx.homePagerIdle)
      if (!global.lx.homePagerIdle) return
      if (__DEV__) {
        console.log('[PLAY_DEBUG] mylist press', {
          listId: listState.activeListId,
          index,
          id: item.id,
          name: item.name,
          singer: item.singer,
        })
      }
      if (isMultiSelectModeRef.current) {
        handleSelect(item, index)
      } else {
        handlePlay(index)
      }
    })
  }

  const handleLongPress = (item: LX.Music.MusicInfo, index: number) => {
    if (isMultiSelectModeRef.current) return
    prevSelectIndexRef.current = index
    handleUpdateSelectedList([item])
    onMuiltSelectMode()
  }


  const renderItem: FlatListType['renderItem'] = ({ item, index }) => (
    <ListItem
      item={item}
      index={index}
      activeIndex={activeIndex}
      onPress={handlePress}
      onLongPress={handleLongPress}
      onShowMenu={onShowMenu}
      selectedList={selectedList}
      rowInfo={rowInfo.current}
      isShowAlbumName={isShowAlbumName}
      isShowInterval={isShowInterval}
      isMultiSelectMode={isMultiSelectMode}
      isCustomSortMode={isCustomSortMode}
      dragOffset={dragState ? getCustomSortOffset(index, dragState.fromIndex, dragState.targetIndex, ITEM_HEIGHT) : 0}
      isDragSource={dragState?.fromIndex === index}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
    />
  )
  const getkey: FlatListType['keyExtractor'] = item => item.id
  const getItemLayout: FlatListType['getItemLayout'] = (data, index) => {
    return { length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index }
  }

  return (
    <View ref={containerRef} style={styles.container} onLayout={handleContainerLayout}>
      <FlatList
        ref={flatListRef}
        style={styles.list}
        data={currentList}
        maxToRenderPerBatch={4}
        numColumns={rowInfo.current.rowNum}
        horizontal={false}
        scrollEnabled={!dragState}
        onScroll={handleListScroll}
        scrollEventThrottle={16}
        // updateCellsBatchingPeriod={80}
        windowSize={8}
        removeClippedSubviews={!isCustomSortMode}
        initialNumToRender={12}
        renderItem={renderItem}
        keyExtractor={getkey}
        extraData={`${activeIndex}-${isMultiSelectMode}-${isCustomSortMode}-${dragState ? `${dragState.fromIndex}-${dragState.targetIndex}` : ''}`}
        getItemLayout={getItemLayout}
        ListEmptyComponent={(
          <Text style={styles.emptyText} size={13} color={theme['c-font-label']}>
            {t('no_item')}
          </Text>
        )}
      />
      {
        dragState
          ? (
            <Animated.View
              pointerEvents="none"
              style={{
                ...styles.dragGhost,
                height: ITEM_HEIGHT,
                backgroundColor: theme['c-content-background'],
                transform: [{ translateY: ghostTranslateY }],
              }}
            >
              <ListItem
                item={dragState.item}
                index={dragState.fromIndex}
                activeIndex={-1}
                onPress={handlePress}
                onLongPress={handleLongPress}
                onShowMenu={onShowMenu}
                selectedList={selectedList}
                rowInfo={rowInfo.current}
                isShowAlbumName={isShowAlbumName}
                isShowInterval={isShowInterval}
                isMultiSelectMode={false}
                isCustomSortMode
                isDragGhost
                onDragStart={handleDragStart}
                onDragMove={handleDragMove}
                onDragEnd={handleDragEnd}
              />
            </Animated.View>
            )
          : null
      }
      {
        activeIndex > -1 && !isMultiSelectMode && !dragState
          ? <LocateButton onPress={handleLocate} />
          : null
      }
    </View>
  )
})

const styles = createStyle({
  container: {
    flex: 1,
  },
  list: {
    flexGrow: 1,
    flexShrink: 1,
  },
  emptyText: {
    textAlign: 'center',
    paddingTop: 24,
  },
  dragGhost: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    zIndex: 20,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
})

export default List
