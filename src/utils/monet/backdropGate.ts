// 这一层只放纯判断：这里唯一的 import 是 surface.ts（纯 JS + @material，node --test 加载得了），
// 除此之外不许有任何 react-native 依赖或 @/ 别名 —— 这样 `node --test` 才能直接把这张决策表当单测跑。
// 从 surface.ts 拿的那个是 PROVISIONAL_BLUR_SURFACE 这个常量本身：
// 保守底必须全计划只有一份定义，
// 在这里再手写一份等于给"哪一档铺什么"开出第二个版本（而且 store 的 isSame 按引用比色，造新的就白刷）。
// 调用方只有 `coverBackdropStore`（那里两处 resolveCoverBackdrop）；`useCoverSurface` 只从这里取
// `CoverBackdropState` 那个类型，不调用判据。PlayerOverlay（APK 反编译文件）不许 import 这里，
// 它自己那句 `hasBackdropImage ||` 是冗余判断而不是第二套规则。
import { PROVISIONAL_BLUR_SURFACE, type CoverBackdropMode, type CoverSurface } from './surface.ts'

export interface CoverBackdropState {
  enabled: boolean
  picUrl: string | null
  surface: CoverSurface | null
  /** 该不该为这张封面去发一次取色。与 picUrl 分开是必须的：① 那边 picUrl 要等色到手才交，
   *  拿它当取色的触发条件就是死锁 —— 没色 → picUrl 为 null → 不请求 → 永远没色。
   *  ② 那边 picUrl 会带着保守底先非空，这一格仍要为真（测量色还要换它），所以两者更不是一回事。 */
  wantsSurface: boolean
}

/** 屏幕上正在铺底的那一支（可能还是上一首歌的）。宽限期内它被原样重新发布，
 *  于是背景层与前景墨色一起停在旧那一支上 —— 见 coverBackdropStore.ts 的头注释。 */
export interface CoverBackdropStale {
  picUrl: string
  surface: CoverSurface
}

/** 一支层在组件里的身份。测量支就是那张封面（url）；保守支在同一串后面加 `|p` 与它分开。
 *  分成两个身份是必需而不是风格：保守支先占住 url 那个槽的话，测量色到手时组件看到的还是
 *  "这个 key 已经在栈里"，于是只把一支已经淡完的层重新标记为 show —— 屏幕永远停在灰底上，
 *  一行报错都不会有（spec §10.3 最后一条）。
 *  撞车要另一张封面的 url 正好以 `|p` 结尾且与这一张同前缀；本仓库的封面只有 `http(s)://…`
 *  与本地文件路径两种，都不带裸竖线，所以不做额外转义。 */
export const PROVISIONAL_LAYER_SUFFIX = '|p'

export const coverLayerKey = (picUrl: string, surface: CoverSurface): string =>
  surface.provisional ? `${picUrl}${PROVISIONAL_LAYER_SUFFIX}` : picUrl

/** 唯一可调的观感数字，推导见 spec §4.6-4：原生单次超时 4s，取两次的时间量级；
 *  低于 4s 会把"慢但还活着"的取色判成失败（先淡出再淡入，比一次闪更难看），
 *  高于 15s（ATTEMPT_COOLDOWN_MS）就分不清是宽限期还是冷却重试。 */
export const COVER_BACKDROP_GRACE_MS = 8000

export const resolveCoverBackdrop = (dynamicBg: boolean, hasThemeBgImage: boolean,
  pic: string | null | undefined, surface: CoverSurface | null,
  algo: CoverBackdropMode,
  stale: CoverBackdropStale | null = null, withinGrace = false): CoverBackdropState => {
  // 主题自带背景图优先：hasThemeBgImage 的实参必须是 ActiveTheme 的 theme['bg-image'] 取真值，
  // 那是 PageContent 真正拿去画图的同一个值，不能用 extInfo 里的原始字符串（纯色主题是 ''）。
  const enabled = dynamicBg && !hasThemeBgImage
  // 关掉的瞬间也要交回 null，让屏幕上那一层走退场淡出而不是硬切（spec §4.6-1）。
  if (!enabled) return { enabled, picUrl: null, surface: null, wantsSurface: false }
  // pic 也参加这条：切到没有封面的歌时 enabled 仍为真，只挡 enabled 会让上一张封面的色多刷一帧，
  // 而那一帧模糊封面层已经因为 picUrl 变空而卸载 —— 屏幕上是"整屏纯色闪一下"，
  // 不是验收 ④ 说的"与改动前逐像素一致"。没有封面的歌同理不给宽限期：留着的该是"这张封面还没上色"，
  // 而不是"这一首根本不该有背景层"。② 的保守底也走同一道门 —— 那片深色同样是一层背景。
  if (!pic) return { enabled, picUrl: null, surface: null, wantsSurface: false }
  // "有色了"的判据有三条，缺一条都会静默走错路：
  // mode 必须就是本档（切档走 clearCoverPaletteCache + resetCoverBackdrop，正常路径不会有别档的色；
  // 这条挡的是"设置被别处改了却没 reset"那一类漏 —— 否则 ② 会直接铺着 ① 的染色底）；
  // provisional 必须为假（② 发出去的保守底会作为 held 传回这张表，把它当成"有色"就等于
  // wantsSurface 翻假、测量请求再也不发，屏幕上永远停在一片深色）。
  if (surface != null && !surface.provisional && surface.mode === algo) {
    return { enabled, picUrl: pic, surface, wantsSurface: false }
  }
  // ②「动态取色」（重度模糊封面铺底，spec §10.2"切换加载最短"）：测量还没到手也立刻铺底，
  // 铺的是全遮保守那一支 —— 糊完的最亮块可能接近纯白，白字要对它过闸门，
  // 数学上稳的起点只有全遮（保守底根本没有"照"可透）。
  // 它也压掉下面的宽限期分支：本档有自己那层可发，就不该停在上一首那张照片上（§10.4-4）。
  // 层的身份因此不再等于封面 url，见 CoverBackdrop/index.tsx 的 picUrl + '|p' + mode。
  const provisional = algo === 'blur' ? PROVISIONAL_BLUR_SURFACE : null
  if (provisional != null) {
    return { enabled, picUrl: pic, surface: provisional, wantsSurface: true }
  }
  // 新歌的色还没到手：宽限期内且手里真的有一支旧层，就把它原样重新发布（底与字同一份、同一次 publish 一起翻）。
  // 留住的是带自己 picUrl 的完整那一支（糊封面 + 底色 + 蒙版），不是把上一首的纯色铺到新一首上，
  // 所以这不是 backdropGate 旧注释担心的"刷一屏旧封面色"。
  // 末句 `stale.picUrl !== pic` 是防御性余量：Task 6 的接线里同一 url 会先被上面的 surface != null 接住，走不到这里。
  if (withinGrace && stale != null && stale.picUrl !== pic && stale.surface.mode === algo) {
    return { enabled, picUrl: stale.picUrl, surface: stale.surface, wantsSurface: true }
  }
  return { enabled, picUrl: null, surface: null, wantsSurface: true }
}
