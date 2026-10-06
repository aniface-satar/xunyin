/**
 * MusiCNN 输入特征：log-mel spectrogram（纯 JS，Hermes 可跑）。
 *
 * 参数对齐 essentia 的 TensorflowInputMusiCNN：16kHz 单声道、512 点窗 / 256 hop、
 * Hann 窗、96 个 HTK mel 三角带（0~11000Hz）、log10(1e-10 + mel 能量)，
 * 每 187 帧组成一个 patch（约 3 秒）。若换用 EffNet 系模型需同步调整本文件参数。
 *
 * 注意：DSP 参数与 essentia 源码的一致性无法在本仓库环境验证，
 * 真机联调时若 embedding 异常，先对照 essentia TensorflowInputMusiCNN 校准 mel 伸缩与频带范围。
 */

export const MEL_BANDS = 96
export const FRAME_SIZE = 512
export const HOP_SIZE = 256
export const PATCH_FRAMES = 187
export const SAMPLE_RATE = 16000
const MEL_LOW_HZ = 0
const MEL_HIGH_HZ = 11000
const LOG_FLOOR = 1e-10
const FFT_BINS = FRAME_SIZE / 2

const hzToMel = (hz: number) => 2595 * Math.log10(1 + hz / 700)
const melToHz = (mel: number) => 700 * (Math.pow(10, mel / 2595) - 1)

const buildHann = (): Float32Array => {
  const win = new Float32Array(FRAME_SIZE)
  for (let i = 0; i < FRAME_SIZE; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (FRAME_SIZE - 1)))
  return win
}

const buildMelFilterbank = (): Float32Array[] => {
  const melLow = hzToMel(MEL_LOW_HZ)
  const melHigh = hzToMel(MEL_HIGH_HZ)
  // 每个三角带需要左右两个斜边，共 bands+2 个边界点
  const points = MEL_BANDS + 2
  const boundariesHz: number[] = []
  for (let i = 0; i < points; i++) {
    boundariesHz.push(melToHz(melLow + (melHigh - melLow) * i / (points - 1)))
  }
  const binHz = SAMPLE_RATE / FRAME_SIZE
  const filters: Float32Array[] = []
  for (let band = 0; band < MEL_BANDS; band++) {
    const filter = new Float32Array(FFT_BINS)
    const leftHz = boundariesHz[band]
    const centerHz = boundariesHz[band + 1]
    const rightHz = boundariesHz[band + 2]
    for (let bin = 0; bin < FFT_BINS; bin++) {
      const freq = bin * binHz
      if (freq <= leftHz || freq >= rightHz) continue
      filter[bin] = freq < centerHz
        ? (freq - leftHz) / (centerHz - leftHz)
        : (rightHz - freq) / (rightHz - centerHz)
    }
    filters.push(filter)
  }
  return filters
}

interface Precomputed {
  hann: Float32Array
  filters: Float32Array[]
  cosTable: Float32Array
  sinTable: Float32Array
}

let precomputed: Precomputed | null = null

const ensurePrecomputed = (): Precomputed => {
  if (precomputed) return precomputed
  const cosTable = new Float32Array(FRAME_SIZE / 2)
  const sinTable = new Float32Array(FRAME_SIZE / 2)
  for (let i = 0; i < FRAME_SIZE / 2; i++) {
    cosTable[i] = Math.cos(2 * Math.PI * i / FRAME_SIZE)
    sinTable[i] = Math.sin(2 * Math.PI * i / FRAME_SIZE)
  }
  precomputed = { hann: buildHann(), filters: buildMelFilterbank(), cosTable, sinTable }
  return precomputed
}

/** 迭代 radix-2 FFT，原位计算，实输入长度 FRAME_SIZE。 */
const fftPower = (re: Float32Array, im: Float32Array, pre: Precomputed): void => {
  const n = FRAME_SIZE
  // bit reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr
      const ti = im[i]; im[i] = im[j]; im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const wLenStep = n / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wIndex = k * wLenStep
        const wr = pre.cosTable[wIndex]
        const wi = -pre.sinTable[wIndex]
        const ur = re[i + k]
        const ui = im[i + k]
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr
        re[i + k] = ur + vr
        im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr
        im[i + k + len / 2] = ui - vi
      }
    }
  }
}

/** 单声道 16kHz PCM → log-mel 帧序列 [frames][MEL_BANDS]。 */
export const computeLogMelFrames = (pcm: Float32Array): Float32Array[] => {
  const pre = ensurePrecomputed()
  const re = new Float32Array(FRAME_SIZE)
  const im = new Float32Array(FRAME_SIZE)
  const power = new Float32Array(FFT_BINS)
  const frames: Float32Array[] = []
  if (pcm.length < FRAME_SIZE) return frames
  for (let offset = 0; offset + FRAME_SIZE <= pcm.length; offset += HOP_SIZE) {
    for (let i = 0; i < FRAME_SIZE; i++) {
      re[i] = pcm[offset + i] * pre.hann[i]
      im[i] = 0
    }
    fftPower(re, im, pre)
    for (let bin = 0; bin < FFT_BINS; bin++) {
      power[bin] = re[bin] * re[bin] + im[bin] * im[bin]
    }
    const frame = new Float32Array(MEL_BANDS)
    for (let band = 0; band < MEL_BANDS; band++) {
      const filter = pre.filters[band]
      let energy = 0
      for (let bin = 0; bin < FFT_BINS; bin++) energy += power[bin] * filter[bin]
      frame[band] = Math.log10(LOG_FLOOR + energy)
    }
    frames.push(frame)
  }
  return frames
}

/** 帧序列 → [patchCount][PATCH_FRAMES * MEL_BANDS]（模型输入的一维布局，帧优先）。 */
export const buildPatches = (frames: Float32Array[]): Float32Array[] => {
  if (!frames.length) return []
  const patches: Float32Array[] = []
  // 短音频至少凑出一个 patch（尾部补最后一帧，避免整段音频被丢弃）
  const padded = frames.length >= PATCH_FRAMES
    ? frames
    : [...frames, ...Array.from({ length: PATCH_FRAMES - frames.length }, () => frames[frames.length - 1] ?? new Float32Array(MEL_BANDS))]
  for (let start = 0; start + PATCH_FRAMES <= padded.length; start += PATCH_FRAMES) {
    const patch = new Float32Array(PATCH_FRAMES * MEL_BANDS)
    for (let f = 0; f < PATCH_FRAMES; f++) {
      patch.set(padded[start + f], f * MEL_BANDS)
    }
    patches.push(patch)
  }
  return patches
}

/** 余弦相似度；任一向量为零向量时返回 0。 */
export const cosine = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let dot = 0
  let na = 0
  let nb = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na <= 0 || nb <= 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
