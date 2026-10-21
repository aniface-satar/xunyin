// Shazam 签名的二进制编码，逐字节复刻 shazamio 0.8.1 signature.py:167 encode_to_binary()。
// 这个模块刻意不依赖 react-native-quick-base64 / Buffer：同一份代码将来可能要整段搬进
// WebView 的注入脚本里跑，那边没有原生模块也没有 Buffer。
export interface SigPeak {
  fftNumber: number
  magnitude: number
  frequencyBin: number
}

export interface SigBand {
  band: number
  peaks: SigPeak[]
}

export const SIGNATURE_URI_PREFIX = 'data:audio/vnd.shazam.sig;base64,'

const MAGIC_1 = 0xcafe2580
const MAGIC_2 = 0x94119c00
const BAND_TLV_BASE = 0x60030040
// crc32 写在第 4..7 字节，校验的是它之后的全部字节（含第 8 字节起的大小/魔数）
const CRC_FIELD_OFFSET = 4
const CRC_COVERED_FROM = 8

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

// zlib / binascii.crc32 同一个多项式与初值；返回值翻成无符号
const crc32 = (bytes: Uint8Array, from: number): number => {
  let c = -1
  for (let i = from; i < bytes.length; i++) c = (CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)) | 0
  return (c ^ -1) >>> 0
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const toBase64 = (bytes: Uint8Array): string => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0
    const n = (b0 << 16) | (b1 << 8) | b2
    out += BASE64_CHARS[(n >> 18) & 63] + BASE64_CHARS[(n >> 12) & 63]
    out += i + 1 < bytes.length ? BASE64_CHARS[(n >> 6) & 63] : '='
    out += i + 2 < bytes.length ? BASE64_CHARS[n & 63] : '='
  }
  return out
}

class ByteWriter {
  private readonly buf: number[] = []

  u8(value: number): void {
    this.buf.push(value & 0xff)
  }

  u16le(value: number): void {
    this.buf.push(value & 0xff, (value >>> 8) & 0xff)
  }

  u32le(value: number): void {
    this.buf.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
  }

  zeros(count: number): void {
    for (let i = 0; i < count; i++) this.buf.push(0)
  }

  get length(): number {
    return this.buf.length
  }

  toArray(): readonly number[] {
    return this.buf
  }

  /** 头部的 crc32 要在整条消息成型后回填，所以先占位写 0，末尾再覆写第 4..7 字节 */
  finish(crcOffset: number, checksumFrom: number): Uint8Array {
    const out = Uint8Array.from(this.buf)
    const crc = crc32(out, checksumFrom)
    out[crcOffset] = crc & 0xff
    out[crcOffset + 1] = (crc >>> 8) & 0xff
    out[crcOffset + 2] = (crc >>> 16) & 0xff
    out[crcOffset + 3] = (crc >>> 24) & 0xff
    return out
  }
}

/**
 * bands 必须按 band 升序、组内按 fftNumber 非降序——这是上游 sorted(...) + 顺序写入的约定，
 * 顺序错了签名字节就变了。峰检测侧按构造天然满足，这里不再排序。
 */
export const encodeSignatureUri = (numberSamples: number, bands: SigBand[]): string => {
  const contents = new ByteWriter()
  for (const { band, peaks } of bands) {
    const body = new ByteWriter()
    let lastFftNumber = 0
    for (const peak of peaks) {
      if (peak.fftNumber - lastFftNumber >= 255) {
        body.u8(0xff)
        body.u32le(peak.fftNumber)
        lastFftNumber = peak.fftNumber
      }
      body.u8(peak.fftNumber - lastFftNumber)
      body.u16le(peak.magnitude)
      body.u16le(peak.frequencyBin)
      lastFftNumber = peak.fftNumber
    }
    contents.u32le(BAND_TLV_BASE + band)
    contents.u32le(body.length)
    for (const byte of body.toArray()) contents.u8(byte)
    // 补齐到 4 字节边界。别写成 -length % 4：JS 的 % 跟着被除数符号走，length 非 4 倍数时是负数
    contents.zeros((4 - (body.length % 4)) % 4)
  }

  const sizeMinusHeader = contents.length + 8
  const message = new ByteWriter()
  for (const field of [
    MAGIC_1,
    0, // crc32 占位，末尾回填
    sizeMinusHeader,
    MAGIC_2,
    0, 0, 0, // void1
    3 << 27, // 16000Hz 在 SampleRate 里是 3，左移 27
    0, 0, // void2
    Math.floor(numberSamples + 16000 * 0.24),
    (15 << 19) + 0x40000,
  ]) message.u32le(field)
  message.u32le(0x40000000)
  message.u32le(sizeMinusHeader)
  for (const byte of contents.toArray()) message.u8(byte)

  return SIGNATURE_URI_PREFIX + toBase64(message.finish(CRC_FIELD_OFFSET, CRC_COVERED_FROM))
}
