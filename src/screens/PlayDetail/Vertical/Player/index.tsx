import { memo } from 'react'
import { View } from 'react-native'

// import Title from './components/Title'
import MusicInfo from './components/MusicInfo'
import PlayInfo from './components/PlayInfo'
import ControlBtn from './components/ControlBtn'
import { createStyle } from '@/utils/tools'
import { NAV_SHEAR_NATIVE_IDS } from '@/config/constant'
import { useWindowSize } from '@/utils/hooks'
import { useStatusbarHeight } from '@/store/common/hook'
import { HEADER_HEIGHT } from '@/screens/PlayDetail/Vertical/components/Header'
import { getPlayDetailLayout } from '@/screens/PlayDetail/Vertical/layout'
import type { PlayerControlLayout, PlayerRect } from '@/components/player/PlayerOverlay'


export default memo(({ showMusicInfo = true, onProgressLayout, onControlLayout }: {
  showMusicInfo?: boolean
  onProgressLayout?: (layout: PlayerRect) => void
  onControlLayout?: (layouts: PlayerControlLayout) => void
}) => {
  const { width: winWidth, height: winHeight } = useWindowSize()
  const statusBarHeight = useStatusbarHeight()
  const { contentLeft } = getPlayDetailLayout(
    winWidth,
    winHeight,
    statusBarHeight + HEADER_HEIGHT,
  )

  return (
    <View style={{ ...styles.container, paddingHorizontal: contentLeft }} nativeID={NAV_SHEAR_NATIVE_IDS.playDetail_player}>
      {showMusicInfo ? <MusicInfo /> : null}
      <PlayInfo onProgressLayout={onProgressLayout} />
      <ControlBtn onControlLayout={onControlLayout} />
    </View>
  )
})

const styles = createStyle({
  container: {
    flex: 0,
    width: '100%',
    // paddingTop: progressContentPadding,
    // marginTop: -progressContentPadding,
    // backgroundColor: 'rgba(0, 0, 0, .1)',
    paddingBottom: 15,
    paddingTop: 5,
    // backgroundColor: AppColors.primary,
    // backgroundColor: 'red',
    flexDirection: 'column',
  },
  status: {
    marginTop: 10,
    flexDirection: 'column',
    flex: 0,
    paddingLeft: 5,
    justifyContent: 'space-evenly',
    // backgroundColor: 'rgba(0, 0, 0, .1)',
  },
})
