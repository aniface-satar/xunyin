import { memo, useCallback, useMemo } from 'react'
import { FlatList, TouchableOpacity, View, type FlatListProps } from 'react-native'

import Image from '@/components/common/Image'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { groupLikedAlbums, type LikedAlbumGroup } from '@/core/mylistLibrary'
import { useOpenMusicDetail } from '@/utils/hooks/useOpenMusicDetail'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { BorderRadius, BorderWidths } from '@/theme'
import { useLikedSongs } from './useLikedSongs'

type FlatListType = FlatListProps<LikedAlbumGroup>

const AlbumRow = memo(({ group, onPress }: {
  group: LikedAlbumGroup
  onPress: (group: LikedAlbumGroup) => void
}) => {
  const theme = useTheme()
  const t = useI18n()

  return (
    <TouchableOpacity
      style={{ ...styles.row, borderBottomColor: theme['c-border-background'] }}
      activeOpacity={0.7}
      onPress={() => { onPress(group) }}
      accessibilityRole="button"
      accessibilityLabel={group.name}
    >
      <View style={{ ...styles.cover, backgroundColor: theme['c-primary-background'] }}>
        <Image url={group.cover || undefined} style={styles.coverImage} />
      </View>
      <View style={styles.info}>
        <Text numberOfLines={1} size={15} color={theme['c-font']}>{group.name || '--'}</Text>
        <Text numberOfLines={1} style={styles.sub} size={12} color={theme['c-font-label']}>
          {[group.author, t('mylist_song_count', { count: group.count })].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Icon name="chevron-right" size={12} color={theme['c-font-label']} />
    </TouchableOpacity>
  )
})

export default ({ keyword = '' }: { keyword?: string }) => {
  const theme = useTheme()
  const t = useI18n()
  const musics = useLikedSongs()
  const openMusicDetail = useOpenMusicDetail()
  const searchText = keyword.trim().toLowerCase()
  const groups = useMemo(() => groupLikedAlbums(musics), [musics])
  const displayGroups = useMemo(() => {
    if (!searchText) return groups
    return groups.filter(group => group.name.toLowerCase().includes(searchText) || group.author.toLowerCase().includes(searchText))
  }, [groups, searchText])

  const handlePress = useCallback((group: LikedAlbumGroup) => {
    openMusicDetail({
      type: 'songlist',
      info: {
        id: group.id,
        name: group.name,
        author: group.author,
        img: group.cover,
        source: group.source,
      },
    })
  }, [openMusicDetail])

  const renderItem: FlatListType['renderItem'] = ({ item }) => (
    <AlbumRow group={item} onPress={handlePress} />
  )
  const getKey: FlatListType['keyExtractor'] = item => item.key

  return (
    <View style={styles.container}>
      <FlatList
        style={styles.list}
        data={displayGroups}
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
  emptyText: {
    textAlign: 'center',
    paddingTop: 24,
  },
})
