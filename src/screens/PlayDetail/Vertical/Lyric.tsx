import { memo, useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { View, FlatList, TouchableOpacity, type FlatListProps, type LayoutChangeEvent, type NativeSyntheticEvent, type NativeScrollEvent, type ViewProps, type TextLayoutEventData } from 'react-native'
// import { useLayout } from '@/utils/hooks'
import { type Line, useLrcPlay, useLrcSet } from '@/plugins/lyric'
import { createStyle, toast, clipboardWriteText } from '@/utils/tools'
import { BorderWidths, BorderRadius } from '@/theme'
// import { useComponentIds } from '@/store/common/hook'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import { useGlassColors } from '@/utils/hooks/useGlassColors'
import { BLUR_LYRIC_COMPONENT_OPACITY, LYRIC_COMPONENT_OPACITY } from '@/utils/monet/onCoverTheme'
import { useCoverSurface } from '@/utils/monet/useCoverSurface'
import { WALLPAPER_LYRIC_OPACITY, getWallpaperLyricPalette } from '@/utils/wallpaper/palette'
import { useLyricToolMode } from '@/utils/hooks/useLyricToolMode'
import { buildLyricCopyText, hasLyricText, invertLyricSelection, pickLyricLineIndexes, pickLyricLinesForCopy, selectAllLyricLines, setLyricToolMode } from '@/core/lyricCopy'
import { useI18n } from '@/lang'
import Button from '@/components/common/Button'
import Text, { AnimatedColorText } from '@/components/common/Text'
import { setSpText } from '@/utils/pixelRatio'
import playerState from '@/store/player/state'
import { usePlayMusicInfo } from '@/store/player/hook'
import { scrollTo } from '@/utils/scroll'
import PlayLine, { type PlayLineType } from '../components/PlayLine'
import MusicSummary from './components/MusicSummary'
import { HEADER_HEIGHT } from './components/Header'
import ShareCardModal from '@/components/ShareCard/ShareCardModal'
import type { ShareCardData } from '@/components/ShareCard'
import { resolveNoWrap, type LyricBlockLine } from '@/components/ShareCard/fitLyricBlock'
import { getLyricFallbackDragLineSpacing } from '@/components/player/PlayerOverlay/transition'
import { getPlayDetailLayout } from './layout'
import { useStatusbarHeight } from '@/store/common/hook'
import { useWindowSize } from '@/utils/hooks'
import { BTN_WIDTH } from './Player/components/MoreBtn/Btn'
// import { screenkeepAwake } from '@/utils/nativeModules/utils'
// import { log } from '@/utils/log'
// import { toast } from '@/utils/tools'

type FlatListType = FlatListProps<Line>

// const useLock = () => {
//   const showCommentRef = useRef(false)


//   useEffect(() => {
//     let appstateListener = AppState.addEventListener('change', (state) => {
//       switch (state) {
//         case 'active':
//           if (showLyricRef.current && !showCommentRef.current) screenkeepAwake()
//           break
//         case 'background':
//           screenUnkeepAwake()
//           break
//       }
//     })
//     return () => {
//       appstateListener.remove()
//     }
//   }, [])
//   useEffect(() => {
//     let listener: ReturnType<typeof onNavigationComponentDidDisappearEvent>
//     showCommentRef.current = !!componentIds.comment
//     if (showCommentRef.current) {
//       if (showLyricRef.current) screenUnkeepAwake()
//       listener = onNavigationComponentDidDisappearEvent(componentIds.comment as string, () => {
//         if (showLyricRef.current && AppState.currentState == 'active') screenkeepAwake()
//       })
//     }

//     const rm = global.state_event.on('componentIdsUpdated', (ids) => {

//     })

//     return () => {
//       if (listener) listener.remove()
//     }
//   }, [])
// }

interface LyricProps {
  showSummary?: boolean
  summaryGestureHandlers?: ViewProps
}

interface LineProps {
  line: Line
  lineNum: number
  activeLine: number
  selected: boolean
  selectable: boolean
  /** 非当前行（含它的译文）那一档透明度。由页面按"封面场是哪一档"决定，逐行不自己判断 ——
   *  判一次要订阅一次背景状态，摊到几百行上就是白订阅。 */
  lyricOpacity: number
  /** 壁纸模式（自定义背景）且播控页没有封面场：非当前行改走 utils/wallpaper/palette 那一档墨。
   *  同样由页面判一次再传进来，理由同上 —— 这个布尔要跟 `useCoverSurface()` 一起判断。 */
  wallpaperLyric: boolean
  onLayout: (lineNum: number, height: number, width: number) => void
  /** 这一句在歌词页上实际折成几行（onTextLayout 量出来的）：海报要跟这里保持一致 */
  onRowCount: (lineNum: number, rows: number) => void
  onPress: (lineNum: number) => void
  onLongPress: (lineNum: number) => void
}
const LrcLine = memo(({ line, lineNum, activeLine, selected, selectable, lyricOpacity, wallpaperLyric, onLayout, onRowCount, onPress, onLongPress }: LineProps) => {
  const glassColors = useGlassColors(lyricOpacity)
  const theme = useTheme()
  // 壁纸模式的墨色（白字 / 黑字）在主题里，非当前行这两支颜料与当前行的描边都从它派生 ——
  // 换一次墨色，歌词页跟着一起翻，不需要各写一套常量
  const wallpaperInk = theme['wallpaper-ink']
  const wallpaperInks = useMemo(() => getWallpaperLyricPalette(wallpaperInk), [wallpaperInk])
  const lrcFontSize = useSettingValue('playDetail.vertical.style.lrcFontSize')
  const textAlign = useSettingValue('playDetail.style.align')
  const size = lrcFontSize / 10
  const lineHeight = setSpText(size) * 1.3

  // 工具模式里播放进度不再染色，高亮只跟着选中走
  const active = selectable ? selected : activeLine == lineNum
  const colors = useMemo(() => {
    return active ? [
      glassColors.lyricActive,
      glassColors.lyricActiveTranslation,
      1,
    ] as const : [
      // 壁纸模式：主题的 `c-350 / c-300` 在照片上只剩 0.29 / 0.26（见 palette 里那段账），
      // 换成专用那一档 —— 颜料自己带 alpha，页面那层 0.72 再乘一次
      wallpaperLyric ? wallpaperInks.ink : glassColors.lyric,
      wallpaperLyric ? wallpaperInks.translation : glassColors.lyricTranslation,
      glassColors.lyricOpacity,
    ] as const
  }, [active, glassColors, wallpaperLyric, wallpaperInks])

  // 当前行在壁纸模式下是满墨（c-primary = 墨本身），色值已经到顶；要"再加深"只能压它外沿那一圈反色，
  // 把这一笔从"薄薄一层墨"托成"带描边的一笔"（白字配黑环 / 黑字配白环，见 palette）。
  const activeShadow = wallpaperLyric && active ? {
    textShadowColor: wallpaperInks.activeShadow.color,
    textShadowOffset: wallpaperInks.activeShadow.offset,
    textShadowRadius: wallpaperInks.activeShadow.radius,
  } : null

  const handleLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    onLayout(lineNum, nativeEvent.layout.height, nativeEvent.layout.width)
  }

  // 歌词页自己按当前宽度排出来的行数就是"这句有没有折行"的判据（估宽模型猜不准换行点，
  // 真排出来的一行才作数）。海报那一侧拿它决定卡里要不要也钉成一行。
  const handleTextLayout = ({ nativeEvent }: NativeSyntheticEvent<TextLayoutEventData>) => {
    onRowCount(lineNum, nativeEvent.lines.length)
  }

  // textBreakStrategy="simple" 用于解决某些设备上字体被截断的问题
  // https://stackoverflow.com/a/72822360
  return (
    <TouchableOpacity
      style={[styles.line, selected ? { backgroundColor: theme['c-primary-background-hover'] } : null]}
      onLayout={handleLayout}
      onPress={() => { onPress(lineNum) }}
      onLongPress={() => { onLongPress(lineNum) }}
      activeOpacity={0.7}
    >
      <AnimatedColorText style={{
        ...styles.lineText,
        textAlign,
        lineHeight,
        ...(activeShadow ?? {}),
      }} textBreakStrategy="simple" onTextLayout={handleTextLayout} color={colors[0]} opacity={colors[2]} size={size}>{line.text}</AnimatedColorText>
      {
        line.extendedLyrics.map((lrc, index) => {
          return (<AnimatedColorText style={{
            ...styles.lineTranslationText,
            textAlign,
            lineHeight: lineHeight * 0.8,
          }} textBreakStrategy="simple" key={index} color={colors[1]} opacity={colors[2]} size={size * 0.8}>{lrc}</AnimatedColorText>)
        })
      }
    </TouchableOpacity>
  )
}, (prevProps, nextProps) => {
  return prevProps.line === nextProps.line &&
    prevProps.selected === nextProps.selected &&
    prevProps.selectable === nextProps.selectable &&
    prevProps.lyricOpacity === nextProps.lyricOpacity &&
    prevProps.wallpaperLyric === nextProps.wallpaperLyric &&
    prevProps.activeLine != nextProps.lineNum &&
    nextProps.activeLine != nextProps.lineNum
})
const wait = async() => new Promise(resolve => setTimeout(resolve, 100))

