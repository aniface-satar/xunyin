import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { FlatList, TouchableOpacity, View, type FlatListProps } from 'react-native'

import Image from '@/components/common/Image'
import { LoveIcon } from '@/components/common/LoveIcon'
import Text from '@/components/common/Text'
import { getListMusics, removeUserList } from '@/core/list'
import { getListDetail } from '@/core/songlist'
import { useMyList } from '@/store/list/hook'
import { useTheme } from '@/store/theme/hook'
import { type ListInfoItem } from '@/store/songlist/state'
import homeDetailActions from '@/store/homeDetail/action'
import { createStyle, toast } from '@/utils/tools'
import { useI18n } from '@/lang'
import { scaleSizeH, scaleSizeW } from '@/utils/pixelRatio'
import { BorderRadius, BorderWidths } from '@/theme'

type FlatListType = FlatListProps<LX.List.UserListInfo>

interface PlaylistMeta {
  count: number
  cover: string | null
}

const PlaylistRow = memo(({ item, meta, onPress, onUnlike }: {
  item: LX.List.UserListInfo
  meta: PlaylistMeta | undefined
  onPress: (item: LX.List.UserListInfo) => void
  onUnlike: (item: LX.List.UserListInfo) => void
}) => {
  const theme = useTheme()

  return (
    <TouchableOpacity
      style={{ ...styles.playlistRow, borderBottomColor: theme['c-border-background'] }}
      activeOpacity={0.7}
      onPress={() => { onPress(item) }}
    >
      <View style={{ ...styles.playlistCover, backgroundColor: theme['c-primary-background'] }}>
        <Image url={meta?.cover} style={styles.playlistCoverImage} />
      </View>
      <View style={styles.playlistInfo}>
        <Text numberOfLines={1} size={15} color={theme['c-font']}>{item.name}</Text>
        <Text style={styles.playlistCount} size={12} color={theme['c-font-label']}>
          {global.i18n.t('mylist_song_count', { count: meta?.count ?? 0 })}
        </Text>
      </View>
      <TouchableOpacity
        style={styles.loveButton}
        activeOpacity={0.7}
        onPress={() => { onUnlike(item) }}
        accessibilityRole="button"
        accessibilityLabel={global.i18n.t('love_playlist_remove')}
      >
        <LoveIcon filled size={16} color={theme['c-primary']} />
      </TouchableOpacity>
    </TouchableOpacity>
  )
})

export default ({ keyword = '' }: { keyword?: string }) => {
  const theme = useTheme()
  const t = useI18n()
  const allList = useMyList()
  const searchText = keyword.trim().toLowerCase()
  const displayPlaylists = useMemo(() => {
    const playlists = allList.filter((list): list is LX.List.UserListInfo => {
      return 'source' in list && 'sourceListId' in list &&
        !!list.source && !!list.sourceListId && !!list.isLove
    })
    return searchText
      ? playlists.filter(listInfo => listInfo.name.toLowerCase().includes(searchText))
      : playlists
  }, [allList, searchText])

  const [metas, setMetas] = useState<Record<string, PlaylistMeta>>({})

  const loadMeta = useCallback(async(playlist: LX.List.UserListInfo) => {
    const list = await getListMusics(playlist.id)
    const fallbackCover = list.find(musicInfo => musicInfo.meta.picUrl)?.meta.picUrl ?? null
    setMetas(prev => ({ ...prev, [playlist.id]: { count: list.length, cover: fallbackCover } }))

    if (!playlist.source || !playlist.sourceListId || /^board__/.test(playlist.sourceListId)) return

    try {
      const detail = await getListDetail(playlist.sourceListId, playlist.source, 1)
      if (!detail.info.img) return
      setMetas(prev => ({
        ...prev,
        [playlist.id]: {
          count: Math.max(detail.total, list.length),
          cover: detail.info.img!,
        },
      }))
    } catch {
      // Keep the local music cover as a fallback when the playlist detail cannot be loaded.
    }
  }, [])

  useEffect(() => {
    for (const playlist of displayPlaylists) void loadMeta(playlist).catch(() => {})
  }, [displayPlaylists, loadMeta])

  useEffect(() => {
    const handleChange = (ids: string[]) => {
      const changedPlaylists = displayPlaylists.filter(playlist => ids.includes(playlist.id))
      for (const playlist of changedPlaylists) void loadMeta(playlist).catch(() => {})
    }

    global.app_event.on('myListMusicUpdate', handleChange)
    return () => {
      global.app_event.off('myListMusicUpdate', handleChange)
    }
  }, [displayPlaylists, loadMeta])

  const handlePress = useCallback((item: LX.List.UserListInfo) => {
    if (!item.source || !item.sourceListId) return

    if (/^board__/.test(item.sourceListId)) {
      const id = item.sourceListId.replace(/^board__/, '')
      const bangid = id.split('__')[1] ?? ''
      homeDetailActions.push({
        type: 'leaderboard',
        source: item.source,
        board: {
          id,
          name: item.name,
          bangid,
        },
      })
      return
    }

    const info: ListInfoItem = {
      id: item.sourceListId,
      name: item.name,
      author: '',
      source: item.source,
    }
    homeDetailActions.push({ type: 'songlist', info })
  }, [])

  const handleUnlike = useCallback((item: LX.List.UserListInfo) => {
    void removeUserList([item.id]).then(() => {
      toast(global.i18n.t('love_playlist_removed'))
    })
  }, [])

  const renderItem: FlatListType['renderItem'] = ({ item }) => (
    <PlaylistRow item={item} meta={metas[item.id]} onPress={handlePress} onUnlike={handleUnlike} />
  )
  const getKey: FlatListType['keyExtractor'] = item => item.id

  return (
    <View style={styles.container}>
      <FlatList
        style={styles.list}
        data={displayPlaylists}
        maxToRenderPerBatch={9}
        windowSize={9}
        removeClippedSubviews={true}
        initialNumToRender={12}
        renderItem={renderItem}
        keyExtractor={getKey}
        ListEmptyComponent={
          <Text style={styles.emptyText} size={13} color={theme['c-font-label']}>
            {t('mylist_no_collect_playlist')}
          </Text>
        }
      />
    </View>
  )
}

const ITEM_HEIGHT = scaleSizeH(68)

const styles = createStyle({
  container: {
    flex: 1,
  },
  list: {
    flex: 1,
    paddingLeft: scaleSizeW(16),
    paddingRight: scaleSizeW(16),
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
  loveButton: {
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: scaleSizeW(34),
    height: ITEM_HEIGHT,
  },
  emptyText: {
    textAlign: 'center',
    paddingTop: scaleSizeH(24),
  },
})
