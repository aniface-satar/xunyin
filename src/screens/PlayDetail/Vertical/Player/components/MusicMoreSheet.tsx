import { Fragment, forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Animated, Modal, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native'

import GlassBackdrop from '@/components/common/GlassBackdrop'
import Image from '@/components/common/Image'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { BorderWidths } from '@/theme'
import MusicAddModal, { type MusicAddModalType } from '@/components/MusicAddModal'
import MusicToggleModal, { type MusicToggleModalType } from '@/screens/Home/Views/Mylist/MusicList/MusicToggleModal'
import DownloadQualitySheet, { type DownloadQualitySheetType } from '@/components/DownloadQualitySheet'
import { dislikeMusic } from '@/core/player/player'
import { addTempPlayList } from '@/core/player/tempPlayList'
import { hasDislike } from '@/core/dislikeList'
import { getMusicAlbumListInfo } from '@/core/musicLinks'
import { LIST_IDS } from '@/config/constant'
import musicSdk from '@/utils/musicSdk'
import { usePlayerMusicInfo, usePlayMusicInfo } from '@/store/player/hook'

import { useTheme } from '@/store/theme/hook'
import { useNavigationBarHeight } from '@/store/common/hook'
import { useI18n } from '@/lang'
import { useSheetSlideAnimation } from '@/utils/hooks/useSheetSlideAnimation'
import { primeBackdropForPanel } from '@/utils/backdropSnapshot'
import { useOpenMusicDetail } from '@/utils/hooks/useOpenMusicDetail'
import { assertApiSupport, createStyle, toast } from '@/utils/tools'
import { scaleSizeH } from '@/utils/pixelRatio'

export interface MusicMoreSheetType {
  show: () => void
}

interface MusicMoreSheetProps {
  onOpenArtist: (music: { source: LX.Source, singer: string }) => void
}

type AlbumInfoApi = (id: string | number) => Promise<{ publishDate?: string | null }>

const getRawMusicInfo = (rawMusicInfo: NonNullable<LX.Player.PlayMusicInfo['musicInfo']>) => {
  return 'progress' in rawMusicInfo ? rawMusicInfo.metadata.musicInfo : rawMusicInfo
}

const canDownloadMusicInfo = (musicInfo: LX.Music.MusicInfo) => {
  return musicInfo.source != 'local' && assertApiSupport(musicInfo.source)
}

const getAlbumInfoApi = (source: string) => {
  const sdk = musicSdk as unknown as Record<string, { album?: { getAlbumInfo?: AlbumInfoApi } }>
  return sdk[source]?.album?.getAlbumInfo
}

const formatInfoValue = (value: string | null | undefined) => {
  return value?.length ? value : '--'
}

const ACTIONS = [
  { key: 'playNext', icon: 'list-order', label: 'music_more_play_next' },
  { key: 'dislike', icon: 'remove', label: 'dislike' },
  { key: 'userList', icon: 'add_folder', label: 'music_more_add_to_mylist' },
  { key: 'toggleSource', icon: 'search-2', label: 'toggle_source' },
  { key: 'download', icon: 'download-2', label: 'download_menu' },
] as const

// 头部封面与下方操作行共用这组横向度量：图标中心对封面中心，文字左缘对歌名/歌手左缘
const SHEET_PADDING_HORIZONTAL = 16
const SHEET_COVER_SIZE = 58
const SHEET_COVER_TO_INFO_GAP = 14

const MusicMoreSheet = forwardRef<MusicMoreSheetType, MusicMoreSheetProps>(({ onOpenArtist }, ref) => {
  const theme = useTheme()
  const t = useI18n()
  // 强制边到边后三键导航压在面板下缘，底部操作行要让开它
  const navigationBarHeight = useNavigationBarHeight()
  const musicInfo = usePlayerMusicInfo()
  const playMusicInfo = usePlayMusicInfo()
  const openMusicDetail = useOpenMusicDetail()
  const isDisliked = hasDislike(playMusicInfo.musicInfo)
  const rawMusicInfo = playMusicInfo.musicInfo ? getRawMusicInfo(playMusicInfo.musicInfo) : null
  const canDownload = rawMusicInfo != null && canDownloadMusicInfo(rawMusicInfo)
  const albumLink = rawMusicInfo ? getMusicAlbumListInfo(rawMusicInfo) : null
  const canOpenArtist = rawMusicInfo != null && rawMusicInfo.source != 'local'
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [publishDate, setPublishDate] = useState<string | null>(null)
  const musicAddModalRef = useRef<MusicAddModalType>(null)
  const musicToggleModalRef = useRef<MusicToggleModalType>(null)
  const downloadQualitySheetRef = useRef<DownloadQualitySheetType>(null)
  const slide = useSheetSlideAnimation()

  useImperativeHandle(ref, () => ({
    show() {
      // 玻璃面糊的是"面板背后真实显示的那一帧"。截图要 60~150ms，先挂面板的话第一帧
      // 只能空着，等快照回来才糊上 —— 观感就是背景从清晰突然变糊。先拍再挂，首帧即最终形态。
      void primeBackdropForPanel().then(() => {
        setMounted(true)
        slide.show()
        requestAnimationFrame(() => {
          setVisible(true)
        })
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

  const handleOpenArtist = () => {
    if (!rawMusicInfo || !canOpenArtist) return
    hide(() => {
      // 等面板收起再交给父组件的选择器，避免两个 Modal 同帧切换
      requestAnimationFrame(() => {
        onOpenArtist(rawMusicInfo)
      })
    })
  }

  const handleOpenAlbum = () => {
    if (!albumLink) return
    hide(() => {
      openMusicDetail({ type: 'songlist', info: albumLink })
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

    if (key == 'dislike') {
      hide()
      toast(global.i18n.t('lists_dislike_music_add_tip'))
      void dislikeMusic()
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

    if (key == 'download') {
      const downloadMusicInfo = rawMusicInfo.source == 'local' ? [] : [rawMusicInfo]
      hide(() => {
        requestAnimationFrame(() => {
          downloadQualitySheetRef.current?.show(downloadMusicInfo)
        })
      })
    }
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
                overlayOpacity={0.62}
                restOffset={slide.sheetLayout}
                style={{ backgroundColor: theme['c-content-background'] }}
              />
              <View style={{ paddingBottom: scaleSizeH(16) + navigationBarHeight }} onStartShouldSetResponder={() => true}>
                <View style={styles.header}>
                  <Image cache={false} url={musicInfo.pic} style={styles.cover} />
                  <View style={styles.info}>
                    <Text numberOfLines={1} size={17} style={styles.name} color={theme['c-font']}>{musicInfo.name}</Text>
                    <TouchableOpacity
                      style={styles.linkRow}
                      activeOpacity={0.7}
                      disabled={!canOpenArtist}
                      onPress={handleOpenArtist}
                      accessibilityRole="button"
                      accessibilityLabel={musicInfo.singer}
                    >
                      <Text numberOfLines={1} size={13} color={theme['c-primary']} style={styles.linkText}>{musicInfo.singer}</Text>
                      {canOpenArtist && <Icon name="chevron-right" size={12} color={theme['c-font-label']} style={styles.linkArrow} />}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.linkRow, styles.linkRowSpaced]}
                      activeOpacity={0.7}
                      disabled={!albumLink}
                      onPress={handleOpenAlbum}
                      accessibilityRole="button"
                      accessibilityLabel={musicInfo.album}
                    >
                      <Text numberOfLines={1} size={13} color={theme['c-font-label']} style={styles.linkText}>{formatInfoValue(musicInfo.album)}</Text>
                      {albumLink != null && <Icon name="chevron-right" size={12} color={theme['c-font-label']} style={styles.linkArrow} />}
                    </TouchableOpacity>
                    <Text style={styles.date} numberOfLines={1} size={13} color={theme['c-font-label']}>{formatInfoValue(publishDate)}</Text>
                  </View>
                </View>
                <View style={[styles.separator, { borderBottomColor: theme['c-border-background'] }]} />
                <View style={styles.actions}>
                  {
                    ACTIONS.map(({ key, icon, label }, index) => (
                      <Fragment key={key}>
                        <TouchableOpacity
                          style={[styles.action, (key == 'dislike' && isDisliked) || (key == 'download' && !canDownload) ? styles.actionDisabled : null]}
                          activeOpacity={0.6}
                          accessibilityRole="button"
                          disabled={(key == 'dislike' && isDisliked) || (key == 'download' && !canDownload)}
                          onPress={() => {
                            handleAction(key)
                          }}
                        >
                          <Icon name={icon} size={20} color={theme['c-primary']} style={styles.actionIcon} />
                          <Text numberOfLines={1} size={14} color={theme['c-font']} style={styles.actionText}>{t(label)}</Text>
                        </TouchableOpacity>
                        {
                          index < ACTIONS.length - 1 && (
                            <View style={[styles.separator, { borderBottomColor: theme['c-border-background'] }]} />
                          )
                        }
                      </Fragment>
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
      <DownloadQualitySheet ref={downloadQualitySheetRef} />
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
    // 勿加百分比 maxHeight：自动高度的绝对定位节点上 Yoga 会按内容自身高度解析百分比，面板会被裁掉一截
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SHEET_PADDING_HORIZONTAL,
    paddingVertical: 18,
  },
  cover: {
    width: SHEET_COVER_SIZE,
    height: SHEET_COVER_SIZE,
    borderRadius: 6,
  },
  info: {
    flex: 1,
    marginLeft: SHEET_COVER_TO_INFO_GAP,
  },
  name: {
    fontWeight: 'bold',
    marginBottom: 6,
  },
  linkRow: {
    alignItems: 'center',
    flexDirection: 'row',
    // 歌手/专辑两行都是跳转入口，行高给足，避免相邻两行点串
    minHeight: 28,
  },
  linkRowSpaced: {
    marginTop: 2,
  },
  date: {
    marginTop: 4,
  },
  linkText: {
    flexShrink: 1,
  },
  linkArrow: {
    marginLeft: 2,
  },
  // 分隔线直接照歌单列表的行线：borderBottom + BorderWidths.normal 不经过 createStyle 的尺寸换算。
  // 别再写成 height: 1 —— scaleSizeH 会在高密度屏（如 1260×2800 @3.5）把它算成 0dp，线整条消失。
  separator: {
    borderBottomWidth: BorderWidths.normal,
  },
  actions: {
    flexDirection: 'column',
  },
  action: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-start',
    height: 54,
    paddingHorizontal: SHEET_PADDING_HORIZONTAL,
    width: '100%',
  },
  actionIcon: {
    // 和封面同宽并居中：图标中心 = 左内边距 + 封面宽度 / 2
    width: SHEET_COVER_SIZE,
    textAlign: 'center',
  },
  actionText: {
    // 与头部歌名/歌手左缘对齐：左内边距 + 封面宽度 + 封面到文字间距
    marginLeft: SHEET_COVER_TO_INFO_GAP,
    flex: 1,
  },
  actionDisabled: {
    opacity: 0.35,
  },
})

export default MusicMoreSheet
