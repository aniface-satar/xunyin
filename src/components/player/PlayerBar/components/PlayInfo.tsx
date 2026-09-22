import { memo, useCallback, useRef, useState } from 'react'
import { View } from 'react-native'

import Progress, { MINI_PROGRESS_INFO_HEIGHT } from '@/components/player/ProgressBar'
import { useProgress } from '@/store/player/hook'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'
import { COMPONENT_IDS } from '@/config/constant'
import { usePageVisible } from '@/store/common/hook'
import { useBufferProgress } from '@/plugins/player'
import { useSettingValue } from '@/store/setting/hook'
import { useGlassColors } from '@/utils/hooks/useGlassColors'
import type { PlayerRect } from '@/components/player/PlayerOverlay'

const PlayTime = memo(({ timeStr }: { timeStr: string }) => {
  const glassColors = useGlassColors()
  return <Text size={11} color={glassColors.muted} numberOfLines={1} style={styles.time}>{timeStr}</Text>
})

export default ({ isHome, onProgressLayout }: {
  isHome: boolean
  onProgressLayout?: (layout: PlayerRect) => void
}) => {
  const [autoUpdate, setAutoUpdate] = useState(true)
  const { maxPlayTimeStr, nowPlayTimeStr, progress, maxPlayTime } = useProgress(autoUpdate)
  const buffered = useBufferProgress()
  const allowProgressBarSeek = useSettingValue('common.allowProgressBarSeek')
  const playbackRef = useRef<View>(null)

  const handlePlaybackLayout = useCallback(() => {
    playbackRef.current?.measureInWindow((x, y, width, height) => {
      onProgressLayout?.({ x, y, width, height })
    })
  }, [onProgressLayout])

  usePageVisible([COMPONENT_IDS.home], useCallback((visible) => {
    if (isHome) setAutoUpdate(visible)
  }, [isHome]))

  return (
    <View style={styles.container}>
      <View ref={playbackRef} onLayout={handlePlaybackLayout} collapsable={false} pointerEvents={allowProgressBarSeek ? 'auto' : 'none'}>
        <Progress progress={progress} duration={maxPlayTime} buffered={buffered} />
      </View>
      <View style={styles.info}>
        <PlayTime timeStr={nowPlayTimeStr} />
        <PlayTime timeStr={maxPlayTimeStr} />
      </View>
    </View>
  )
}

const styles = createStyle({
  container: {
    paddingHorizontal: 3,
    paddingTop: 2,
  },
  info: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  time: {
    height: MINI_PROGRESS_INFO_HEIGHT,
    flexShrink: 0,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
    lineHeight: MINI_PROGRESS_INFO_HEIGHT,
  },
})
