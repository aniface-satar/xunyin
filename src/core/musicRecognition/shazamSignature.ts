// Shazam 签名生成，逐行复刻 shazamio 0.8.1 的 algorithm.py（SignatureGenerator）+ signature.py 编码。
//
// 这里不改算法、不调阈值、不"修 bug"：签名内容一变，服务端只会安静地认不出歌，
// 单测 tests/music-recognition-shazam-signature.mts 用 Python 生成的 uri 做逐字节对拍。
// 已知保留的上游缺陷见文件末尾两处注释（band 3 死条件、平稳信号出不了峰）。
import { type SigBand, type SigPeak, encodeSignatureUri } from './shazamSigEncode.ts'

export const SHAZAM_SAMPLE_RATE = 16000

const FFT_INPUT_SIZE = 2048
const FFT_BINS = 1025
const COMPLEX_FFT_SIZE = 1024
const CHUNK_SIZE = 128
const RING_ROWS = 256
const MAX_PEAKS = 255
const PEAK_SPREAD_LOOKBACK_ROWS = 46

// np.hanning(2050)[1:-1]：分母是 2049 而不是 2048，去掉两端 0 后仍是 2048 点
const HANNING = (() => {
  const w = new Float64Array(FFT_INPUT_SIZE)
  for (let k = 0; k < FFT_INPUT_SIZE; k++) w[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (k + 1)) / 2049)
  return w
})()

// 1024 点复数 FFT 的旋转因子表与位反转置换表，模块加载时算一次
const FFT_TWIDDLE = (() => {
  const re = new Float64Array(COMPLEX_FFT_SIZE)
  const im = new Float64Array(COMPLEX_FFT_SIZE)
  for (let m = 0; m < COMPLEX_FFT_SIZE; m++) {
    re[m] = Math.cos((2 * Math.PI * m) / COMPLEX_FFT_SIZE)
    im[m] = -Math.sin((2 * Math.PI * m) / COMPLEX_FFT_SIZE)
  }
  return { re, im }
})()

const FFT_REVERSAL = (() => {
  const order = new Uint16Array(COMPLEX_FFT_SIZE)
  for (let i = 0; i < COMPLEX_FFT_SIZE; i++) {
    let rev = 0
    for (let bit = 0; bit < 10; bit++) rev = (rev << 1) | ((i >> bit) & 1)
    order[i] = rev
  }
  return order
})()

// 实数 FFT 拆成半长复数 FFT 后，把 1024 点结果拼回 1025 个 bin 用的旋转因子
const UNPACK_TWIDDLE = (() => {
  const re = new Float64Array(FFT_BINS)
  const im = new Float64Array(FFT_BINS)
  for (let k = 0; k < FFT_BINS; k++) {
    re[k] = Math.cos((Math.PI * k) / COMPLEX_FFT_SIZE)
    im[k] = -Math.sin((Math.PI * k) / COMPLEX_FFT_SIZE)
  }
  return { re, im }
})()

const mod = (value: number, size: number): number => ((value % size) + size) % size

const PEAK_NEIGHBOR_OFFSETS = [-10, -7, -4, -3, 1, 2, 5, 8]
const PEAK_HISTORY_ROW_OFFSETS = [-53, -45, 165, 172, 179, 186, 193, 200, 214, 221, 228, 235, 242, 249]

// 频率 -> 频段。3500-5500Hz 那一档上游写成了 `5500 < f <= 5500`（恒假），
// 所以 band 3 永远不会出现。补齐它等于改签名字节，这里照抄。
const bandOfFrequency = (hz: number): number => {
  if (hz > 250 && hz < 520) return 0
  if (hz > 520 && hz < 1450) return 1
  if (hz > 1450 && hz < 3500) return 2
  return -1
}

const FREQUENCY_PER_BIN = SHAZAM_SAMPLE_RATE / 2 / 1024 / 64

interface RowRing {
  readonly rows: Float64Array[]
  readonly values: Float64Array
  position: number
  numWritten: number
}

const createRowRing = (): RowRing => {
  const values = new Float64Array(RING_ROWS * FFT_BINS)
  const rows: Float64Array[] = []
  for (let i = 0; i < RING_ROWS; i++) rows.push(values.subarray(i * FFT_BINS, (i + 1) * FFT_BINS))
  return { rows, values, position: 0, numWritten: 0 }
}

class SignatureBuilder {
  private readonly samples = new Int16Array(FFT_INPUT_SIZE)
  private samplePosition = 0
  private readonly windowed = new Float64Array(FFT_INPUT_SIZE)
  private readonly fftRe = new Float64Array(COMPLEX_FFT_SIZE)
  private readonly fftIm = new Float64Array(COMPLEX_FFT_SIZE)
  private readonly powerRow = new Float64Array(FFT_BINS)
  private readonly spreadRow = new Float64Array(FFT_BINS)
  private readonly fftRows = createRowRing()
  private readonly spreadRows = createRowRing()
  private readonly peaksByBand = new Map<number, SigPeak[]>()
  private numberSamples = 0

