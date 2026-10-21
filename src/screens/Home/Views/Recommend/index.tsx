import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, TouchableOpacity, useWindowDimensions, View } from 'react-native'

import Text from '@/components/common/Text'
import { FeatureIcon } from '@/components/common/Icon'
import Image from '@/components/common/Image'
import MusicListItem from '@/components/OnlineList/ListItem'
import ListMenu, { type ListMenuType, type Position } from '@/components/OnlineList/ListMenu'
import ListMusicAdd, { type MusicAddModalType } from '@/components/MusicAddModal'
import DownloadQualitySheet, { type DownloadQualitySheetType } from '@/components/DownloadQualitySheet'
import Menu, { type MenuType } from '@/components/common/Menu'
import { clearMusicUrl, handleDislikeMusic, handlePlayLater, handleShare, handleShowMusicSourceDetail } from '@/components/OnlineList/listAction'
import { useTheme } from '@/store/theme/hook'
import { useTempPlayList } from '@/store/player/hook'
import { useI18n } from '@/lang'
import homeDetailActions from '@/store/homeDetail/action'
import type { ListInfoItem } from '@/store/songlist/state'
import { getRadioMode, getRadioQueueSummary, getRadioStatus, isRadioActive, startRadio } from '@/core/recommend/radio'
import { recommendationEngine } from '@/core/recommend'
import Onboarding from './Onboarding'
import { scaleSizeW } from '@/utils/pixelRatio'
import { createStyle, getRowInfo } from '@/utils/tools'
import { BorderRadius } from '@/theme'
import type { RadioMode } from '@/core/recommend/types'
import { CARD_SONG_COUNT, getRecommendFeed, markPlaylistNotInterested, playCuratedNewSong, refreshCuratedNewSongs, refreshCuratedPlaylists, refreshRecommendFeed, subscribeRecommendFeed } from './feed'

type CardStatus = 'idle' | 'loading' | 'playing' | 'error'

// 内容区左右内边距与歌单卡片间距：卡片宽度要按这两个值换算，一屏才能正好露出 2.5 个封面
// 必须用 scaleSizeW：歌曲行的负边距靠它对齐内容区，裸 15 在大屏上会错位
const CONTENT_PADDING_X = scaleSizeW(15)
const CARD_GAP = scaleSizeW(12)
const VISIBLE_CARD_COUNT = 2.5

// 本区块永不进入多选，传稳定空数组引用以保留歌曲行的 memo
const NO_SELECT: LX.Music.MusicInfoOnline[] = []

const COPY = {
  radio: {
    icon: 'radio-tower',
    title: 'recommend_radio_title',
    desc: 'recommend_radio_desc',
    loading: 'recommend_radio_loading',
    playing: 'recommend_radio_playing',
  },
  explore: {
    icon: 'compass-outline',
    title: 'recommend_explore_title',
    desc: 'recommend_explore_desc',
    loading: 'recommend_explore_loading',
    playing: 'recommend_explore_playing',
  },
} as const

const useRadioCard = (mode: RadioMode) => {
  const tempPlayList = useTempPlayList()
  const [status, setStatus] = useState<CardStatus>(() => isRadioActive() && getRadioMode() == mode ? 'playing' : 'idle')
  const [upcoming, setUpcoming] = useState<string[]>([])

  // 电台与探索共用同一个引擎队列，任一模式在播时另一张卡片要回到待命态
  useEffect(() => {
    const active = isRadioActive() && getRadioMode() == mode
    setStatus(current => active ? 'playing' : current == 'playing' ? 'idle' : current)
    // 一行两列后卡片变窄，只预览下一首
    setUpcoming(active ? getRadioQueueSummary(1) : [])
  }, [mode, tempPlayList])

  const handlePress = useCallback(async() => {
    setStatus('loading')
    try {
      await startRadio(mode)
      setUpcoming(getRadioQueueSummary(1))
      setStatus('playing')
    } catch (error) {
      const status = getRadioStatus()
      console.error('[recommend] start_failed', mode, error, JSON.stringify({
        poolSize: status.poolSize,
        queueSize: status.queueSize,
        channels: status.channels,
        reasons: status.reasons,
      }))
      setStatus('error')
    }
  }, [mode])

  return { status, handlePress, upcoming }
}

