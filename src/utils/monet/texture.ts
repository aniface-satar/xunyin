import { Hct } from '@material/material-color-utilities/hct/hct.js'
import { argbFromLstar, blueFromArgb, greenFromArgb, linearized, lstarFromY, redFromArgb } from '@material/material-color-utilities/utils/color_utils.js'

import { encodePngDataUri } from './png.ts'
import type { CoverPixels } from './sourceColor.ts'
import type { ToneBand } from './surface.ts'

/** 纹理竖边固定 294 texel，横边按屏幕宽高比折算：纹样尺度要跟着屏幕走，不能两张屏幕用同一张位图 */
export const TEXTURE_OUT_HEIGHT = 294
export const TEXTURE_OUT_WIDTH_MIN = 40
export const TEXTURE_OUT_WIDTH_MAX = 200
/** Hermes 上单遍全量要 300~450ms（V8 实测 87ms，Hermes 慢 3~5 倍），会把 morph 动画挤掉帧，所以按行分块让路 */
export const TEXTURE_ROWS_PER_CHUNK = 8
export const TEXTURE_SEED = 20261014
/** 云团尺度（每屏多少个周期）。旧值 13 是照着"低通半衰减落在屏宽 3~5%"调的，
 *  后来发现那个指标量到的是参考图自己的生成器抖动，不是云；13 周期出来是墙漆颗粒。 */
export const MARBLE_FREQ = 6
/** domain-warp 强度：再大形状就散成噪声，再小就只是糊掉的封面 */
export const WARP_STRENGTH = 0.07
/** 背景染色彩度 = 封面整体彩度 × 这个比例。两张参考图都落在这个比例上：
 *  晚霞封面平均 C*37.5 → 背景 20（0.53），雨夜封面平均 C*5.7 → 背景 3.6（0.63）。
 *  不用取色器那支 scored source 的彩度：它挑的是画面里最跳的一块（雨夜 17），
 *  整屏照它上彩就变成一坨蓝灰漆，而参考图那一张几乎是无色的。 */
export const COVER_CHROMA_RATIO = 0.55
/** 纹理彩度上界。参考图逐段量下来 C* 16~23（晚霞最浓的一张），比底色那支 CHROMA_CAP=36 低一档：
 *  底色是一小块要撑住识别度，背景是整屏要能压住字。 */
export const TEXTURE_CHROMA_MAX = 26
/** 箱形模糊半径（在 128 网格上）。cover-fit 只把封面 45% 的宽度铺满横屏，所以 10 格 ≈ 屏宽 17%：
 *  参考图糊到认不出建筑/岩石，只剩一两团大的明暗；旧值 3 时封面里的硬边直接透到背景上，
 *  一眼就是"照片放大"而不是柔光。 */
export const COVER_BLUR_RADIUS = 10
/** 低于此彩度一律按纯灰出。HCT 里连"纯 sRGB 灰"也读出 1.9~2.9 的彩度（#808080 1.896、#ffffff 2.869），
 *  照这么小的值回 Hct.from 会随机偏暖或偏青。但整屏染色允许带一丝色相 ——
 *  雨夜那张参考图的背景本身就只有 C*2.7~8，阈值定在 4 会把它的蓝整个抹平。 */
export const NEUTRAL_CHROMA = 2
/** 单 texel 相对所在行均值的最大偏离（tone 档）：照片里的硬边（地平线、人脸）压到这个幅度才像柔光背景。
 *  参考图去掉纵向色阶后的局部起伏跨度 11~17，这一层和下面那层各出一半。 */
export const STRUCTURE_TOLERANCE = 10
/** 抽象云纹的振幅（tone 档，正负各半）。封面自己很平时背景全靠这一层撑起伏，所以它是独立量，不跟封面成比例。 */
export const MARBLE_RELIEF = 8
/** 起伏收到 v=CALM_START_V 为止保持满量，之后一路收到 CALM_MIN。
 *  参考图的下半屏（正文区）几乎是一整片，云只留在封面背后那一段；字要落的地方越平越好读。 */
