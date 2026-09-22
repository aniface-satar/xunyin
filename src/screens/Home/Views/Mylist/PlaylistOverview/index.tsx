import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, TouchableOpacity, View, type FlatListProps } from 'react-native'

import { Icon } from '@/components/common/Icon'
import Image from '@/components/common/Image'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useMyList } from '@/store/list/hook'
import { getListMusics, removeUserList } from '@/core/list'
import { createStyle, confirmDialog } from '@/utils/tools'
import { useI18n } from '@/lang'
import { scaleSizeH, scaleSizeW } from '@/utils/pixelRatio'
import { BorderWidths, BorderRadius } from '@/theme'
import { LIST_IDS } from '@/config/constant'

import ListMenu, { type ListMenuType, type Position } from '../MyList/ListMenu'
import ListNameEdit, { type ListNameEditType } from '../MyList/ListNameEdit'
import ListMusicSort, { type ListMusicSortType } from '../MyList/ListMusicSort'
import DuplicateMusic, { type DuplicateMusicType } from '../MyList/DuplicateMusic'
import ListImportExport, { type ListImportExportType } from '../MyList/ListImportExport'
import { handleRemove, handleSync } from '../MyList/listAction'
import { useMylistSearch } from '../Search'

type FlatListType = FlatListProps<LX.List.UserListInfo>

export interface PlaylistMeta {
  count: number
  cover: string | null
}

interface QuickTileProps {
  icon: 'love' | 'music_time'
  label: string
  onPress: () => void
}

const QuickTile = ({ icon, label, onPress }: QuickTileProps) => {
  const theme = useTheme()

  return (
    <TouchableOpacity
      style={{ ...styles.quickTile, backgroundColor: theme['c-primary-background'] }}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Icon name={icon} size={22} color={theme['c-primary-font']} />
      <Text style={styles.quickTileLabel} size={14} color={theme['c-font']}>{label}</Text>
    </TouchableOpacity>
  )
}

const PlaylistRow = memo(({ item, meta, onPress, onShowMenu, onSelect, index, isMultiSelect, selected }: {
  item: LX.List.UserListInfo
  index: number
  meta: PlaylistMeta | undefined
  onPress: (item: LX.List.UserListInfo) => void
  onShowMenu: (item: LX.List.UserListInfo, index: number, position: Position) => void
  onSelect: (item: LX.List.UserListInfo) => void
  isMultiSelect: boolean
  selected: boolean
}) => {
  const theme = useTheme()
  const moreButtonRef = useRef<TouchableOpacity>(null)

  const handleShowMenu = () => {
    if (moreButtonRef.current?.measure) {
      moreButtonRef.current.measure((fx, fy, width, height, px, py) => {
        onShowMenu(item, index, {
          x: Math.ceil(px),
          y: Math.ceil(py),
          w: Math.ceil(width),
          h: Math.ceil(height),
        })
      })
    }
  }

  return (
    <TouchableOpacity
      style={{ ...styles.playlistRow, borderBottomColor: theme['c-border-background'] }}
      onPress={() => { isMultiSelect ? onSelect(item) : onPress(item) }}
      activeOpacity={0.7}
    >
      {
        isMultiSelect
          ? (
            <View style={styles.playlistCheckbox}>
              <Icon
                name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'}
                size={18}
                color={selected ? theme['c-primary'] : theme['c-350']}
              />
            </View>
            )
          : null
      }
      <View style={{ ...styles.playlistCover, backgroundColor: theme['c-primary-background'] }}>
        <Image url={meta?.cover} style={styles.playlistCoverImage} />
      </View>
      <View style={styles.playlistInfo}>
        <Text numberOfLines={1} size={15} color={theme['c-font']}>{item.name}</Text>
        <Text style={styles.playlistCount} size={12} color={theme['c-font-label']}>
          {global.i18n.t('mylist_song_count', { count: meta?.count ?? 0 })}
        </Text>
      </View>
      {
        !isMultiSelect
          ? (
            <TouchableOpacity onPress={handleShowMenu} ref={moreButtonRef} style={styles.playlistMoreBtn}>
              <Icon name="dots-vertical" color={theme['c-350']} size={16} />
            </TouchableOpacity>
            )
          : null
      }
    </TouchableOpacity>
  )
})

