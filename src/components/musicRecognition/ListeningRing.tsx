import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing } from 'react-native'

import { BorderWidths } from '@/theme'
import { scaleSizeH, scaleSizeW } from '@/utils/pixelRatio'

const RIPPLE_DURATION = 2200

interface Props {
  /** 每开始一轮采集自增一次；值变了就呼出一圈，所以圈数就是"听了几回" */
  pulse: number
  /** 圆盘的设计尺寸（未换算），涟漪从这个尺寸上长出去 */
  size: number
  color: string
}

/**
 * 聆听涟漪：一轮采集对应一圈，从圆盘边缘扩散到消失。
 * 它只在真正开始听的瞬间动，不像循环动效那样把"正在听"演成"一直在转"。
 */
export default ({ pulse, size, color }: Props) => {
  const value = useRef(new Animated.Value(0)).current
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    let mounted = true
    void AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (mounted) setReducedMotion(enabled)
    })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (pulse == 0 || reducedMotion) return
    value.setValue(0)
    const animation = Animated.timing(value, {
      toValue: 1,
      duration: RIPPLE_DURATION,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    })
    animation.start()
    return () => { animation.stop() }
  }, [pulse, reducedMotion, value])

  if (reducedMotion) return null

  return (
    <Animated.View
      pointerEvents="none"
      style={[{
        position: 'absolute',
        left: 0,
        top: 0,
        width: scaleSizeW(size),
        height: scaleSizeH(size),
        borderRadius: 9999,
        borderWidth: BorderWidths.normal3,
        borderColor: color,
      }, {
        opacity: value.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0.7, 0.7, 0] }),
        transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.32] }) }],
      }]}
    />
  )
}
