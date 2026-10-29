import { memo, useCallback, useMemo } from 'react'
import { FlatList, TouchableOpacity, View, type FlatListProps } from 'react-native'

import Image from '@/components/common/Image'
import { LoveIcon } from '@/components/common/LoveIcon'
import Text from '@/components/common/Text'
import { artistKey, filterLikedArtists, toArtistSearchItem, type LikedArtist } from '@/core/artistLibrary'
import { removeLikedArtist } from '@/core/likedArtist'
import { useLikedArtists } from '@/store/likedArtist/hook'
import { useOpenMusicDetail } from '@/utils/hooks/useOpenMusicDetail'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { BorderWidths } from '@/theme'

type FlatListType = FlatListProps<LikedArtist>

const ArtistRow = memo(({ item, onPress, onUnlike }: {
  item: LikedArtist
  onPress: (item: LikedArtist) => void
  onUnlike: (item: LikedArtist) => void
}) => {
  const theme = useTheme()
  const t = useI18n()

  return (
    <TouchableOpacity
      style={{ ...styles.row, borderBottomColor: theme['c-border-background'] }}
      activeOpacity={0.7}
      onPress={() => { onPress(item) }}
      accessibilityRole="button"
      accessibilityLabel={item.name}
    >
      <View style={{ ...styles.avatar, backgroundColor: theme['c-primary-background'] }}>
        {
          item.img
            ? <Image url={item.img} style={styles.avatarImage} />
            : <Text size={17} color={theme['c-primary']}>{item.name.slice(0, 1).toUpperCase()}</Text>
        }
      </View>
      <View style={styles.info}>
        <Text numberOfLines={1} size={15} color={theme['c-font']}>{item.name}</Text>
        {item.alias
          ? <Text numberOfLines={1} style={styles.sub} size={12} color={theme['c-font-label']}>{item.alias}</Text>
          : null}
      </View>
      <TouchableOpacity
        style={styles.loveButton}
        activeOpacity={0.7}
        onPress={() => { onUnlike(item) }}
        accessibilityRole="button"
        accessibilityLabel={t('love_remove')}
      >
        <LoveIcon filled size={16} color={theme['c-primary']} />
      </TouchableOpacity>
    </TouchableOpacity>
  )
})

export default ({ keyword = '' }: { keyword?: string }) => {
  const theme = useTheme()
  const t = useI18n()
  const likedArtists = useLikedArtists()
  const openMusicDetail = useOpenMusicDetail()
  const displayArtists = useMemo(() => filterLikedArtists(likedArtists, keyword), [keyword, likedArtists])

  const handlePress = useCallback((item: LikedArtist) => {
    openMusicDetail({ type: 'artist', info: toArtistSearchItem(item) })
  }, [openMusicDetail])

  const handleUnlike = useCallback((item: LikedArtist) => {
    void removeLikedArtist(item.source, item.id)
  }, [])

  const renderItem: FlatListType['renderItem'] = ({ item }) => (
    <ArtistRow item={item} onPress={handlePress} onUnlike={handleUnlike} />
  )
  const getKey: FlatListType['keyExtractor'] = item => artistKey(item.source, item.id)

  return (
    <View style={styles.container}>
      <FlatList
        style={styles.list}
        data={displayArtists}
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
  avatarImage: {
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
