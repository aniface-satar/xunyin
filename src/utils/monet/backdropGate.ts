// 这一层只放纯判断：除了下面这个会被 Node 擦掉的类型 import，本文件不许有任何运行时依赖，
// 这样 `node --test` 才能直接加载它，把这张决策表当单元测试跑。
// `useCoverSurface` 是它唯一的调用方。PlayerOverlay（APK 反编译文件）不许 import 这里，
// 它自己那句 `hasBackdropImage ||` 是冗余判断而不是第二套规则。
import type { CoverSurface } from './surface.ts'

export interface CoverBackdropState {
  enabled: boolean
  picUrl: string | null
  surface: CoverSurface | null
}

export const resolveCoverBackdrop = (dynamicBg: boolean, hasThemeBgImage: boolean,
  pic: string | null | undefined, surface: CoverSurface | null): CoverBackdropState => {
  // 主题自带背景图优先：hasThemeBgImage 的实参必须是 ActiveTheme 的 theme['bg-image'] 取真值，
  // 那是 PageContent 真正拿去画图的同一个值，不能用 extInfo 里的原始字符串（纯色主题是 ''）。
  const enabled = dynamicBg && !hasThemeBgImage
  // pic 也参加这条：切到没有封面的歌时 enabled 仍为真，只挡 enabled 会让上一张封面的色多刷一帧，
  // 而那一帧模糊封面层已经因为 picUrl 变空而卸载 —— 屏幕上是"整屏纯色闪一下"，
  // 不是验收 ④ 说的"与改动前逐像素一致"。
  const active = enabled && !!pic && surface != null
  return {
    enabled,
    picUrl: active ? pic ?? null : null,
    surface: active ? surface : null,
  }
}
