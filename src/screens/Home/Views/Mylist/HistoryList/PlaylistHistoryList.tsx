import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { FlatList, TouchableOpacity, View, type FlatListProps } from 'react-native'

import Image from '@/components/common/Image'
import Text from '@/components/common/Text'
import homeDetailActions from '@/store/homeDetail/action'
import { type ListInfoItem } from '@/store/songlist/state'
import { getPlaylistHistory } from '@/utils/data'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { BorderRadius, BorderWidths } from '@/theme'
import { scaleSizeH, scaleSizeW } from '@/utils/pixelRatio'

type FlatListType = FlatListProps<LX.Player.PlaylistHistoryItem>

const PlaylistHistoryRow = memo(({ item, onPress }: {
  item: LX.Player.PlaylistHistoryItem
  onPress: (item: LX.Player.PlaylistHistoryItem) => void
}) => {
  const theme = useTheme()

  return (
    <TouchableOpacity
      style={{ ...styles.row, borderBottomColor: theme['c-border-background'] }}
      activeOpacity={0.7}
      onPress={() => { onPress(item) }}
    >
      <View style={{ ...styles.cover, backgroundColor: theme['c-primary-background'] }}>
        <Image url={item.img} style={styles.coverImage} />
      </View>
      <View style={styles.info}>
        <Text numberOfLines={1} size={15} color={theme['c-font']}>{item.name}</Text>
        <Text numberOfLines={1} style={styles.subtitle} size={12} color={theme['c-font-label']}>
          {item.author ? `${item.author} · ` : ''}{item.source.toUpperCase()}
        </Text>
      </View>
    </TouchableOpacity>
  )
})

export default ({ keyword = '' }: { keyword?: string }) => {
  const t = useI18n()
  const theme = useTheme()
  const [historyList, setHistoryList] = useState<LX.Player.PlaylistHistoryItem[]>([])
  const searchText = keyword.trim().toLowerCase()
  const displayHistoryList = useMemo(() => {
    if (!searchText) return historyList
    return historyList.filter(item => {
      return [item.name, item.author]
        .some(value => value?.toLowerCase().includes(searchText))
    })
  }, [historyList, searchText])

  useEffect(() => {
    let mounted = true
    void getPlaylistHistory().then(list => {
      if (mounted) setHistoryList(list)
    })

    const handleChange = (list: LX.Player.PlaylistHistoryItem[]) => {
      setHistoryList([...list])
    }
    global.app_event.on('playlistHistoryUpdated', handleChange)
    return () => {
      mounted = false
      global.app_event.off('playlistHistoryUpdated', handleChange)
    }
  }, [])

  const handlePress = useCallback((item: LX.Player.PlaylistHistoryItem) => {
    if (/^board__/.test(item.sourceListId)) {
      const boardId = item.sourceListId.replace(/^board__/, '')
      homeDetailActions.push({
        type: 'leaderboard',
        source: item.source,
        board: {
          id: boardId,
          name: item.name,
          bangid: boardId.split('__')[1] ?? '',
        },
      })
      return
    }

    const info: ListInfoItem = {
      id: item.sourceListId,
      name: item.name,
      author: item.author ?? '',
      source: item.source,
      img: item.img,
    }
    homeDetailActions.push({ type: 'songlist', info })
  }, [])

  const renderItem: FlatListType['renderItem'] = ({ item }) => (
    <PlaylistHistoryRow item={item} onPress={handlePress} />
  )
  const getKey: FlatListType['keyExtractor'] = item => `${item.listId}_${item.playTime}`

  return (
    <View style={styles.container}>
      <FlatList
        style={styles.list}
        data={displayHistoryList}
        maxToRenderPerBatch={9}
        windowSize={9}
        removeClippedSubviews={true}
        initialNumToRender={12}
        renderItem={renderItem}
        keyExtractor={getKey}
        ListEmptyComponent={
          <Text style={styles.emptyText} size={13} color={theme['c-font-label']}>
            {t('mylist_history_playlist_empty')}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ITEM_HEIGHT,
    borderBottomWidth: BorderWidths.normal,
  },
  cover: {
    width: scaleSizeH(52),
    height: scaleSizeH(52),
    borderRadius: BorderRadius.normal,
    overflow: 'hidden',
    marginRight: scaleSizeW(12),
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  info: {
    flex: 1,
    justifyContent: 'center',
  },
  subtitle: {
    marginTop: 2,
  },
  emptyText: {
    textAlign: 'center',
    paddingTop: scaleSizeH(24),
  },
})
