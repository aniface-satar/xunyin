import { forwardRef, memo, useImperativeHandle, useMemo, useState } from 'react'
import { FlatList, RefreshControl, TouchableOpacity, View, type FlatListProps } from 'react-native'

import { type ArtistSearchItem } from '@/store/search/artist/state'
import { useLayout } from '@/utils/hooks'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { scaleSizeW } from '@/utils/pixelRatio'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'
import Image from '@/components/common/Image'

type FlatListType = FlatListProps<ArtistSearchItem>
type Status = 'loading' | 'refreshing' | 'end' | 'error' | 'idle'

const H_PADDING = scaleSizeW(12)
const H_GAP = scaleSizeW(12)
const MIN_ITEM_WIDTH = scaleSizeW(88)

export interface ArtistGridProps {
  onRefresh: () => void
  onLoadMore: () => void
  onPressItem: (item: ArtistSearchItem) => void
}
export interface ArtistGridType {
  setList: (list: ArtistSearchItem[], showSource?: boolean) => void
  setStatus: (val: Status) => void
}

export default forwardRef<ArtistGridType, ArtistGridProps>(({ onRefresh, onLoadMore, onPressItem }, ref) => {
  const [currentList, setList] = useState<ArtistSearchItem[]>([])
  const [showSource, setShowSource] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const { onLayout, width } = useLayout()
  const theme = useTheme()

  useImperativeHandle(ref, () => ({
    setList(list, showSource = false) {
      setList(list)
      setShowSource(showSource)
    },
    setStatus(val) {
      setStatus(val)
    },
  }))

  const rowInfo = useMemo(() => {
    const num = Math.max(Math.floor((width - H_PADDING * 2 + H_GAP) / (MIN_ITEM_WIDTH + H_GAP)), 2)
    return {
      num,
      width: (width - H_PADDING * 2 - H_GAP * (num - 1)) / num,
    }
  }, [width])

  const list = useMemo(() => {
    const list = [...currentList]
    let whiteItemNum = list.length % rowInfo.num
    if (whiteItemNum > 0) whiteItemNum = rowInfo.num - whiteItemNum
    for (let i = 0; i < whiteItemNum; i++) {
      list.push({
        id: `white__${i}`,
        name: '',
        alias: '',
        img: '',
        songCount: '',
        albumCount: '',
        source: 'kg',
      })
    }
    return list
  }, [currentList, rowInfo.num])

  const handleLoadMore = () => {
    if (status != 'idle') return
    onLoadMore()
  }

  const renderItem: FlatListType['renderItem'] = ({ item }) => (
    <ArtistItem item={item} width={rowInfo.width} showSource={showSource} onPressItem={onPressItem} />
  )
  const getKey: FlatListType['keyExtractor'] = item => `${item.source}__${item.id}`
  const refreshControl = useMemo(() => (
    <RefreshControl
      colors={[theme['c-primary']]}
      refreshing={status == 'refreshing'}
      onRefresh={onRefresh} />
  ), [status, onRefresh, theme])
  const footerComponent = useMemo(() => {
    let label: FooterLabel
    switch (status) {
      case 'refreshing':
        return null
      case 'loading':
        label = 'list_loading'
        break
      case 'end':
        label = 'list_end'
        break
      case 'error':
        label = 'list_error'
        break
      case 'idle':
        label = null
        break
    }
    return (
      <View style={{ width: '100%' }}>
        <Footer label={label} onLoadMore={onLoadMore} />
      </View>
    )
  }, [onLoadMore, status])

  return (
    <View style={styles.container} onLayout={onLayout}>
      {
        width == 0
          ? null
          : (
              <FlatList
                key={String(rowInfo.num)}
                style={styles.list}
                contentContainerStyle={styles.listContent}
                columnWrapperStyle={styles.row}
                numColumns={rowInfo.num}
                data={list}
                maxToRenderPerBatch={6}
                windowSize={8}
                removeClippedSubviews={true}
                renderItem={renderItem}
                keyExtractor={getKey}
                onEndReachedThreshold={0.6}
                onEndReached={handleLoadMore}
                refreshControl={refreshControl}
                ListFooterComponent={footerComponent}
              />
            )
      }
    </View>
  )
})

const ArtistItem = memo(({ item, width, showSource, onPressItem }: {
  item: ArtistSearchItem
  width: number
  showSource: boolean
  onPressItem: (item: ArtistSearchItem) => void
}) => {
  const theme = useTheme()
  const t = useI18n()

  if (!item.name) return <View style={{ width, marginBottom: scaleSizeW(16) }} />

  const countParts = []
  if (item.songCount) countParts.push(t('artist_song_count', { num: item.songCount }))
  if (item.albumCount) countParts.push(t('artist_album_count', { num: item.albumCount }))
  const subtitle = countParts.join(' · ') || item.alias

  return (
    <TouchableOpacity style={{ ...styles.item, width }} activeOpacity={0.6} onPress={() => { onPressItem(item) }}>
      <View style={{ width, height: width }}>
        <Image url={item.img} style={{ width, height: width, borderRadius: width / 2 }} />
        {showSource ? <Text style={styles.sourceLabel} size={9} color="#fff">{item.source}</Text> : null}
      </View>
      <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
      {subtitle
        ? <Text style={styles.subtitle} size={10} numberOfLines={1} color={theme['c-font-label']}>{subtitle}</Text>
        : null}
    </TouchableOpacity>
  )
})

type FooterLabel = 'list_loading' | 'list_end' | 'list_error' | null
const Footer = ({ label, onLoadMore }: {
  label: FooterLabel
  onLoadMore: () => void
}) => {
  const theme = useTheme()
  const t = useI18n()
  const handlePress = () => {
    if (label != 'list_error') return
    onLoadMore()
  }
  return (
    label
      ? (
          <View>
            <Text onPress={handlePress} style={styles.footer} color={theme['c-font-label']}>{t(label)}</Text>
          </View>
        )
      : null
  )
}

const styles = createStyle({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingLeft: H_PADDING,
    paddingRight: H_PADDING,
    paddingTop: 12,
    paddingBottom: 20,
  },
  row: {
    justifyContent: 'space-between',
  },
  item: {
    marginBottom: scaleSizeW(16),
    alignItems: 'center',
  },
  name: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 6,
    paddingLeft: 2,
    paddingRight: 2,
  },
  subtitle: {
    fontSize: 10,
    textAlign: 'center',
    marginTop: 2,
    paddingLeft: 2,
    paddingRight: 2,
  },
  sourceLabel: {
    paddingLeft: 5,
    paddingRight: 5,
    paddingTop: 1,
    paddingBottom: 1,
    position: 'absolute',
    right: 4,
    bottom: 4,
    borderRadius: 8,
    overflow: 'hidden',
    // 头像色不可控，浅色头像上 9px 白字要压深底
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  footer: {
    textAlign: 'center',
    padding: 10,
  },
})
