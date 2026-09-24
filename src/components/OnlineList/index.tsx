import { useCallback, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import { ScrollView, View } from 'react-native'
// import LoadingMask, { LoadingMaskType } from '@/components/common/LoadingMask'
import List, { type ListProps, type ListType, type Status, type RowInfoType } from './List'
import ListMenu, { type ListMenuType, type Position, type SelectInfo } from './ListMenu'
import ListMusicMultiAdd, { type MusicMultiAddModalType as ListAddMultiType } from '@/components/MusicMultiAddModal'
import ListMusicAdd, { type MusicAddModalType as ListMusicAddType } from '@/components/MusicAddModal'
import MultipleModeBar, { type MultipleModeBarType, type SelectMode } from './MultipleModeBar'
import { clearMusicUrl, handleDislikeMusic, handlePlay, handlePlayLater, handleShare, handleShowMusicSourceDetail } from './listAction'
import { createStyle } from '@/utils/tools'
import { BorderWidths, BorderRadius } from '@/theme'
import Text from '@/components/common/Text'
import Button from '@/components/common/Button'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { hasDislike } from '@/core/dislikeList'
import { hasMusicUrlByMusic } from '@/utils/data'
import MusicToggleModal, { type MusicToggleModalType } from '@/screens/Home/Views/Mylist/MusicList/MusicToggleModal'

type MultipleAction = 'playLater' | 'add' | 'toggleSource' | 'copyName' | 'musicSourceDetail' | 'removeCache' | 'dislike'

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
  onMultiSelectModeChange?: (isMultiSelectMode: boolean) => void
}
export interface OnlineListType {
  setList: (list: LX.Music.MusicInfoOnline[], isAppend?: boolean, showSource?: boolean) => void
  setStatus: (val: Status) => void
  showMultiSelect: () => void
  exitMultiSelect: () => void
}

const OnlineMultipleActions = ({ selectedList, onAction }: {
  selectedList: LX.Music.MusicInfoOnline[]
  onAction: (action: MultipleAction) => void
}) => {
  const t = useI18n()
  const theme = useTheme()
  const musicInfo = selectedList[0]
  const [hasUrlCache, setHasUrlCache] = useState(false)

  useEffect(() => {
    let isCurrent = true
    setHasUrlCache(false)
    if (musicInfo) {
      void hasMusicUrlByMusic(musicInfo).then(exists => {
        if (isCurrent) setHasUrlCache(exists)
      })
    }
    return () => {
      isCurrent = false
    }
  }, [musicInfo])

  const actions = useMemo(() => {
    const menus: Array<{ action: MultipleAction, label: string, disabled?: boolean }> = [
      { action: 'playLater', label: t('play_later'), disabled: !selectedList.length },
      { action: 'add', label: t('add_to'), disabled: !selectedList.length },
      { action: 'toggleSource', label: t('toggle_source'), disabled: !musicInfo },
      { action: 'copyName', label: t('copy_name'), disabled: !musicInfo },
      { action: 'musicSourceDetail', label: t('music_source_detail'), disabled: !musicInfo },
      { action: 'removeCache', label: t('list_remove_cache'), disabled: !hasUrlCache },
      { action: 'dislike', label: t('dislike'), disabled: !musicInfo || hasDislike(musicInfo) },
    ]
    return menus
  }, [hasUrlCache, musicInfo, selectedList.length, t])

  return (
    <ScrollView
      style={multipleStyles.container}
      contentContainerStyle={{ ...multipleStyles.content, borderTopColor: theme['c-border-background'] }}
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {
        actions.map(action => (
          <Button
            key={action.action}
            disabled={action.disabled}
            onPress={() => { onAction(action.action) }}
            style={{ ...multipleStyles.action, backgroundColor: theme['c-button-background'], borderColor: theme['c-border-background'] }}
          >
            <Text size={12} numberOfLines={1} color={theme['c-button-font']}>{action.label}</Text>
          </Button>
        ))
      }
    </ScrollView>
  )
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
  onMultiSelectModeChange,
}, ref) => {
  const listRef = useRef<ListType>(null)
  const multipleModeBarRef = useRef<MultipleModeBarType>(null)
  const listMusicAddRef = useRef<ListMusicAddType>(null)
  const listMusicMultiAddRef = useRef<ListAddMultiType>(null)
  const listMenuRef = useRef<ListMenuType>(null)
  const musicToggleModalRef = useRef<MusicToggleModalType>(null)
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
  }, [])

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
  const listHeader = barInHeader
    ? <>{ListHeaderComponent}{multipleModeBar}</>
    : ListHeaderComponent

  return (
    <View style={styles.container}>
      {
        barInHeader
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
        />
      </View>
      {
        multiSelectStyle == 'mylist' && isMultiSelectMode
          ? <OnlineMultipleActions selectedList={selectedList} onAction={handleMultipleAction} />
          : null
      }
      <ListMusicAdd ref={listMusicAddRef} onAdded={() => { hancelExitSelect() }} />
      <ListMusicMultiAdd ref={listMusicMultiAddRef} onAdded={() => { hancelExitSelect() }} />
      <ListMenu
        ref={listMenuRef}
        onPlay={info => { handlePlay(info.musicInfo) }}
        onPlayLater={info => { hancelExitSelect(); handlePlayLater(info.musicInfo, info.selectedList, hancelExitSelect) }}
        onCopyName={info => { handleShare(info.musicInfo) }}
        onAdd={handleAddMusic}
        onMusicSourceDetail={info => { void handleShowMusicSourceDetail(info.musicInfo) }}
        onRemoveCache={info => { void clearMusicUrl(info.musicInfo) }}
        onDislikeMusic={info => { void handleDislikeMusic(info.musicInfo) }}
      />
      <MusicToggleModal ref={musicToggleModalRef} />
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

const multipleStyles = createStyle({
  container: {
    flexGrow: 0,
    flexShrink: 0,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 8,
    paddingRight: 2,
    paddingVertical: 7,
    borderTopWidth: BorderWidths.normal,
  },
  action: {
    height: 30,
    paddingLeft: 12,
    paddingRight: 12,
    marginRight: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BorderRadius.normal,
    borderWidth: BorderWidths.normal,
    overflow: 'hidden',
  },
})
