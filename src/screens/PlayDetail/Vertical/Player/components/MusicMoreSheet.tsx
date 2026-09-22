import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Animated, Modal, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native'

import GlassBackdrop from '@/components/common/GlassBackdrop'
import Image from '@/components/common/Image'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import MusicAddModal, { type MusicAddModalType } from '@/components/MusicAddModal'
import MusicToggleModal, { type MusicToggleModalType } from '@/screens/Home/Views/Mylist/MusicList/MusicToggleModal'
import { addListMusics } from '@/core/list'
import { dislikeMusic } from '@/core/player/player'
import { addTempPlayList } from '@/core/player/tempPlayList'
import { LIST_IDS } from '@/config/constant'
import musicSdk from '@/utils/musicSdk'
import settingState from '@/store/setting/state'
import { usePlayerMusicInfo, usePlayInfo, usePlayMusicInfo } from '@/store/player/hook'
import { useTheme } from '@/store/theme/hook'
import { useSheetSlideAnimation } from '@/utils/hooks/useSheetSlideAnimation'
import { createStyle } from '@/utils/tools'

export interface MusicMoreSheetType {
  show: () => void
}

type AlbumInfoApi = (id: string | number) => Promise<{ publishDate?: string | null }>

const getRawMusicInfo = (rawMusicInfo: NonNullable<LX.Player.PlayMusicInfo['musicInfo']>) => {
  return 'progress' in rawMusicInfo ? rawMusicInfo.metadata.musicInfo : rawMusicInfo
}

const getAlbumInfoApi = (source: string) => {
  const sdk = musicSdk as unknown as Record<string, { album?: { getAlbumInfo?: AlbumInfoApi } }>
  return sdk[source]?.album?.getAlbumInfo
}

const formatInfoValue = (value: string | null | undefined) => {
  return value?.length ? value : '--'
}

const ACTIONS = [
  { key: 'playNext', icon: 'list-order', label: '添加到下一首' },
  { key: 'playlist', icon: 'add-music', label: '添加到播放列表' },
  { key: 'userList', icon: 'add_folder', label: '添加到我的歌单' },
  { key: 'toggleSource', icon: 'search-2', label: '歌曲换源' },
  { key: 'dislike', icon: 'remove', label: '不喜欢' },
] as const

