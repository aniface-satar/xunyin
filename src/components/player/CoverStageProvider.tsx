import { createContext, useContext, useMemo, useRef, type PropsWithChildren } from 'react'
import { Animated } from 'react-native'

import type { CoverStage } from '@/utils/monet/surface'

interface CoverStageValue {
  /** 压暗层的位置：0 = 浏览台（亮）、1 = 歌词台（暗）。CoverBackdrop 把它乘进 δ 蒙版的不透明度，
   *  由 PagerView 的 onPageScroll 连续投递（翻页中途也跟手），落定时由 onPageSelected 钉到端值。 */
  dim: Animated.Value
}

/** 没挂 provider 的树拿到的就是"歌词台"：dim 恒 1 —— 与分台之前逐像素一致。
 *  默认值是暗台而不是亮台，这是承重的：接线只发生在一个个显式挂 provider 的地方，
 *  漏掉的树（将来任何新消费者）必须是"没变化"而不是"悄悄亮了一档、证书没核过"。 */
const DEFAULT_DIM = new Animated.Value(1)
const CoverStageContext = createContext<CoverStageValue>({
  dim: DEFAULT_DIM,
})

export const useCoverStage = () => useContext(CoverStageContext)

/** 挂在需要用"分台布光"的那棵树外层：PlayDetail 竖屏树、PlayerOverlay。
 *  initialStage 让"记住上次翻到歌词页"的重开场景第一帧就在正确的台上（否则会闪一帧亮台）。
 *  「在哪一台」这个概念只活在蒙版解算里（surface.ts 的两条闸门 → δ）：前景恒为一支白之后没有第二个读者，
 *  所以这里不再把它做成 state —— 翻页时翻一次 state 会把整棵上了色的子树白重渲一遍。 */
export default ({ children, initialStage = 'browse' }: PropsWithChildren<{ initialStage?: CoverStage }>) => {
  const dim = useRef(new Animated.Value(initialStage === 'lyric' ? 1 : 0)).current
  const value = useMemo(() => ({ dim }), [dim])
  return <CoverStageContext.Provider value={value}>{children}</CoverStageContext.Provider>
}
