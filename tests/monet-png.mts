import test from 'node:test'
import assert from 'node:assert/strict'
import { inflateSync } from 'node:zlib'

import { encodePng, encodePngDataUri } from '../src/utils/monet/png.ts'

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

const readChunks = (png: Uint8Array) => {
  const out: { type: string; data: Uint8Array; crc: number }[] = []
  let p = 8
  while (p < png.length) {
    const len = (png[p] << 24 | png[p + 1] << 16 | png[p + 2] << 8 | png[p + 3]) >>> 0
    const type = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7])
    const data = png.subarray(p + 8, p + 8 + len)
    const crc = (png[p + 8 + len] << 24 | png[p + 9 + len] << 16 | png[p + 10 + len] << 8 | png[p + 11 + len]) >>> 0
    out.push({ type, data, crc })
    p += 12 + len
  }
  return out
}

// 我们只发 filter type 0（None），所以测试能直接 unfilter 回原字节
const unfilter = (raw: Uint8Array, width: number, height: number) => {
  const out = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (width * 4 + 1)], 0, `第 ${y} 行的 filter type 必须是 0`)
    out.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4)
  }
  return out
}

const gradient = (w: number, h: number) => {
  const rgba = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = i & 255
    rgba[i * 4 + 1] = (i * 3) & 255
    rgba[i * 4 + 2] = (i * 7) & 255
    rgba[i * 4 + 3] = 255
  }
  return rgba
}

test('签名 + IHDR 写的是真实尺寸、8 位深度、color type 6（RGBA）', () => {
  const rgba = gradient(6, 11)
  const png = encodePng(rgba, 6, 11)
  assert.deepEqual(Array.from(png.subarray(0, 8)), SIGNATURE)
  const chunks = readChunks(png)
  assert.deepEqual(chunks.map(c => c.type), ['IHDR', 'IDAT', 'IEND'])
  const ihdr = chunks[0].data
  assert.equal((ihdr[0] << 24 | ihdr[1] << 16 | ihdr[2] << 8 | ihdr[3]) >>> 0, 6)
  assert.equal((ihdr[4] << 24 | ihdr[5] << 16 | ihdr[6] << 8 | ihdr[7]) >>> 0, 11)
  assert.equal(ihdr[8], 8)
  assert.equal(ihdr[9], 6)
})

test('IDAT 解压 unfilter 之后与输入逐字节相同', () => {
  const rgba = gradient(6, 11)
  const idat = readChunks(encodePng(rgba, 6, 11))[1].data
  const raw = new Uint8Array(inflateSync(Buffer.from(idat)))
  assert.deepEqual(Array.from(unfilter(raw, 6, 11)), Array.from(rgba))
})

test('每个 chunk 的 CRC 都对得上（写错 CRC 的 PNG 会被解码端整张丢掉）', () => {
  // 与实现同一套多项式的独立实现：不共享代码，才能真正否决实现里写反的 CRC
  const crcOf = (bytes: Uint8Array) => {
    let c = 0xffffffff
    for (const b of bytes) {
      c ^= b
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    return (c ^ 0xffffffff) >>> 0
  }
  const png = encodePng(gradient(4, 4), 4, 4)
  for (const chunk of readChunks(png)) {
    const body = new Uint8Array(4 + chunk.data.length)
    for (let i = 0; i < 4; i++) body[i] = chunk.type.charCodeAt(i)
    body.set(chunk.data, 4)
    assert.equal(crcOf(body).toString(16), chunk.crc.toString(16), `${chunk.type} 的 CRC 不匹配`)
  }
})

test('1×1 退化输入不崩且能解回原字节', () => {
  const one = new Uint8Array([10, 20, 30, 255])
  const png = encodePng(one, 1, 1)
  const raw = new Uint8Array(inflateSync(Buffer.from(readChunks(png)[1].data)))
  assert.deepEqual(Array.from(unfilter(raw, 1, 1)), Array.from(one))
})

test('data URI 前缀与 base64 体（解码回来就是那张 PNG）', () => {
  const rgba = gradient(5, 9)
  const uri = encodePngDataUri(rgba, 5, 9)
  assert.ok(uri.startsWith('data:image/png;base64,'))
  const body = uri.slice('data:image/png;base64,'.length)
  assert.deepEqual(Array.from(Buffer.from(body, 'base64')), Array.from(encodePng(rgba, 5, 9)))
})