const MusicMoreSheet = forwardRef<MusicMoreSheetType>((_, ref) => {
  const theme = useTheme()
  const musicInfo = usePlayerMusicInfo()
  const playMusicInfo = usePlayMusicInfo()
  const playInfo = usePlayInfo()
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [publishDate, setPublishDate] = useState<string | null>(null)
  const musicAddModalRef = useRef<MusicAddModalType>(null)
  const musicToggleModalRef = useRef<MusicToggleModalType>(null)
  const slide = useSheetSlideAnimation()

  useImperativeHandle(ref, () => ({
    show() {
      setMounted(true)
      slide.show()
      requestAnimationFrame(() => {
        setVisible(true)
      })
    },
  }))

  useEffect(() => {
    let requestValid = true
    const rawMusicInfo = playMusicInfo.musicInfo ? getRawMusicInfo(playMusicInfo.musicInfo) : null
    const source = rawMusicInfo?.source
    const albumId = rawMusicInfo && 'albumId' in rawMusicInfo.meta
      ? rawMusicInfo.meta.albumId
      : undefined
    const albumInfoApi = source ? getAlbumInfoApi(source) : undefined

    setPublishDate(null)
    if (!albumId || !albumInfoApi) return

    albumInfoApi(albumId).then(({ publishDate }) => {
      if (requestValid) setPublishDate(publishDate ?? null)
    }).catch(() => {
      if (requestValid) setPublishDate(null)
    })

    return () => {
      requestValid = false
    }
  }, [playMusicInfo.musicInfo])

  const hide = (after?: () => void) => {
    slide.hide(() => {
      setVisible(false)
      after?.()
    })
  }

  const handleAction = (key: typeof ACTIONS[number]['key']) => {
    const rawMusicInfo = playMusicInfo.musicInfo ? getRawMusicInfo(playMusicInfo.musicInfo) : null
    if (!rawMusicInfo) return
    const listId = playMusicInfo.listId ?? LIST_IDS.DEFAULT

    if (key == 'playNext') {
      hide()
      addTempPlayList([{ listId, musicInfo: rawMusicInfo }])
      return
    }

    if (key == 'playlist') {
      hide()
      void addListMusics(
        playInfo.playerListId ?? LIST_IDS.DEFAULT,
        [rawMusicInfo],
        settingState.setting['list.addMusicLocationType'],
      )
      return
    }

    if (key == 'userList') {
      hide(() => {
        requestAnimationFrame(() => {
          musicAddModalRef.current?.show({ musicInfo: rawMusicInfo, isMove: false, listId })
        })
      })
      return
    }

    if (key == 'toggleSource') {
      hide(() => {
        requestAnimationFrame(() => {
          musicToggleModalRef.current?.show({ musicInfo: rawMusicInfo, listId })
        })
      })
      return
    }

    hide()
    void dislikeMusic()
  }

  if (!mounted) return null

  return (
    <>
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
        <TouchableWithoutFeedback onPress={() => {
          hide()
        }}>
          <Animated.View style={[styles.mask, { opacity: slide.maskOpacity }]}>
            <Animated.View
              style={[
                styles.sheet,
                { backgroundColor: theme['c-content-background'] },
                { transform: [{ translateY: slide.sheetY }] },
              ]}
              onLayout={slide.onSheetLayout}
              onStartShouldSetResponder={() => true}
            >
              <GlassBackdrop
                blurRadius={24}
                overlayOpacity={0.62}
                style={{ backgroundColor: theme['c-content-background'] }}
              />
              <View style={styles.content} onStartShouldSetResponder={() => true}>
                <View style={styles.header}>
                  <Image cache={false} url={musicInfo.pic} style={styles.cover} />
                  <View style={styles.info}>
                    <Text numberOfLines={1} size={17} style={styles.name} color={theme['c-font']}>{musicInfo.name}</Text>
                    <Text numberOfLines={1} size={13} color={theme['c-primary']}>{musicInfo.singer}</Text>
                    <Text numberOfLines={1} size={13} color={theme['c-font-label']}>{formatInfoValue(musicInfo.album)}</Text>
                    <Text numberOfLines={1} size={13} color={theme['c-font-label']}>{formatInfoValue(publishDate)}</Text>
                  </View>
                </View>
                <View style={[styles.separator, { backgroundColor: theme['c-border-background'] }]} />
                <View style={styles.actions}>
                  {
                    ACTIONS.map(({ key, icon, label }) => (
                      <TouchableOpacity
                        key={key}
                        style={styles.action}
                        activeOpacity={0.6}
                        accessibilityRole="button"
                        onPress={() => {
                          handleAction(key)
                        }}
                      >
                        <Icon name={icon} size={20} color={theme['c-primary']} style={styles.actionIcon} />
                        <Text numberOfLines={1} size={14} color={theme['c-font']} style={styles.actionText}>{label}</Text>
                      </TouchableOpacity>
                    ))
                  }
                </View>
              </View>
            </Animated.View>
          </Animated.View>
        </TouchableWithoutFeedback>
      </Modal>
      <MusicAddModal ref={musicAddModalRef} />
      <MusicToggleModal ref={musicToggleModalRef} />
    </>
  )
})

const styles = createStyle({
  mask: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '82%',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    overflow: 'hidden',
  },
  content: {
    paddingBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  cover: {
    width: 58,
    height: 58,
    borderRadius: 6,
  },
  info: {
    flex: 1,
    marginLeft: 14,
  },
  name: {
    fontWeight: '700',
    marginBottom: 3,
  },
  separator: {
    height: 1,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  action: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 54,
    paddingHorizontal: 12,
    width: '50%',
  },
  actionIcon: {
    width: 30,
  },
  actionText: {
    marginLeft: 10,
  },
})

export default MusicMoreSheet
