import { memo, useRef } from 'react'
import { PanResponder, View, TouchableOpacity } from 'react-native'
import { BorderRadius, BorderWidths } from '@/theme'
import Image from '@/components/common/Image'
import { Icon } from '@/components/common/Icon'
import { createStyle, type RowInfo } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useAssertApiSupport } from '@/store/common/hook'
import { scaleSizeH } from '@/utils/pixelRatio'
import Text from '@/components/common/Text'
import Checkbox from '@/components/common/CheckBox/Checkbox'

// 行高用于内联样式（createStyle 不会换算）与 getItemLayout，这里只换算一次
export const ITEM_HEIGHT = scaleSizeH(68)

const DragHandle = ({ onGrant, onMove, onRelease }: {
  onGrant: () => void
  onMove: (dy: number, moveY: number) => void
  onRelease: () => void
}) => {
  const theme = useTheme()
  const handlersRef = useRef({ onGrant, onMove, onRelease })
  handlersRef.current = { onGrant, onMove, onRelease }
  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { handlersRef.current.onGrant() },
    onPanResponderMove: (_event, gestureState) => { handlersRef.current.onMove(gestureState.dy, gestureState.moveY) },
    onPanResponderRelease: () => { handlersRef.current.onRelease() },
    onPanResponderTerminate: () => { handlersRef.current.onRelease() },
  })).current

  return (
    <View
      {...panResponder.panHandlers}
      style={styles.moreButton}
      accessibilityRole="button"
      accessibilityLabel={global.i18n.t('list_custom_sort_drag')}
    >
      <Icon name="menu" style={{ color: theme['c-350'] }} size={14} />
    </View>
  )
}


export default memo(({ item, index, activeIndex, onPress, onShowMenu, onLongPress, selectedList, rowInfo, isShowAlbumName, isShowInterval, isMultiSelectMode, isCustomSortMode = false, dragOffset = 0, isDragSource = false, isDragGhost = false, onDragStart, onDragMove, onDragEnd }: {
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
  isCustomSortMode?: boolean
  dragOffset?: number
  isDragSource?: boolean
  isDragGhost?: boolean
  onDragStart?: (item: LX.Music.MusicInfo, index: number) => void
  onDragMove?: (dy: number, moveY: number) => void
  onDragEnd?: () => void
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
      backgroundColor: isDragGhost || isSelected || active ? theme['c-primary-background-hover'] : 'rgba(0,0,0,0)',
      opacity: isDragSource ? 0 : isSupported ? 1 : 0.5,
      transform: dragOffset ? [{ translateY: dragOffset }] : undefined,
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
      {
        isDragGhost
          ? (
            <View style={styles.moreButton}>
              <Icon name="menu" style={{ color: theme['c-350'] }} size={14} />
            </View>
            )
          : isCustomSortMode
            ? (
              <DragHandle
                onGrant={() => { onDragStart?.(item, index) }}
                onMove={(dy, moveY) => { onDragMove?.(dy, moveY) }}
                onRelease={() => { onDragEnd?.() }}
              />
              )
            : (
              <TouchableOpacity onPress={handleShowMenu} ref={moreButtonRef} style={styles.moreButton} accessibilityRole="button" accessibilityLabel={global.i18n.t('more_actions')}>
                <Icon name="dots-vertical" style={{ color: theme['c-350'] }} size={12} />
              </TouchableOpacity>
              )
      }
      {/* </View> */}
    </View>
  )
}, (prevProps, nextProps) => {
  return !!(prevProps.item === nextProps.item &&
    prevProps.index === nextProps.index &&
    prevProps.isShowAlbumName === nextProps.isShowAlbumName &&
    prevProps.isShowInterval === nextProps.isShowInterval &&
    prevProps.isMultiSelectMode === nextProps.isMultiSelectMode &&
    prevProps.isCustomSortMode === nextProps.isCustomSortMode &&
    prevProps.dragOffset === nextProps.dragOffset &&
    prevProps.isDragSource === nextProps.isDragSource &&
    prevProps.isDragGhost === nextProps.isDragGhost &&
    prevProps.activeIndex != nextProps.index &&
    nextProps.activeIndex != nextProps.index &&
    nextProps.selectedList.includes(nextProps.item) == prevProps.selectedList.includes(nextProps.item)
  )
})


const styles = createStyle({
  listItem: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    paddingLeft: 16,
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
