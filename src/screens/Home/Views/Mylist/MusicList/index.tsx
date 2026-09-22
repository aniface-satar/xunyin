import { useCallback, useEffect, forwardRef, useImperativeHandle, useRef, useState } from 'react'

import listState from '@/store/list/state'
import ListMenu, { type ListMenuType, type Position, type SelectInfo } from './ListMenu'
import { clearMusicUrl, handleDislikeMusic, handlePlay, handlePlayLater, handleRemove, handleShare, handleShowMusicSourceDetail, handleUpdateMusicInfo, handleUpdateMusicPosition } from './listAction'
import List, { type ListType } from './List'
import ListMusicAdd, { type MusicAddModalType as ListMusicAddType } from '@/components/MusicAddModal'
import ListMusicMultiAdd, { type MusicMultiAddModalType as ListAddMultiType } from '@/components/MusicMultiAddModal'
import { createStyle } from '@/utils/tools'
import { type LayoutChangeEvent, View } from 'react-native'
import MultipleModeBar, { type MultipleModeBarType } from './MultipleModeBar'
import ListMusicSearch, { type ListMusicSearchType } from './ListMusicSearch'
import MusicPositionModal, { type MusicPositionModalType } from './MusicPositionModal'
import MetadataEditModal, { type MetadataEditType, type MetadataEditProps } from '@/components/MetadataEditModal'
import MusicToggleModal, { type MusicToggleModalType } from './MusicToggleModal'
import MultipleActions, { type MultipleAction } from './MultipleActions'

export interface MusicListType {
  showSearch: () => void
  search: (keyword: string) => void
  exitSearch: () => void
  showMultiSelect: () => void
  exitMultiSelect: () => void
}

interface MusicListProps {
  onExitSearch?: () => void
  onMultiSelectModeChange?: (isMultiSelectMode: boolean) => void
}

