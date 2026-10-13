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

export interface CoverSurface {
  /** 铺底色，同时用作蒙版色：保证前景字色始终落在它这一侧 */
  base: string
  /** 蒙版不透明度：封面越亮/越暗（相对底色）越实，限制封面透出的 tone 漂移 */
  scrimAlpha: number
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
  // 字色 tone 落在 49.9~50.0 且带彩度时（例：Hct.from(0, 20, 49.95)）两端都够不到 4.5，
  // 此时必须 null 回落到主题纯色，而不是交一个不达标的底色。
  const baseTone = Hct.fromInt(base).tone
  if (Contrast.ratioOfTones(baseTone, font.tone) < MIN_CONTRAST) return null

  // 合成 ≈ scrim(base, a) 盖在模糊封面(平均色) 上：偏离量 = (1 - a) * |封面 tone - 底色 tone|
  const drift = Math.abs(Hct.fromInt(coverAvgArgb).tone - baseTone)
  let scrimAlpha = drift <= TONE_DRIFT_LIMIT ? SCRIM_MIN : 1 - TONE_DRIFT_LIMIT / drift
  scrimAlpha = Math.min(SCRIM_MAX, Math.max(SCRIM_MIN, scrimAlpha))

  return { base: cssRgb(base), scrimAlpha: Number(scrimAlpha.toFixed(2)) }
}
