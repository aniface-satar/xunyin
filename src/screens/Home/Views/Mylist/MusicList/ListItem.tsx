import { memo, useRef } from 'react'
import { View, TouchableOpacity } from 'react-native'
import { BorderRadius, BorderWidths } from '@/theme'
import Image from '@/components/common/Image'
import { Icon } from '@/components/common/Icon'
import { createStyle, type RowInfo } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useAssertApiSupport } from '@/store/common/hook'
import { scaleSizeH, scaleSizeW } from '@/utils/pixelRatio'
import Text from '@/components/common/Text'
import Checkbox from '@/components/common/CheckBox/Checkbox'

const ITEM_RAW_HEIGHT = scaleSizeH(68)
// History rows are scaled again by createStyle; keep virtualization aligned with that final height.
export const ITEM_HEIGHT = scaleSizeH(ITEM_RAW_HEIGHT)
const ITEM_COVER_SIZE = scaleSizeH(52)


export default memo(({ item, index, activeIndex, onPress, onShowMenu, onLongPress, selectedList, rowInfo, isShowAlbumName, isShowInterval, isMultiSelectMode }: {
  item: LX.Music.MusicInfo
  index: number
  activeIndex: number
  onPress: (item: LX.Music.MusicInfo, index: number) => void
  onLongPress: (item: LX.Music.MusicInfo, index: number) => void
  onShowMenu: (item: LX.Music.MusicInfo, index: number, position: { x: number, y: number, w: number, h: number }) => void
  selectedList: LX.Music.MusicInfo[]
  rowInfo: RowInfo
  isShowAlbumName: boolean
  isShowInterval: boolean
  isMultiSelectMode: boolean
}) => {
  const theme = useTheme()

  const isSelected = selectedList.includes(item)
  // console.log(item.name, selectedList, selectedList.includes(item))
  const isSupported = useAssertApiSupport(item.source)
  const moreButtonRef = useRef<TouchableOpacity>(null)
  const handleShowMenu = () => {
    if (moreButtonRef.current?.measure) {
      moreButtonRef.current.measure((fx, fy, width, height, px, py) => {
        // console.log(fx, fy, width, height, px, py)
        onShowMenu(item, index, { x: Math.ceil(px), y: Math.ceil(py), w: Math.ceil(width), h: Math.ceil(height) })
      })
    }
  }
  const active = activeIndex == index

  const singer = `${item.singer}${isShowAlbumName && item.meta.albumName ? ` · ${item.meta.albumName}` : ''}`

  return (
    <View style={{
      ...styles.listItem,
      width: rowInfo.rowWidth,
      height: ITEM_HEIGHT,
      borderBottomColor: theme['c-border-background'],
      backgroundColor: isSelected ? theme['c-primary-background-hover'] : 'rgba(0,0,0,0)',
      opacity: isSupported ? 1 : 0.5,
    }}>
      <TouchableOpacity style={[styles.listItemLeft, isMultiSelectMode && styles.listItemLeftMultiSelect]} onPress={() => { onPress(item, index) }} onLongPress={() => { onLongPress(item, index) }}>
        {
          isMultiSelectMode
            ? <Checkbox status={isSelected ? 'checked' : 'unchecked'} disabled tintColors={{ true: theme['c-primary'], false: theme['c-300'] }} size={0.75} />
            : null
        }
        <View style={{ ...styles.cover, backgroundColor: theme['c-primary-background'] }}>
          <Image style={styles.coverImage} url={item.meta.picUrl} />
        </View>
        <View style={styles.itemInfo}>
          <Text size={15} color={active ? theme['c-primary-font'] : theme['c-font']} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.singer} size={12} color={theme['c-font-label']} numberOfLines={1}>
            {singer} · {item.source.toUpperCase()}
          </Text>
        </View>
        {
          isShowInterval ? (
            <Text size={12} color={active ? theme['c-primary-alpha-400'] : theme['c-250']} numberOfLines={1}>{item.interval}</Text>
          ) : null
        }
      </TouchableOpacity>
      {/* <View style={styles.listItemRight}> */}
      <TouchableOpacity onPress={handleShowMenu} ref={moreButtonRef} style={styles.moreButton}>
        <Icon name="dots-vertical" style={{ color: theme['c-350'] }} size={12} />
      </TouchableOpacity>
      {/* </View> */}
    </View>
  )
}, (prevProps, nextProps) => {
  return !!(prevProps.item === nextProps.item &&
    prevProps.index === nextProps.index &&
    prevProps.isShowAlbumName === nextProps.isShowAlbumName &&
    prevProps.isShowInterval === nextProps.isShowInterval &&
    prevProps.isMultiSelectMode === nextProps.isMultiSelectMode &&
    prevProps.activeIndex != nextProps.index &&
    nextProps.activeIndex != nextProps.index &&
    nextProps.selectedList.includes(nextProps.item) == prevProps.selectedList.includes(nextProps.item)
  )
})


const styles = createStyle({
  listItem: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    paddingLeft: scaleSizeW(16),
    paddingRight: 2,
    alignItems: 'center',
    borderBottomWidth: BorderWidths.normal,
  },
  listItemLeft: {
    flex: 1,
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  listItemLeftMultiSelect: {
    paddingLeft: 8,
  },
  cover: {
    width: ITEM_COVER_SIZE,
    height: ITEM_COVER_SIZE,
    borderRadius: BorderRadius.normal,
    overflow: 'hidden',
    marginRight: scaleSizeW(12),
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  itemInfo: {
    flex: 1,
    flexGrow: 1,
    flexShrink: 1,
    justifyContent: 'center',
    paddingRight: 2,
  },
  singer: {
    marginTop: 2,
  },
  // listItemBadge: {
  //   // fontSize: 10,
  //   paddingLeft: 5,
  //   paddingTop: 2,
  //   alignSelf: 'flex-start',
  // },
  listItemRight: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    justifyContent: 'center',
  },

  moreButton: {
    height: '80%',
    paddingLeft: 16,
    paddingRight: 16,
    // paddingTop: 10,
    // paddingBottom: 10,
    // backgroundColor: 'rgba(0,0,0,0.2)',
    justifyContent: 'center',
  },
})
