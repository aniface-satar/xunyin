// 动态背景生效时，播放页那一棵子树的前景色阶。
// 这个文件是纯函数（不许 import react-native，也不许 import 带原生桥的 ./index），
// 所以 `node --test` 能直接拿真主题表 + 真封面夹具把每个角色的对比度跑一遍。
import { Contrast } from '@material/material-color-utilities/contrast/contrast.js'
import { Hct } from '@material/material-color-utilities/hct/hct.js'

import { cssRgb, MIN_CONTRAST, type CoverSurface } from './surface.ts'

/** 主字色：歌名、当前歌词行、面板标题。目标 L*92 而不是纯白 —— 白到 100 会刺，
 *  而留 8 个色阶的余量是给"底色透出一点封面轮廓"用的。 */
export const INK_FONT = { tone: 92, chroma: 18, min: MIN_CONTRAST }
/** 次级字色：时间、说明文字、次要图标。这一档就是用户要的"灰"。 */
export const INK_LABEL = { tone: 77, chroma: 10, min: MIN_CONTRAST }
/** 控件图标：上一首/播放/下一首、选中态。图标笔画细，抗锯齿会吃掉边缘，所以跟文字一样吃 4.5，不放宽到 3.0。 */
export const INK_ACCENT = { tone: 74, chroma: 24, min: MIN_CONTRAST }
/** 强调色：进度条已填充、歌词当前行的那支带封面色相的颜色。 */
export const INK_PRIMARY = { tone: 78, chroma: 24, min: MIN_CONTRAST }
/** 歌词非当前行：大字号、有意压暗（这是全部 17 套主题共有的设计），适用 WCAG 大字号 3.0 这一档。 */
export const INK_LYRIC = { tone: 62, chroma: 8, min: 3.0 }
/** 歌词非当前行的译文：比 lyric 再退一档。 */
export const INK_LYRIC_SOFT = { tone: 56, chroma: 6, min: 3.0 }
/** 面板（卡片/底部表/碟片垫）相对场的明度差。往**暗**走：更深的面既保住白字的余量，
 *  又比"比页面更亮的白板"更像暗色主题里的浮层。 */
export const PANEL_TONE_DROP = 6
export const PANEL_CHROMA_CAP = 10
/** 面板别再暗过这条线，否则跟纯黑主题分不出、也吃不到封面色相。 */
export const PANEL_MIN_TONE = 12
/** 色域余量：闸门判的是"夹完 sRGB 色域之后读回来的实际明度"，不留余量时端点会贴着线走
 *  （实测歌词译文档正好 3.01）。留 0.1 的代价只是每档多走一两格明度。与 BAND_HEADROOM 同理由。 */
export const INK_HEADROOM = 0.1

export type InkRole = typeof INK_FONT | typeof INK_LABEL | typeof INK_ACCENT | typeof INK_PRIMARY
  | typeof INK_LYRIC | typeof INK_LYRIC_SOFT

export interface CoverInk {
  font: number
  fontLabel: number
  accent: number
  primary: number
  lyric: number
  lyricSoft: number
  panel: number
}

const isFiniteTone = (tone: number) => Number.isFinite(tone) && tone >= 0 && tone <= 100

/**
 * 从角色的目标明度出发，朝"远离依托面"的方向逐格走，每格里彩度从大到小退让，
 * 直到"夹完 sRGB 色域之后读回来的实际明度"过这条角色的对比度线。
 *
 * 两个都必须做：HCT 的 tone 是输入值，夹色域后会被拽回来（实测能差 1 个 L*以上），
 * 而彩度越高拽得越狠 —— 所以不能只按目标 tone 算一次就交出去。
 * 退到 chroma 0 就等于中性灰，其对比度与纯白/纯黑同侧同档，所以依托面只要过了
 * buildCoverSurface 那道白字闸门，这里最坏也只是"层次塌成全白"，不会返回失败。
 */
