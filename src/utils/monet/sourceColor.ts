import { QuantizerCelebi } from '@material/material-color-utilities/quantize/quantizer_celebi.js'
import { Score } from '@material/material-color-utilities/score/score.js'
import { argbFromRgb } from '@material/material-color-utilities/utils/color_utils.js'

export const QUANTIZE_COLORS = 128

/** 原生像素桥的返回值：一维行主序 + 真实行列数（纹理采样必须知道行宽） */
export interface CoverPixels {
  pixels: number[]
  width: number
  height: number
}

export interface CoverAnalysis {
  /** Monet 源色：色度加权后的"最丰富颜色" */
  source: number
  /** 全图平均色：用来估封面透出后的明度漂移 */
  average: number
}

export const analyzeArgbPixels = (pixels: number[]): CoverAnalysis | null => {
  // 入参来自 RN 原生桥，是个真实边界：`!pixels?.length` 会放过 { length: 3 } 这类 array-like，
  // 然后 `for (const pixel of pixels)` 直接抛 TypeError —— 文档承诺的是"非法输入返回 null"，就得真做到。
  if (!Array.isArray(pixels) || pixels.length === 0) return null
  const opaque: number[] = []
  let sumR = 0
  let sumG = 0
  let sumB = 0
  for (const pixel of pixels) {
    const argb = pixel >>> 0
    if ((argb >>> 24) < 255) continue
    opaque.push(argb)
    sumR += (argb >> 16) & 0xff
    sumG += (argb >> 8) & 0xff
    sumB += argb & 0xff
  }
  if (!opaque.length) return null

  const average = argbFromRgb(
    Math.round(sumR / opaque.length),
    Math.round(sumG / opaque.length),
    Math.round(sumB / opaque.length),
  ) >>> 0

  // 实测：Score.score 返回 number[]（不是 Map），且**永远至少给一个**：色度 < 5 的被
  // CUTOFF_CHROMA 全滤掉时（纯灰/近灰封面）它返回内置兜底色 Google Blue 0xFF4285F4，
  // 而不是空数组。灰封面被涂成蓝色是错的，所以用官方 options 把兜底色换成封面平均色。
  const ranked = Score.score(QuantizerCelebi.quantize(opaque, QUANTIZE_COLORS), { fallbackColorARGB: average })
  const source = ranked[0] >>> 0

  return { source, average }
}