const OverviewHeader = ({ isMultiSelect, selectedCount, onOpenLove, onOpenHistory, onToggleMultiSelect, onSelectAll, onCreatePlaylist }: {
  onOpenLove: () => void
  onOpenHistory: () => void
  isMultiSelect: boolean
  selectedCount: number
  onToggleMultiSelect: () => void
  onSelectAll: () => void
  onCreatePlaylist: () => void
}) => {
  const theme = useTheme()
  const t = useI18n()

  return (
    <View>
      <View style={styles.quickGrid}>
        <QuickTile icon="love" label={t('mylist_favorite')} onPress={onOpenLove} />
        <QuickTile icon="music_time" label={t('mylist_history')} onPress={onOpenHistory} />
      </View>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel} size={13} color={theme['c-font-label']}>
          {isMultiSelect ? t('mylist_selected_count', { count: selectedCount }) : t('mylist_user_playlists')}
        </Text>
        <TouchableOpacity
          style={styles.sectionAction}
          onPress={onToggleMultiSelect}
          activeOpacity={0.7}
        >
          <Text size={13} color={theme['c-primary']}>
            {isMultiSelect ? t('list_select_cancel') : t('mylist_multi_select')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.sectionAction}
          onPress={isMultiSelect ? onSelectAll : onCreatePlaylist}
          activeOpacity={0.7}
        >
          <Text size={13} color={theme['c-primary']}>
            {isMultiSelect ? t('list_select_all') : t('mylist_new_playlist')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

export default ({ onOpenList, onOpenLove, onOpenHistory }: {
  onOpenList: (listInfo: LX.List.MyListInfo) => void
  onOpenLove: () => void
  onOpenHistory: () => void
}) => {
  const theme = useTheme()
  const t = useI18n()
  const allList = useMyList()
  const { keyword } = useMylistSearch()
  const userList = useMemo(() => allList.filter((l): l is LX.List.UserListInfo => {
    return l.id !== LIST_IDS.DEFAULT && l.id !== LIST_IDS.LOVE && l.id !== LIST_IDS.TEMP &&
      !('isLove' in l && l.isLove)
  }), [allList])
  const searchText = keyword.trim().toLowerCase()
  const displayUserList = useMemo(() => {
    return searchText
      ? userList.filter(listInfo => listInfo.name.toLowerCase().includes(searchText))
      : userList
  }, [searchText, userList])
  const [metas, setMetas] = useState<Record<string, PlaylistMeta>>({})
  const [isMultiSelect, setIsMultiSelect] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const loadMeta = useCallback(async(listId: string) => {
    const list = await getListMusics(listId)
    const cover = list.find(musicInfo => musicInfo.meta.picUrl)?.meta.picUrl ?? null
    setMetas(prev => ({ ...prev, [listId]: { count: list.length, cover } }))
  }, [])

  useEffect(() => {
    for (const listInfo of displayUserList) void loadMeta(listInfo.id).catch(() => {})
    void loadMeta(LIST_IDS.LOVE).catch(() => {})
  }, [displayUserList, loadMeta])

  useEffect(() => {
    const handleChange = (ids: string[]) => {
      for (const id of ids) void loadMeta(id).catch(() => {})
    }
    global.app_event.on('myListMusicUpdate', handleChange)
    return () => {
      global.app_event.off('myListMusicUpdate', handleChange)
    }
  }, [loadMeta])

  const listMenuRef = useRef<ListMenuType>(null)
  const listNameEditRef = useRef<ListNameEditType>(null)
  const listMusicSortRef = useRef<ListMusicSortType>(null)
  const duplicateMusicRef = useRef<DuplicateMusicType>(null)
  const listImportExportRef = useRef<ListImportExportType>(null)

  const showMenu = useCallback((listInfo: LX.List.UserListInfo, index: number, position: Position) => {
    listMenuRef.current?.show({ listInfo, index }, position)
  }, [])

  const toggleMultiSelect = useCallback(() => {
    setIsMultiSelect(prev => !prev)
    setSelectedIds(new Set())
  }, [])

  const togglePlaylistSelect = useCallback((listInfo: LX.List.UserListInfo) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(listInfo.id)) next.delete(listInfo.id)
      else next.add(listInfo.id)
      return next
    })
  }, [])

  const selectAllPlaylists = useCallback(() => {
    setSelectedIds(prev => prev.size == displayUserList.length ? new Set() : new Set(displayUserList.map(listInfo => listInfo.id)))
  }, [displayUserList])

  const removeSelectedPlaylists = useCallback(() => {
    const ids = userList.filter(listInfo => selectedIds.has(listInfo.id)).map(listInfo => listInfo.id)
    if (!ids.length) return
    void confirmDialog({
      message: global.i18n.t('mylist_playlist_remove_multi_tip', { num: ids.length }),
      confirmButtonText: global.i18n.t('list_remove_tip_button'),
    }).then(confirmed => {
      if (!confirmed) return
      void removeUserList(ids)
      setIsMultiSelect(false)
      setSelectedIds(new Set())
    })
  }, [selectedIds, userList])

  const renderItem: FlatListType['renderItem'] = ({ item, index }) => (
    <PlaylistRow
      item={item}
      index={index}
      meta={metas[item.id]}
      onPress={onOpenList}
      onShowMenu={showMenu}
      onSelect={togglePlaylistSelect}
      isMultiSelect={isMultiSelect}
      selected={selectedIds.has(item.id)}
    />
  )
  const getKey: FlatListType['keyExtractor'] = item => item.id

  return (
    <View style={styles.container}>
      <FlatList
        style={styles.list}
        data={displayUserList}
        maxToRenderPerBatch={9}
        windowSize={9}
        removeClippedSubviews={true}
        initialNumToRender={12}
        renderItem={renderItem}
        keyExtractor={getKey}
        ListHeaderComponent={
          <OverviewHeader
            onOpenLove={onOpenLove}
            onOpenHistory={onOpenHistory}
            isMultiSelect={isMultiSelect}
            selectedCount={selectedIds.size}
            onToggleMultiSelect={toggleMultiSelect}
            onSelectAll={selectAllPlaylists}
            onCreatePlaylist={() => { listNameEditRef.current?.showCreate(displayUserList.length) }}
          />
        }
        ListEmptyComponent={
          <Text style={styles.emptyText} size={13} color={theme['c-font-label']}>
            {t('mylist_no_playlist')}
          </Text>
        }
      />
      <ListNameEdit ref={listNameEditRef} />
      <ListMusicSort ref={listMusicSortRef} />
      <DuplicateMusic ref={duplicateMusicRef} />
      <ListImportExport ref={listImportExportRef} />
      <ListMenu
        ref={listMenuRef}
        onNew={index => listNameEditRef.current?.showCreate(index)}
        onRename={info => listNameEditRef.current?.show(info)}
        onSort={info => listMusicSortRef.current?.show(info)}
        onDuplicateMusic={info => duplicateMusicRef.current?.show(info)}
        onImport={(info, position) => listImportExportRef.current?.import(info, position)}
        onExport={(info, position) => listImportExportRef.current?.export(info, position)}
        onRemove={info => { handleRemove(info) }}
        onSync={info => { handleSync(info) }}
        onSelectLocalFile={(info, position) => listImportExportRef.current?.selectFile(info, position)}
      />
      {
        isMultiSelect
          ? (
            <View style={{ ...styles.selectionBar, backgroundColor: theme['c-content-background'] }}>
              <TouchableOpacity style={styles.selectionBtn} onPress={toggleMultiSelect}>
                <Text size={13} color={theme['c-font']}>{t('list_select_cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.selectionBtn} onPress={selectAllPlaylists}>
                <Text size={13} color={theme['c-font']}>
                  {selectedIds.size == displayUserList.length ? t('list_select_unall') : t('list_select_all')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ ...styles.selectionBtn, opacity: selectedIds.size ? 1 : 0.3 }}
                disabled={!selectedIds.size}
                onPress={removeSelectedPlaylists}
              >
                <Text size={13} color={theme['c-primary']}>{t('delete')}</Text>
              </TouchableOpacity>
            </View>
            )
          : null
      }
    </View>
  )
}

