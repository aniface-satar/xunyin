import { useCallback, useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import { View } from 'react-native'
// import LoadingMask, { LoadingMaskType } from '@/components/common/LoadingMask'
import List, { type ListProps, type ListType, type Status, type RowInfoType } from './List'
import ListMenu, { type ListMenuType, type Position, type SelectInfo } from './ListMenu'
import ListMusicMultiAdd, { type MusicMultiAddModalType as ListAddMultiType } from '@/components/MusicMultiAddModal'
import ListMusicAdd, { type MusicAddModalType as ListMusicAddType } from '@/components/MusicAddModal'
import MultipleModeBar, { type MultipleModeBarType, type SelectMode } from './MultipleModeBar'
import MultipleActionsBar, { type MultipleAction } from './MultipleActionsBar'
import { clearMusicUrl, handleDislikeMusic, handlePlay, handlePlayLater, handleShare, handleShowMusicSourceDetail } from './listAction'
import { createStyle } from '@/utils/tools'
import MusicToggleModal, { type MusicToggleModalType } from '@/screens/Home/Views/Mylist/MusicList/MusicToggleModal'
import DownloadQualitySheet, { type DownloadQualitySheetType } from '@/components/DownloadQualitySheet'

export interface OnlineListProps {
  onRefresh: ListProps['onRefresh']
  onLoadMore: ListProps['onLoadMore']
  onPlayList?: ListProps['onPlayList']
  progressViewOffset?: ListProps['progressViewOffset']
  ListHeaderComponent?: ListProps['ListHeaderComponent']
  checkHomePagerIdle?: boolean
  rowType?: RowInfoType
  multiSelectStyle?: 'default' | 'mylist'
  multiSelectBarPosition?: 'top' | 'header'
  /**
   * builtin：选择栏（已选 N 项 / 全选）与底部批量操作栏都由列表自己渲染（默认）；
   * external：不渲染内置选择栏，改由宿主页面在自己的工具条里绘制「取消 / 全选」，
   * 宿主通过 ref 的 selectAll 驱动；底部批量操作栏保持不变。
   */
  multiSelectUi?: 'builtin' | 'external'
  onMultiSelectModeChange?: (isMultiSelectMode: boolean) => void
  onSelectedListChange?: (selectedList: LX.Music.MusicInfoOnline[]) => void
  showLocateButton?: boolean
}
export interface OnlineListType {
  setList: (list: LX.Music.MusicInfoOnline[], isAppend?: boolean, showSource?: boolean) => void
  setStatus: (val: Status) => void
  showMultiSelect: () => void
  exitMultiSelect: () => void
  selectAll: (isAll: boolean) => void
}

export default forwardRef<OnlineListType, OnlineListProps>(({
  onRefresh,
  onLoadMore,
  onPlayList,
  progressViewOffset,
  ListHeaderComponent,
  checkHomePagerIdle = false,
  rowType,
  multiSelectStyle = 'default',
  multiSelectBarPosition = 'top',
  multiSelectUi = 'builtin',
  onMultiSelectModeChange,
  onSelectedListChange,
  showLocateButton,
}, ref) => {
  const listRef = useRef<ListType>(null)
  const multipleModeBarRef = useRef<MultipleModeBarType>(null)
  const listMusicAddRef = useRef<ListMusicAddType>(null)
  const listMusicMultiAddRef = useRef<ListAddMultiType>(null)
  const listMenuRef = useRef<ListMenuType>(null)
  const musicToggleModalRef = useRef<MusicToggleModalType>(null)
  const downloadQualitySheetRef = useRef<DownloadQualitySheetType>(null)
  // const loadingMaskRef = useRef<LoadingMaskType>(null)
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false)
  const [selectedList, setSelectedList] = useState<LX.Music.MusicInfoOnline[]>([])

  useImperativeHandle(ref, () => ({
    setList(list, isAppend = false, showSource = false) {
      listRef.current?.setList(list, isAppend, showSource)
      multipleModeBarRef.current?.setIsSelectAll(false)
    },
    setStatus(val) {
      listRef.current?.setStatus(val)
    },
    showMultiSelect() {
      hancelMultiSelect()
    },
    exitMultiSelect() {
      hancelExitSelect()
    },
    selectAll(isAll) {
      listRef.current?.selectAll(isAll)
      multipleModeBarRef.current?.setIsSelectAll(isAll)
    },
  }))

  useEffect(() => {
    onMultiSelectModeChange?.(isMultiSelectMode)
  }, [isMultiSelectMode, onMultiSelectModeChange])

  const hancelMultiSelect = () => {
    multipleModeBarRef.current?.show()
    listRef.current?.setIsMultiSelectMode(true)
    setIsMultiSelectMode(true)
  }
  const hancelSwitchSelectMode = (mode: SelectMode) => {
    multipleModeBarRef.current?.setSwitchMode(mode)
    listRef.current?.setSelectMode(mode)
  }
  const hancelExitSelect = () => {
    multipleModeBarRef.current?.exitSelectMode()
    listRef.current?.setIsMultiSelectMode(false)
    setIsMultiSelectMode(false)
  }

  const handleSelectedListChange = useCallback((list: LX.Music.MusicInfoOnline[]) => {
    setSelectedList(list)
    onSelectedListChange?.(list)
  }, [onSelectedListChange])

  const showMenu = (musicInfo: LX.Music.MusicInfoOnline, index: number, position: Position) => {
    listMenuRef.current?.show({
      musicInfo,
      index,
      single: false,
      selectedList: listRef.current!.getSelectedList(),
    }, position)
  }
  const handleAddMusic = (info: SelectInfo) => {
    if (info.selectedList.length) {
      listMusicMultiAddRef.current?.show({ selectedList: info.selectedList, listId: '', isMove: false })
    } else {
      listMusicAddRef.current?.show({ musicInfo: info.musicInfo, listId: '', isMove: false })
    }
  }

  const handleMultipleAction = useCallback((action: MultipleAction) => {
    const info = listRef.current?.getSelectedList()
    if (!info?.length) return
    const musicInfo = info[0]
    switch (action) {
      case 'playLater':
        hancelExitSelect()
        handlePlayLater(musicInfo, info, hancelExitSelect)
        break
      case 'download':
        hancelExitSelect()
        requestAnimationFrame(() => {
          downloadQualitySheetRef.current?.show(info)
        })
        break
      case 'add':
        listMusicMultiAddRef.current?.show({ selectedList: info, listId: '', isMove: false })
        break
      case 'toggleSource':
        musicToggleModalRef.current?.show({ musicInfo, listId: '' })
        break
      case 'copyName':
        handleShare(musicInfo)
        break
      case 'musicSourceDetail':
        void handleShowMusicSourceDetail(musicInfo)
        break
      case 'removeCache':
        void clearMusicUrl(musicInfo)
        break
      case 'dislike':
        void handleDislikeMusic(musicInfo)
        break
    }
  }, [])

  const multipleModeBar = (
    <MultipleModeBar
      ref={multipleModeBarRef}
      onSwitchMode={hancelSwitchSelectMode}
      onSelectAll={isAll => {
        listRef.current?.selectAll(isAll)
        if (multiSelectStyle == 'mylist') {
          const list = listRef.current?.getList() ?? []
          handleSelectedListChange(isAll ? [...list] : [])
        }
      }}
      onExitSelectMode={hancelExitSelect}
      multiSelectStyle={multiSelectStyle}
      selectedCount={selectedList.length}
    />
  )
  const barInHeader = multiSelectBarPosition == 'header'
  const builtinMultiSelectUi = multiSelectUi == 'builtin'
  const listHeader = barInHeader && builtinMultiSelectUi
    ? <>{ListHeaderComponent}{multipleModeBar}</>
    : ListHeaderComponent

  return (
    <View style={styles.container}>
      {
        barInHeader || !builtinMultiSelectUi
          ? null
          : <View style={styles.topBar}>{multipleModeBar}</View>
      }
      <View style={{ flex: 1 }}>
        <List
          ref={listRef}
          onShowMenu={showMenu}
          onMuiltSelectMode={hancelMultiSelect}
          onSelectAll={isAll => {
            multipleModeBarRef.current?.setIsSelectAll(isAll)
            if (multiSelectStyle == 'mylist') {
              const list = listRef.current?.getList() ?? []
              handleSelectedListChange(isAll ? [...list] : [])
            }
          }}
          onRefresh={onRefresh}
          onLoadMore={onLoadMore}
          onPlayList={onPlayList}
          progressViewOffset={progressViewOffset}
          ListHeaderComponent={listHeader}
          checkHomePagerIdle={checkHomePagerIdle}
          rowType={rowType}
          onSelectedListChange={multiSelectStyle == 'mylist' ? handleSelectedListChange : undefined}
          showLocateButton={showLocateButton}
        />
      </View>
      {
        // 底部批量操作栏与选择栏解耦：即使选择栏交给宿主页面绘制，这里仍保留原有位置
        multiSelectStyle == 'mylist' && isMultiSelectMode
          ? <MultipleActionsBar selectedList={selectedList} onAction={handleMultipleAction} />
          : null
      }
      <ListMusicAdd ref={listMusicAddRef} onAdded={() => { hancelExitSelect() }} />
      <ListMusicMultiAdd ref={listMusicMultiAddRef} onAdded={() => { hancelExitSelect() }} />
      <ListMenu
        ref={listMenuRef}
        onPlay={info => {
          // 歌单上下文（如歌单详情、榜单）中的“播放”按来源歌单播放，与点行行为一致，
          // 否则会落入试听列表，导致歌单播放历史无法记录
          if (onPlayList) {
            onPlayList(info.index)
            return
          }
          handlePlay(info.musicInfo)
        }}
        onPlayLater={info => { hancelExitSelect(); handlePlayLater(info.musicInfo, info.selectedList, hancelExitSelect) }}
        onDownload={info => {
          requestAnimationFrame(() => {
            downloadQualitySheetRef.current?.show([info.musicInfo])
          })
        }}
        onCopyName={info => { handleShare(info.musicInfo) }}
        onAdd={handleAddMusic}
        onMusicSourceDetail={info => { void handleShowMusicSourceDetail(info.musicInfo) }}
        onRemoveCache={info => { void clearMusicUrl(info.musicInfo) }}
        onDislikeMusic={info => { void handleDislikeMusic(info.musicInfo) }}
      />
      <MusicToggleModal ref={musicToggleModalRef} />
      <DownloadQualitySheet ref={downloadQualitySheetRef} />
      {/* <LoadingMask ref={loadingMaskRef} /> */}
    </View>
  )
})


const styles = createStyle({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  topBar: {
    width: '100%',
    zIndex: 2,
  },
  list: {
    flex: 1,
  },
  exitMultipleModeBtn: {
    height: 40,
  },
})