const CardBody = ({ mode, status, upcoming }: { mode: RadioMode, status: CardStatus, upcoming: string[] }) => {
  const theme = useTheme()
  const t = useI18n()
  const copy = COPY[mode]
  const playingText = upcoming.length
    ? t('recommend_queue_next', { names: upcoming.join('、') })
    : t(copy.playing)
  return (
    <>
      <FeatureIcon name={copy.icon} size={22} color={theme['c-primary-font']} style={styles.cardIcon} />
      <Text size={17} numberOfLines={1} color={theme['c-font']} style={styles.cardTitle}>{t(copy.title)}</Text>
      <Text size={12} numberOfLines={3} color={theme['c-font-label']} style={styles.cardDesc}>
        {status == 'playing' ? playingText : t(copy.desc)}
      </Text>
      {
        status == 'loading' || status == 'error'
          ? <Text size={11} color={theme['c-font-label']} style={styles.cardStatus}>
              {status == 'loading' ? t(copy.loading) : t('recommend_error')}
            </Text>
          : null
      }
    </>
  )
}

const RadioCard = ({ mode }: { mode: RadioMode }) => {
  const theme = useTheme()
  const card = useRadioCard(mode)
  return (
    <TouchableOpacity
      style={{ ...styles.radioCard, backgroundColor: theme['c-primary-background-active'] }}
      activeOpacity={0.85}
      onPress={() => {
        void card.handlePress()
      }}
    >
      <CardBody mode={mode} status={card.status} upcoming={card.upcoming} />
      {
        card.status == 'loading'
          ? <ActivityIndicator color={theme['c-primary-font-active']} style={styles.spinner} />
          : null
      }
    </TouchableOpacity>
  )
}

const SectionHeader = ({ title, loading, onPressRefresh, onPressMore }: {
  title: string
  loading: boolean
  onPressRefresh: () => void
  onPressMore: () => void
}) => {
  const theme = useTheme()
  const t = useI18n()
  return (
    <View style={styles.sectionHeader}>
      <Text size={15} color={theme['c-font']} style={styles.sectionLabel}>{title}</Text>
      <TouchableOpacity
        onPress={() => {
          if (!loading) onPressRefresh()
        }}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={[styles.headerAction, loading && styles.headerActionDisabled]}
      >
        <Text size={13} color={theme['c-font-label']}>{t('recommend_refresh')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onPressMore}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text size={13} color={theme['c-primary']}>{t('recommend_more')}</Text>
      </TouchableOpacity>
    </View>
  )
}

const useRecommendFeed = () => {
  const tempPlayList = useTempPlayList()
  const [, setTick] = useState(0)
  useEffect(() => subscribeRecommendFeed(() => {
    setTick(value => value + 1)
  }), [])
  // tab 常驻挂载，电台每推进一次队列就复查画像版本，两个区块才会跟着算法更新
  useEffect(() => {
    void refreshRecommendFeed()
  }, [tempPlayList])
  return getRecommendFeed()
}

const FeedPlaceholder = ({ text }: { text: string }) => {
  const theme = useTheme()
  return <Text size={12} color={theme['c-font-label']} style={styles.placeholder}>{text}</Text>
}

const NewSongsSection = ({ feed, onShowMenu }: {
  feed: ReturnType<typeof useRecommendFeed>
  onShowMenu: (item: LX.Music.MusicInfoOnline, index: number, position: Position) => void
}) => {
  const t = useI18n()
  const rowInfo = useRef(getRowInfo('medium')).current
  const tracks = feed.newSongs.tracks.slice(0, CARD_SONG_COUNT)
  return (
    <View style={styles.section}>
      <SectionHeader
        title={t('recommend_new_songs')}
        loading={feed.newSongsLoading}
        onPressRefresh={() => {
          void refreshCuratedNewSongs()
        }}
        onPressMore={() => {
          homeDetailActions.push({ type: 'recommendNewSongs' })
        }}
      />
      {
        !tracks.length
          ? <FeedPlaceholder text={t(feed.newSongsLoading ? 'recommend_feed_loading' : 'recommend_feed_empty')} />
          : (
              <View style={styles.songList}>
                {
                  tracks.map((track, index) => (
                    <MusicListItem
                      key={track.id}
                      item={track}
                      index={index}
                      selectedList={NO_SELECT}
                      rowInfo={rowInfo}
                      isShowAlbumName={false}
                      isShowInterval={false}
                      isMultiSelectMode={false}
                      activeIndex={-1}
                      onPress={() => {
                        playCuratedNewSong(index)
                      }}
                      onShowMenu={onShowMenu}
                    />
                  ))
                }
              </View>
            )
      }
    </View>
  )
}

