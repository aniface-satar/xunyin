// 这个栈里没有 SVG / Skia / GL，也没有混合模式与渐变基元（spec §7.3），
// 纹理只能是一张运行时生成的位图；而位图要能被 RN 的普通 <Image> 吃掉，就得有合法编码。
// pako（HEAD package.json:58）做 deflate，PNG 封装手写 —— 只发 filter type 0，无需自适应滤波。
import { Buffer } from 'buffer'
import { deflate } from 'pako'

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const writeU32BE = (out: Uint8Array, offset: number, value: number) => {
  out[offset] = (value >>> 24) & 255
  out[offset + 1] = (value >>> 16) & 255
  out[offset + 2] = (value >>> 8) & 255
  out[offset + 3] = value & 255
}

const chunk = (type: string, data: Uint8Array) => {
  const body = new Uint8Array(4 + data.length)
  for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i)
  body.set(data, 4)
  // 长度 4 + 类型 4 + 数据 + CRC 4。typed array 越界写会被静默丢弃，少算 4 字节 CRC 就凭空消失
  const out = new Uint8Array(12 + data.length)
  writeU32BE(out, 0, data.length)
  out.set(body, 4)
  writeU32BE(out, 4 + body.length, crc32(body))
  return out
}

export const encodePng = (rgba: Uint8Array, width: number, height: number): Buffer => {
  const stride = width * 4
  const raw = new Uint8Array(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    // 每行首字节是 filter type，0 = None（原样存），所以解码端不需要重建相邻像素
    raw[y * (stride + 1)] = 0
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }

  const ihdr = new Uint8Array(13)
  writeU32BE(ihdr, 0, width)
  writeU32BE(ihdr, 4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA

  const idat = deflate(raw, { level: 9 })
  const parts = [SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const png = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    png.set(part, offset)
    offset += part.length
  }
  return Buffer.from(png)
}

export const encodePngDataUri = (rgba: Uint8Array, width: number, height: number) =>
  `data:image/png;base64,${encodePng(rgba, width, height).toString('base64')}`
