import { memo, useEffect, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'

import ImageBackground from '@/components/common/ImageBackground'
import { defaultHeaders } from '@/components/common/Image'
import { useCoverSurface } from '@/utils/monet/useCoverSurface'
import type { CoverSurface } from '@/utils/monet/surface'

const BLUR_RADIUS = 90
const FADE_IN_MS = 380
const FADE_OUT_MS = 260

interface Layer {
  /** 层身份就是封面 url：同一张封面的色在 coverPalette 里是同一份引用，不会有两个"同名不同色" */
  key: string
  surface: CoverSurface
}

interface Slot {
  layer: Layer
  show: boolean
}

interface BackdropLayerProps {
  layer: Layer
  show: boolean
  /** 退场淡完（opacity 到 0）：这一支已经看不见，父层可以真的撤掉它 */
  onHide: (key: string) => void
  /** 进场淡到位（opacity 到 1）：这一支已经完整盖住全屏，压在它下面的那些可以开始退场 */
  onRevealed: (key: string) => void
}

/**
 * 一支层的淡入淡出。opacity 走原生驱动；动画跑完才通知父层撤槽，
 * 这样"卸载"永远发生在看不见的时候，不会留下半透明的一屏主题底。
 * 两条通知共用同一条时钟 —— Animated.timing 的完成回调，组件里没有第二个 setTimeout。
 */
const BackdropLayer = memo(({ layer, show, onHide, onRevealed }: BackdropLayerProps) => {
  const anim = useRef(new Animated.Value(0)).current
  const onHideRef = useRef(onHide)
  onHideRef.current = onHide
  const onRevealedRef = useRef(onRevealed)
  onRevealedRef.current = onRevealed

  useEffect(() => {
    if (show) {
      // 淡到 1 的那一帧是"下面那支彻底看不见了"的唯一可靠信号：
      // 早一帧撤就是交叉淡（中间帧露主题底），不撤就是旧层一直堆在栈底。
      Animated.timing(anim, {
        toValue: 1,
        duration: FADE_IN_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) onRevealedRef.current(layer.key)
      })
      return
    }
    Animated.timing(anim, {
      toValue: 0,
      duration: FADE_OUT_MS,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onHideRef.current(layer.key)
    })
  // 只在挂载与 show 翻转时跑；anim 与 layer 在挂载后不变
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])

  const source = useRef({
    uri: layer.key.startsWith('/') ? 'file://' + layer.key : layer.key,
    headers: defaultHeaders,
    cache: 'force-cache' as const,
  }).current

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: anim }]} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: layer.surface.base }]} />
      <ImageBackground style={StyleSheet.absoluteFill} source={source} resizeMode="cover" blurRadius={BLUR_RADIUS} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: layer.surface.base, opacity: layer.surface.scrimAlpha }]} />
    </Animated.View>
  )
})

/**
 * 全屏播控页的封面铺底层。
 *
 * 「闪」的根因不是缺动画，是层在"有/无"两个状态之间硬卸载 —— 改法是先叠后撤：
 * 新层叠在旧层之上淡到 1，淡到位后旧层才走退场（它在下面，退场全程不可见），
 * 所以中间帧不露主题底。两支交叉淡（线性 a=t, b=1-t）会露 25%，不要改成那样。
 *
 * 屏上该铺哪一支由 resolveCoverBackdrop 决定（含 8s 宽限期），这里只负责"它变了就淡过去"，
 * 一点判据都不写在组件里 —— 判据要能 node --test（tests/monet-gate.mts）。
 * 前景墨色读 store 里同一份 surface，底与字在同一次 publish 里一起翻。
 */
export default memo(() => {
  const { picUrl, surface } = useCoverSurface()
  const target: Layer | null = picUrl != null && surface != null ? { key: picUrl, surface } : null
  const [slots, setSlots] = useState<Slot[]>([])

  useEffect(() => {
    setSlots(prev => {
      if (target == null) return prev.map(s => ({ ...s, show: false }))
      if (prev.some(s => s.layer.key === target.key)) {
        return prev.map(s => ({ ...s, show: s.layer.key === target.key }))
      }
      // 新层叠上去；已经在淡出的那些保持淡出，别让一支退了半场的层又亮回来
      return [...prev, { layer: target, show: true }]
    })
  // 触发的是"published 的 picUrl / surface 变了"，不是"发生过一次 publish"：
  // 切歌那一次 store 会把同一支 {picUrl, surface} 原样重投（isSame 还比 wantsSurface，它在宽限分支里翻了），
  // 两个依赖项逐字段相同 → effect 不跑 → 不会白起一次动画。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picUrl, surface])

  const handleHide = (key: string) => {
    setSlots(prev => prev.filter(s => !(s.layer.key === key && !s.show)))
  }

  // spec §4.6-3「到 1 之后才卸载旧层」落地的地方：淡到位的这一支接手让压在它下面的层退场。
  // 比它晚叠上去的那些一律不动 —— 它们是更新的目标，由自己的完成回调负责；
  // 否则快切歌时"先淡完的那支"会把还在淡入的最新一支按回去。
  const handleRevealed = (key: string) => {
    setSlots(prev => {
      const idx = prev.findIndex(s => s.layer.key === key)
      if (idx < 1 || !prev.slice(0, idx).some(s => s.show)) return prev
      return prev.map((s, i) => (i < idx && s.show ? { ...s, show: false } : s))
    })
  }

  if (!slots.length) return null

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {slots.map(s => <BackdropLayer key={s.layer.key} layer={s.layer} show={s.show} onHide={handleHide} onRevealed={handleRevealed} />)}
    </View>
  )
})
