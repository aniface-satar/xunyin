import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlatList, TouchableOpacity, View, type FlatListProps } from 'react-native'

import { usePlayMusicInfo } from '@/store/player/hook'
import { useTheme } from '@/store/theme/hook'
import Image from '@/components/common/Image'
import Text from '@/components/common/Text'
import { playListById } from '@/core/player/player'
import { getPlayHistory } from '@/utils/data'
import { createStyle } from '@/utils/tools'
import { useI18n } from '@/lang'
import { BorderWidths, BorderRadius } from '@/theme'
import { scaleSizeH, scaleSizeW } from '@/utils/pixelRatio'

type FlatListType = FlatListProps<LX.Player.PlayHistoryItem>

const getMusicInfo = (musicInfo: LX.Player.PlayHistoryItem['musicInfo']) => {
  return 'progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo
}

const HistoryItem = ({ item, active, onPress }: {
  item: LX.Player.PlayHistoryItem
  active: boolean
  onPress: (item: LX.Player.PlayHistoryItem) => void
}) => {
  const theme = useTheme()
  const musicInfo = getMusicInfo(item.musicInfo)

  return (
    <TouchableOpacity
      style={{
        ...styles.item,
        borderBottomColor: theme['c-border-background'],
        backgroundColor: active ? theme['c-primary-background-hover'] : 'rgba(0,0,0,0)',
      }}
      onPress={() => { onPress(item) }}
      activeOpacity={0.7}
    >
      <View style={{ ...styles.cover, backgroundColor: theme['c-primary-background'] }}>
        <Image style={styles.coverImage} url={musicInfo.meta.picUrl} />
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1} size={15} color={active ? theme['c-primary-font'] : theme['c-font']}>
          {musicInfo.name}
        </Text>
        <Text style={styles.singer} numberOfLines={1} size={12} color={theme['c-font-label']}>
          {musicInfo.singer} · {musicInfo.source.toUpperCase()}
        </Text>
      </View>
    </TouchableOpacity>
  )
}

export default ({ keyword = '' }: { keyword?: string }) => {
  const t = useI18n()
  const theme = useTheme()
  const playMusicInfo = usePlayMusicInfo()
  const [historyList, setHistoryList] = useState<LX.Player.PlayHistoryItem[]>([])
  const searchText = keyword.trim().toLowerCase()

  useEffect(() => {
    let mounted = true
    void getPlayHistory().then(list => {
      if (mounted) setHistoryList(list)
    }).catch(() => {})

    const handleChange = (list: LX.Player.PlayHistoryItem[]) => {
      setHistoryList([...list])
    }
    global.app_event.on('playHistoryUpdated', handleChange)
    return () => {
      mounted = false
      global.app_event.off('playHistoryUpdated', handleChange)
    }
  }, [])

  const displayHistoryList = useMemo(() => {
    if (!searchText) return historyList
    return historyList.filter(item => {
      const musicInfo = getMusicInfo(item.musicInfo)
      return [musicInfo.name, musicInfo.singer, musicInfo.meta.albumName, musicInfo.source]
        .some(value => value?.toLowerCase().includes(searchText))
    })
  }, [historyList, searchText])

  const handlePress = useCallback((item: LX.Player.PlayHistoryItem) => {
    const musicInfo = getMusicInfo(item.musicInfo)
    if (!item.listId || !musicInfo.id) return
    void playListById(item.listId, musicInfo.id)
  }, [])

  const renderItem: FlatListType['renderItem'] = ({ item }) => (
    <HistoryItem
      item={item}
      active={playMusicInfo.musicInfo?.id === getMusicInfo(item.musicInfo).id}
      onPress={handlePress}
    />
  )
  const getKey: FlatListType['keyExtractor'] = item => `${item.listId ?? ''}_${getMusicInfo(item.musicInfo).id ?? ''}`

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
            {t('mylist_history_empty')}
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
  item: {
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
  name: {
    fontSize: 15,
  },
  singer: {
    marginTop: 2,
  },
  emptyText: {
    textAlign: 'center',
    paddingTop: scaleSizeH(24),
  },
})
