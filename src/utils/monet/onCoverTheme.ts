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
  'c-primary-alpha-900': { kind: 'plate', ink: 'primary' },
  'c-primary-light-100-alpha-400': { kind: 'plate', ink: 'primary' },
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

/** 主题里那条 alpha 阶梯是这个组件自己的层次语言，换色不动它；只有 solid 角色才整个替换。 */
const keepAlpha = (value: string | undefined): number => {
  const matched = value == null ? null : rgbaAlphaRxp.exec(value)
  if (!matched) return 1
  return Math.min(1, Math.max(0, Number(matched[1])))
}

const cssRgba = (argb: number, alpha: number) =>
  alpha >= 1 ? cssRgb(argb) : `rgba(${redOf(argb)}, ${greenOf(argb)}, ${blueOf(argb)}, ${alpha.toFixed(2)})`
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
  const ink = buildOnCoverInk(surface)
  if (ink == null) return theme
  // ActiveTheme 上除字色串之外还有 isDark / bg-image 这类非字符串键，所以按 unknown 读写、只动字符串键
  const next = Object.assign({}, theme) as Record<string, unknown>
  // 场上恒为深色（墨色恒为白），所以 isDark 一并翻真：
  // components/common/StatusBar.tsx 读的就是 context 里的这个布尔来决定状态栏图标用亮还是暗，
  // 翻它一个就把图标带对了，不需要引入任何 mergeOptions（仓库里此前没有先例）。
  next.isDark = true
  for (const [key, rule] of Object.entries(COVER_RULES)) {
    const current = next[key]
    if (typeof current !== 'string') continue
    const argb = ink[rule.ink]
    next[key] = rule.kind === 'solid' ? cssRgb(argb) : cssRgba(argb, keepAlpha(current))
  }
  return next as T
}
