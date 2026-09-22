import { TouchableOpacity, View } from 'react-native'
import { Icon } from '@/components/common/Icon'
import { useGlassColors } from '@/utils/hooks/useGlassColors'
// import { useIsPlay } from '@/store/player/hook'
import { playNext, playPrev, togglePlay } from '@/core/player/player'
import { useIsPlay } from '@/store/player/hook'
import { createStyle } from '@/utils/tools'
import { useCallback, useMemo, useRef } from 'react'
import { scaleSizeH } from '@/utils/pixelRatio'
import { useWindowSize } from '@/utils/hooks'
import { useStatusbarHeight } from '@/store/common/hook'
import { HEADER_HEIGHT } from '@/screens/PlayDetail/Vertical/components/Header'
import { getPlayDetailLayout } from '@/screens/PlayDetail/Vertical/layout'
import Btn, { BTN_WIDTH } from './MoreBtn/Btn'
import PlayModeBtn from './MoreBtn/PlayModeBtn'
import TimeoutExitBtn from './MoreBtn/TimeoutExitBtn'
import CommentBtn from './MoreBtn/CommentBtn'
import PlaylistSheet, { type PlaylistSheetType } from './PlaylistSheet'
import type { PlayerControlLayout, PlayerRect } from '@/components/player/PlayerOverlay'

const MusicListBtn = () => {
  const playlistSheetRef = useRef<PlaylistSheetType>(null)

  const handleShowPlaylist = () => {
    playlistSheetRef.current?.show()
  }

  return (
    <>
      <Btn icon="list-order" onPress={handleShowPlaylist} />
      <PlaylistSheet ref={playlistSheetRef} />
    </>
  )
}

const PrevBtn = ({ size, onLayout }: { size: number, onLayout?: (layout: PlayerRect) => void }) => {
  const glassColors = useGlassColors()
  const btnRef = useRef<View>(null)
  const handleLayout = useCallback(() => {
    btnRef.current?.measureInWindow((x, y, width, height) => {
      onLayout?.({ x, y, width, height })
    })
  }, [onLayout])
  const handlePlayPrev = () => {
    void playPrev()
  }
  return (
    <View ref={btnRef} onLayout={handleLayout} collapsable={false}>
      <TouchableOpacity style={{ ...styles.cotrolBtn, width: size, height: size }} activeOpacity={0.5} onPress={handlePlayPrev}>
        <Icon name='prevMusic' color={glassColors.accent} rawSize={size * 0.7} />
      </TouchableOpacity>
    </View>
  )
}
const NextBtn = ({ size, onLayout }: { size: number, onLayout?: (layout: PlayerRect) => void }) => {
  const glassColors = useGlassColors()
  const btnRef = useRef<View>(null)
  const handleLayout = useCallback(() => {
    btnRef.current?.measureInWindow((x, y, width, height) => {
      onLayout?.({ x, y, width, height })
    })
  }, [onLayout])
  const handlePlayNext = () => {
    void playNext()
  }
  return (
    <View ref={btnRef} onLayout={handleLayout} collapsable={false}>
      <TouchableOpacity style={{ ...styles.cotrolBtn, width: size, height: size }} activeOpacity={0.5} onPress={handlePlayNext}>
        <Icon name='nextMusic' color={glassColors.accent} rawSize={size * 0.7} />
      </TouchableOpacity>
    </View>
  )
}

const TogglePlayBtn = ({ size, onLayout }: { size: number, onLayout?: (layout: PlayerRect) => void }) => {
  const glassColors = useGlassColors()
  const btnRef = useRef<View>(null)
  const handleLayout = useCallback(() => {
    btnRef.current?.measureInWindow((x, y, width, height) => {
      onLayout?.({ x, y, width, height })
    })
  }, [onLayout])
  const isPlay = useIsPlay()
  return (
    <View ref={btnRef} onLayout={handleLayout} collapsable={false}>
      <TouchableOpacity style={{ ...styles.cotrolBtn, width: size, height: size }} activeOpacity={0.5} onPress={togglePlay}>
        <Icon name={isPlay ? 'pause' : 'play'} color={glassColors.accent} rawSize={size * 0.7} />
      </TouchableOpacity>
    </View>
  )
}

const MAX_SIZE = BTN_WIDTH * 1.6
const MIN_SIZE = BTN_WIDTH * 1.2

export default ({ onControlLayout }: {
  onControlLayout?: (layouts: PlayerControlLayout) => void
}) => {
  const winSize = useWindowSize()
  const statusBarHeight = useStatusbarHeight()
  const layoutsRef = useRef<Partial<PlayerControlLayout>>({})
  const emitLayouts = useCallback((key: keyof PlayerControlLayout, layout: PlayerRect) => {
    layoutsRef.current[key] = layout
    if (layoutsRef.current.prev && layoutsRef.current.play && layoutsRef.current.next) {
      onControlLayout?.(layoutsRef.current as PlayerControlLayout)
    }
  }, [onControlLayout])
  const maxHeight = Math.max(winSize.height * 0.11, MIN_SIZE)
  const { contentWidth } = getPlayDetailLayout(
    winSize.width,
    winSize.height,
    statusBarHeight + HEADER_HEIGHT,
  )
  const size = Math.min(Math.max(winSize.width * 0.33 * global.lx.fontSize * 0.4, MIN_SIZE), MAX_SIZE, maxHeight)
  const controlTop = scaleSizeH(22)
  const containerHeight = size + BTN_WIDTH + scaleSizeH(62)
  const containerStyle = useMemo(() => {
    return {
      ...styles.conatiner,
      height: containerHeight,
    }
  }, [containerHeight])

  return (
    <View style={containerStyle}>
      <View style={{ ...styles.controlRow, width: contentWidth, height: size, top: controlTop }}>
        <PrevBtn size={size} onLayout={(layout) => { emitLayouts('prev', layout) }} />
        <TogglePlayBtn size={size} onLayout={(layout) => { emitLayouts('play', layout) }} />
        <NextBtn size={size} onLayout={(layout) => { emitLayouts('next', layout) }} />
      </View>
      <View style={{ ...styles.actionRow, width: contentWidth }}>
        <PlayModeBtn />
        <TimeoutExitBtn />
        <CommentBtn />
        <MusicListBtn />
      </View>
    </View>
  )
}


const styles = createStyle({
  conatiner: {
    alignItems: 'center',
    position: 'relative',
    // backgroundColor: 'rgba(0, 0, 0, .1)',
  },
  cotrolBtn: {
    justifyContent: 'center',
    alignItems: 'center',

    // backgroundColor: '#ccc',
    shadowOpacity: 1,
    textShadowRadius: 1,
  },
  controlRow: {
    position: 'absolute',
    left: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actionRow: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexShrink: 0,
    paddingBottom: 6,
  },
})
