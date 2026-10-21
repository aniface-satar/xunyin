import { useMemo, type PropsWithChildren } from 'react'

import { useTheme } from '@/store/theme/hook'
import { ThemeContext } from '@/store/theme/state'
import { applyOnCoverTheme } from '@/utils/monet/onCoverTheme'
import { useCoverSurface } from '@/utils/monet/useCoverSurface'

/**
 * 只在"动态背景真的生效"那一棵树里，把主题换成封面导出的那套墨色。
 *
 * 为什么用 context 而不是改组件：播放页的前景有两条来路 —— 直接 `theme['c-*']`（17 个键）
 * 与 useGlassColors（8 个别名，本身也只是读那 8 个键）。换 context 的 value 一次管住整棵子树，
 * 组件一行都不用动；反过来一个个改组件会把 morph 动画那段反编译代码也卷进去。
 *
 * surface 为空时 applyOnCoverTheme 原样返回同一个引用，所以功能关着 = 一次多余的渲染都没有。
 *
 * 墨色刻意与底色同帧翻，不做延迟（试过，实测更差）：这个 provider 挂在 PlayerOverlay 外层、
 * Home 挂载时就翻过一次，展开那一下没有新 publish，延迟不生效，只会让主题的次级灰字压在
 * 正在变深的底上 —— 整段淡入期间都低于 3.0:1。要软化"变色"，只有底色能淡，见 CoverBackdrop。
 *
 * 墨色不再分台：② 两支闸门同值之后全场只有一支白（见 onCoverTheme.BLUR_INK），
 * 翻页那一格只影响背景压暗层，与前景无关，所以这里不读 useCoverStage —— 读了就会让整棵子树白重渲一遍。
 */
export default ({ children }: PropsWithChildren) => {
  const theme = useTheme()
  const { surface } = useCoverSurface()
  const value = useMemo(() => applyOnCoverTheme(theme, surface), [theme, surface])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