export const pickInkArgb = (hue: number, role: InkRole, chromaCap: number, backingTone: number): number | null => {
  if (!Number.isFinite(hue) || !isFiniteTone(backingTone) || !Number.isFinite(role.tone)) return null
  const away = backingTone <= 50 ? 1 : -1
  const chroma = Math.min(role.chroma, Math.max(0, chromaCap))
  for (let step = 0; step <= 100; step++) {
    const tone = role.tone + away * step
    if (tone < 0 || tone > 100) return null
    // 彩度按 2 一档往下退：同一步明度里先要最 colourful 的那支，退让只是为了过闸
    for (let c = chroma; c >= 0; c -= 2) {
      const argb = Hct.from(hue, c, tone).toInt() >>> 0
      const actual = Hct.fromInt(argb).tone
      if (Contrast.ratioOfTones(actual, backingTone) >= role.min + INK_HEADROOM) return argb
    }
  }
  return null
}

/**
 * 由"用户真正看到的那层场"（CoverSurface.fieldTone）与封面那支颜色导出整套前景。
 * 场算不出来（非法入参）就 null —— 调用方保持主题原样，等于这一帧不上色。
 */
export const buildOnCoverInk = (surface: Pick<CoverSurface, 'fieldTone' | 'tint'>): CoverInk | null => {
  const { fieldTone, tint } = surface
  if (!isFiniteTone(fieldTone) || !Number.isFinite(tint?.hue) || !Number.isFinite(tint?.chroma)) return null
  // 彩度上限跟封面自己有多浓走：灰封面不该长出一支鲜艳的高亮色（那是造色，不是跟色）。
  const chromaCap = Math.max(0, tint.chroma)
  const pick = (role: InkRole) => pickInkArgb(tint.hue, role, chromaCap, fieldTone)
  const font = pick(INK_FONT)
  const fontLabel = pick(INK_LABEL)
  const accent = pick(INK_ACCENT)
  const primary = pick(INK_PRIMARY)
  const lyric = pick(INK_LYRIC)
  const lyricSoft = pick(INK_LYRIC_SOFT)
  const panel = pickInkArgb(tint.hue,
    { tone: Math.max(PANEL_MIN_TONE, fieldTone - PANEL_TONE_DROP), chroma: PANEL_CHROMA_CAP, min: 0 },
    chromaCap, fieldTone)
  if (font == null || fontLabel == null || accent == null || primary == null || lyric == null || lyricSoft == null || panel == null) return null
  return { font, fontLabel, accent, primary, lyric, lyricSoft, panel }
}

/** `useGlassColors.lyricOpacity`：歌词页的非当前行与它的译文，组件自己还要再乘这一档透明度。
 *  这条乘法必须记在这里而不是只记在脑子里 —— 上一版就是按主题色核的对比度，漏掉了组件那层 0.6，
 *  结果亮封面上非当前行的实际值只有 1.88:1。`useGlassColors` 的默认值现在直接 import 这一个常量，
 *  两边不可能再各写一个数。不在这里反向 import 那个 hook：它带 `react` 与主题 store，而这个模块要能被 `node --test` 直接拉起来。 */
export const LYRIC_COMPONENT_OPACITY = 0.6

/** ②那一档的组件透明度，由 `Vertical/Lyric.tsx` 只在封面场是 'blur' 时传给 `useGlassColors`
 *  （① 与普通主题照旧走上面那条 0.6，一个像素都没变）。
 *
 *  2026-10-18 是 0.75、`BLUR_MIN_CONTRAST` 5.0：那天钉的是"非当前行不许破 3.0"（最坏封面 3.39 / 3.20）。
 *  2026-10-19 用户反馈"非当前歌词和当前歌词的颜色区分不明显"，要"加大歌词白色的实度/饱和度/亮度"，
 *  并在四档小样（.scratch/t170_*.png，用真机截图反解重渲染）里选了最强烈的一档 —— 于是 0.75 → 0.50，
 *  歌词那两层在真机截图上的成图落到 L\*67.4 / 64.9（在此之前是 83.4 / 80.9；同一张图的当前行恒 L\*100）。
 *  代价写明：最坏（白底）封面上非当前行 2.52、译文 2.31 —— 低于大字号 3.0 那条线，这两格是用户拍板的交换，
 *  不是漏核。深色封面（多数）上仍在 4 以上（真机那片场上 4.55 / 3.98）。改这里要重跑 .scratch/t166_gap.mts、
 *  t170_final.py 与 t171_ship.mts。 */
export const BLUR_LYRIC_COMPONENT_OPACITY = 0.5

