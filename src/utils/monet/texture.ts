import { Hct } from '@material/material-color-utilities/hct/hct.js'
import { argbFromLstar, blueFromArgb, greenFromArgb, linearized, lstarFromY, redFromArgb } from '@material/material-color-utilities/utils/color_utils.js'

import { encodePngDataUri } from './png.ts'
import type { CoverPixels } from './sourceColor.ts'
import { CHROMA_CAP, type ToneBand } from './surface.ts'

/** 纹理竖边固定 294 texel，横边按屏幕宽高比折算：纹样尺度要跟着屏幕走，不能两张屏幕用同一张位图 */
export const TEXTURE_OUT_HEIGHT = 294
export const TEXTURE_OUT_WIDTH_MIN = 40
export const TEXTURE_OUT_WIDTH_MAX = 200
/** Hermes 上单遍全量要 300~450ms（V8 实测 87ms，Hermes 慢 3~5 倍），会把 morph 动画挤掉帧，所以按行分块让路 */
export const TEXTURE_ROWS_PER_CHUNK = 8
export const TEXTURE_SEED = 20261014
/** 云团尺度：参照图实测自相关长度 ≈ 屏宽 7%，折到这张位图上是约 7 个周期 */
export const MARBLE_FREQ = 7
/** domain-warp 强度：再大形状就散成噪声，再小就只是糊掉的封面 */
export const WARP_STRENGTH = 0.12
/** 封面结构 vs 抽象云纹的混合权重（小样 A：结构为主，换封面要看得出换了） */
export const COVER_WEIGHT = 0.45
/** 彩度下限比例：越亮的 texel 越淡（参照图里越暗的云团越饱和） */
export const CHROMA_FLOOR = 0.35
/** 箱形模糊半径（在 128 网格上）≈ 屏幕 40dp：只留最大的几块明暗团 */
export const COVER_BLUR_RADIUS = 4
/** 封面明度 p5~p95 跨度达到这么多个 L* 才让结构项吃满权重；暗角/底噪类平封面只有 0.3~1.5 */
export const COVER_SPAN_REF = 12
/** 纯 sRGB 灰在 HCT 里也读出 1.9~2.9 的彩度（#808080 1.896、#ffffff 2.869）。按这个彩度回 Hct.from 会染色：
 *  比灰本身少要彩度偏暖（tone 95 → 243,240,239），tone 99.2 附近求解器偏青（247,254,255）。低于此值一律按纯灰出 */
export const NEUTRAL_CHROMA = 4
const OCTAVES = 6
const FREQ_STEP = 2.03

export interface TextureRequest {
  source: CoverPixels
  /** 来自 buildCoverSurface.band：带内任一端对字色都 >= MIN_CONTRAST */
  band: ToneBand
  outWidth: number
  outHeight: number
}

export const textureWidthFor = (screenWidth: number, screenHeight: number) =>
  Math.max(TEXTURE_OUT_WIDTH_MIN, Math.min(TEXTURE_OUT_WIDTH_MAX, Math.round(TEXTURE_OUT_HEIGHT * screenWidth / screenHeight)))

const smoothStep = (t: number) => t * t * (3 - 2 * t)

const hash2 = (x: number, y: number, seed: number) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

const valueNoise = (x: number, y: number, seed: number) => {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = smoothStep(x - xi)
  const yf = smoothStep(y - yi)
  const a = hash2(xi, yi, seed)
  const b = hash2(xi + 1, yi, seed)
  const c = hash2(xi, yi + 1, seed)
  const d = hash2(xi + 1, yi + 1, seed)
  return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf
}

const fbm = (x: number, y: number, seed: number) => {
  let sum = 0
  let amp = 0.5
  let norm = 0
  let fx = x
  let fy = y
  for (let i = 0; i < OCTAVES; i++) {
    sum += amp * valueNoise(fx, fy, seed + i * 977)
    norm += amp
    amp *= 0.5
    fx *= FREQ_STEP
    fy *= FREQ_STEP
  }
  return sum / norm
}

