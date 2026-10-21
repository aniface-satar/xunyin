import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { type NativeScrollEvent, type NativeSyntheticEvent, Animated } from 'react-native'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import { type Lines } from 'lrc-file-parser'
import { useGlassColors } from '@/utils/hooks/useGlassColors'
import { formatPlayTime2 } from '@/utils'


export interface PlayLineType {
  updateScrollInfo: (scrollInfo: NativeSyntheticEvent<NativeScrollEvent>['nativeEvent'] | null) => void
  updateLayoutInfo: (listLayoutInfo: { spaceHeight: number, lineHeights: number[] }) => void
  updateLyricLines: (lyricLines: Lines) => void
  setVisible: (visible: boolean) => void
}

const ANIMATION_DURATION = 300

export interface PlayLineProps {
  // When set, anchor the label at ratio × list viewport height and show the time of
  // the line whose center is nearest to the anchor. Without it the legacy formula is used.
  viewportRatio?: number
}

export default forwardRef<PlayLineType, PlayLineProps>(({ viewportRatio }, ref) => {
  const glassColors = useGlassColors()
  const [scrollInfo, setScrollInfo] = useState<NativeSyntheticEvent<NativeScrollEvent>['nativeEvent'] | null>(null)
  const [listLayoutInfo, setListLayoutInfo] = useState<{ spaceHeight: number, lineHeights: number[] }>({ spaceHeight: 0, lineHeights: [] })
  const [lyricLines, setLyricLines] = useState<Lines>([])
  const [visible, setVisible] = useState(false)
  const opsAnim = useRef<Animated.Value>(
    new Animated.Value(0),
  ).current

  const setShow = (visible: boolean) => {
    Animated.timing(opsAnim, {
      toValue: visible ? 1 : 0,
      duration: ANIMATION_DURATION,
      useNativeDriver: true,
    }).start(() => {
      if (!visible) setVisible(false)
    })
  }

  useImperativeHandle(ref, () => ({
    updateScrollInfo(scrollInfo) {
      setScrollInfo(scrollInfo)
    },
    updateLayoutInfo(listLayoutInfo) {
      setListLayoutInfo(listLayoutInfo)
    },
    updateLyricLines(lyricLines) {
      setLyricLines(lyricLines)
    },
    setVisible(visible) {
      if (visible) {
        setVisible(true)
      }
      requestAnimationFrame(() => {
        setShow(visible)
      })
      // setVisible()
    },
  }))

  if (!scrollInfo || !visible) return null
  let targetLineNum = -1
  if (viewportRatio != null) {
    // Line i sits centered on the anchor when contentOffset.y = spaceHeight + sumAbove(i) + h(i)/2 - anchorY.
    const x = scrollInfo.contentOffset.y + scrollInfo.layoutMeasurement.height * viewportRatio - listLayoutInfo.spaceHeight
    let bestDist = Number.MAX_VALUE
    let lineOffset = 0
    for (let line = 0; line < listLayoutInfo.lineHeights.length; line++) {
      const height = listLayoutInfo.lineHeights[line] ?? 0
      const dist = Math.abs(lineOffset + height / 2 - x)
      if (dist < bestDist) {
        bestDist = dist
        targetLineNum = line
      }
      lineOffset += height
    }
  } else {
    // spaceHeight is the visible distance between the lyric list top and the fixed play line.
    const offset = scrollInfo.contentOffset.y + listLayoutInfo.spaceHeight
    let lineOffset = listLayoutInfo.spaceHeight
    for (let line = 0; line < listLayoutInfo.lineHeights.length; line++) {
      lineOffset += listLayoutInfo.lineHeights[line]
      if (lineOffset < offset) continue
      targetLineNum = line
      break
    }
    if (targetLineNum == -1) targetLineNum = listLayoutInfo.lineHeights.length - 1
  }
  const time = lyricLines[targetLineNum]?.time ?? 0
  const timeLabel = formatPlayTime2(time / 1000)
  return (
    <Animated.View style={{
      ...styles.playLine,
      top: viewportRatio != null ? `${viewportRatio * 100}%` : '40%',
      opacity: opsAnim,
    }}>
      <Text style={viewportRatio != null ? styles.labelCentered : styles.label} color={glassColors.text} size={13}>{timeLabel}</Text>
    </Animated.View>
  )
})

const styles = createStyle({
  playLine: {
    position: 'absolute',
    width: '100%',
    left: 0,
    height: 2,
  },
  label: {
    position: 'absolute',
    right: 20,
    bottom: 3,
    flexDirection: 'row',
    alignItems: 'center',
  },
  labelCentered: {
    position: 'absolute',
    right: 20,
    top: -9,
    flexDirection: 'row',
    alignItems: 'center',
  },
})
