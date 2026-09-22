import { playList } from '@/core/player/player'
import { useMemo, useRef, useState, useEffect, forwardRef, useImperativeHandle } from 'react'
import { FlatList, type NativeScrollEvent, type NativeSyntheticEvent, type FlatListProps } from 'react-native'

import listState from '@/store/list/state'
import playerState from '@/store/player/state'
import { getListPosition, getListPrevSelectId, saveListPosition } from '@/utils/data'
// import { useMusicList } from '@/store/list/hook'
import { getListMusics, setActiveList } from '@/core/list'
import ListItem, { ITEM_HEIGHT } from './ListItem'
import Text from '@/components/common/Text'
import { createStyle, getRowInfo } from '@/utils/tools'
import { useI18n } from '@/lang'
import { usePlayInfo, usePlayMusicInfo } from '@/store/player/hook'
import { useTheme } from '@/store/theme/hook'
import type { Position, SelectInfo } from './ListMenu'
import type { SelectMode } from './MultipleModeBar'
import { useActiveListId } from '@/store/list/hook'
import { useSettingValue } from '@/store/setting/hook'

type FlatListType = FlatListProps<LX.Music.MusicInfo>

export interface ListProps {
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

const usePlayIndex = () => {
  const activeListId = useActiveListId()
  const playMusicInfo = usePlayMusicInfo()
  const playInfo = usePlayInfo()

  const playIndex = useMemo(() => {
    return playMusicInfo.listId == activeListId ? playInfo.playIndex : -1
  }, [activeListId, playInfo.playIndex, playMusicInfo.listId])

  return playIndex
}


const List = forwardRef<ListType, ListProps>(({ onShowMenu, onMuiltSelectMode, onSelectAll, onSelectedListChange }, ref) => {
  const theme = useTheme()
  const t = useI18n()
  const flatListRef = useRef<FlatList>(null)
  const [currentList, setList] = useState<LX.List.ListMusics>([])
  const listFirstScrollRef = useRef(false)
  const isMultiSelectModeRef = useRef(false)
  const [isMultiSelectMode, setIsMultiSelectModeState] = useState(false)
  const selectModeRef = useRef<SelectMode>('single')
  const prevSelectIndexRef = useRef(-1)
  const [selectedList, setSelectedList] = useState<LX.List.ListMusics>([])
  const selectedListRef = useRef<LX.List.ListMusics>([])
  const currentListIdRef = useRef('')
  const waitJumpListPositionRef = useRef(false)
  const rowInfo = useRef(getRowInfo())
  const onSelectedListChangeRef = useRef(onSelectedListChange)
  const isShowAlbumName = useSettingValue('list.isShowAlbumName')
  const isShowInterval = useSettingValue('list.isShowInterval')
  // console.log('render music list')

  useEffect(() => {
    onSelectedListChangeRef.current = onSelectedListChange
  }, [onSelectedListChange])

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
    let isUpdateingList = true
    const updateList = (id: string) => {
      if (currentListIdRef.current == id) return
      isUpdateingList = true
      setList([])
      currentListIdRef.current = id
      void Promise.all([getListMusics(id), getListPosition(id)]).then(([list, position]) => {
        requestAnimationFrame(() => {
          if (currentListIdRef.current != id) return
          selectedListRef.current = []
          setSelectedList([])
          onSelectedListChangeRef.current([])
          console.log('[LIST_DEBUG] ui load', { id, length: list.length, ids: list.slice(0, 8).map(item => item.id) })
          setList([...list])
          requestAnimationFrame(() => {
            isUpdateingList = false
            listFirstScrollRef.current = true
            if (waitJumpListPositionRef.current) {
              waitJumpListPositionRef.current = false
              if (playerState.playMusicInfo.listId == id && playerState.playInfo.playIndex > -1) {
                try {
                  flatListRef.current?.scrollToIndex({ index: Math.floor(playerState.playInfo.playIndex / (rowInfo.current.rowNum ?? 1)), viewPosition: 0.3, animated: false })
                  return
                } catch {}
              }
            }
            flatListRef.current?.scrollToOffset({ offset: position, animated: false })
          })
        })
      })
    }
    const handleChange = (ids: string[]) => {
      if (!ids.includes(listState.activeListId)) return
      const id = listState.activeListId
      void getListMusics(id).then((list) => {
        if (currentListIdRef.current != id) return
        selectedListRef.current = []
        setSelectedList([])
        onSelectedListChangeRef.current([])
        console.log('[LIST_DEBUG] ui change', { id, length: list.length, ids: list.slice(0, 8).map(item => item.id) })
        setList([...list])
      })
    }

    const handleJumpPosition = () => {
      requestAnimationFrame(() => {
        const listId = playerState.playMusicInfo.listId
        if (!listId) return
        if (listId != listState.activeListId) {
          setActiveList(listId)
          if (currentListIdRef.current != listId) waitJumpListPositionRef.current = true
        } else if (playerState.playInfo.playIndex > -1) {
          if (isUpdateingList) waitJumpListPositionRef.current = true
          else {
            try {
              flatListRef.current?.scrollToIndex({ index: Math.floor(playerState.playInfo.playIndex / (rowInfo.current.rowNum ?? 1)), viewPosition: 0.3, animated: true })
            } catch {}
          }
        }
      })
    }
    if (global.lx.jumpMyListPosition) {
      global.lx.jumpMyListPosition = false
      if (playerState.playMusicInfo.listId) {
        waitJumpListPositionRef.current = true
        updateList(playerState.playMusicInfo.listId)
      } else void getListPrevSelectId().then(updateList)
    } else void getListPrevSelectId().then(updateList)

    global.state_event.on('mylistToggled', updateList)
    global.app_event.on('myListMusicUpdate', handleChange)
    global.app_event.on('jumpListPosition', handleJumpPosition)

    return () => {
      global.state_event.off('mylistToggled', updateList)
      global.app_event.off('myListMusicUpdate', handleChange)
      global.app_event.off('jumpListPosition', handleJumpPosition)
    }
  }, [])

  const activeIndex = usePlayIndex()
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
      console.log('[PLAY_DEBUG] mylist press', {
        listId: listState.activeListId,
        index,
        id: item.id,
        name: item.name,
        singer: item.singer,
      })
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

  const handleScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (listFirstScrollRef.current) {
      listFirstScrollRef.current = false
      return
    }
    void saveListPosition(listState.activeListId, nativeEvent.contentOffset.y)
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
    />
  )
  const getkey: FlatListType['keyExtractor'] = item => item.id
  const getItemLayout: FlatListType['getItemLayout'] = (data, index) => {
    return { length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index }
  }

  return (
    <FlatList
      ref={flatListRef}
      onScroll={handleScroll}
      style={styles.list}
      data={currentList}
      maxToRenderPerBatch={4}
      numColumns={rowInfo.current.rowNum}
      horizontal={false}
      // updateCellsBatchingPeriod={80}
      windowSize={8}
      removeClippedSubviews={true}
      initialNumToRender={12}
      renderItem={renderItem}
      keyExtractor={getkey}
      extraData={activeIndex + '-' + isMultiSelectMode}
      getItemLayout={getItemLayout}
      ListEmptyComponent={(
        <Text style={styles.emptyText} size={13} color={theme['c-font-label']}>
          {t('no_item')}
        </Text>
      )}
    />
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
})

export default List
