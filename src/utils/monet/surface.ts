import { Contrast } from '@material/material-color-utilities/contrast/contrast.js'
import { Hct } from '@material/material-color-utilities/hct/hct.js'
import { blueFromArgb, greenFromArgb, redFromArgb } from '@material/material-color-utilities/utils/color_utils.js'

export const CHROMA_CAP = 36
export const MIN_CONTRAST = 4.5
export const DARK_ANCHOR_TONE = 10
export const LIGHT_ANCHOR_TONE = 96
export const TONE_DRIFT_LIMIT = 8
export const SCRIM_MIN = 0.45
export const SCRIM_MAX = 0.9
const MAX_TONE_STEPS = 8
/** 纹理明度摆幅上限（单边）：超过这个跨度，云纹会盖过"这是同一张封面"的观感 */
export const TEXTURE_TONE_SWING = 26
/** 色域余量：HCT→sRGB 夹色域会把带边缘的 tone 拉回来一点。实测余量 0 时 971,280 例里有 10 例破线（最差 4.495），
 *  留 0.1 之后 0 例破线（最差 4.632），代价只是带宽 29→28。见 spec §7.5。 */
export const BAND_HEADROOM = 0.1

export interface ToneBand {
  lo: number
  hi: number
}

export interface CoverSurface {
  /** 铺底色，同时用作蒙版色：保证前景字色始终落在它这一侧 */
  base: string
  /** 蒙版不透明度：封面越亮/越暗（相对底色）越实，限制封面透出的 tone 漂移 */
  scrimAlpha: number
  /** 纹理层可用的明度带：两端对字色都 >= MIN_CONTRAST + BAND_HEADROOM，且包住 base 本身 */
  band: ToneBand
}

const cssRgb = (argb: number) => `rgb(${redFromArgb(argb)}, ${greenFromArgb(argb)}, ${blueFromArgb(argb)})`

const rgbColorRxp = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/
// CSS 语义是"超过 255 钳到 255"。少了这一步，`300 << 16` 会溢出污染相邻通道，
// 交出去一个看起来正常的暗色，比抛错更难查。
const clampChannel = (value: string) => Math.min(255, Number(value))

export const parseCssColor = (color: string): number | null => {
  const matched = rgbColorRxp.exec(color.trim())
  if (!matched) return null
  return ((255 << 24) | (clampChannel(matched[1]) << 16) | (clampChannel(matched[2]) << 8) | clampChannel(matched[3])) >>> 0
}

// 上游（原生像素与 parseCssColor）保证 alpha=255；非整数或带透明通道就是取色失败。
// 注意 `NaN >>> 0 === 0`：不在这一层挡住，失败会被静默当成"不透明黑"参与配色。
const isUsableArgb = (argb: number) => Number.isInteger(argb) && (argb >>> 24) === 255

// 从底色往两边各走整数 tone 一步，走到"再走一步就破线"、"走出 swing"或"走出 tone 域"为止。
// 底色 tone 是 HCT→sRGB 夹完色域再读回来的小数（实测 96.1149 / 10.0143），带必须落在整数格上：
// 从小数起走，lo 会掉到 -0.99 这种 tone 域外的值，两端也永远差一小截小数，纹理层拿到没法直接用。
// 下界锚在 floor（含底色本身），上界从 ceil 起步，保证带包住底色。
// 上界永远被 tone<=100（纯白）顶死：亮主题的纵深只能从靠字色的那端挖，所以带宽是数学上限，不是手艺差。
export const buildToneBand = (baseArgb: number, fontArgb: number): ToneBand => {
  if (!isUsableArgb(baseArgb) || !isUsableArgb(fontArgb)) return { lo: 0, hi: 0 }
  const fontTone = Hct.fromInt(fontArgb).tone
  const baseTone = Hct.fromInt(baseArgb).tone
  const anchor = Math.floor(baseTone)
  const keeps = (t: number) => Contrast.ratioOfTones(t, fontTone) >= MIN_CONTRAST + BAND_HEADROOM
  let lo = anchor
  while (lo > 0 && anchor - lo < TEXTURE_TONE_SWING && keeps(lo - 1)) lo -= 1
  let hi = Math.min(100, Math.ceil(baseTone))
  while (hi + 1 <= 100 && hi - anchor < TEXTURE_TONE_SWING && keeps(hi + 1)) hi += 1
  return { lo, hi }
}

export const buildCoverSurface = (sourceArgb: number, coverAvgArgb: number, fontArgb: number): CoverSurface | null => {
  if (!isUsableArgb(fontArgb) || !isUsableArgb(sourceArgb) || !isUsableArgb(coverAvgArgb)) return null

  const font = Hct.fromInt(fontArgb)
  const source = Hct.fromInt(sourceArgb)
  const isDark = font.tone > 50
  const chroma = Math.min(source.chroma, CHROMA_CAP)

  let tone = isDark ? DARK_ANCHOR_TONE : LIGHT_ANCHOR_TONE
  for (let i = 0; i < MAX_TONE_STEPS && Contrast.ratioOfTones(tone, font.tone) < MIN_CONTRAST; i++) {
    tone = isDark ? Math.max(0, tone - 4) : Math.min(100, tone + 3)
  }
  const base = Hct.from(source.hue, chroma, tone).toInt() >>> 0
  // HCT→sRGB 夹色域后真正铺出来的底色 tone 才是给用户看的那个值，判断以它为准。
  // 字色 tone 落在 49.9~50.0 且带彩度时（例：Hct.from(0, 20, 49.95)）亮分支最好也只有
  // 纯白的 4.4962。另一侧够得到（tone 0 → 4.6706），但底色跨侧等于把整页从亮翻成黑，
  // 那是看得见的乱来 —— 所以够不到就 null 回落到主题纯色，不跨侧硬凑。
  const baseTone = Hct.fromInt(base).tone
  if (Contrast.ratioOfTones(baseTone, font.tone) < MIN_CONTRAST) return null

  // 合成 ≈ scrim(base, a) 盖在模糊封面(平均色) 上：偏离量 = (1 - a) * |封面 tone - 底色 tone|
  const drift = Math.abs(Hct.fromInt(coverAvgArgb).tone - baseTone)
  let scrimAlpha = drift <= TONE_DRIFT_LIMIT ? SCRIM_MIN : 1 - TONE_DRIFT_LIMIT / drift
  scrimAlpha = Math.min(SCRIM_MAX, Math.max(SCRIM_MIN, scrimAlpha))

  return { base: cssRgb(base), scrimAlpha: Number(scrimAlpha.toFixed(2)), band: buildToneBand(base, fontArgb) }
}
