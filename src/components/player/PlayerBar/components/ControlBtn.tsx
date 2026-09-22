import { TouchableOpacity, View } from 'react-native'
import { Icon } from '@/components/common/Icon'
import { useIsPlay } from '@/store/player/hook'
import { playNext, playPrev, togglePlay } from '@/core/player/player'
import { createStyle } from '@/utils/tools'
import { useCallback, useRef } from 'react'
import type { PlayerControlLayout, PlayerRect } from '@/components/player/PlayerOverlay'
import { useGlassColors } from '@/utils/hooks/useGlassColors'

const BTN_SIZE = 22
const handlePlayPrev = () => {
  void playPrev()
}
const handlePlayNext = () => {
  void playNext()
}

const PlayPrevBtn = ({ onLayout }: { onLayout?: (layout: PlayerRect) => void }) => {
  const glassColors = useGlassColors()
  const btnRef = useRef<View>(null)
  const handleLayout = useCallback(() => {
    btnRef.current?.measureInWindow((x, y, width, height) => {
      onLayout?.({ x, y, width, height })
    })
  }, [onLayout])

  return (
    <View ref={btnRef} onLayout={handleLayout} collapsable={false}>
      <TouchableOpacity style={styles.controlBtn} activeOpacity={0.5} onPress={handlePlayPrev} accessibilityRole="button" accessibilityLabel="上一首">
        <Icon name='prevMusic' color={glassColors.accent} size={BTN_SIZE} />
      </TouchableOpacity>
    </View>
  )
}

const PlayNextBtn = ({ onLayout }: { onLayout?: (layout: PlayerRect) => void }) => {
  const glassColors = useGlassColors()
  const btnRef = useRef<View>(null)
  const handleLayout = useCallback(() => {
    btnRef.current?.measureInWindow((x, y, width, height) => {
      onLayout?.({ x, y, width, height })
    })
  }, [onLayout])

  return (
    <View ref={btnRef} onLayout={handleLayout} collapsable={false}>
      <TouchableOpacity style={styles.controlBtn} activeOpacity={0.5} onPress={handlePlayNext} accessibilityRole="button" accessibilityLabel="下一首">
        <Icon name='nextMusic' color={glassColors.accent} size={BTN_SIZE} />
      </TouchableOpacity>
    </View>
  )
}

const TogglePlayBtn = ({ onLayout }: { onLayout?: (layout: PlayerRect) => void }) => {
  const isPlay = useIsPlay()
  const glassColors = useGlassColors()
  const btnRef = useRef<View>(null)
  const handleLayout = useCallback(() => {
    btnRef.current?.measureInWindow((x, y, width, height) => {
      onLayout?.({ x, y, width, height })
    })
  }, [onLayout])

  return (
    <View ref={btnRef} onLayout={handleLayout} collapsable={false}>
      <TouchableOpacity style={styles.controlBtn} activeOpacity={0.5} onPress={togglePlay} accessibilityRole="button" accessibilityLabel={global.i18n.t(isPlay ? 'pause' : 'play')}>
        <Icon name={isPlay ? 'pause' : 'play'} color={glassColors.accent} size={28} />
      </TouchableOpacity>
    </View>
  )
}

export default ({ onControlLayout }: { onControlLayout?: (layouts: PlayerControlLayout) => void }) => {
  const layoutsRef = useRef<Partial<PlayerControlLayout>>({})
  const emitLayouts = useCallback((key: keyof PlayerControlLayout, layout: PlayerRect) => {
    layoutsRef.current[key] = layout
    if (layoutsRef.current.prev && layoutsRef.current.play && layoutsRef.current.next) {
      onControlLayout?.({
        prev: layoutsRef.current.prev,
        play: layoutsRef.current.play,
        next: layoutsRef.current.next,
      })
    }
  }, [onControlLayout])

  return (
    <>
      <PlayPrevBtn onLayout={(layout) => { emitLayouts('prev', layout) }} />
      <TogglePlayBtn onLayout={(layout) => { emitLayouts('play', layout) }} />
      <PlayNextBtn onLayout={(layout) => { emitLayouts('next', layout) }} />
    </>
  )
}


const styles = createStyle({
  controlBtn: {
    width: 44,
    height: 46,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',

  },
})
