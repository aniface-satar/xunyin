import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, View } from 'react-native'

import { BorderWidths } from '@/theme'
import { scaleSizeH, scaleSizeW } from '@/utils/pixelRatio'
import { createStyle } from '@/utils/tools'

// 三圈：一圈看不出「在扩散」，四圈起盘内挤成一团同心圆。
const RIPPLE_COUNT = 3
// 一圈从圆心涨到盘边的时间。比盘外那圈涟漪（2.2s）慢一点：盘外那圈说的是「这一轮听完了」，
// 盘内这几圈说的是「还在听」，慢一些才不会像在抢拍。
const RIPPLE_DURATION = 2600
// 相邻两圈的出发间隔 = 一圈时长 / 圈数，三圈首尾相接：不会挤成一团，也不会中间空一拍。
const RIPPLE_DELAY = RIPPLE_DURATION / RIPPLE_COUNT
// 起点不从 0 起：0 的时候整圈缩成一个点，描边会在圆心抖一下。
const MIN_SCALE = 0.2
// 波纹收在圆盘描边内侧，别叠到那圈边上。
const RIPPLE_INSET = 8

interface Props {
  /** 圆盘的设计尺寸（未换算），与 RecognizePanel 的 DISC_SIZE 同一个数 */
  size: number
  /** 波纹颜色。用主色的半透明档，叠在淡底盘面上才不会糊 */
  color: string
}

/**
 * 盘内同心波纹：一圈圈从圆心推到盘边，顶掉原来「按下就把盘面涂成主色」的实心反馈。
 * 和 ListeningRing 分工：那个在盘外、一轮一圈，回答「听了第几回」；
 * 这个在盘内、持续扩散，回答「正在听」。
 * 只在聆听期间挂载 —— 卸载即停，所以没有「按了停止还在扩」的中间态。
 */
export default ({ size, color }: Props) => {
  const values = useRef(Array.from({ length: RIPPLE_COUNT }, () => new Animated.Value(0))).current
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    let mounted = true
    void AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (mounted) setReducedMotion(enabled)
    })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (reducedMotion) return
    // 每圈一条循环，出发时间用 delay 错开。delay 放在 loop 外面：放进 sequence 里的话
    // 每跑完一圈都要再空一拍，三圈就变成轮流闪，而不是一圈追着一圈。
    const animations = values.map((value, index) => Animated.sequence([
      Animated.delay(index * RIPPLE_DELAY),
      Animated.loop(
        Animated.timing(value, {
          toValue: 1,
          duration: RIPPLE_DURATION,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ),
    ]))
    for (const animation of animations) animation.start()
    return () => {
      for (const animation of animations) animation.stop()
    }
  }, [reducedMotion, values])

  // 关掉动效的人不该连「已经开始听」都看不出来：那一层由圆盘描边、状态文案和停止按钮顶着，
  // 这里只把会动的部分去掉。
  if (reducedMotion) return null

  const innerSize = size - RIPPLE_INSET * 2
  const width = scaleSizeW(innerSize)
  const height = scaleSizeH(innerSize)

  return (
    <View style={styles.container} pointerEvents="none">
      {
        values.map((value, index) => (
          <Animated.View
            key={index}
            style={[styles.ripple, {
              width,
              height,
              marginLeft: -width / 2,
              marginTop: -height / 2,
              borderColor: color,
              // 刚出圆心时最亮，越往外越淡 —— 一圈的「寿命」就看这条曲线。
              opacity: value.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] }),
              transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [MIN_SCALE, 1] }) }],
            }]}
          />
        ))
      }
    </View>
  )
}

const styles = createStyle({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  ripple: {
    position: 'absolute',
    // 圆心对齐盘心，再靠负 margin 把自身拉回中心：不依赖 flex 对齐，缩放才不会跑偏。
    left: '50%',
    top: '50%',
    borderRadius: 9999,
    borderWidth: BorderWidths.normal3,
  },
})
