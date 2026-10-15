// 这一层只放纯判断：除了下面这个会被 Node 擦掉的类型 import，本文件不许有任何运行时依赖，
// 这样 `node --test` 才能直接加载它，把这张决策表当单元测试跑。
// `useCoverSurface` 是它唯一的调用方。PlayerOverlay（APK 反编译文件）不许 import 这里，
// 它自己那句 `hasBackdropImage ||` 是冗余判断而不是第二套规则。
import type { CoverSurface } from './surface.ts'

export interface CoverBackdropState {
  enabled: boolean
  picUrl: string | null
  surface: CoverSurface | null
  /** 该不该为这张封面去发一次取色。与 picUrl 分开是必须的：picUrl 要等色到手才交（见下），
   *  拿它当取色的触发条件就是死锁 —— 没色 → picUrl 为 null → 不请求 → 永远没色。 */
  wantsSurface: boolean
}

/** 屏幕上正在铺底的那一支（可能还是上一首歌的）。宽限期内它被原样重新发布，
 *  于是背景层与前景墨色一起停在旧那一支上 —— 见 coverBackdropStore.ts 的头注释。 */
export interface CoverBackdropStale {
  picUrl: string
  surface: CoverSurface
}

/** 唯一可调的观感数字，推导见 spec §4.6-4：原生单次超时 4s，取两次的时间量级；
 *  低于 4s 会把"慢但还活着"的取色判成失败（先淡出再淡入，比一次闪更难看），
 *  高于 15s（ATTEMPT_COOLDOWN_MS）就分不清是宽限期还是冷却重试。 */
export const COVER_BACKDROP_GRACE_MS = 8000

export const resolveCoverBackdrop = (dynamicBg: boolean, hasThemeBgImage: boolean,
  pic: string | null | undefined, surface: CoverSurface | null,
  stale: CoverBackdropStale | null = null, withinGrace = false): CoverBackdropState => {
  // 主题自带背景图优先：hasThemeBgImage 的实参必须是 ActiveTheme 的 theme['bg-image'] 取真值，
  // 那是 PageContent 真正拿去画图的同一个值，不能用 extInfo 里的原始字符串（纯色主题是 ''）。
  const enabled = dynamicBg && !hasThemeBgImage
  // 关掉的瞬间也要交回 null，让屏幕上那一层走退场淡出而不是硬切（spec §4.6-1）。
  if (!enabled) return { enabled, picUrl: null, surface: null, wantsSurface: false }
  // pic 也参加这条：切到没有封面的歌时 enabled 仍为真，只挡 enabled 会让上一张封面的色多刷一帧，
  // 而那一帧模糊封面层已经因为 picUrl 变空而卸载 —— 屏幕上是"整屏纯色闪一下"，
  // 不是验收 ④ 说的"与改动前逐像素一致"。没有封面的歌同理不给宽限期：留着的该是"这张封面还没上色"，
  // 而不是"这一首根本不该有背景层"。
  if (!pic) return { enabled, picUrl: null, surface: null, wantsSurface: false }
  if (surface != null) return { enabled, picUrl: pic, surface, wantsSurface: false }
  // 新歌的色还没到手：宽限期内且手里真的有一支旧层，就把它原样重新发布（底与字同一份、同一次 publish 一起翻）。
  // 留住的是带自己 picUrl 的完整那一支（糊封面 + 底色 + 蒙版），不是把上一首的纯色铺到新一首上，
  // 所以这不是 backdropGate 旧注释担心的"刷一屏旧封面色"。
  // 末句 `stale.picUrl !== pic` 是防御性余量：Task 6 的接线里同一 url 会先被上面的 surface != null 接住，走不到这里。
  if (withinGrace && stale != null && stale.picUrl !== pic) {
    return { enabled, picUrl: stale.picUrl, surface: stale.surface, wantsSurface: true }
  }
  return { enabled, picUrl: null, surface: null, wantsSurface: true }
}