// 秩归一：把值换成它在这个场里的百分位。不做这一步，映到色阶带时会被封面自身的高光/暗部比例压扁，
// 实测结构对比只剩参照图的一半。divisor 取 max(1, n-1)：1×1 封面会在这里除 0，NaN 一旦进 Hct 就是整屏花。
const buildRank = (values: Float32Array) => {
  const sorted = Float32Array.from(values).sort()
  const divisor = Math.max(1, sorted.length - 1)
  return (v: number) => {
    let lo = 0
    let hi = sorted.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid] < v) lo = mid + 1
      else hi = mid
    }
    return lo / divisor
  }
}

// 秩归一只认先后不认差距：暗角封面整张只差 1.5 个色阶，也会被拉满整条带。按封面自己的 p5~p95 明度跨度
// 给结构项打折，平封面退回纯云纹；真实封面跨度远大于参考值（实测那张 70），不受影响。
const coverContrastOf = (tones: Float32Array) => {
  const sorted = Float32Array.from(tones).sort()
  const last = sorted.length - 1
  const spread = sorted[Math.floor(last * 0.95)] - sorted[Math.floor(last * 0.05)]
  return Math.min(1, spread / COVER_SPAN_REF)
}

interface BlurredCover {
  r: Float32Array
  g: Float32Array
  b: Float32Array
}

// 糊完不取整：封面若几乎是平的（暗角、底噪），取整后只剩两三个离散值，秩归一会把每道取整台阶放大成整条带宽的硬边和白点
const boxBlur = (src: readonly number[], w: number, h: number, radius: number): BlurredCover => {
  const out = { r: new Float32Array(w * h), g: new Float32Array(w * h), b: new Float32Array(w * h) }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sr = 0
      let sg = 0
      let sb = 0
      let n = 0
      for (let dy = -radius; dy <= radius; dy++) {
        const row = Math.min(h - 1, Math.max(0, y + dy)) * w
        for (let dx = -radius; dx <= radius; dx++) {
          const p = (src[row + Math.min(w - 1, Math.max(0, x + dx))] >>> 0)
          sr += (p >> 16) & 255
          sg += (p >> 8) & 255
          sb += p & 255
          n += 1
        }
      }
      out.r[y * w + x] = sr / n
      out.g[y * w + x] = sg / n
      out.b[y * w + x] = sb / n
    }
  }
  return out
}

// HCT 的 tone 就是 L*，直接从浮点 RGB 算，免得为了过 Hct.fromInt 再取整一次
const toneOf = (r: number, g: number, b: number) =>
  lstarFromY(0.2126 * linearized(r) + 0.7152 * linearized(g) + 0.0722 * linearized(b))

const makeCoverSampler = (blurred: BlurredCover, w: number, h: number) => {
  const lastX = w - 1
  const lastY = h - 1
  return (u: number, v: number) => {
    const x = Math.min(lastX, Math.max(0, u * lastX))
    const y = Math.min(lastY, Math.max(0, v * lastY))
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const x1 = Math.min(x0 + 1, lastX)
    const y1 = Math.min(y0 + 1, lastY)
    const fx = x - x0
    const fy = y - y0
    const mix = (c: Float32Array) =>
      (c[y0 * w + x0] * (1 - fx) + c[y0 * w + x1] * fx) * (1 - fy) + (c[y1 * w + x0] * (1 - fx) + c[y1 * w + x1] * fx) * fy
    const r = mix(blurred.r)
    const g = mix(blurred.g)
    const b = mix(blurred.b)
    // 色相与彩度对 1 级 RGB 不敏感，照旧走整数 HCT；明度要连续，单独算
    const hct = Hct.fromInt(((255 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)) >>> 0)
    return { tone: toneOf(r, g, b), hue: hct.hue, chroma: hct.chroma }
  }
}

/**
 * 纹理核心：封面结构 + 抽象云纹 → 合法色阶带里的 RGBA。
 * `yieldRows` 每 TEXTURE_ROWS_PER_CHUNK 行调一次；单测不传（结果必须与分块无关）。
 */
