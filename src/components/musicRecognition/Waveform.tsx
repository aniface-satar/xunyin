import { useEffect, useRef } from 'react'
import { Animated, Easing, View } from 'react-native'
import { createStyle } from '@/utils/tools'
import { scaleSizeH, scaleSizeW } from '@/utils/pixelRatio'

const IDLE_PATTERN = [0.32, 0.68, 0.44, 0.95, 0.56, 0.8, 0.38, 0.62, 0.5]
const KEYFRAME = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]

interface Props {
  active?: boolean
  bars?: number
  /** 最高一根条的基础高度，未激活时按 IDLE_PATTERN 比例取静态高度 */
  height?: number
  barWidth?: number
  gap?: number
  color: string
}

/**
 * 识曲声纹。未激活时是一排静止的声波（入口卡片用），激活后变成沿索引相位推进的行波（识别中用）。
 */
export default ({ active = false, bars = 9, height = 28, barWidth = 3, gap = 3, color }: Props) => {
  const progress = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!active) {
      progress.setValue(0)
      return
    }
    const animation = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    )
    animation.start()
    return () => {
      animation.stop()
    }
  }, [active, progress])

  const maxHeight = scaleSizeH(height)
  const minHeight = scaleSizeH(4)
  const items = []
  for (let i = 0; i < bars; i++) {
    const barStyle = [styles.bar, { width: scaleSizeW(barWidth), backgroundColor: color }]
    if (active) {
      // 一个完整正弦周期铺在环形进度上，首尾取值相同，循环处不会跳一下
      const outputRange = KEYFRAME.map(t => {
        const wave = 0.5 + 0.5 * Math.sin(2 * Math.PI * (t + i / bars))
        return minHeight + (maxHeight - minHeight) * wave
      })
      items.push(
        <Animated.View
          key={`bar-${i}`}
          style={[...barStyle, { height: progress.interpolate({ inputRange: KEYFRAME, outputRange }) }]}
        />,
      )
    } else {
      items.push(
        <View
          key={`bar-${i}`}
          style={[...barStyle, { height: minHeight + (maxHeight - minHeight) * IDLE_PATTERN[i % IDLE_PATTERN.length] }]}
        />,
      )
    }
  }

  return (
    <View style={[styles.container, { columnGap: scaleSizeW(gap) }]}>{items}</View>
  )
}

const styles = createStyle({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bar: {
    borderRadius: 2,
  },
})
