import { useCallback, useRef } from 'react'
import { StyleSheet, TouchableOpacity, View, type LayoutChangeEvent } from 'react-native'

import Text from '@/components/common/Text'
import { LoveIcon } from '@/components/common/LoveIcon'
import { Icon } from '@/components/common/Icon'
import { usePlayerMusicInfo, usePlayMusicInfo } from '@/store/player/hook'
import { useIsLove } from '@/store/player/useIsLove'
import { useGlassColors } from '@/utils/hooks/useGlassColors'
import SynchronizedMarquee, { useSynchronizedMarquee } from '@/components/common/SynchronizedMarquee'
import { createStyle } from '@/utils/tools'
import { collectMusic, uncollectMusic } from '@/core/player/player'
import { useStatusbarHeight } from '@/store/common/hook'
import { scaleSizeH, scaleSizeW } from '@/utils/pixelRatio'
import { HEADER_HEIGHT } from '@/screens/PlayDetail/Vertical/components/Header'
import { useWindowSize } from '@/utils/hooks'
import { FULL_ARTIST_FONT_SIZE, FULL_ARTIST_LINE_HEIGHT, FULL_TITLE_FONT_SIZE, FULL_TITLE_LINE_HEIGHT, getPlayDetailLayout } from '../../layout'
import { BTN_WIDTH, BTN_ICON_SIZE, DOTS_VERTICAL_ALIGNMENT_OFFSET } from './MoreBtn/Btn'
import MusicMoreSheet, { type MusicMoreSheetType } from './MusicMoreSheet'
import LyricPreview from './LyricPreview'
import { getActionColumnLayout } from '@/components/player/PlayerOverlay/transition'

export interface MusicInfoLayout {
  titleY: number
  titleWidth: number
  artistY: number
  artistWidth: number
  lyricY: number
  actionX: number
  actionY: number
  actionWidth: number
  actionHeight: number
}

