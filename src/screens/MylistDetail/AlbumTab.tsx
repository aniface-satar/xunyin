import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, TouchableOpacity, View, type FlatListProps } from 'react-native'

import Image from '@/components/common/Image'
import { LoveIcon } from '@/components/common/LoveIcon'
import Text from '@/components/common/Text'
import { getListMusics, removeUserList } from '@/core/list'
import {
  buildLikedAlbumRows,
  isLikedAlbumList,
  type LikedAlbumList,
  type LikedAlbumMeta,
  type LikedAlbumRow,
} from '@/core/mylistLibrary'
import { useMyList } from '@/store/list/hook'
import { useOpenMusicDetail } from '@/utils/hooks/useOpenMusicDetail'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle, toast } from '@/utils/tools'
import { BorderRadius, BorderWidths } from '@/theme'

type FlatListType = FlatListProps<LikedAlbumRow>

const AlbumRow = memo(({ row, onPress, onUnlike }: {
  row: LikedAlbumRow
  onPress: (row: LikedAlbumRow) => void
  onUnlike: (row: LikedAlbumRow) => void
}) => {
  const theme = useTheme()
  const t = useI18n()

  return (
    <TouchableOpacity
      style={{ ...styles.row, borderBottomColor: theme['c-border-background'] }}
      activeOpacity={0.7}
      onPress={() => { onPress(row) }}
      accessibilityRole="button"
      accessibilityLabel={row.name}
    >
      <View style={{ ...styles.cover, backgroundColor: theme['c-primary-background'] }}>
        <Image url={row.cover || undefined} style={styles.coverImage} />
      </View>
      <View style={styles.info}>
        <Text numberOfLines={1} size={15} color={theme['c-font']}>{row.name || '--'}</Text>
        <Text numberOfLines={1} style={styles.sub} size={12} color={theme['c-font-label']}>
          {[row.author, t('mylist_song_count', { count: row.count })].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <TouchableOpacity
        style={styles.loveButton}
        activeOpacity={0.7}
        onPress={() => { onUnlike(row) }}
        accessibilityRole="button"
        accessibilityLabel={t('love_playlist_remove')}
      >
        <LoveIcon filled size={16} color={theme['c-primary']} />
      </TouchableOpacity>
    </TouchableOpacity>
  )
})

export default ({ keyword = '', active = true }: { keyword?: string, active?: boolean }) => {
  const theme = useTheme()
  const t = useI18n()
  const allList = useMyList()
  const openMusicDetail = useOpenMusicDetail()
  const [metas, setMetas] = useState<Record<string, LikedAlbumMeta>>({})
  // 已经拉过封面/数量的专辑，滑回这个标签时不再重复请求
  const loadedIdsRef = useRef(new Set<string>())
  const searchText = keyword.trim().toLowerCase()
  const albumLists = useMemo(() => allList.filter((list): list is LikedAlbumList => {
    return 'sourceListId' in list && isLikedAlbumList(list)
  }), [allList])
  const rows = useMemo(() => buildLikedAlbumRows(albumLists, metas), [albumLists, metas])
  const displayRows = useMemo(() => {
    if (!searchText) return rows
    return rows.filter(row => row.name.toLowerCase().includes(searchText) || row.author.toLowerCase().includes(searchText))
  }, [rows, searchText])

  const loadMeta = useCallback(async(list: LikedAlbumList) => {
    const musics = await getListMusics(list.id)
    const cover = musics.find(music => music.meta.picUrl)?.meta.picUrl ?? ''
    setMetas(prev => ({
      ...prev,
      [list.id]: { count: musics.length, cover, author: musics[0]?.singer ?? '' },
    }))
  }, [])

  // 页面常驻在 PagerView 里，只有切到这个标签才拉取封面/数量；拉过的不再重复拉
  useEffect(() => {
    if (!active) return
    for (const list of albumLists) {
      if (loadedIdsRef.current.has(list.id)) continue
      loadedIdsRef.current.add(list.id)
      void loadMeta(list).catch(() => {
        loadedIdsRef.current.delete(list.id)
      })
    }
  }, [active, albumLists, loadMeta])

  useEffect(() => {
    if (!active) return
    const handleChange = (ids: string[]) => {
      for (const list of albumLists) {
        if (!ids.includes(list.id)) continue
        void loadMeta(list).catch(() => {
          loadedIdsRef.current.delete(list.id)
        })
      }
    }

    global.app_event.on('myListMusicUpdate', handleChange)
    return () => {
      global.app_event.off('myListMusicUpdate', handleChange)
    }
  }, [active, albumLists, loadMeta])

  const handlePress = useCallback((row: LikedAlbumRow) => {
    openMusicDetail({
      type: 'songlist',
      info: {
        id: row.id,
        name: row.name,
        author: row.author,
        img: row.cover,
        source: row.source,
      },
    })
  }, [openMusicDetail])

  const handleUnlike = useCallback((row: LikedAlbumRow) => {
    void removeUserList([row.listId]).then(() => {
      toast(t('love_playlist_removed'))
    })
  }, [t])

  const renderItem: FlatListType['renderItem'] = ({ item }) => (
    <AlbumRow row={item} onPress={handlePress} onUnlike={handleUnlike} />
  )
  const getKey: FlatListType['keyExtractor'] = item => item.key

  return (
    <View style={styles.container}>
      <FlatList
        style={styles.list}
        data={displayRows}
        maxToRenderPerBatch={9}
        windowSize={9}
        removeClippedSubviews={true}
        initialNumToRender={12}
        renderItem={renderItem}
        keyExtractor={getKey}
        ListEmptyComponent={
          <Text style={styles.emptyText} size={13} color={theme['c-font-label']}>
            {t('mylist_no_album')}
          </Text>
        }
      />
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
  list: {
    flex: 1,
    paddingLeft: 16,
    paddingRight: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 68,
    borderBottomWidth: BorderWidths.normal,
  },
  cover: {
    width: 52,
    height: 52,
    borderRadius: BorderRadius.normal,
    overflow: 'hidden',
    marginRight: 12,
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  info: {
    flex: 1,
    justifyContent: 'center',
    marginRight: 8,
  },
  sub: {
    marginTop: 2,
  },
  loveButton: {
    flexGrow: 0,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: 34,
    height: 68,
  },
  emptyText: {
    textAlign: 'center',
    paddingTop: 24,
  },
})