/** ②把"当前行译文"也从主题那支 0.80 收进梯队的一格（有效 α）。
 *  主题给这一格的 alpha 是 `c-primary-alpha-200` = 0.80，它在 ② 里比非当前行那一档（0.49）还亮 ——
 *  用户 2026-10-19 说的"区分不明显"里，它是离当前行最近的那一层：真机截图上是当前行 L\*100、它 L\*90.2、
 *  非当前行 L\*83.4，当前行的最近竞争者其实是它自己这句译文。收到 0.66 之后：100 / 83.2 / 67.4。
 *  ① 与普通主题照旧走主题自己的 0.80，不动。 */
export const BLUR_LYRIC_ACTIVE_TRANSLATION_ALPHA = 0.66

/**
 * ②「动态取色」那一档的整套前景：一支白用到底，不读场、不读色相。
 * 用户 2026-10-17 定稿"控件统一为一个颜色、近乎白、不随背景改变"，2026-10-18 又把这个界面整体调亮；
 * 两条一起成立的结果就是**文字只剩一档**：标题、时间/说明、控件图标、当前行全是实白，
 * 层次改由两处买 —— 歌词那条 alpha 梯队（当前行实白、当前行译文白@0.66、非当前行白@0.98、译文白@0.88，
 * 后两层再乘组件那条 0.50）与面板那层黑纱。
 *
 * 全部读数对着最坏那支 L\*46.0 的场（闸门 5.5 钉住的模型场 43.7~44.3 + 真机峰值那 1.7 个 L\*，
 * 逐张账见 .scratch/t171_ship.mts）：实白 5.17（线 4.5）｜ 当前行译文 0.66 → 3.25 ｜
 * 非当前行有效 0.49 → 2.52 ｜ 译文有效 0.44 → 2.31。该场上当前行 L\*100、当前行译文 L\*82.4、
 * 非当前行 L\*73.7、译文 L\*70.7 —— 当前行与它下面那一层差 17.6 个 L\*（10-18 那一档是 100 / 90.2 / 83.4 / 80.9）。
 *
 * 为什么小字层还是实白（旧值 0.78）：那一格是在闸门 7.0（场 ≤L\*37.8）下才摆得下的阶梯；
 * 场一旦亮到 L\*48~49，0.78 只剩 3.5~3.6，破 4.5（现在的上限 L\*46 上也只有 3.9）。恒白这一档既然不让步，
 * 能动的只有背景。
 * 代价写明：标题与"时间/下一行预告"逐字节同色（上一版特意拆开过），
 * 这一档的层次语言是"白字 + 黑纱面板 + 歌词那条梯队"，不是四级灰。
 * 面板反着走 —— 黑纱：它永远比场暗，白字在它上面只会更安全，同时封面轮廓还能从卡片底下透出来。
 */
export const BLUR_INK: CoverInk = {
  font: 0xFFFFFFFF,
  fontLabel: 0xFFFFFFFF,
  accent: 0xFFFFFFFF,
  primary: 0xFFFFFFFF,
  // 0.98 而不是 1.0：取满的话 c-350 与 c-font 是同一串 rgb(255, 255, 255)，
  // 层次全靠组件那条 opacity 撑着，漏挂一次就退回"当前行与非当前行没区分"那个老症状。
  lyric: ((250 << 24) | 0xFFFFFF) >>> 0, // 0.98 的白：非当前行（再乘组件 0.50 才是屏上那条）
  // 0.88 而不是 0.92：组件落到 0.50 之后，0.98/0.92 那对 ink 在模型场上只差 1.7 个 L\*（真机成图上 1.3），
  // "译文"这一档又并回非当前行那一层 —— 退到 0.88 才有 2.9（真机成图 2.5）的档。
  // 代价落在普通译文行上：暗封面从 L\*66 一线落到 L\*57（对那片场仍有 3.98:1），另外三档不受影响。
  lyricSoft: ((224 << 24) | 0xFFFFFF) >>> 0, // 0.88 的白：译文行
  panel: (82 << 24) >>> 0, // 0.32 的黑纱
}

/** 场上真正该用的墨色：① 由场与封面色相导出，② 恒为那一支不随背景变的白（层次全靠 alpha 摆）。
 *  ② 永远"算得出来"（白阶梯不依赖闸门），所以 null 只会从 ① 那一支来。 */