export default ({
  showSummary = true,
  summaryGestureHandlers,
}: LyricProps) => {
  const lyricLines = useLrcSet()
  const lyricLinesRef = useRef(lyricLines)
  lyricLinesRef.current = lyricLines
  const { line } = useLrcPlay()
  // 非当前行那一档跟着背景场走：② 的场比 ① 亮 9 个 L*，白@0.98 乘上 0.6 只剩 2.75（线 3.0），
  // 所以 ② 这一档换成那一档自己的值（2026-10-19 用户要"当前行与非当前行拉开"，又压深了一格）——
  // 墨色与这条乘法是**成对**核过的，见 onCoverTheme.BLUR_LYRIC_COMPONENT_OPACITY。
  const { surface } = useCoverSurface()
  const flatListRef = useRef<FlatList>(null)
  const playLineRef = useRef<PlayLineType>(null)
  const isPauseScrollRef = useRef(true)
  const scrollTimoutRef = useRef<NodeJS.Timeout | null>(null)
  const delayScrollTimeout = useRef<NodeJS.Timeout | null>(null)
  const lineRef = useRef({ line: 0, prevLine: 0 })
  const isFirstSetLrc = useRef(true)
  const scrollInfoRef = useRef<NativeSyntheticEvent<NativeScrollEvent>['nativeEvent'] | null>(null)
  const listLayoutInfoRef = useRef<{ spaceHeight: number, lineHeights: number[] }>({ spaceHeight: 0, lineHeights: [] })
  const scrollCancelRef = useRef<(() => void) | null>(null)
  const isShowLyricProgressSetting = useSettingValue('playDetail.isShowLyricProgressSetting')
  const lyricToolMode = useLyricToolMode()
  const lyricToolModeRef = useRef(lyricToolMode)
  lyricToolModeRef.current = lyricToolMode
  const [selectedLines, setSelectedLines] = useState<Set<number>>(() => new Set())
  const selectedLinesRef = useRef(selectedLines)
  selectedLinesRef.current = selectedLines
  // 每句在歌词页上排成几行（onTextLayout 量的）：海报拿它决定卡里要不要保持一行。
  // 换歌/换字号时清空，下一次布局会重新量。
  const lineRowCountsRef = useRef<number[]>([])
  const lrcFontSizeForRows = useSettingValue('playDetail.vertical.style.lrcFontSize')
  useEffect(() => {
    lineRowCountsRef.current = []
  }, [lyricLines, lrcFontSizeForRows])
  const playMusicInfo = usePlayMusicInfo()
  const [posterData, setPosterData] = useState<{ musicInfo: ShareCardData, lyricLines: readonly LyricBlockLine[] } | null>(null)
  // 海报正文字号跟着歌词页设置走（"以用户当前选择的歌词大小为准"）：设置存的是 ×10 的值，卡内用 dp
  const lyricFontSizeSetting = useSettingValue('playDetail.vertical.style.lrcFontSize')
  const posterLyricFontSize = lyricFontSizeSetting / 10
  const theme = useTheme()
  // 壁纸模式（自定义背景）下，歌词页的底是一张照片：主题灰阶 c-350 / c-300 压在上面只剩 1.87 / 1.61，
  // 所以那两档换成 palette 里专门算过的一支（见 getWallpaperLyricPalette）。
  // 前提是**没有封面场** —— 开了动态背景时播放页整棵子树换的是封面墨色，那一档不能被这个覆盖。
  const wallpaperLyric = surface == null && theme['is-wallpaper']
  const lyricOpacity = surface?.mode === 'blur' ? BLUR_LYRIC_COMPONENT_OPACITY : wallpaperLyric ? WALLPAPER_LYRIC_OPACITY : LYRIC_COMPONENT_OPACITY
  const t = useI18n()
  const { width: winWidth, height: winHeight } = useWindowSize()
  const statusBarHeight = useStatusbarHeight()
  const coverGap = useMemo(() => getPlayDetailLayout(
    winWidth,
    winHeight,
    statusBarHeight + HEADER_HEIGHT,
  ).coverGap, [statusBarHeight, winHeight, winWidth])
  // useLock()
  // const [imgUrl, setImgUrl] = useState(null)
  // const theme = useGetter('common', 'theme')
  // const { onLayout, ...layout } = useLayout()

  // useEffect(() => {
  //   const url = playMusicInfo ? playMusicInfo.musicInfo.img : null
  //   if (imgUrl == url) return
  //   setImgUrl(url)
  // // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [playMusicInfo])

  // const imgWidth = useMemo(() => layout.width * 0.75, [layout.width])
  const handleScrollToActive = (index = lineRef.current.line) => {
    if (index < 0) return
    if (flatListRef.current) {
      // console.log('handleScrollToActive', index)
      if (index == 0) {
        // The measured header is the distance between the summary and the play line.
        flatListRef.current.scrollToOffset({
          offset: listLayoutInfoRef.current.spaceHeight || dragLineSpacing,
          animated: true,
        })
        return
      }
      if (scrollInfoRef.current && lineRef.current.line - lineRef.current.prevLine == 1) {
        let offset = listLayoutInfoRef.current.spaceHeight
        for (let line = 0; line < index; line++) {
          offset += listLayoutInfoRef.current.lineHeights[line]
        }
        offset += (listLayoutInfoRef.current.lineHeights[line] ?? 0) / 2
        try {
          scrollCancelRef.current = scrollTo(flatListRef.current, scrollInfoRef.current, offset - scrollInfoRef.current.layoutMeasurement.height * 0.5, 600, () => {
            scrollCancelRef.current = null
          })
        } catch {}
      } else {
        if (scrollCancelRef.current) {
          scrollCancelRef.current()
          scrollCancelRef.current = null
        }
        try {
          flatListRef.current.scrollToIndex({
            index,
            animated: true,
            viewPosition: 0.5,
          })
        } catch {}
      }
    }
  }

  const handleScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollInfoRef.current = nativeEvent
    if (isPauseScrollRef.current) {
      playLineRef.current?.updateScrollInfo(nativeEvent)
    }
  }
  const handleScrollBeginDrag = () => {
    isPauseScrollRef.current = true
    playLineRef.current?.setVisible(true)
    if (delayScrollTimeout.current) {
      clearTimeout(delayScrollTimeout.current)
      delayScrollTimeout.current = null
    }
    if (scrollTimoutRef.current) {
      clearTimeout(scrollTimoutRef.current)
      scrollTimoutRef.current = null
    }
    if (scrollCancelRef.current) {
      scrollCancelRef.current()
      scrollCancelRef.current = null
    }
  }

  const onScrollEndDrag = () => {
    if (!isPauseScrollRef.current) return
    if (scrollTimoutRef.current) clearTimeout(scrollTimoutRef.current)
    if (lyricToolModeRef.current) {
      // 工具模式里把手移开也不跳回当前行，理由同上
      playLineRef.current?.setVisible(false)
      return
    }
    scrollTimoutRef.current = setTimeout(() => {
      playLineRef.current?.setVisible(false)
      scrollTimoutRef.current = null
      isPauseScrollRef.current = false
      if (!playerState.isPlay) return
      handleScrollToActive()
    }, 3000)
  }


  useEffect(() => {
    return () => {
      if (delayScrollTimeout.current) {
        clearTimeout(delayScrollTimeout.current)
        delayScrollTimeout.current = null
      }
      if (scrollTimoutRef.current) {
        clearTimeout(scrollTimoutRef.current)
        scrollTimoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    // 换歌时回到普通歌词页，否则下一首会静默停在没有播控按钮的工具界面
    setLyricToolMode(false)
    // linesRef.current = lyricLines
    listLayoutInfoRef.current.lineHeights = []
    lineRef.current.prevLine = 0
    lineRef.current.line = 0
    if (!flatListRef.current) return
    flatListRef.current.scrollToOffset({
      offset: listLayoutInfoRef.current.spaceHeight || dragLineSpacing,
      animated: false,
    })
    if (!lyricLines.length) return
    playLineRef.current?.updateLyricLines(lyricLines)
    requestAnimationFrame(() => {
      if (isFirstSetLrc.current) {
        isFirstSetLrc.current = false
        setTimeout(() => {
          isPauseScrollRef.current = false
          handleScrollToActive()
        }, 100)
      } else {
        if (delayScrollTimeout.current) clearTimeout(delayScrollTimeout.current)
        delayScrollTimeout.current = setTimeout(() => {
          handleScrollToActive(0)
        }, 100)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lyricLines])

  useEffect(() => {
    if (line < 0) return
    lineRef.current.prevLine = lineRef.current.line
    lineRef.current.line = line
    if (!flatListRef.current || isPauseScrollRef.current) return
    // 工具模式里不跟着播放滚：行在手指底下动会让人点不中
    if (lyricToolModeRef.current) return

    if (line - lineRef.current.prevLine != 1) {
      handleScrollToActive()
      return
    }

    delayScrollTimeout.current = setTimeout(() => {
      delayScrollTimeout.current = null
      handleScrollToActive()
    }, 600)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line])

  useEffect(() => {
    requestAnimationFrame(() => {
      playLineRef.current?.updateLayoutInfo(listLayoutInfoRef.current)
      playLineRef.current?.updateLyricLines(lyricLines)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isShowLyricProgressSetting])

  const handleScrollToIndexFailed: FlatListType['onScrollToIndexFailed'] = (info) => {
    void wait().then(() => {
      handleScrollToActive(info.index)
    })
  }

  const handleLineLayout = useCallback<LineProps['onLayout']>((lineNum, height) => {
    listLayoutInfoRef.current.lineHeights[lineNum] = height
    playLineRef.current?.updateLayoutInfo(listLayoutInfoRef.current)
  }, [])

  const handleLineRowCount = useCallback<LineProps['onRowCount']>((lineNum, rows) => {
    lineRowCountsRef.current[lineNum] = rows
  }, [])

  const handleSpaceLayout = useCallback(({ nativeEvent }: LayoutChangeEvent) => {
    listLayoutInfoRef.current.spaceHeight = nativeEvent.layout.height
    playLineRef.current?.updateLayoutInfo(listLayoutInfoRef.current)
  }, [])

  const toggleLineSelection = useCallback((lineNum: number) => {
    const lineData = lyricLinesRef.current[lineNum]
    // 纯音乐的空白行没什么可复制，点了不该亮起来
    if (!lineData || !hasLyricText(lineData)) return
    setSelectedLines(prev => {
      const next = new Set(prev)
      if (next.has(lineNum)) next.delete(lineNum)
      else next.add(lineNum)
      return next
    })
  }, [])

  const handleLinePress = useCallback((lineNum: number) => {
    if (lyricToolModeRef.current) {
      toggleLineSelection(lineNum)
      return
    }
    const lineData = lyricLinesRef.current[lineNum]
    if (!lineData) return
    playLineRef.current?.setVisible(false)
    if (scrollTimoutRef.current) {
      clearTimeout(scrollTimoutRef.current)
      scrollTimoutRef.current = null
    }
    if (delayScrollTimeout.current) {
      clearTimeout(delayScrollTimeout.current)
      delayScrollTimeout.current = null
    }
    isPauseScrollRef.current = false
    global.app_event.setProgress(lineData.time / 1000)
  }, [toggleLineSelection])

  const handleLineLongPress = useCallback((lineNum: number) => {
    // 已经在工具模式里长按不能把用户攒下的多选清空
    if (lyricToolModeRef.current) return
    const lineData = lyricLinesRef.current[lineNum]
    setSelectedLines(lineData && hasLyricText(lineData) ? new Set([lineNum]) : new Set())
    setLyricToolMode(true)
  }, [])

  useEffect(() => {
    if (lyricToolMode) return
    // 退出工具模式后选中态没有意义，留着会让下一首一进来就带着高亮
    setSelectedLines(prev => prev.size ? new Set<number>() : prev)
  }, [lyricToolMode])

  const handleSelectAll = useCallback(() => {
    setSelectedLines(selectAllLyricLines(lyricLinesRef.current))
  }, [])

  const handleInvertSelection = useCallback(() => {
    setSelectedLines(prev => invertLyricSelection(lyricLinesRef.current, prev))
  }, [])

  const handleCopyLyric = useCallback(() => {
    const selected = selectedLinesRef.current
    if (!selected.size) {
      toast(lyricLinesRef.current.length ? t('lyric_copy_no_selection') : t('lyric_copy_empty'))
      return
    }
    const text = buildLyricCopyText(pickLyricLinesForCopy(lyricLinesRef.current, selected))
    if (!text) {
      toast(t('lyric_copy_no_selection'))
      return
    }
    clipboardWriteText(text)
    toast(t('lyric_copy_success'))
  }, [t])

  // 海报与复制同源：都从工具模式里勾选的行取词。一行没选就提示去勾选（share_card_no_selection），
  // 歌本身没词才是 lyric_copy_empty。
  const handleLyricPoster = useCallback(() => {
    const lines = lyricLinesRef.current
    if (!lines.length) {
      toast(t('lyric_copy_empty'))
      return
    }
    const posterIndexes = pickLyricLineIndexes(lines, selectedLinesRef.current)
    if (!posterIndexes.length) {
      toast(t('share_card_no_selection'))
      return
    }
    // 换行跟歌词页对齐：那一句在歌词页上排成一行（onTextLayout 量的 rows <= 1），海报里也钉成一行。
    // 没量到的行不再"算了不当一行"：FlatList 只挂载屏幕附近那几行，全选出来的绝大多数从没排过版，
    // 那部分按歌词页自己的宽度与字号估（判据住 resolveNoWrap）。
    // 歌词页一行的可用宽度 = 屏宽 − container 左右各 20（styles.line 的负 margin 与 padding 相互抵消）。
    const pageFontDp = setSpText(posterLyricFontSize)
    const pageTextWidth = Math.max(0, winWidth - 40)
    const posterLines: LyricBlockLine[] = posterIndexes.map(index => {
      const line = lines[index]
      return {
        text: line.text,
        extendedLyrics: line.extendedLyrics,
        noWrap: resolveNoWrap(lineRowCountsRef.current[index], line.text, pageFontDp, pageTextWidth),
      }
    })
    // 歌名/歌手/封面与头部那张(song)卡同一取法（Header.tsx:62-64），
    // 'progress' in 判据区分播放态包装与裸 musicInfo。
    const currentMusic = playerState.playMusicInfo.musicInfo ?? playMusicInfo.musicInfo
    if (!currentMusic) return
    const musicInfo = 'progress' in currentMusic ? currentMusic.metadata.musicInfo : currentMusic
    setPosterData({
      musicInfo: { name: musicInfo.name, singer: musicInfo.singer, pic: musicInfo.meta.picUrl },
      lyricLines: posterLines,
    })
  }, [playMusicInfo, posterLyricFontSize, t, winWidth])

  // Keep the first paint aligned with the play line; async page/summary measurements would show a visible jump.
  const pageHeight = Math.max(0, winHeight - statusBarHeight - HEADER_HEIGHT)
  const dragLineSpacing = useMemo(() => getLyricFallbackDragLineSpacing({
    pageHeight,
    coverGap,
    coverSize: 52,
    buttonWidth: BTN_WIDTH,
  }), [coverGap, pageHeight])

  const renderItem: FlatListType['renderItem'] = ({ item, index }) => {
    return (
      <LrcLine line={item} lineNum={index} activeLine={line} selected={selectedLines.has(index)} selectable={lyricToolMode} lyricOpacity={lyricOpacity} wallpaperLyric={wallpaperLyric} onLayout={handleLineLayout} onRowCount={handleLineRowCount} onPress={handleLinePress} onLongPress={handleLineLongPress} />
    )
  }
  const getkey: FlatListType['keyExtractor'] = (item, index) => `${index}${item.text}`

  const spaceComponent = useMemo(() => (
    <View style={styles.space}></View>
  ), [])

  const headerComponent = useMemo(() => (
    <View style={{ ...styles.header, height: dragLineSpacing }} onLayout={handleSpaceLayout}></View>
  ), [dragLineSpacing, handleSpaceLayout])

  return (
    <View style={styles.page}>
      <View
        {...(summaryGestureHandlers ?? {})}
        style={[styles.summary, { opacity: showSummary ? 1 : 0 }]}
        pointerEvents={showSummary ? 'box-none' : 'none'}
      >
        <MusicSummary coverSize={52} marginTop={coverGap} />
      </View>
      <View style={styles.listWrap}>
        <FlatList
          data={lyricLines}
          renderItem={renderItem}
          keyExtractor={getkey}
          style={styles.container}
          ref={flatListRef}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={headerComponent}
          ListFooterComponent={spaceComponent}
          contentOffset={{ x: 0, y: dragLineSpacing }}
          onScrollBeginDrag={handleScrollBeginDrag}
          onScrollEndDrag={onScrollEndDrag}
          fadingEdgeLength={100}
          initialNumToRender={Math.max(line + 10, 10)}
          onScrollToIndexFailed={handleScrollToIndexFailed}
          onScroll={handleScroll}
        />
        { isShowLyricProgressSetting ? <PlayLine ref={playLineRef} viewportRatio={0.5} /> : null }
      </View>
      {
        lyricToolMode ? (
          <>
            <View style={styles.selectBar}>
              <Button style={{ ...styles.selectBtn, backgroundColor: theme['c-button-background'], borderColor: theme['c-border-background'] }} onPress={handleSelectAll} accessibilityRole="button">
                <Text size={12} numberOfLines={1} color={theme['c-button-font']}>{t('lyric_tool_select_all')}</Text>
              </Button>
              <Button style={{ ...styles.selectBtn, backgroundColor: theme['c-button-background'], borderColor: theme['c-border-background'] }} onPress={handleInvertSelection} accessibilityRole="button">
                <Text size={12} numberOfLines={1} color={theme['c-button-font']}>{t('lyric_tool_invert')}</Text>
              </Button>
            </View>
            <View style={styles.toolBar}>
              <Button style={{ ...styles.toolBtn, backgroundColor: theme['c-button-background'] }} onPress={handleCopyLyric} accessibilityRole="button">
                <Text size={14} color={theme['c-button-font']} style={styles.toolBtnText}>{t('lyric_tool_copy')}</Text>
              </Button>
              <Button style={{ ...styles.toolBtn, backgroundColor: theme['c-button-background'] }} onPress={handleLyricPoster} accessibilityRole="button">
                <Text size={14} color={theme['c-button-font']} style={styles.toolBtnText}>{t('lyric_tool_poster')}</Text>
              </Button>
            </View>
          </>
        ) : null
      }
      {/* 海报弹窗挂在工具条条件块外：设了 posterData 后即使工具模式变了（切歌/翻页会 setLyricToolMode(false)），
          Modal 也不会在拍摄途中被卸载 —— 那会让 captureRef 的 promise reject，在身后弹“生成图片失败”。 */}
      {
        posterData ? (
          <ShareCardModal
            visible
            mode="lyric"
            musicInfo={posterData.musicInfo}
            lyricFontSize={posterLyricFontSize}
            lyricLines={posterData.lyricLines}
            onClose={() => { setPosterData(null) }}
          />
        ) : null
      }
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
    paddingLeft: 20,
    paddingRight: 20,
    // backgroundColor: 'rgba(0,0,0,0.1)',
  },
  space: {
    paddingTop: '100%',
  },
  page: {
    flex: 1,
  },
  listWrap: {
    flex: 1,
  },
  header: {
  },
  summary: {
    flexShrink: 0,
    paddingLeft: 20,
  },
  line: {
    paddingTop: 10,
    paddingBottom: 10,
    marginLeft: -20,
    marginRight: -20,
    paddingLeft: 20,
    paddingRight: 20,
    // opacity: 0,
  },
  lineText: {
    textAlign: 'center',
    // fontSize: 16,
    // lineHeight: 20,
    // paddingTop: 5,
    // paddingBottom: 5,
    // opacity: 0,
  },
  lineTranslationText: {
    textAlign: 'center',
    // fontSize: 13,
    // lineHeight: 17,
    paddingTop: 5,
    // paddingBottom: 5,
  },
  selectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 20,
    paddingRight: 20,
    paddingTop: 8,
  },
  // 与歌单多选底部那排小按钮同一形式：按内容撑宽，不占满一行
  selectBtn: {
    height: 30,
    paddingLeft: 12,
    paddingRight: 12,
    marginRight: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BorderRadius.normal,
    borderWidth: BorderWidths.normal,
    overflow: 'hidden',
  },
  toolBar: {
    flexDirection: 'row',
    gap: 12,
    paddingLeft: 20,
    paddingRight: 20,
    paddingTop: 8,
    paddingBottom: 15,
  },
  toolBtn: {
    flex: 1,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  toolBtnText: {
    textAlign: 'center',
  },
})