const ITEM_HEIGHT = scaleSizeH(68)

const styles = createStyle({
  container: {
    flex: 1,
    flexDirection: 'column',
  },
  list: {
    flex: 1,
    paddingLeft: scaleSizeW(16),
    paddingRight: scaleSizeW(16),
  },
  quickGrid: {
    flexDirection: 'row',
    gap: scaleSizeW(12),
    paddingTop: scaleSizeH(12),
    paddingBottom: scaleSizeH(16),
  },
  quickTile: {
    flex: 1,
    borderRadius: BorderRadius.normal * 2,
    paddingVertical: scaleSizeH(16),
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickTileLabel: {
    marginTop: scaleSizeH(6),
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: scaleSizeH(10),
  },
  sectionLabel: {
    flex: 1,
  },
  sectionAction: {
    marginLeft: scaleSizeW(12),
    paddingVertical: scaleSizeH(4),
    paddingLeft: scaleSizeW(4),
  },
  playlistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ITEM_HEIGHT,
    borderBottomWidth: BorderWidths.normal,
  },
  playlistCover: {
    width: scaleSizeH(52),
    height: scaleSizeH(52),
    borderRadius: BorderRadius.normal,
    overflow: 'hidden',
    marginRight: scaleSizeW(12),
  },
  playlistCheckbox: {
    marginRight: scaleSizeW(10),
  },
  playlistCoverImage: {
    width: '100%',
    height: '100%',
  },
  playlistInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  playlistCount: {
    marginTop: 2,
  },
  playlistMoreBtn: {
    width: scaleSizeW(36),
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    textAlign: 'center',
    paddingTop: scaleSizeH(24),
  },
  selectionBar: {
    position: 'absolute',
    left: scaleSizeW(16),
    right: scaleSizeW(16),
    bottom: scaleSizeH(8),
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: BorderRadius.normal,
    borderWidth: BorderWidths.normal,
    borderColor: 'rgba(0,0,0,0)',
    minHeight: scaleSizeH(48),
  },
  selectionBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
})