export const resolveOnCoverInk = (surface: CoverSurface): CoverInk | null => {
  if (surface.mode === 'monet') return buildOnCoverInk(surface)
  return BLUR_INK
}

/** 实心态：直接换成某一支墨色 */
interface SolidRule { kind: 'solid', ink: keyof CoverInk }
/** 透光态：留着主题自己那条 alpha（alpha 命名是反的：alpha-900 = 0.10），只换颜料 */
interface PlateRule { kind: 'plate', ink: keyof CoverInk }
type CoverRule = SolidRule | PlateRule

/**
 * 播放页竖屏子树（PlayDetail/Vertical + PlayDetail/components + PlayerOverlay）与 useGlassColors
 * 实际读到的键，一个一个列在这里。没列出来的键原样穿过 —— 也就是说其他页面、其他组件一律不受影响。
 * 新增组件若开始读某个字色键，要同批把键补进这张表，否则它会拿到主题灰落在深色场上。
 */
const COVER_RULES: Record<string, CoverRule> = {
  'c-font': { kind: 'solid', ink: 'font' },
  'c-primary-font': { kind: 'solid', ink: 'font' },
  'c-font-label': { kind: 'solid', ink: 'fontLabel' },
  'c-button-font': { kind: 'solid', ink: 'accent' },
  'c-button-font-selected': { kind: 'solid', ink: 'accent' },
  'c-primary': { kind: 'solid', ink: 'primary' },
  'c-primary-light-100': { kind: 'solid', ink: 'primary' },
  // 歌词页的非当前行/译文行（useGlassColors 的 lyric / lyricTranslation）
  'c-350': { kind: 'solid', ink: 'lyric' },
  'c-300': { kind: 'solid', ink: 'lyricSoft' },
  // 面：卡片、底部表、碟片垫；PageContent 那层交给铺底色，反正它在背景层底下
  'c-content-background': { kind: 'solid', ink: 'panel' },
  'c-main-background': { kind: 'solid', ink: 'panel' },
  // 碟片垫在主题里是"接近白的 0.8 洗色"，透光会糊出一块亮板，所以也走实心态
  'c-primary-light-900-alpha-200': { kind: 'solid', ink: 'panel' },

  'c-border-background': { kind: 'plate', ink: 'fontLabel' },
  'c-list-header-border-bottom': { kind: 'plate', ink: 'primary' },
  'c-primary-alpha-200': { kind: 'plate', ink: 'primary' },
  // common/Slider.tsx 的 minimum/maximumTrackTintColor，播放器设置里音量/倍速/字号/歌词偏移四条都走它。
  // 漏这一条的症状是"圆点跟封面、槽是主题色"，看着就是两套色。
  'c-primary-alpha-500': { kind: 'plate', ink: 'primary' },
  'c-primary-alpha-900': { kind: 'plate', ink: 'primary' },
  'c-primary-light-100-alpha-400': { kind: 'plate', ink: 'primary' },
  // ProgressBar.tsx 拖拽时"跟手那一段"（非拖拽态的已填充段是上面那条 alpha-400）。
  // 漏这一条的症状是进度条不拖还好、一拖就冒出主题色。
  'c-primary-light-100-alpha-600': { kind: 'plate', ink: 'primary' },
  'c-primary-light-100-alpha-700': { kind: 'plate', ink: 'accent' },
  'c-primary-light-300-alpha-800': { kind: 'plate', ink: 'primary' },
  'c-primary-light-400-alpha-700': { kind: 'plate', ink: 'primary' },
  'c-button-background': { kind: 'plate', ink: 'accent' },
  'c-button-background-hover': { kind: 'plate', ink: 'accent' },
  'c-button-background-selected': { kind: 'plate', ink: 'accent' },
  'c-button-background-active': { kind: 'plate', ink: 'accent' },
  'c-primary-background': { kind: 'plate', ink: 'primary' },
  'c-primary-background-hover': { kind: 'plate', ink: 'primary' },
  'c-primary-background-active': { kind: 'plate', ink: 'primary' },
  'c-primary-input-background': { kind: 'plate', ink: 'primary' },
}

export const COVER_RULE_KEYS = Object.keys(COVER_RULES)
/** 透光那一档的键：只换颜料、保住主题自己那条 alpha。
 *  单独导出是给单测精确分档用的 —— 用"主题值里有没有 alpha"去猜会漏（实心态里也有 rgba(...,1)）。 */
