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

export const parseCssColor = (color: string): number | null => {
  const matched = rgbColorRxp.exec(color.trim())
  if (!matched) return null
  return ((255 << 24) | (Number(matched[1]) << 16) | (Number(matched[2]) << 8) | Number(matched[3])) >>> 0
}

export const buildCoverSurface = (sourceArgb: number, coverAvgArgb: number, fontArgb: number): CoverSurface | null => {
  const font = Hct.fromInt(fontArgb >>> 0)
  if (!fontArgb || !Number.isFinite(font.tone)) return null
  const source = Hct.fromInt(sourceArgb >>> 0)
  if (!Number.isFinite(source.tone)) return null

  const isDark = font.tone > 50
  const chroma = Math.min(source.chroma, CHROMA_CAP)

  let tone = isDark ? DARK_ANCHOR_TONE : LIGHT_ANCHOR_TONE
  for (let i = 0; i < MAX_TONE_STEPS && Contrast.ratioOfTones(tone, font.tone) < MIN_CONTRAST; i++) {
    tone = isDark ? Math.max(0, tone - 4) : Math.min(100, tone + 3)
  }
  const base = Hct.from(source.hue, chroma, tone).toInt() >>> 0

  // 合成 ≈ scrim(base, a) 盖在模糊封面(平均色) 上：偏离量 = (1 - a) * |封面 tone - 底色 tone|
  const drift = Math.abs(Hct.fromInt(coverAvgArgb >>> 0).tone - tone)
  let scrimAlpha = drift <= TONE_DRIFT_LIMIT ? SCRIM_MIN : 1 - TONE_DRIFT_LIMIT / drift
  scrimAlpha = Math.min(SCRIM_MAX, Math.max(SCRIM_MIN, scrimAlpha))

  return { base: cssRgb(base), scrimAlpha: Number(scrimAlpha.toFixed(2)) }
}