const PlaylistSection = ({ feed }: { feed: ReturnType<typeof useRecommendFeed> }) => {
  const theme = useTheme()
  const t = useI18n()
  const { width: windowWidth } = useWindowDimensions()
  // 一屏正好露出 2.5 个封面：那半个就是"还能往左滑"的提示
  const cardWidth = Math.floor((windowWidth - CONTENT_PADDING_X - CARD_GAP * 2) / VISIBLE_CARD_COUNT)
  const playlists = feed.cardPlaylists
  const menuRef = useRef<MenuType>(null)
  const [menuMounted, setMenuMounted] = useState(false)
  const notInterestedTargetRef = useRef<ListInfoItem | null>(null)
  const cardRefs = useRef(new Map<string, TouchableOpacity>())

  const showCardMenu = (item: ListInfoItem) => {
    const card = cardRefs.current.get(`${item.source}__${item.id}`)
    if (!card?.measure) return
    card.measure((fx, fy, width, height, px, py) => {
      notInterestedTargetRef.current = item
      const position = { x: Math.ceil(px), y: Math.ceil(py), w: Math.ceil(width), h: Math.ceil(height) }
      if (menuMounted) menuRef.current?.show(position)
      else {
        setMenuMounted(true)
        requestAnimationFrame(() => {
          menuRef.current?.show(position)
        })
      }
    })
  }

  const handleMenuPress = () => {
    const item = notInterestedTargetRef.current
    notInterestedTargetRef.current = null
    if (item) void markPlaylistNotInterested(item)
  }

  return (
    <View style={styles.section}>
      <SectionHeader
        title={t('recommend_playlists')}
        loading={feed.playlistsLoading}
        onPressRefresh={() => {
          void refreshCuratedPlaylists()
        }}
        onPressMore={() => {
          homeDetailActions.push({ type: 'recommendPlaylists' })
        }}
      />
      {
        !playlists.length
          ? <FeedPlaceholder text={t(feed.playlistsLoading ? 'recommend_feed_loading' : 'recommend_feed_empty')} />
          : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.playlistScroll}
                contentContainerStyle={styles.playlistRow}
              >
                {
                  playlists.map(item => {
                    const key = `${item.source}__${item.id}`
                    return (
                      <TouchableOpacity
                        key={key}
                        ref={ref => {
                          if (ref) cardRefs.current.set(key, ref)
                          else cardRefs.current.delete(key)
                        }}
                        style={{ ...styles.playlistCard, width: cardWidth }}
                        activeOpacity={0.85}
                        onLongPress={() => { showCardMenu(item) }}
                        onPress={() => {
                          homeDetailActions.push({ type: 'songlist', info: item })
                        }}
                      >
                        <Image style={styles.playlistCover} url={item.img} />
                        <Text size={13} numberOfLines={2} color={theme['c-font']} style={styles.playlistName}>{item.name}</Text>
                        {
                          item.author ? (
                            <Text size={11} numberOfLines={1} color={theme['c-font-label']} style={styles.playlistAuthor}>
                              {item.author}
                            </Text>
                          ) : null
                        }
                      </TouchableOpacity>
                    )
                  })
                }
              </ScrollView>
            )
      }
      {
        menuMounted
          ? (
              <Menu
                ref={menuRef}
                menus={[{ action: 'notInterested', label: t('dislike') }]}
                onPress={handleMenuPress}
              />
            )
          : null
      }
    </View>
  )
}