  get peakCount(): number {
    let count = 0
    for (const peaks of this.peaksByBand.values()) count += peaks.length
    return count
  }

  get processedSeconds(): number {
    return this.numberSamples / SHAZAM_SAMPLE_RATE
  }

  get consumedSamples(): number {
    return this.numberSamples
  }

  processChunk(pcm: ArrayLike<number>, start: number): void {
    this.numberSamples += CHUNK_SIZE
    for (let k = 0; k < CHUNK_SIZE; k++) {
      this.samples[(this.samplePosition + k) & (FFT_INPUT_SIZE - 1)] = pcm[start + k]
    }
    this.samplePosition = (this.samplePosition + CHUNK_SIZE) & (FFT_INPUT_SIZE - 1)
    this.doFft()
    this.doPeakSpreadingAndRecognition()
  }

  buildUri(): string {
    const bands: SigBand[] = []
    for (const band of [...this.peaksByBand.keys()].sort((a, b) => a - b)) {
      bands.push({ band, peaks: this.peaksByBand.get(band)! })
    }
    return encodeSignatureUri(this.numberSamples, bands)
  }

  // 2048 点实数 FFT：平铺成 1024 复数做变换，再按 k 与 N-k 拼回 1025 个 bin
  private doFft(): void {
    // 环形缓冲按写游标旋转：游标之后是旧数据，游标之前是刚写入的新数据，拼起来正好是时间正序
    for (let k = 0; k < FFT_INPUT_SIZE; k++) {
      this.windowed[k] = HANNING[k] * this.samples[(this.samplePosition + k) & (FFT_INPUT_SIZE - 1)]
    }

    const re = this.fftRe
    const im = this.fftIm
    for (let j = 0; j < COMPLEX_FFT_SIZE; j++) {
      re[j] = this.windowed[2 * j]
      im[j] = this.windowed[2 * j + 1]
    }

    const order = FFT_REVERSAL
    for (let i = 0; i < COMPLEX_FFT_SIZE; i++) {
      const j = order[i]
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t
        t = im[i]; im[i] = im[j]; im[j] = t
      }
    }
    const twRe = FFT_TWIDDLE.re
    const twIm = FFT_TWIDDLE.im
    for (let len = 2; len <= COMPLEX_FFT_SIZE; len <<= 1) {
      const half = len >> 1
      const step = COMPLEX_FFT_SIZE / len
      for (let start = 0; start < COMPLEX_FFT_SIZE; start += len) {
        for (let j = 0; j < half; j++) {
          const a = start + j
          const b = a + half
          const wr = twRe[j * step]
          const wi = twIm[j * step]
          const br = re[b]
          const bi = im[b]
          const vr = br * wr - bi * wi
          const vi = br * wi + bi * wr
          re[b] = re[a] - vr
          im[b] = im[a] - vi
          re[a] = re[a] + vr
          im[a] = im[a] + vi
        }
      }
    }