export const CALM_START_V = 0.45
export const CALM_END_V = 0.72
export const CALM_MIN = 0.3
/** 正文区起点：歌名基线在 v≈0.56，往上留一格余量。这一段整体钉在闸门以下。 */
export const TEXT_TOP_V = 0.5
/** 正文区自己保留的明暗跨度（tone 档）。参考图这一段敢跑到 L*50~62、跨度 11~17，
 *  因为它不管闸门；而闸门要求 v≥0.5 一律不超过 band.hi，中位只能靠"压平"抬上去 ——
 *  12 档时中位是 42，字底下仍然是黑的。 */
export const TEXT_SPREAD_MAX = 6
/** 光照坡在屏顶的峰值（tone 档，相对闸门）。两张参考图最亮的一段都在屏顶 12% 以内
 *  （晚霞 L*70~72、雨夜 L*64~65），14 档只做到 53，整片看着就是糊住的褐灰。
 *  这一层只作用于正文区以上，闸门钉在正文区所以 4.5 不受影响；代价是最亮的封面上
 *  状态栏和顶栏图标会掉到约 2.4:1 —— 参考图本身也是这个数。 */
export const LIFT_MAX = 20
// 6 个周期叠三个倍频程最细一层已经到 50 周期/屏，再叠一倍就低于一个 texel，出来是噪点不是云
const OCTAVES = 3
const FREQ_STEP = 2.03

export interface TextureRequest {
  source: CoverPixels
  /** 只用带的上沿：白字往下只会更安全，所以纹理钉在 hi 上、其余全部往下挂 */
  band: ToneBand
  /** 来自 buildCoverSurface.tint：整片背景共用的那一支颜色 */
  tint: { hue: number, chroma: number }
  outWidth: number
  outHeight: number
}

export const textureWidthFor = (screenWidth: number, screenHeight: number) =>
  Math.max(TEXTURE_OUT_WIDTH_MIN, Math.min(TEXTURE_OUT_WIDTH_MAX, Math.round(TEXTURE_OUT_HEIGHT * screenWidth / screenHeight)))

const smoothStep = (t: number) => t * t * (3 - 2 * t)

/** 起伏的纵向收束曲线：上半屏（封面背后）留云，正文区往平里收 */
const calmOf = (v: number) => {
  if (v <= CALM_START_V) return 1
  if (v >= CALM_END_V) return CALM_MIN
  return 1 - (1 - CALM_MIN) * smoothStep((v - CALM_START_V) / (CALM_END_V - CALM_START_V))
}

/** 纵向光照坡：由设计给定，不跟封面走。两张参考图都是"顶部最亮、落到正文区收在闸门上"
 *  （晚霞 71→50、雨夜 64→47），而封面自己的行均值可能反着来 —— 晚霞那张顶部是暗的，
 *  跟着它做就出来上暗下亮（实测 30→40），一眼就不是同一类图。 */
const liftOf = (v: number) => LIFT_MAX * (1 - smoothStep(Math.min(1, v / TEXT_TOP_V)))

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

interface BlurredCover {
  r: Float32Array
  g: Float32Array
  b: Float32Array
}

// 横竖各一遍的滑动窗口：二维核是 (2r+1)² 次/像素，半径一大 Hermes 就吃不消；可分离之后成本只随 r 线性涨。
// 两端用"复制边缘"（下标钳住不动、除数恒为 span），比补零少一圈暗边。
const blurChannel = (src: Float32Array, w: number, h: number, radius: number): Float32Array => {
  const span = 2 * radius + 1
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let acc = 0
    for (let dx = -radius; dx <= radius; dx++) acc += src[row + Math.min(w - 1, Math.max(0, dx))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / span
      acc += src[row + Math.min(w - 1, x + radius + 1)] - src[row + Math.max(0, x - radius)]
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let dy = -radius; dy <= radius; dy++) acc += tmp[Math.min(h - 1, Math.max(0, dy)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / span
      acc += tmp[Math.min(h - 1, y + radius + 1) * w + x] - tmp[Math.max(0, y - radius) * w + x]
    }
  }
  return out
}

const boxBlur = (src: readonly number[], w: number, h: number, radius: number): BlurredCover => {
  const n = w * h
  const r = new Float32Array(n)
  const g = new Float32Array(n)
  const b = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const p = src[i] >>> 0
    r[i] = (p >> 16) & 255
    g[i] = (p >> 8) & 255
    b[i] = p & 255
  }
  return { r: blurChannel(r, w, h, radius), g: blurChannel(g, w, h, radius), b: blurChannel(b, w, h, radius) }
}

