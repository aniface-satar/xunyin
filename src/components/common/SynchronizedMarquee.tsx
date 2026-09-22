import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native'
import { createStyle } from '@/utils/tools'

const DEFAULT_GAP = 32
const DEFAULT_SPEED = 30
const DEFAULT_PAUSE_DURATION = 1000

interface MarqueeLineState {
  overflow: boolean
  loopWidth: number
  animation: Animated.Value
}

interface MarqueeLine extends MarqueeLineState {
  finished: boolean
  animationRef: Animated.CompositeAnimation | null
}

export interface SynchronizedMarqueeController {
  setLine: (id: string, state: MarqueeLineState) => void
  removeLine: (id: string) => void
  destroy: () => void
}

export const useSynchronizedMarquee = ({
  lineCount,
  speed = DEFAULT_SPEED,
  pauseDuration = DEFAULT_PAUSE_DURATION,
}: {
  lineCount: number
  speed?: number
  pauseDuration?: number
}): SynchronizedMarqueeController => {
  return useMemo(() => {
    const lines = new Map<string, MarqueeLine>()
    let cycleId = 0
    let restartRequested = false
    let pauseTimeout: ReturnType<typeof setTimeout> | null = null

    const clearPause = () => {
      if (pauseTimeout == null) return
      clearTimeout(pauseTimeout)
      pauseTimeout = null
    }

    const stopCycle = (reset = true) => {
      cycleId++
      clearPause()
      for (const line of lines.values()) {
        line.animationRef?.stop()
        line.animationRef = null
        line.finished = false
        if (reset) line.animation.setValue(0)
      }
    }

    const allFinished = () => {
      if (!lines.size || lines.size < lineCount) return false
      for (const line of lines.values()) {
        if (!line.finished) return false
      }
      return true
    }

    const startCycle = () => {
      stopCycle()
      if (!lines.size || lines.size < lineCount) return
      const currentCycleId = cycleId

      for (const [id, line] of lines.entries()) {
        if (!line.overflow) {
          line.finished = true
          continue
        }

        const animation = Animated.timing(line.animation, {
          toValue: -line.loopWidth,
          duration: Math.max(1, (line.loopWidth / speed) * 1000),
          easing: Easing.linear,
          useNativeDriver: true,
        })
        line.animationRef = animation
        line.finished = false
        animation.start(({ finished }) => {
          const currentLine = lines.get(id)
          if (!finished || currentCycleId != cycleId || currentLine?.animationRef != animation) return
          currentLine.animationRef = null
          currentLine.finished = true
          // The duplicate copy is aligned with the start position here, so
          // resetting the animation is visually seamless.
          currentLine.animation.setValue(0)
          if (allFinished()) {
            pauseTimeout = setTimeout(() => {
              pauseTimeout = null
              startCycle()
            }, pauseDuration)
          }
        })
      }
    }

    const requestRestart = () => {
      if (restartRequested) return
      restartRequested = true
      requestAnimationFrame(() => {
        restartRequested = false
        startCycle()
      })
    }

    return {
      setLine(id, state) {
        const currentLine = lines.get(id)
        const nextLine: MarqueeLine = {
          ...state,
          finished: false,
          animationRef: currentLine?.animationRef ?? null,
        }
        lines.set(id, nextLine)
        requestRestart()
      },
      removeLine(id) {
        lines.delete(id)
        stopCycle(false)
      },
      destroy() {
        stopCycle(false)
        lines.clear()
      },
    }
  }, [lineCount, pauseDuration, speed])
}

interface MarqueeTextProps {
  id: string
  controller: SynchronizedMarqueeController
  active?: boolean
  gap?: number
  children: ReactNode
  style?: StyleProp<ViewStyle>
  onLayout?: (event: LayoutChangeEvent) => void
}

export default ({ id, controller, active = true, gap = DEFAULT_GAP, children, style, onLayout }: MarqueeTextProps) => {
  const translateX = useRef(new Animated.Value(0)).current
  const [containerWidth, setContainerWidth] = useState(0)
  const [textWidth, setTextWidth] = useState(0)
  const overflow = containerWidth > 0 && textWidth > containerWidth + 1
  const loopWidth = textWidth + gap

  useEffect(() => {
    if (!active) {
      controller.removeLine(id)
      translateX.stopAnimation()
      translateX.setValue(0)
      return
    }
    controller.setLine(id, {
      overflow,
      loopWidth,
      animation: translateX,
    })
    return () => {
      controller.removeLine(id)
    }
  }, [active, controller, id, loopWidth, overflow, translateX])

  useEffect(() => () => {
    controller.destroy()
  }, [controller])

  const handleContainerLayout = (event: LayoutChangeEvent) => {
    setContainerWidth(event.nativeEvent.layout.width)
    onLayout?.(event)
  }

  const handleNaturalLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    setTextWidth(nativeEvent.layout.width)
  }

  const itemStyle = textWidth > 0 ? [styles.item, { width: textWidth }] : styles.item

  return (
    <View style={[styles.mask, style]} onLayout={handleContainerLayout}>
      <Animated.View style={[styles.content, { transform: [{ translateX }] }]}>
        <View collapsable={false} style={itemStyle}>
          {children}
        </View>
        {
          overflow && (
            <>
              <View style={{ width: gap }} />
              <View style={itemStyle}>{children}</View>
            </>
          )
        }
      </Animated.View>
      {/* Unconstrained (huge-width) hidden layer: measures the natural single-line width
          so copies are laid out at the full text width instead of a mask-constrained one. */}
      <View style={styles.measureWrap} pointerEvents="none">
        <View collapsable={false} style={styles.measureContent} onLayout={handleNaturalLayout}>
          {children}
        </View>
      </View>
    </View>
  )
}

const styles = createStyle({
  mask: {
    overflow: 'hidden',
    width: '100%',
  },
  content: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    flexShrink: 0,
  },
  item: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    flexShrink: 0,
  },
  measureWrap: {
    left: 0,
    opacity: 0,
    position: 'absolute',
    top: 0,
    width: 10000,
  },
  measureContent: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    flexShrink: 0,
  },
})

