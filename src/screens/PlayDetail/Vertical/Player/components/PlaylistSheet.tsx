import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  Animated,
  FlatList,
  Modal,
  PanResponder,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  type GestureResponderEvent,
} from 'react-native'

import GlassBackdrop from '@/components/common/GlassBackdrop'
import Image from '@/components/common/Image'
import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
import { getListMusics, removeListMusics, updateListMusicPosition } from '@/core/list'
import { playList, playTempPlayList } from '@/core/player/player'
import { removeTempPlayList } from '@/core/player/tempPlayList'
import { usePlayInfo, usePlayMusicInfo, useTempPlayList } from '@/store/player/hook'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { LIST_ITEM_HEIGHT } from '@/config/constant'
import { scaleSizeH } from '@/utils/pixelRatio'
import { createStyle } from '@/utils/tools'
import { useGlassColors } from '@/utils/hooks/useGlassColors'
import { useSheetSlideAnimation } from '@/utils/hooks/useSheetSlideAnimation'
import { overlayModalGesture } from '@/components/player/PlayerOverlay/overlayModalGesture'
import { buildPlaylistQueue, getDragTargetSourceIndex, type PlaylistQueueItem } from './playlistQueue'

export interface PlaylistSheetType {
  show: () => void
}

interface DragInfo {
  id: string
  top: number
  left: number
  width: number
  startPageY: number
  originalIndex: number
  currentIndex: number
}

const ITEM_HEIGHT = scaleSizeH(LIST_ITEM_HEIGHT)

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

interface PlaylistRowProps {
  item: PlaylistQueueItem
  index: number
  active: boolean
  dragging: boolean
  onPlay: (item: PlaylistQueueItem) => void
  onRemove: (item: PlaylistQueueItem) => void
  onLongPress: (item: PlaylistQueueItem, index: number, event: GestureResponderEvent) => void
}

const PlaylistRow = memo(({
  item,
  index,
  active,
  dragging,
  onPlay,
  onRemove,
  onLongPress,
}: PlaylistRowProps) => {
  const glassColors = useGlassColors()
  const musicInfo = item.musicInfo
  const singer = musicInfo.singer ? `${musicInfo.source.toUpperCase()} · ${musicInfo.singer}` : musicInfo.source.toUpperCase()

  return (
    <View style={{ ...styles.row, opacity: dragging ? 0 : 1 }}>
      <TouchableOpacity
        style={styles.rowMain}
        activeOpacity={0.65}
        delayLongPress={260}
        onPress={() => {
          onPlay(item)
        }}
        onLongPress={event => {
          if (item.route == 'playlist') onLongPress(item, index, event)
        }}
      >
        <View style={styles.number}>
          {
            active
              ? <Icon name="play-outline" size={13} color={glassColors.accent} />
              : item.route == 'playLater'
                ? <Icon name="nextMusic" size={12} color={glassColors.accent} />
                : <Text size={13} color={glassColors.muted}>{index + 1}</Text>
          }
        </View>
        <Image style={styles.cover} url={musicInfo.meta.picUrl} />
        <View style={styles.info}>
          <Text numberOfLines={1} size={14} color={active ? glassColors.accent : glassColors.text}>
            {musicInfo.name}
          </Text>
          <Text numberOfLines={1} size={11} color={active ? glassColors.accent : glassColors.muted} style={styles.singer}>
            {singer}
          </Text>
        </View>
        {
          musicInfo.interval
            ? <Text numberOfLines={1} size={12} color={glassColors.muted} style={styles.interval}>{musicInfo.interval}</Text>
            : null
        }
      </TouchableOpacity>
      <TouchableOpacity style={styles.removeButton} activeOpacity={0.7} onPress={() => {
        onRemove(item)
      }}>
        <Icon name="close" size={15} color={glassColors.muted} />
      </TouchableOpacity>
    </View>
  )
})