// HCT 的 tone 就是 L*，直接从浮点 RGB 算，免得为了过 Hct.fromInt 再取整一次
const toneOf = (r: number, g: number, b: number) =>
  lstarFromY(0.2126 * linearized(r) + 0.7152 * linearized(g) + 0.0722 * linearized(b))

// Lab 的 C*（=HCT 的彩度）。注意入参是线性光分量，和上面按 0~255 取值的 toneOf 不一样：
// 这里要的正是"在线性光下平均出来的那支色"，再 linearized 一次就变成双重转换了。
const chromaOfLinear = (lr: number, lg: number, lb: number) => {
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f((0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047)
  const fy = f(0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb)
  const fz = f((0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883)
  return Math.hypot(500 * (fx - fy), 200 * (fy - fz))
}

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
    return toneOf(mix(blurred.r), mix(blurred.g), mix(blurred.b))
  }
}

/**
 * 纹理核心：封面结构 + 抽象云纹 → 合法色阶带里的 RGBA。
 * `yieldRows` 每 TEXTURE_ROWS_PER_CHUNK 行调一次；单测不传（结果必须与分块无关）。
 */
export const buildTextureRgba = async(request: TextureRequest, yieldRows?: () => Promise<void>): Promise<Uint8Array> => {
  const { source, band, tint, outWidth, outHeight } = request
  const count = outWidth * outHeight
  const blurred = boxBlur(source.pixels, source.width, source.height, COVER_BLUR_RADIUS)
  const sampleCover = makeCoverSampler(blurred, source.width, source.height)

  // 整屏染色有多浓，看封面"整体是什么颜色"：先把糊过的网格在线性光下平均成一支色，再算它的 C*。
  // 不能逐点算彩度再取中位 —— 那样每块局部都按自己的彩度计票，雨夜那张读出来 20.7，
  // 而它的平均色其实只有 5.7（色相在画面里绕了一圈，互相抵消掉了），照 20 上彩就浓过头三倍。
  const grid = source.width * source.height
  let mr = 0
  let mg = 0
  let mb = 0
  for (let i = 0; i < grid; i++) {
    mr += linearized(blurred.r[i])
    mg += linearized(blurred.g[i])
    mb += linearized(blurred.b[i])
  }
  // linearized() 给的是 0~100（它是为 lstarFromY 准备的），Lab 矩阵要的是 0~1
  const coverChroma = chromaOfLinear(mr / grid / 100, mg / grid / 100, mb / grid / 100)
  const chromaBase = Math.min(tint.chroma, TEXTURE_CHROMA_MAX, COVER_CHROMA_RATIO * coverChroma)

  const coverTone = new Float32Array(count)
  const marbleRaw = new Float32Array(count)
  const rowSum = new Float32Array(outHeight)

  // 封面是方的、屏是长的：按"铺满"取中央那一条，背景才像同一张照片放大，而不是被竖着拉长
  const screenAspect = outWidth / outHeight
  const srcAspect = source.width / source.height
  const fracX = Math.min(1, screenAspect / srcAspect)
  const fracY = Math.min(1, srcAspect / screenAspect)

  for (let y = 0; y < outHeight; y++) {
    const cy = (y + 0.5) / outHeight
    const calm = calmOf(cy)
    for (let x = 0; x < outWidth; x++) {
      const cx = (x + 0.5) / outWidth
      // 两路独立 fBm 只用来搅采样坐标（domain warp），第三路才是抽象云纹本体
      const w1 = fbm(cx * MARBLE_FREQ + 3.1, cy * MARBLE_FREQ + 7.7, TEXTURE_SEED) - 0.5
      const w2 = fbm(cx * MARBLE_FREQ + 11.3, cy * MARBLE_FREQ + 2.9, TEXTURE_SEED + 31) - 0.5
      const u = 0.5 + (cx - 0.5) * fracX + WARP_STRENGTH * w1
      const v = 0.5 + (cy - 0.5) * fracY + WARP_STRENGTH * w2
      const tone = sampleCover(u, v)
      const i = y * outWidth + x
      coverTone[i] = tone
      marbleRaw[i] = (fbm(cx * MARBLE_FREQ + 5.3, cy * MARBLE_FREQ + 9.1, TEXTURE_SEED + 707) - 0.5) * calm
      rowSum[y] += tone
    }
    if (yieldRows != null && (y + 1) % TEXTURE_ROWS_PER_CHUNK === 0) await yieldRows()
  }

  // 行均值只是为了剥出横向结构：纵向那条坡由设计给定（见 liftOf），不跟封面走。
  const rowMean = new Float32Array(outHeight)
  for (let y = 0; y < outHeight; y++) rowMean[y] = rowSum[y] / outWidth

  const dev = new Float32Array(count)
  for (let y = 0; y < outHeight; y++) {
    const m = rowMean[y]
    const calm = calmOf((y + 0.5) / outHeight)
    const base = y * outWidth
    for (let x = 0; x < outWidth; x++) dev[base + x] = (coverTone[base + x] - m) * calm
  }
  const devSorted = Float32Array.from(dev).sort()
  const last = count - 1
  const devSpread = devSorted[Math.floor(last * 0.98)] - devSorted[Math.floor(last * 0.02)]
  const devScale = Math.min(1, STRUCTURE_TOLERANCE / Math.max(1e-6, devSpread))

  let marbleMean = 0
  for (let i = 0; i < count; i++) marbleMean += marbleRaw[i]
  marbleMean /= count
  let marbleVar = 0
  for (let i = 0; i < count; i++) {
    const d = marbleRaw[i] - marbleMean
    marbleVar += d * d
  }
  const marbleSigma = Math.max(1e-6, Math.sqrt(marbleVar / count))
  // 云纹不做秩归一：秩归一把钟形场摊成直方图均匀的场，于是每一段中等坡都变成一样强的台阶 ——
  // 量出来"起伏够了"，看着却是迷彩斑块。留它自己的分布，绝大多数地方贴着均值，极值离得远。
  const relief = new Float32Array(count)
  const halfRelief = MARBLE_RELIEF / 2
  for (let i = 0; i < count; i++) {
    const z = Math.max(-2, Math.min(2, (marbleRaw[i] - marbleMean) / marbleSigma))
    relief[i] = (z / 2) * halfRelief
  }

  const field = new Float32Array(count)
  for (let y = 0; y < outHeight; y++) {
    const grade = liftOf((y + 0.5) / outHeight)
    const base = y * outWidth
    for (let x = 0; x < outWidth; x++) {
      const i = base + x
      field[i] = grade + devScale * dev[i] + relief[i]
    }
  }
  // 闸门钉在"字要落的那一段"：正文区取 p99.5 作顶，这一段几乎每一格都过 4.5。
  // 正文区以上不参与这个上限（那条"上亮下暗"由 liftOf 给），所以不必为了字把整屏一起压暗。
  const textStart = Math.min(outHeight - 1, Math.floor(TEXT_TOP_V * outHeight))
  const textTop = new Float32Array((outHeight - textStart) * outWidth)
  for (let y = textStart; y < outHeight; y++) {
    const base = y * outWidth
    const rowBase = (y - textStart) * outWidth
    for (let x = 0; x < outWidth; x++) textTop[rowBase + x] = field[base + x]
  }
  textTop.sort()
  const pin = textTop[Math.floor((textTop.length - 1) * 0.995)]
  // 正文区的顶已经被 pin 钉在闸门上，再把它的跨度压进 TEXT_SPREAD_MAX，中位才抬得起来；
  // 不压的话一张对比强的封面会一路拖到 tone 25，闸门守住了、人眼看着是糊成一片黑。
  // 压缩比从屏顶 smoothStep 缓进来，边界不出台阶。
  const textScale = Math.min(1, TEXT_SPREAD_MAX / Math.max(1e-6, pin - textTop[Math.floor((textTop.length - 1) * 0.05)]))

  const rgba = new Uint8Array(count * 4)
  const ceiling = band.hi + LIFT_MAX
  for (let y = 0; y < outHeight; y++) {
    const s = 1 - (1 - textScale) * smoothStep(Math.min(1, ((y + 0.5) / outHeight) / TEXT_TOP_V))
    for (let x = 0; x < outWidth; x++) {
      const i = y * outWidth + x
      const n = field[i]
      const below = pin - n
      const tone = Math.min(ceiling, Math.max(0, band.hi - (below >= 0 ? s * below : below)))
      const argb = chromaBase < NEUTRAL_CHROMA ? argbFromLstar(tone) >>> 0 : Hct.from(tint.hue, chromaBase, tone).toInt() >>> 0
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