export const COVER_PLATE_KEYS = COVER_RULE_KEYS.filter(key => COVER_RULES[key].kind === 'plate')

const rgbaAlphaRxp = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(\d*\.?\d+)\s*\)/

/**
 * ② 专属的 alpha 覆盖：只改这一个键，且只在封面场是 'blur' 时生效。
 *
 * `c-primary-alpha-200` 在主题里是"当前行译文"那一格（useGlassColors.lyricActiveTranslation）。
 * ① 那一档留着主题的 0.80 是对的 —— 强调色淡一点仍然成档；② 那一档不行：前景只剩白，
 * 0.80 比非当前行（0.98 × 0.50 = 0.49）亮出一大截，当前行的最近竞争者就成了它自己的译文。
 * 收进 0.66：仍在非当前行之上（那是"当前这一句的译文"该有的位置），又与实白拉开 17 个 L\*。
 * 只覆盖 alpha、颜料照旧走规则表（② 是那支白），所以"① 与 ② 的颜料一致"那条用例不受影响。
 */
const BLUR_ALPHA_OVERRIDES: Record<string, number> = {
  'c-primary-alpha-200': BLUR_LYRIC_ACTIVE_TRANSLATION_ALPHA,
}

/** 主题里那条 alpha 阶梯是这个组件自己的层次语言，换色不动它；只有 solid 角色才整个替换。 */
const keepAlpha = (value: string | undefined): number => {
  const matched = value == null ? null : rgbaAlphaRxp.exec(value)
  if (!matched) return 1
  return Math.min(1, Math.max(0, Number(matched[1])))
}

const cssRgba = (argb: number, alpha: number) =>
  alpha >= 1 ? cssRgb(argb) : `rgba(${redOf(argb)}, ${greenOf(argb)}, ${blueOf(argb)}, ${alpha.toFixed(2)})`
/** 实心态的发色：墨色自己那条 alpha 要跟着出去（② 的歌词档与黑纱面板靠它分层）。
 *  不透明时发串跟原来完全一样，所以 ① 那一支逐字节不变。
 *  导出给单测用：② 那条用例要对着 BLUR_INK 常量表核出屏上真正的串，自己抄一份发串逻辑迟早脱拍。 */
export const cssArgb = (argb: number) => cssRgba(argb, (argb >>> 24) / 255)
const redOf = (argb: number) => (argb >> 16) & 0xff
const greenOf = (argb: number) => (argb >> 8) & 0xff
const blueOf = (argb: number) => argb & 0xff

/**
 * 把播放页那一棵子树读到的字色/面色键换成封面导出的那套墨色，其余键原样保留。
 * surface 为空（功能关着 / 主题自带背景图 / 取色没过闸门）就返回同一个 theme 引用，
 * 这样 context 的 value 不变，React 不会白重渲一遍。
 */
export const applyOnCoverTheme = <T extends object>(theme: T, surface: CoverSurface | null): T => {
  if (surface == null) return theme
  const ink = resolveOnCoverInk(surface)
  if (ink == null) return theme
  // ActiveTheme 上除字色串之外还有 isDark / bg-image 这类非字符串键，所以按 unknown 读写、只动字符串键
  const next = Object.assign({}, theme) as Record<string, unknown>
  // 场上恒为深色（墨色恒为白），所以 isDark 一并翻真：
  // components/common/StatusBar.tsx 读的就是 context 里的这个布尔来决定状态栏图标用亮还是暗，
  // 翻它一个就把图标带对了，不需要引入任何 mergeOptions（仓库里此前没有先例）。
  next.isDark = true
  // ② 的歌词台把"当前行译文"那一格收进梯队（见 BLUR_ALPHA_OVERRIDES）；① 不改主题自己那条 alpha。
  const overrides = surface.mode === 'blur' ? BLUR_ALPHA_OVERRIDES : null
  for (const [key, rule] of Object.entries(COVER_RULES)) {
    const current = next[key]
    if (typeof current !== 'string') continue
    const argb = ink[rule.ink]
    next[key] = rule.kind === 'solid' ? cssArgb(argb) : cssRgba(argb, overrides?.[key] ?? keepAlpha(current))
  }
  return next as T
}