const PlaylistSheet = forwardRef<PlaylistSheetType>((_, ref) => {
  const theme = useTheme()
  const glassColors = useGlassColors()
  const t = useI18n()
  const playInfo = usePlayInfo()
  const playMusicInfo = usePlayMusicInfo()
  const tempPlayList = useTempPlayList()
  const listId = playInfo.playerListId ?? playMusicInfo.listId

  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [playlistItems, setPlaylistItems] = useState<LX.Music.MusicInfo[]>([])
  const [draggingItems, setDraggingItems] = useState<PlaylistQueueItem[] | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const slide = useSheetSlideAnimation()

  const listIdRef = useRef(listId)
  const itemsRef = useRef<PlaylistQueueItem[]>([])
  const dragInfoRef = useRef<DragInfo | null>(null)
  const scrollOffsetRef = useRef(0)
  const viewportRef = useRef({ top: 0, left: 0, width: 0 })
  const viewportViewRef = useRef<View>(null)
  const currentMusicId = playMusicInfo.musicInfo?.id ?? null

  const dragTop = useMemo(() => new Animated.Value(0), [])
  const dragLeft = useMemo(() => new Animated.Value(0), [])
  const dragWidth = useMemo(() => new Animated.Value(0), [])

  const refreshList = useCallback(() => {
    const currentListId = listIdRef.current
    if (!currentListId) {
      setPlaylistItems([])
      return
    }

    void getListMusics(currentListId).then(musics => {
      if (currentListId != listIdRef.current || dragInfoRef.current) return
      setPlaylistItems([...musics])
    }).catch(() => {})
  }, [])

  const measureViewport = useCallback(() => {
    viewportViewRef.current?.measureInWindow((x, y, width) => {
      viewportRef.current = { left: x, top: y, width }
    })
  }, [])

  const endDrag = useCallback(() => {
    const info = dragInfoRef.current
    if (!info) return

    dragInfoRef.current = null
    setDragId(null)
    setDraggingItems(null)
    const currentListId = listIdRef.current
    if (currentListId && info.currentIndex != info.originalIndex) {
      void updateListMusicPosition(currentListId, info.currentIndex, [info.id]).catch(() => {
        refreshList()
      })
    }
  }, [refreshList])

  const moveDrag = useCallback((pageY: number) => {
    const info = dragInfoRef.current
    if (!info) return

    const top = info.top + pageY - info.startPageY
    dragTop.setValue(top)

    const contentY = top - viewportRef.current.top + scrollOffsetRef.current
    const targetVisibleIndex = clamp(Math.round(contentY / ITEM_HEIGHT), 0, itemsRef.current.length - 1)
    const targetIndex = getDragTargetSourceIndex(itemsRef.current, targetVisibleIndex, info.originalIndex)
    if (targetIndex == info.currentIndex) return

    const nextItems = [...itemsRef.current]
    const movedVisibleIndex = nextItems.findIndex(queueItem => queueItem.route == 'playlist' && queueItem.index == info.currentIndex)
    const [movedItem] = nextItems.splice(movedVisibleIndex, 1)
    nextItems.splice(targetVisibleIndex, 0, movedItem)
    itemsRef.current = nextItems
    setDraggingItems(nextItems)
    info.currentIndex = targetIndex
  }, [dragTop])

  const startDrag = useCallback((item: PlaylistQueueItem, index: number, event: GestureResponderEvent) => {
    if (dragInfoRef.current != null || listIdRef.current == null) return
    const rowView = event.currentTarget as unknown as View | null
    rowView?.measureInWindow((x, y, width) => {
      dragInfoRef.current = {
        id: item.musicInfo.id,
        top: y,
        left: x,
        width,
        startPageY: event.nativeEvent.pageY,
        originalIndex: item.index,
        currentIndex: item.index,
      }
      dragTop.setValue(y)
      dragLeft.setValue(x)
      dragWidth.setValue(width)
      setDragId(item.musicInfo.id)
    })
  }, [dragLeft, dragTop, dragWidth])

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponderCapture: () => dragInfoRef.current != null,
    onMoveShouldSetPanResponderCapture: () => dragInfoRef.current != null,
    onPanResponderMove: (_, gestureState) => {
      moveDrag(gestureState.moveY)
    },
    onPanResponderRelease: endDrag,
    onPanResponderTerminate: endDrag,
    onPanResponderTerminationRequest: () => false,
  })).current

  useEffect(() => {
    listIdRef.current = listId
    refreshList()
  }, [listId, refreshList])

  useEffect(() => {
    const handleListUpdate = (ids: string[]) => {
      if (!listIdRef.current || !ids.includes(listIdRef.current)) return
      refreshList()
    }

    global.app_event.on('myListMusicUpdate', handleListUpdate)
    return () => {
      global.app_event.off('myListMusicUpdate', handleListUpdate)
    }
  }, [refreshList])

  const derivedItems = useMemo(() => buildPlaylistQueue(
    playlistItems,
    tempPlayList,
    currentMusicId,
  ), [playlistItems, tempPlayList, currentMusicId])

  const items = draggingItems ?? derivedItems

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  useEffect(() => {
    if (!visible) return

    overlayModalGesture.active = true
    return () => {
      overlayModalGesture.active = false
    }
  }, [visible])

  useImperativeHandle(ref, () => ({
    show() {
      scrollOffsetRef.current = 0
      setMounted(true)
      slide.show()
      requestAnimationFrame(() => {
        setVisible(true)
        measureViewport()
      })
    },
  }))

  const hide = useCallback((after?: () => void) => {
    endDrag()
    slide.hide(() => {
      setVisible(false)
      after?.()
    })
  }, [endDrag, slide])

  const handlePlay = useCallback((item: PlaylistQueueItem) => {
    if (dragInfoRef.current) return
    if (item.route == 'playLater') {
      void playTempPlayList(item.index)
      return
    }

    const currentListId = listIdRef.current
    if (!currentListId) return
    void playList(currentListId, item.index)
  }, [])

  const handleRemove = useCallback((item: PlaylistQueueItem) => {
    if (dragInfoRef.current) return
    if (item.route == 'playLater') {
      removeTempPlayList(item.index)
      return
    }

    const currentListId = listIdRef.current
    if (!currentListId) return
    void removeListMusics(currentListId, [item.musicInfo.id]).then(() => {
      refreshList()
    })
  }, [refreshList])

  const renderItem = useCallback(({ item, index }: { item: PlaylistQueueItem, index: number }) => {
    return (
      <PlaylistRow
        item={item}
        index={index}
        active={currentMusicId == item.musicInfo.id}
        dragging={dragId == item.musicInfo.id}
        onPlay={handlePlay}
        onRemove={handleRemove}
        onLongPress={startDrag}
      />
    )
  }, [currentMusicId, dragId, handlePlay, handleRemove, startDrag])

  const dragItem = dragId ? items.find(item => item.musicInfo.id == dragId) : null

  if (!mounted) return null

  return (
    <Modal
      animationType="none"
      transparent
      hardwareAccelerated
      statusBarTranslucent
      visible={visible}
      onRequestClose={() => {
        hide()
      }}
      onDismiss={() => {
        if (!visible) setMounted(false)
      }}
    >
      <Animated.View
        style={[styles.mask, { opacity: slide.maskOpacity }]}
      >
        <TouchableWithoutFeedback onPress={() => {
          hide()
        }}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>
        <>
          <Animated.View
            style={[
              styles.sheet,
              {
                backgroundColor: theme['c-content-background'],
                borderTopColor: theme['c-border-background'],
              },
              { transform: [{ translateY: slide.sheetY }] },
            ]}
            onLayout={slide.onSheetLayout}
          >
            <GlassBackdrop
              blurRadius={24}
              overlayOpacity={0.66}
              style={{ backgroundColor: theme['c-content-background'] }}
            />
            <View style={styles.content}>
              <View style={styles.header}>
                <Text size={15} style={styles.title} numberOfLines={1} color={glassColors.text}>
                  {t('play_detail_playlist_title')}
                </Text>
                <TouchableOpacity onPress={() => {
                  hide()
                }} style={styles.closeBtn}>
                  <Icon
                    name="chevron-right-2"
                    size={14}
                    color={glassColors.muted}
                    style={styles.downIcon}
                  />
                </TouchableOpacity>
              </View>
              <View
                ref={viewportViewRef}
                style={styles.listViewport}
                onLayout={() => {
                  measureViewport()
                }}
              >
                {
                  items.length
                    ? (
                      <FlatList
                        data={items}
                        keyExtractor={item => `${item.route}_${item.index}_${item.musicInfo.id}`}
                        renderItem={renderItem}
                        getItemLayout={(_, index) => ({ length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index })}
                        contentContainerStyle={styles.listContent}
                        nestedScrollEnabled
                        showsVerticalScrollIndicator={false}
                        scrollEnabled={!dragId}
                        scrollEventThrottle={16}
                        onScroll={event => {
                          scrollOffsetRef.current = event.nativeEvent.contentOffset.y
                        }}
                      />
                      )
                    : (
                      <View style={styles.empty}>
                        <Text size={13} color={glassColors.muted}>{t('play_detail_playlist_empty')}</Text>
                      </View>
                      )
                }
              </View>
            </View>
          </Animated.View>

          {
            dragItem
              ? (
                <Animated.View style={[styles.dragItem, { top: dragTop, left: dragLeft, width: dragWidth }]}>
                  <View style={[styles.dragContent, { backgroundColor: theme['c-primary-background-hover'] }]}>
                    <View style={styles.number}>
                      <Icon name="dots-vertical" size={13} color={glassColors.accent} />
                    </View>
                    <Image style={styles.cover} url={dragItem.musicInfo.meta.picUrl} />
                    <View style={styles.info}>
                      <Text numberOfLines={1} size={14} color={glassColors.text}>{dragItem.musicInfo.name}</Text>
                      <Text numberOfLines={1} size={11} color={glassColors.accent} style={styles.singer}>
                        {dragItem.musicInfo.singer}
                      </Text>
                    </View>
                  </View>
                </Animated.View>
                )
              : null
          }
        </>
      </Animated.View>
    </Modal>
  )
})

const styles = createStyle({
  mask: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  backdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '50%',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderTopWidth: 1,
    overflow: 'hidden',
  },
  content: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
  },
  title: {
    flex: 1,
    paddingLeft: 15,
  },
  closeBtn: {
    height: 44,
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  downIcon: {
    transform: [{ rotate: '90deg' }],
  },
  listViewport: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 14,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 140,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ITEM_HEIGHT,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
  },
  number: {
    width: 26,
    alignItems: 'center',
  },
  cover: {
    width: 36,
    height: 36,
    marginLeft: 8,
    marginRight: 9,
    borderRadius: 4,
  },
  info: {
    flex: 1,
    flexShrink: 1,
  },
  singer: {
    paddingTop: 3,
  },
  interval: {
    marginLeft: 8,
    marginRight: 6,
  },
  removeButton: {
    height: ITEM_HEIGHT,
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dragItem: {
    position: 'absolute',
    height: ITEM_HEIGHT,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  dragContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 6,
    paddingLeft: 12,
    paddingRight: 8,
  },
})

export default PlaylistSheet
