import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { FlatList, TouchableOpacity, View, type FlatListProps } from 'react-native'

import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { groupLikedArtists, type LikedArtistGroup } from '@/core/mylistLibrary'
import { resolveArtistBySources } from '@/core/artistResolve'
import { useOpenMusicDetail } from '@/utils/hooks/useOpenMusicDetail'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle, toast } from '@/utils/tools'
import { BorderWidths } from '@/theme'
import { useLikedSongs } from './useLikedSongs'

type FlatListType = FlatListProps<LikedArtistGroup>

const ArtistRow = memo(({ group, resolving, disabled, onPress }: {
  group: LikedArtistGroup
  resolving: boolean
  disabled: boolean
  onPress: (group: LikedArtistGroup) => void
}) => {
  const theme = useTheme()
  const t = useI18n()

  return (
    <TouchableOpacity
      style={{ ...styles.row, borderBottomColor: theme['c-border-background'], opacity: resolving ? 0.5 : 1 }}
      activeOpacity={0.7}
      disabled={disabled}
      onPress={() => { onPress(group) }}
      accessibilityRole="button"
      accessibilityLabel={group.name}
    >
      <View style={{ ...styles.avatar, backgroundColor: theme['c-primary-background'] }}>
        <Text size={17} color={theme['c-primary']}>{group.name.slice(0, 1).toUpperCase()}</Text>
      </View>
      <View style={styles.info}>
        <Text numberOfLines={1} size={15} color={theme['c-font']}>{group.name}</Text>
        <Text numberOfLines={1} style={styles.sub} size={12} color={theme['c-font-label']}>
          {t('mylist_song_count', { count: group.count })}
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
  const resolvingRef = useRef<string | null>(null)
  const [resolvingKey, setResolvingKey] = useState<string | null>(null)
  const searchText = keyword.trim().toLowerCase()
  const groups = useMemo(() => groupLikedArtists(musics), [musics])
  const displayGroups = useMemo(() => {
    if (!searchText) return groups
    return groups.filter(group => group.name.toLowerCase().includes(searchText))
  }, [groups, searchText])

  const handlePress = useCallback((group: LikedArtistGroup) => {
    if (resolvingRef.current != null) return
    resolvingRef.current = group.key
    setResolvingKey(group.key)
    void resolveArtistBySources(group.sources, group.name).then(item => {
      resolvingRef.current = null
      setResolvingKey(null)
      if (item) openMusicDetail({ type: 'artist', info: item })
      else toast(t('artist_not_found'))
    })
  }, [openMusicDetail, t])

  const renderItem: FlatListType['renderItem'] = ({ item }) => (
    <ArtistRow
      group={item}
      resolving={resolvingKey == item.key}
      disabled={resolvingKey != null}
      onPress={handlePress}
    />
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
            {t('mylist_no_artist')}
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
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
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
