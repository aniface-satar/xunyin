import { useMemo, useState, useEffect } from 'react'
import { View } from 'react-native'

import { createStyle } from '@/utils/tools'
import { useWindowSize } from '@/utils/hooks'
import { usePlayerMusicInfo } from '@/store/player/hook'
import { NAV_SHEAR_NATIVE_IDS } from '@/config/constant'
import { HEADER_HEIGHT } from './components/Header'
import { FULL_COVER_RADIUS, getPlayDetailLayout } from './layout'
import MusicInfo, { type MusicInfoLayout } from './Player/components/MusicInfo'
import Image from '@/components/common/Image'
import { useStatusbarHeight } from '@/store/common/hook'
import { BorderWidths } from '@/theme'
import { useTheme } from '@/store/theme/hook'


export default ({
  onMusicInfoLayout,
  marqueeActive = true,
}: {
  onMusicInfoLayout?: (layout: MusicInfoLayout) => void
  marqueeActive?: boolean
} = {}) => {
  const musicInfo = usePlayerMusicInfo()
  const theme = useTheme()
  const { width: winWidth, height: winHeight } = useWindowSize()
  const statusBarHeight = useStatusbarHeight()
  const [pic, setPic] = useState(musicInfo.pic)

  useEffect(() => {
    setPic(musicInfo.pic)
  }, [musicInfo.pic])

  const { coverSize, coverGap } = useMemo(() => getPlayDetailLayout(
    winWidth,
    winHeight,
    statusBarHeight + HEADER_HEIGHT,
  ), [statusBarHeight, winHeight, winWidth])

  return (
    <View style={styles.container}>
      <View
        style={{
          ...styles.content,
          marginTop: coverGap,
          backgroundColor: theme['c-content-background'],
        }}
      >
        <Image
          url={pic}
          nativeID={NAV_SHEAR_NATIVE_IDS.playDetail_pic}
          style={{
            width: coverSize,
            height: coverSize,
            borderRadius: FULL_COVER_RADIUS,
            borderWidth: BorderWidths.normal,
            borderColor: theme['c-border-background'],
          }}
        />
      </View>
      <MusicInfo onLayoutChange={onMusicInfoLayout} marqueeActive={marqueeActive} />
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  content: {
    backgroundColor: 'rgba(0,0,0,0)',
    borderRadius: FULL_COVER_RADIUS,
    elevation: 18,
    shadowColor: '#000',
    shadowOpacity: 0.34,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 18,
  },
})

