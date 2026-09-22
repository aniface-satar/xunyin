import { memo, useMemo, useRef } from 'react'
import { TouchableOpacity, View } from 'react-native'

import Text from '@/components/common/Text'
import { LoveIcon } from '@/components/common/LoveIcon'
import { Icon } from '@/components/common/Icon'
import Image from '@/components/common/Image'
import { usePlayerMusicInfo, usePlayMusicInfo } from '@/store/player/hook'
import { useIsLove } from '@/store/player/useIsLove'
import { useGlassColors } from '@/utils/hooks/useGlassColors'
import SynchronizedMarquee, { useSynchronizedMarquee } from '@/components/common/SynchronizedMarquee'
import { collectMusic, uncollectMusic } from '@/core/player/player'
import { createStyle } from '@/utils/tools'
import { BTN_ICON_SIZE, BTN_WIDTH, DOTS_VERTICAL_ALIGNMENT_OFFSET } from '../Player/components/MoreBtn/Btn'
import { FULL_COVER_RADIUS, getPlayDetailLayout } from '../layout'
import { useStatusbarHeight } from '@/store/common/hook'
import { useWindowSize } from '@/utils/hooks'
import { HEADER_HEIGHT } from './Header'
import MusicMoreSheet, { type MusicMoreSheetType } from '../Player/components/MusicMoreSheet'

interface MusicSummaryProps {
  marginTop?: number
  coverSize?: number
}

export default memo(({ marginTop = 0, coverSize = 72 }: MusicSummaryProps) => {
  const musicInfo = usePlayerMusicInfo()
  const playMusicInfo = usePlayMusicInfo()
  const glassColors = useGlassColors()
  const isLove = useIsLove()
  const marquee = useSynchronizedMarquee({ lineCount: 2 })
  const { width: winWidth, height: winHeight } = useWindowSize()
  const statusBarHeight = useStatusbarHeight()

  const { contentWidth } = useMemo(() => getPlayDetailLayout(
    winWidth,
    winHeight,
    statusBarHeight + HEADER_HEIGHT,
  ), [statusBarHeight, winHeight, winWidth])

  const handleToggleLove = () => {
    if (!playMusicInfo.musicInfo) return
    if (isLove) uncollectMusic()
    else collectMusic()
  }
  const moreSheetRef = useRef<MusicMoreSheetType>(null)

  return (
    <View style={[styles.container, { marginTop, width: contentWidth }]}>
      <Image
        cache={false}
        url={musicInfo.pic}
        style={{ ...styles.cover, width: coverSize, height: coverSize }}
      />
      <View style={styles.textColumn}>
        <SynchronizedMarquee id="title" controller={marquee}>
          <Text color={glassColors.text} style={styles.title} numberOfLines={1}>{musicInfo.name}</Text>
        </SynchronizedMarquee>
        <SynchronizedMarquee id="artist" controller={marquee} style={styles.artistMask}>
          <Text color={glassColors.muted} style={styles.artist}>{musicInfo.singer}</Text>
        </SynchronizedMarquee>
      </View>
      <View style={styles.actionRow}>
        <TouchableOpacity
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={handleToggleLove}
          style={styles.loveBtn}
        >
          <LoveIcon filled={isLove} size={BTN_ICON_SIZE} color={isLove ? glassColors.accent : glassColors.muted} />
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => {
            moreSheetRef.current?.show()
          }}
          style={styles.moreBtn}
        >
          <Icon
            name="dots-vertical"
            size={BTN_ICON_SIZE}
            color={glassColors.muted}
            style={{ transform: [{ translateX: DOTS_VERTICAL_ALIGNMENT_OFFSET }] }}
          />
        </TouchableOpacity>
      </View>
      <MusicMoreSheet ref={moreSheetRef} />
    </View>
  )
})

const styles = createStyle({
  container: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    flexShrink: 1,
  },
  cover: {
    borderRadius: FULL_COVER_RADIUS,
    height: 72,
    width: 72,
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 16,
  },
  title: {
    fontSize: 20,
    includeFontPadding: false,
    lineHeight: 26,
  },
  artist: {
    fontSize: 15,
    includeFontPadding: false,
    lineHeight: 20,
  },
  artistMask: {
    marginTop: 5,
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
    marginLeft: 2,
    width: BTN_WIDTH,
  },
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
  },
})