export default forwardRef<MusicListType, MusicListProps>(({ onExitSearch, onMultiSelectModeChange }, ref) => {
  const listMusicSearchRef = useRef<ListMusicSearchType>(null)
  const listRef = useRef<ListType>(null)
  const multipleModeBarRef = useRef<MultipleModeBarType>(null)
  const listMusicAddRef = useRef<ListMusicAddType>(null)
  const listMusicMultiAddRef = useRef<ListAddMultiType>(null)
  const musicPositionModalRef = useRef<MusicPositionModalType>(null)
  const metadataEditTypeRef = useRef<MetadataEditType>(null)
  const listMenuRef = useRef<ListMenuType>(null)
  const musicToggleModalRef = useRef<MusicToggleModalType>(null)
  const layoutHeightRef = useRef<number>(0)
  const isShowMultipleModeBar = useRef(false)
  const isShowSearchBarModeBar = useRef(false)
  const selectedInfoRef = useRef<SelectInfo>()
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false)
  const [selectedList, setSelectedList] = useState<LX.List.ListMusics>([])
  // console.log('render index list')

  useImperativeHandle(ref, () => ({
    showSearch() {
      handleShowSearch()
    },
    search(keyword) {
      listMusicSearchRef.current?.search(keyword, layoutHeightRef.current)
    },
    exitSearch() {
      handleExitSearch()
    },
    showMultiSelect() {
      hancelMultiSelect()
    },
    exitMultiSelect() {
      hancelExitSelect()
    },
  }))

  useEffect(() => {
    onMultiSelectModeChange?.(isMultiSelectMode)
  }, [isMultiSelectMode, onMultiSelectModeChange])

  const hancelMultiSelect = useCallback(() => {
    if (isShowSearchBarModeBar.current) {
      multipleModeBarRef.current?.setVisibleBar(false)
    }
    isShowMultipleModeBar.current = true
    setIsMultiSelectMode(true)
    multipleModeBarRef.current?.show()
    listRef.current?.setIsMultiSelectMode(true)
  }, [])
  const hancelExitSelect = useCallback(() => {
    if (isShowSearchBarModeBar.current) {
      multipleModeBarRef.current?.setVisibleBar(true)
    }
    // console.log('hancelExitSelect', isShowSearchBarModeBar.current)
    multipleModeBarRef.current?.exitSelectMode()
    listRef.current?.setIsMultiSelectMode(false)
    isShowMultipleModeBar.current = false
    setIsMultiSelectMode(false)
  }, [])
  const showMenu = useCallback((musicInfo: LX.Music.MusicInfo, index: number, position: Position) => {
    listMenuRef.current?.show({
      musicInfo,
      index,
      listId: listState.activeListId,
      single: false,
      selectedList: listRef.current!.getSelectedList(),
    }, position)
  }, [])
  const handleSelectedListChange = useCallback((list: LX.List.ListMusics) => {
    setSelectedList(list)
  }, [])
  const handleShowSearch = useCallback(() => {
    isShowSearchBarModeBar.current = true
    if (isShowMultipleModeBar.current) {
      multipleModeBarRef.current?.setVisibleBar(false)
    }
  }, [])
  const handleExitSearch = useCallback(() => {
    isShowSearchBarModeBar.current = false
    listMusicSearchRef.current?.hide()
    if (isShowMultipleModeBar.current) {
      multipleModeBarRef.current?.setVisibleBar(true)
    }
  }, [])
  const handleScrollToInfo = useCallback((info: LX.Music.MusicInfo) => {
    listRef.current?.scrollToInfo(info)
    onExitSearch?.()
    handleExitSearch()
  }, [handleExitSearch, onExitSearch])
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    layoutHeightRef.current = e.nativeEvent.layout.height
  }, [])

  const handleAddMusic = useCallback((info: SelectInfo) => {
    if (info.selectedList.length) {
      listMusicMultiAddRef.current?.show({ selectedList: info.selectedList, listId: info.listId, isMove: false })
    } else {
      listMusicAddRef.current?.show({ musicInfo: info.musicInfo, listId: info.listId, isMove: false })
    }
  }, [])
  const handleMoveMusic = useCallback((info: SelectInfo) => {
    if (info.selectedList.length) {
      listMusicMultiAddRef.current?.show({ selectedList: info.selectedList, listId: info.listId, isMove: true })
    } else {
      listMusicAddRef.current?.show({ musicInfo: info.musicInfo, listId: info.listId, isMove: true })
    }
  }, [])
  const handleEditMetadata = useCallback((info: SelectInfo) => {
    if (info.musicInfo.source != 'local') return
    selectedInfoRef.current = info
    metadataEditTypeRef.current?.show(info.musicInfo.meta.filePath)
  }, [])
  const handleUpdateMetadata = useCallback<MetadataEditProps['onUpdate']>((info) => {
    if (!selectedInfoRef.current || selectedInfoRef.current.musicInfo.source != 'local') return
    handleUpdateMusicInfo(selectedInfoRef.current.listId, selectedInfoRef.current.musicInfo, info)
  }, [])

  const handleMultipleAction = useCallback((action: MultipleAction) => {
    const info = listRef.current?.getSelectedInfo()
    if (!info) return
    switch (action) {
      case 'play':
        handlePlay(info.listId, info.index)
        break
      case 'playLater':
        hancelExitSelect()
        handlePlayLater(info.listId, info.musicInfo, info.selectedList, hancelExitSelect)
        break
      case 'add':
        handleAddMusic(info)
        break
      case 'move':
        handleMoveMusic(info)
        break
      case 'editMetadata':
        handleEditMetadata(info)
        break
      case 'copyName':
        handleShare(info.musicInfo)
        break
      case 'changePosition':
        musicPositionModalRef.current?.show(info)
        break
      case 'toggleSource':
        musicToggleModalRef.current?.show(info)
        break
      case 'musicSourceDetail':
        void handleShowMusicSourceDetail(info.musicInfo)
        break
      case 'removeCache':
        void clearMusicUrl(info.musicInfo)
        break
      case 'dislike':
        void handleDislikeMusic(info.musicInfo)
        break
      case 'remove':
        hancelExitSelect()
        handleRemove(info.listId, info.musicInfo, info.selectedList, hancelExitSelect)
        break
      default:
        break
    }
  }, [handleAddMusic, handleEditMetadata, handleMoveMusic, hancelExitSelect])


  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <MultipleModeBar
          ref={multipleModeBarRef}
          onSelectAll={isAll => listRef.current?.selectAll(isAll)}
          selectedCount={selectedList.length}
        />
      </View>
      <View style={{ flex: 1 }} onLayout={onLayout}>
        <List
          ref={listRef}
          onShowMenu={showMenu}
          onMuiltSelectMode={hancelMultiSelect}
          onSelectAll={isAll => multipleModeBarRef.current?.setIsSelectAll(isAll)}
          onSelectedListChange={handleSelectedListChange}
        />
        {
          isMultiSelectMode
            ? <MultipleActions selectedList={selectedList} onAction={handleMultipleAction} />
            : null
        }
        <ListMusicSearch
          ref={listMusicSearchRef}
          onScrollToInfo={handleScrollToInfo}
        />
      </View>
      <ListMusicAdd ref={listMusicAddRef} onAdded={hancelExitSelect} />
      <ListMusicMultiAdd ref={listMusicMultiAddRef} onAdded={hancelExitSelect} />
      <MusicPositionModal ref={musicPositionModalRef}
        onUpdatePosition={(info, postion) => { handleUpdateMusicPosition(postion, info.listId, info.musicInfo, info.selectedList, hancelExitSelect) }} />
      <ListMenu
        ref={listMenuRef}
        onPlay={info => { handlePlay(info.listId, info.index) }}
        onPlayLater={info => { hancelExitSelect(); handlePlayLater(info.listId, info.musicInfo, info.selectedList, hancelExitSelect) }}
        onRemove={info => { hancelExitSelect(); handleRemove(info.listId, info.musicInfo, info.selectedList, hancelExitSelect) }}
        onDislikeMusic={info => { void handleDislikeMusic(info.musicInfo) }}
        onCopyName={info => { handleShare(info.musicInfo) }}
        onMusicSourceDetail={info => { void handleShowMusicSourceDetail(info.musicInfo) }}
        onAdd={handleAddMusic}
        onMove={handleMoveMusic}
        onEditMetadata={handleEditMetadata}
        onChangePosition={info => musicPositionModalRef.current?.show(info)}
        onToggleSource={info => musicToggleModalRef.current?.show(info)}
        onRemoveCache={info => { void clearMusicUrl(info.musicInfo) }}
      />
      <MetadataEditModal
        ref={metadataEditTypeRef}
        onUpdate={handleUpdateMetadata}
      />
      <MusicToggleModal ref={musicToggleModalRef} />
    </View>
  )
})


const styles = createStyle({
  container: {
    flex: 1,
    flexDirection: 'column',
  },
  topBar: {
    width: '100%',
    zIndex: 2,
  },
})
