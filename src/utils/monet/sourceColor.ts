import { QuantizerCelebi } from '@material/material-color-utilities/quantize/quantizer_celebi.js'
import { Score } from '@material/material-color-utilities/score/score.js'
import { Hct } from '@material/material-color-utilities/hct/hct.js'
import { argbFromRgb } from '@material/material-color-utilities/utils/color_utils.js'

export const QUANTIZE_COLORS = 128

const PALETTE_SEED = 20261014

// mulberry32：小、确定、无依赖。这里只求"同一份像素永远同一个结果"。
const mulberry32 = (a: number) => () => {
  a |= 0
  a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// 改写全局 Math.random 不能靠假设：Hermes/V8 理论上都可写，但用哨兵读回来确认。
// 判成不可写就原样跑 —— 半生效（改了一半、量化读的还是旧的）比不修更糟。
const randomRewritable = (() => {
  const original = Math.random
  try {
    Math.random = () => 0.5
    return Math.random() === 0.5
  } catch {
    return false
  } finally {
    Math.random = original
  }
})()

// 上游 JS 移植版在 quantizer_wsmeans.js:95 用裸 Math.random() 给像素分初始簇，
// 同一份封面实测 50 次出 5 种源色（注释里写的 "reproducible results" 在 JS 版是假的）。
// 量化全程同步，所以窗口里不会漏进别人的随机数。
const withSeededRandom = <T>(fn: () => T): T => {
  if (!randomRewritable) return fn()
  const ambient = Math.random
  const seeded = mulberry32(PALETTE_SEED)
  // 每取一个随机数都先走一遍 ambient、再把它的值丢掉：源色只由 seeded 决定（所以恒定），
  // 但"上游确实读了 Math.random"这件事仍然数得到。省掉这一跳，
  // tests/monet-source-color.mts 的 canary 就只会读到 0 —— 墓碑用例当场变成永假摆设。
  // 副作用是全局随机流每次取色多前进约"不透明像素数"步：仓库里其余 Math.random 用法
  // （歌曲 id、洗牌、抖动）只要散得不重复，不依赖流的连续性，不受影响。
  Math.random = () => {
    ambient()
    return seeded()
  }
  try {
    return fn()
  } finally {
    Math.random = ambient
  }
}

/** 原生像素桥的返回值：一维行主序 + 真实行列数（纹理采样必须知道行宽） */
export interface CoverPixels {
  pixels: number[]
  width: number
  height: number
}

export interface CoverAnalysis {
  /** Monet 源色：色度加权后的"最丰富颜色" */
  source: number
  /** 全图平均色：只用来估整张封面的彩度（洗色有多浓） */
  average: number
  /** 最亮局部块的平均色：蒙版与前景闸门核的是它，不是全图平均色（见 BLOCK_GRID 那条注释） */
  highlight: number
}

/** 分块网格数：blurRadius=90 会把单像素极值抹平，剩下的起伏尺度就是"十六分之一屏宽的那一块"，
 *  所以判"封面透出来多少"要按块均色取最亮块。实测三张夹具的最亮块比全图平均亮 25~41 个 L*，
 *  按平均色算的闸门对亮封面是系统性乐观的（白字 5.59 算过闸、实际 4.29 破线）。 */
export const BLOCK_GRID = 8

const blockHighlightArgb = (pixels: number[], width: number, height: number): number | null => {
  const cellW = width / BLOCK_GRID
  const cellH = height / BLOCK_GRID
  let best: number | null = null
  let bestTone = -Infinity
  for (let by = 0; by < BLOCK_GRID; by++) {
    for (let bx = 0; bx < BLOCK_GRID; bx++) {
      // 行列数不整除时边缘块会窄一点，用四舍五入的整数边界，块间不重叠也不漏采样
      const x0 = Math.round(bx * cellW)
      const x1 = Math.max(x0 + 1, Math.round((bx + 1) * cellW))
      const y0 = Math.round(by * cellH)
      const y1 = Math.max(y0 + 1, Math.round((by + 1) * cellH))
      let sumR = 0
      let sumG = 0
      let sumB = 0
      let count = 0
      for (let y = y0; y < Math.min(y1, height); y++) {
        for (let x = x0; x < Math.min(x1, width); x++) {
          const argb = pixels[y * width + x] >>> 0
          if ((argb >>> 24) < 255) continue
          sumR += (argb >> 16) & 0xff
          sumG += (argb >> 8) & 0xff
          sumB += argb & 0xff
          count += 1
        }
      }
      if (!count) continue
      const argb = argbFromRgb(
        Math.round(sumR / count),
        Math.round(sumG / count),
        Math.round(sumB / count),
      ) >>> 0
      const tone = Hct.fromInt(argb).tone
      if (tone > bestTone) {
        bestTone = tone
        best = argb
      }
    }
  }
  return best
}

export const analyzeArgbPixels = (cover: CoverPixels | null | undefined): CoverAnalysis | null => {
  const pixels = cover?.pixels
  // 入参来自 RN 原生桥，是个真实边界：`!pixels?.length` 会放过 { length: 3 } 这类 array-like，
  // 然后 `for (const pixel of pixels)` 直接抛 TypeError —— 文档承诺的是"非法输入返回 null"，就得真做到。
  if (!Array.isArray(pixels) || pixels.length === 0) return null
  const width = cover!.width
  const height = cover!.height
  // 分块按行主序索引，行宽错了就会跨行取样（出来的"最亮块"是花屏不是亮度），所以不自洽直接判失败。
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return null
  if (pixels.length !== width * height) return null
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

  // 极扁的图（如 32×2 长条，cellH=0.25）里每一块都可能采不到像素，此时回落到平均色：
  // 少了这条回落，null 会一路传到 buildCoverSurface 的 isUsableArgb 守卫，整条取色被判死。
  // 见 tests/monet-source-color.mts 的"空块与回落"用例。
  const highlight = blockHighlightArgb(pixels, width, height) ?? average

  // 实测：Score.score 返回 number[]（不是 Map），且**永远至少给一个**：色度 < 5 的被
  // CUTOFF_CHROMA 全滤掉时（纯灰/近灰封面）它返回内置兜底色 Google Blue 0xFF4285F4，
  // 而不是空数组。灰封面被涂成蓝色是错的，所以用官方 options 把兜底色换成封面平均色。
  const ranked = withSeededRandom(() =>
    Score.score(QuantizerCelebi.quantize(opaque, QUANTIZE_COLORS), { fallbackColorARGB: average }),
  )
  const source = ranked[0] >>> 0

  return { source, average, highlight }
}