    // 与上游一致：只取模平方并除以 2^17，再垫一个 1e-10 的下限（后续有 log 运算）
    const power = this.powerRow
    for (let k = 0; k < FFT_BINS; k++) {
      const zk = k & (COMPLEX_FFT_SIZE - 1)
      const znk = (COMPLEX_FFT_SIZE - k) & (COMPLEX_FFT_SIZE - 1)
      const ar = re[zk]
      const ai = im[zk]
      const br = re[znk]
      const bi = im[znk]
      const her = (ar + br) / 2
      const hei = (ai - bi) / 2
      const hor = (ar - br) / 2
      const hoi = (ai + bi) / 2
      const wr = UNPACK_TWIDDLE.re[k]
      const wi = UNPACK_TWIDDLE.im[k]
      const tr = wr * hor - wi * hoi
      const ti = wr * hoi + wi * hor
      const xr = her + ti
      const xi = hei - tr
      const value = (xr * xr + xi * xi) / (1 << 17)
      power[k] = value > 0.0000000001 ? value : 0.0000000001
    }
    this.fftRows.rows[this.fftRows.position].set(power)
    this.fftRows.position = (this.fftRows.position + 1) % RING_ROWS
    this.fftRows.numWritten += 1
  }

  private doPeakSpreadingAndRecognition(): void {
    this.doPeakSpreading()
    if (this.spreadRows.numWritten >= PEAK_SPREAD_LOOKBACK_ROWS) this.doPeakRecognition()
  }

  // 频域上把每个 bin 抬成"自己和右邻两格"的最大值，再往回 1/3/6 行做时间维度的最大值扩散。
  // 上游用 np.roll 实现前向最大值，末尾 3 个 bin 原样保留，这里逐点等价。
  private doPeakSpreading(): void {
    const origin = this.fftRows.rows[mod(this.fftRows.position - 1, RING_ROWS)]
    const spread = this.spreadRow
    for (let i = 0; i < FFT_BINS - 3; i++) {
      const a = origin[i]
      const b = origin[i + 1]
      const c = origin[i + 2]
      spread[i] = a > b ? (a > c ? a : c) : (b > c ? b : c)
    }
    for (let i = FFT_BINS - 3; i < FFT_BINS; i++) spread[i] = origin[i]

    const rows = this.spreadRows.rows
    const i1 = mod(this.spreadRows.position - 1, RING_ROWS)
    const i2 = mod(this.spreadRows.position - 3, RING_ROWS)
    const i3 = mod(this.spreadRows.position - 6, RING_ROWS)
    const prev1 = rows[i1]
    const prev2 = rows[i2]
    const prev3 = rows[i3]
    // 三行都基于改写前的快照计算，上游是 vstack 后逐行取 max，不存在级联放大
    for (let i = 0; i < FFT_BINS; i++) {
      const v0 = spread[i]
      const m1 = v0 > prev1[i] ? v0 : prev1[i]
      prev1[i] = m1
      const m2 = m1 > prev2[i] ? m1 : prev2[i]
      prev2[i] = m2
      prev3[i] = m2 > prev3[i] ? m2 : prev3[i]
    }
    rows[this.spreadRows.position].set(spread)
    this.spreadRows.position = (this.spreadRows.position + 1) % RING_ROWS
    this.spreadRows.numWritten += 1
  }

  private doPeakRecognition(): void {
    const fftMinus46 = this.fftRows.rows[mod(this.fftRows.position - PEAK_SPREAD_LOOKBACK_ROWS, RING_ROWS)]
    const fftMinus49 = this.spreadRows.rows[mod(this.spreadRows.position - 49, RING_ROWS)]
    const spreadPosition = this.spreadRows.position

    for (let bin = 10; bin < 1015; bin++) {
      const value = fftMinus46[bin]
      if (!(value >= 1 / 64) || value < fftMinus49[bin - 1]) continue

      let maxNeighbor = 0
      for (const offset of PEAK_NEIGHBOR_OFFSETS) {
        const candidate = fftMinus49[bin + offset]
        if (candidate > maxNeighbor) maxNeighbor = candidate
      }
      if (!(value > maxNeighbor)) continue

      let maxAcrossRows = maxNeighbor
      for (const rowOffset of PEAK_HISTORY_ROW_OFFSETS) {
        const candidate = this.spreadRows.rows[mod(spreadPosition + rowOffset, RING_ROWS)][bin - 1]
        if (candidate > maxAcrossRows) maxAcrossRows = candidate
      }
      if (!(value > maxAcrossRows)) continue

      const magnitude = Math.log(Math.max(1 / 64, value)) * 1477.3 + 6144
      const before = Math.log(Math.max(1 / 64, fftMinus46[bin - 1])) * 1477.3 + 6144
      const after = Math.log(Math.max(1 / 64, fftMinus46[bin + 1])) * 1477.3 + 6144
      const variation = magnitude * 2 - before - after
      // 上游在这里是 assert peak_variation_1 > 0：真触发会让整条识曲链抛异常。
      // 峰判定已经保证它为正，万一为 0 只丢这一个峰，不换掉整个结果。
      if (!(variation > 0)) continue
      const correctedBin = bin * 64 + ((after - before) * 32 / variation)

      const band = bandOfFrequency(correctedBin * FREQUENCY_PER_BIN)
      if (band < 0) continue

      let peaks = this.peaksByBand.get(band)
      if (!peaks) {
        peaks = []
        this.peaksByBand.set(band, peaks)
      }
      peaks.push({
        fftNumber: this.spreadRows.numWritten - PEAK_SPREAD_LOOKBACK_ROWS,
        magnitude: Math.trunc(magnitude),
        frequencyBin: Math.trunc(correctedBin),
      })
    }
  }
}

/**
 * 16kHz 单声道 int16 PCM -> Shazam 签名 uri。
 * maxSeconds 与上游一样是"至少听这么久"的门槛：样本先用完就用手上的样本出签名，
 * 峰数不足 255 也一样返回（静音就是空签名）。
 */
export const signatureFromPcm16k = (
  pcm: ArrayLike<number>,
  maxSeconds: number,
): { uri: string, numberSamples: number } | null => {
  const total = pcm.length
  if (total < CHUNK_SIZE) return null

  const builder = new SignatureBuilder()
  let processed = 0
  while (total - processed >= CHUNK_SIZE &&
    (builder.processedSeconds < maxSeconds || builder.peakCount < MAX_PEAKS)) {
    builder.processChunk(pcm, processed)
    processed += CHUNK_SIZE
  }

  return { uri: builder.buildUri(), numberSamples: builder.consumedSamples }
}
