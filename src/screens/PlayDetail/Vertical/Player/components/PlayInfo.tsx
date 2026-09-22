import { memo, useCallback, useRef } from 'react'
import { View, type TextStyle } from 'react-native'

import Progress from '@/components/player/ProgressBar'
import { useProgress } from '@/store/player/hook'
import { useGlassColors } from '@/utils/hooks/useGlassColors'
import { createStyle } from '@/utils/tools'
import { setSpText } from '@/utils/pixelRatio'
import Text from '@/components/common/Text'
import { useBufferProgress } from '@/plugins/player'
import type { PlayerRect } from '@/components/player/PlayerOverlay'

// const FONT_SIZE = 13
export const FULL_PROGRESS_INFO_HEIGHT = Math.ceil(setSpText(15) * 1.2)

const PlayTimeCurrent = ({ timeStr, style }: { timeStr: string, style?: TextStyle }) => {
  const glassColors = useGlassColors()
  // console.log(timeStr)
  return <Text color={glassColors.muted} style={style}>{timeStr}</Text>
}

const PlayTimeMax = memo(({ timeStr, style }: { timeStr: string, style?: TextStyle }) => {
  const glassColors = useGlassColors()
  return <Text color={glassColors.muted} style={style}>{timeStr}</Text>
})

export default ({ onProgressLayout }: { onProgressLayout?: (layout: PlayerRect) => void }) => {
  const { maxPlayTimeStr, nowPlayTimeStr, progress, maxPlayTime } = useProgress()
  const buffered = useBufferProgress()
  const progressRef = useRef<View>(null)

  const handleProgressLayout = useCallback(() => {
    progressRef.current?.measureInWindow((x, y, width, height) => {
      onProgressLayout?.({ x, y, width, height })
    })
  }, [onProgressLayout])

  // console.log('render playInfo')

  return (
    <>
      <View ref={progressRef} style={styles.progress} onLayout={handleProgressLayout} collapsable={false}>
        <Progress progress={progress} duration={maxPlayTime} buffered={buffered} />
      </View>
      <View style={{ ...styles.info, height: FULL_PROGRESS_INFO_HEIGHT }}>
        <PlayTimeCurrent timeStr={nowPlayTimeStr} style={timeStyle} />
        <PlayTimeMax timeStr={maxPlayTimeStr} style={timeStyle} />
      </View>
    </>
  )
}


const styles = createStyle({
  progress: {
    flexGrow: 1,
    flexShrink: 0,
    flexDirection: 'column',
    justifyContent: 'center',
  },
  info: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    // backgroundColor: '#ccc',
  },
})

const timeStyle: TextStyle = {
  height: FULL_PROGRESS_INFO_HEIGHT,
  lineHeight: FULL_PROGRESS_INFO_HEIGHT,
  includeFontPadding: false,
}