export const buildTextureRgba = async(request: TextureRequest, yieldRows?: () => Promise<void>): Promise<Uint8Array> => {
  const { source, band, outWidth, outHeight } = request
  const count = outWidth * outHeight
  const blurred = boxBlur(source.pixels, source.width, source.height, COVER_BLUR_RADIUS)
  const sampleCover = makeCoverSampler(blurred, source.width, source.height)

  // 秩建在"真正被采样的那个场"（糊过的封面）上。小样建在原始场上，
  // 而模糊会把 tone 往均值收，用原始百分位映带就吃不满合法摆幅。
  const fieldTones = new Float32Array(blurred.r.length)
  for (let i = 0; i < fieldTones.length; i++) fieldTones[i] = toneOf(blurred.r[i], blurred.g[i], blurred.b[i])
  const coverRank = buildRank(fieldTones)
  const coverContrast = coverContrastOf(fieldTones)

  const coverRankField = new Float32Array(count)
  const coverHue = new Float32Array(count)
  const coverChroma = new Float32Array(count)
  const marbleRaw = new Float32Array(count)

  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const cx = (x + 0.5) / outWidth
      const cy = (y + 0.5) / outHeight
      // 两路独立 fBm 只用来搅采样坐标（domain warp），第三路才是抽象云纹本体
      const w1 = fbm(cx * MARBLE_FREQ + 3.1, cy * MARBLE_FREQ + 7.7, TEXTURE_SEED) - 0.5
      const w2 = fbm(cx * MARBLE_FREQ + 11.3, cy * MARBLE_FREQ + 2.9, TEXTURE_SEED + 31) - 0.5
      const s = sampleCover(cx + WARP_STRENGTH * w1, cy + WARP_STRENGTH * w2)
      const i = y * outWidth + x
      coverRankField[i] = 0.5 + coverContrast * (coverRank(s.tone) - 0.5)
      coverHue[i] = s.hue
      coverChroma[i] = Math.min(s.chroma, CHROMA_CAP)
      marbleRaw[i] = fbm(cx * MARBLE_FREQ + 5.3, cy * MARBLE_FREQ + 9.1, TEXTURE_SEED + 707)
    }
    if (yieldRows != null && (y + 1) % TEXTURE_ROWS_PER_CHUNK === 0) await yieldRows()
  }

  const marbleRank = buildRank(marbleRaw)
  const mixField = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    mixField[i] = COVER_WEIGHT * coverRankField[i] + (1 - COVER_WEIGHT) * marbleRank(marbleRaw[i])
  }
  // 混合值本身再归一一次：两个均匀百分位场一平均就往中间挤，实测带宽从 29 个色阶塌到 17
  const mixRank = buildRank(mixField)

  const rgba = new Uint8Array(count * 4)
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const i = y * outWidth + x
      const n = mixRank(mixField[i])
      const tone = band.lo + n * (band.hi - band.lo)
      const chroma = coverChroma[i] * (CHROMA_FLOOR + (1 - CHROMA_FLOOR) * (1 - n))
      const argb = coverChroma[i] < NEUTRAL_CHROMA ? argbFromLstar(tone) >>> 0 : Hct.from(coverHue[i], chroma, tone).toInt() >>> 0
      const o = i * 4
      rgba[o] = redFromArgb(argb)
      rgba[o + 1] = greenFromArgb(argb)
      rgba[o + 2] = blueFromArgb(argb)
      rgba[o + 3] = 255
    }
    if (yieldRows != null && (y + 1) % TEXTURE_ROWS_PER_CHUNK === 0) await yieldRows()
  }
  return rgba
}

export const buildCoverTexture = async(request: TextureRequest): Promise<string> => {
  const rgba = await buildTextureRgba(request, async() => {
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0)
    })
  })
  return encodePngDataUri(rgba, request.outWidth, request.outHeight)
}