const Recommend = () => {
  const theme = useTheme()
  const feed = useRecommendFeed()
  const [refreshing, setRefreshing] = useState(false)
  const listMenuRef = useRef<ListMenuType>(null)
  const listMusicAddRef = useRef<MusicAddModalType>(null)
  const downloadQualitySheetRef = useRef<DownloadQualitySheetType>(null)

  // 新歌速递行的三个点菜单与普通歌单列表共用同一套组件与动作
  const showSongMenu = useCallback((musicInfo: LX.Music.MusicInfoOnline, index: number, position: Position) => {
    listMenuRef.current?.show({ musicInfo, index, single: true, selectedList: [] }, position)
  }, [])

  const handleRefresh = useCallback(async() => {
    setRefreshing(true)
    try {
      await refreshRecommendFeed(true)
    } finally {
      setRefreshing(false)
    }
  }, [])

  const [onboardingView, setOnboardingView] = useState<{ completed: boolean, weights: Record<string, number> } | null>(null)
  const reloadOnboarding = useCallback(() => {
    // 读不出问卷状态时退回正常信息流，否则 tab 永久转圈
    recommendationEngine.getOnboardingView().then(setOnboardingView).catch((err: any) => {
      console.log(err)
      setOnboardingView({ completed: true, weights: {} })
    })
  }, [])
  useEffect(() => {
    reloadOnboarding()
  }, [reloadOnboarding])

  if (!onboardingView) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={theme['c-font-label']} style={styles.onboardingLoading} />
      </View>
    )
  }
  if (!onboardingView.completed) {
    return (
      <Onboarding
        initialWeights={onboardingView.weights}
        onCompleted={() => {
          reloadOnboarding()
          void refreshRecommendFeed(true)
        }}
      />
    )
  }

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void handleRefresh()
            }}
          />
        )}
      >
        <View style={styles.radioRow}>
          <RadioCard mode="radio" />
          <RadioCard mode="explore" />
        </View>
        <NewSongsSection feed={feed} onShowMenu={showSongMenu} />
        <PlaylistSection feed={feed} />
      </ScrollView>
      <ListMenu
        ref={listMenuRef}
        onPlay={info => {
          playCuratedNewSong(info.index)
        }}
        onPlayLater={info => {
          handlePlayLater(info.musicInfo, info.selectedList, () => {})
        }}
        onDownload={info => {
          requestAnimationFrame(() => {
            downloadQualitySheetRef.current?.show([info.musicInfo])
          })
        }}
        onAdd={info => {
          listMusicAddRef.current?.show({ musicInfo: info.musicInfo, listId: '', isMove: false })
        }}
        onCopyName={info => {
          handleShare(info.musicInfo)
        }}
        onMusicSourceDetail={info => {
          void handleShowMusicSourceDetail(info.musicInfo)
        }}
        onRemoveCache={info => {
          void clearMusicUrl(info.musicInfo)
        }}
        onDislikeMusic={info => {
          void handleDislikeMusic(info.musicInfo)
        }}
      />
      <ListMusicAdd ref={listMusicAddRef} onAdded={() => {}} />
      <DownloadQualitySheet ref={downloadQualitySheetRef} />
    </>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
  content: {
    paddingTop: 15,
    paddingHorizontal: 15,
    paddingBottom: 30,
  },
  radioRow: {
    flexDirection: 'row',
    gap: 12,
  },
  onboardingLoading: {
    alignSelf: 'center',
    marginTop: 60,
  },
  section: {
    marginTop: 24,
  },
  radioCard: {
    flex: 1,
    borderRadius: BorderRadius.normal * 2,
    paddingVertical: 16,
    paddingHorizontal: 14,
    minHeight: 120,
    justifyContent: 'flex-start',
    overflow: 'hidden',
  },
  cardIcon: {
    marginBottom: 6,
    textAlign: 'center',
  },
  cardTitle: {
    textAlign: 'center',
  },
  cardDesc: {
    marginTop: 8,
    textAlign: 'center',
  },
  cardStatus: {
    marginTop: 6,
  },
  spinner: {
    position: 'absolute',
    right: 10,
    top: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionLabel: {
    flex: 1,
  },
  headerAction: {
    marginRight: 12,
  },
  headerActionDisabled: {
    opacity: 0.4,
  },
  placeholder: {
    paddingVertical: 12,
  },
  songList: {
    marginHorizontal: -CONTENT_PADDING_X,
    paddingRight: 15,
  },
  playlistScroll: {
    // 撑破内容区的左右内边距：卡片要一直滑到屏幕物理边缘，边界不留白边
    // createStyle 不换算 marginHorizontal，所以这里必须保留已换算的常量
    marginHorizontal: -CONTENT_PADDING_X,
  },
  playlistRow: {
    paddingLeft: 15,
    paddingRight: 15,
    paddingBottom: 4,
  },
  playlistCard: {
    marginRight: 12,
  },
  playlistCover: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: BorderRadius.normal * 2,
  },
  playlistName: {
    marginTop: 8,
  },
  playlistAuthor: {
    marginTop: 4,
  },
})

export default Recommend