export default ({
  onLayoutChange,
  marqueeActive = true,
}: {
  onLayoutChange?: (layout: MusicInfoLayout) => void
  marqueeActive?: boolean
} = {}) => {
  const musicInfo = usePlayerMusicInfo()
  const playMusicInfo = usePlayMusicInfo()
  const glassColors = useGlassColors()
  const { width: winWidth, height: winHeight } = useWindowSize()
  const statusBarHeight = useStatusbarHeight()
  const { contentLeft, titleGap, textWidth } = getPlayDetailLayout(
    winWidth,
    winHeight,
    statusBarHeight + HEADER_HEIGHT,
  )
  const actionLayout = getActionColumnLayout(
    contentLeft + textWidth,
    BTN_WIDTH,
    scaleSizeW(4),
  )
  const isLove = useIsLove()
  const moreSheetRef = useRef<MusicMoreSheetType>(null)
  const marquee = useSynchronizedMarquee({ lineCount: 2 })
  const layoutRef = useRef<Partial<MusicInfoLayout>>({})

  const emitLayout = useCallback(() => {
    const {
      titleY,
      titleWidth,
      artistY,
      artistWidth,
      lyricY,
      actionX,
      actionY,
      actionWidth,
      actionHeight,
    } = layoutRef.current
    if (
      typeof titleY == 'number' &&
      typeof titleWidth == 'number' &&
      typeof artistY == 'number' &&
      typeof artistWidth == 'number' &&
      typeof lyricY == 'number' &&
      typeof actionX == 'number' &&
      typeof actionY == 'number' &&
      typeof actionWidth == 'number' &&
      typeof actionHeight == 'number'
    ) {
      onLayoutChange?.({ titleY, titleWidth, artistY, artistWidth, lyricY, actionX, actionY, actionWidth, actionHeight })
    }
  }, [onLayoutChange])

  const handleLayout = useCallback((key: keyof MusicInfoLayout, event: LayoutChangeEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout
    layoutRef.current[key] = key.endsWith('Y')
      ? y
      : key.endsWith('X')
        ? x
        : key.endsWith('Width')
          ? width
          : height
    emitLayout()
  }, [emitLayout])

  const handleActionLayout = useCallback((event: LayoutChangeEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout
    layoutRef.current.actionX = x
    layoutRef.current.actionY = y
    layoutRef.current.actionWidth = width
    layoutRef.current.actionHeight = height
    emitLayout()
  }, [emitLayout])

  const handleToggleLove = () => {
    if (!playMusicInfo.musicInfo) return
    if (isLove) uncollectMusic()
    else collectMusic()
  }

  return (
    <View style={{ ...styles.container, marginTop: titleGap, width: textWidth }}>
      <View style={styles.titleRow}>
        <View style={styles.textColumn}>
          <SynchronizedMarquee
            id="title"
            controller={marquee}
            active={marqueeActive}
            onLayout={(event) => {
              handleLayout('titleY', event)
              handleLayout('titleWidth', event)
            }}
          >
            <Text color={glassColors.text} style={textStyles.title} numberOfLines={1}>{musicInfo.name}</Text>
          </SynchronizedMarquee>
          <SynchronizedMarquee
            id="artist"
            controller={marquee}
            active={marqueeActive}
            style={styles.artistMask}
            onLayout={(event) => {
              handleLayout('artistY', event)
              handleLayout('artistWidth', event)
            }}
          >
            <Text color={glassColors.muted} style={textStyles.artist}>{musicInfo.singer}</Text>
          </SynchronizedMarquee>
        </View>
        <View style={[actionStyles.actionColumn, { width: actionLayout.width }]} onLayout={handleActionLayout}>
          <TouchableOpacity
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 4 }}
            onPress={handleToggleLove}
            style={actionStyles.loveBtn}
          >
              <LoveIcon filled={isLove} size={BTN_ICON_SIZE} color={isLove ? glassColors.accent : glassColors.muted} />
          </TouchableOpacity>
          <View style={{ width: actionLayout.gapWidth }} />
          <TouchableOpacity
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 4, right: 10 }}
            onPress={() => moreSheetRef.current?.show()}
            style={actionStyles.moreBtn}
          >
            <Icon
              name="dots-vertical"
              size={BTN_ICON_SIZE}
              color={glassColors.muted}
              style={{ transform: [{ translateX: DOTS_VERTICAL_ALIGNMENT_OFFSET }] }}
            />
          </TouchableOpacity>
        </View>
      </View>
      <LyricPreview onLayout={(event) => { handleLayout('lyricY', event) }} />
      <MusicMoreSheet ref={moreSheetRef} />
    </View>
  )
}

// 这两个尺寸常量已经完成屏幕/字号换算，不能再经过 createStyle 二次缩放
const textStyles = StyleSheet.create({
  title: {
    fontSize: FULL_TITLE_FONT_SIZE,
    lineHeight: FULL_TITLE_LINE_HEIGHT,
    includeFontPadding: false,
  },
  artist: {
    fontSize: FULL_ARTIST_FONT_SIZE,
    lineHeight: FULL_ARTIST_LINE_HEIGHT,
    includeFontPadding: false,
  },
})

// 操作列与按钮尺寸常量已经完成屏幕换算，不能再经过 createStyle 二次缩放
const actionStyles = StyleSheet.create({
  actionColumn: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingTop: scaleSizeH(2),
  },
  loveBtn: {
    alignItems: 'center',
    height: BTN_WIDTH,
    justifyContent: 'center',
    width: BTN_WIDTH,
  },
  moreBtn: {
    alignItems: 'center',
    height: BTN_WIDTH,
    justifyContent: 'center',
    width: BTN_WIDTH,
  },
})

const styles = createStyle({
  container: {
    paddingHorizontal: 0,
  },
  titleRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    width: '100%',
  },
  textColumn: {
    flex: 1,
  },
  artistMask: {
    marginTop: 4,
  },
})


