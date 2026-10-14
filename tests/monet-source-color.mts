import test from 'node:test'
import assert from 'node:assert/strict'

import { QUANTIZE_COLORS, analyzeArgbPixels } from '../src/utils/monet/sourceColor.ts'
import { Hct } from '@material/material-color-utilities/hct/hct.js'

const fill = (argb: number, n: number) => new Array(n).fill(argb >>> 0)
const GRAY = 0xFF808080
const RED = 0xFFCC2222

test('灰底 + 少量红：源色取红（面积让位于色度），平均色仍是灰', () => {
  const result = analyzeArgbPixels([...fill(GRAY, 900), ...fill(RED, 100)])!
  assert.ok(Hct.fromInt(result.source).chroma > 20, `source chroma=${Hct.fromInt(result.source).chroma}`)
  assert.ok(Hct.fromInt(result.average).chroma < 15, `average chroma=${Hct.fromInt(result.average).chroma}`)
})

test('全灰像素不崩，源色取的是这张图自己的灰而不是内置常量灰', () => {
  // 只断言色度挡不住"把 fallbackColorARGB 写成常量 0xff808080"这种改法：
  // 中灰封面照样全绿，深灰/浅灰封面就会被涂成中灰。三档灰都要求 source === 本图平均色 === 输入色。
  for (const gray of [0xFF808080, 0xFF2A2A2A, 0xFFEFEFEF]) {
    const result = analyzeArgbPixels(fill(gray, 4096))!
    assert.equal(result.average, gray)
    assert.equal(result.source, result.average, `gray=${gray.toString(16)}`)
    assert.ok(Hct.fromInt(result.source).chroma < 5)
  }
})

test('输出 alpha 恒为 255（供 Hct.fromInt 使用）', () => {
  const result = analyzeArgbPixels([...fill(GRAY, 100), ...fill(RED, 100)])!
  assert.equal(result.source >>> 24, 255)
  assert.equal(result.average >>> 24, 255)
})

test('半透明像素被跳过（图标/带透明通道封面不污染结果）', () => {
  const transparent = fill(0x00FF00FF, 3000)
  const result = analyzeArgbPixels([...transparent, ...fill(GRAY, 1000)])!
  // 断言要钉死数值：除以 pixels.length 而不是 opaque.length 时平均色会变成 0xff202020，
  // 色度仍是 1.9，只比色度的话这条就漏过了 —— 而 Task 2 的蒙版正好吃这个平均色。
  assert.equal(result.average, GRAY, `average=${result.average.toString(16)}`)
  assert.equal(result.source, GRAY, `source=${result.source.toString(16)}`)
  assert.ok(Hct.fromInt(result.source).chroma < 5)
})

test('空数组 / 全透明 / 非法输入返回 null', () => {
  assert.equal(analyzeArgbPixels([]), null)
  assert.equal(analyzeArgbPixels(fill(0x00FFFFFF, 100)), null)
  assert.equal(analyzeArgbPixels(null as unknown as number[]), null)
  assert.equal(analyzeArgbPixels(undefined as unknown as number[]), null)
  // array-like 是 Array.isArray 这道守卫存在的理由，不测它就是没守卫
  assert.equal(analyzeArgbPixels({ length: 3 } as unknown as number[]), null)
})

test('量化色数用官方 128', () => {
  assert.equal(QUANTIZE_COLORS, 128)
})

// 多色混合才能把 Wsmeans 的初始簇抖动暴露出来；纯色/两色抖动不出差别。
// 但只有色带还不够：实测这份 6 色纯色块 50 次出的是同一种源色（Wu 给的起始簇太干净，
// 上游那句随机分配初始簇抖不出结果），用例就会变成永真的摆设。真实封面缩略图几乎
// 没有两个像素同色，所以这里给每个像素叠 ±12 的抖动。
// 抖动用的是固定整数哈希，**不能**用 Math.random —— 否则 canary 数到的是这里，不是量化。
const PALETTE = [0xFFF3DC2F, 0xFF3C5A3E, 0xFF8A2C2C, 0xFF244C6E, 0xFFD8C8A8, 0xFF5A5A5A]
const jitter = (x: number, y: number, k: number) => (Math.imul(x * 31 + y * 71 + k * 17 + 11, 2654435761) >>> 0) % 25 - 12
const clampChan = (argb: number, shift: number, delta: number) =>
  Math.min(255, Math.max(0, ((argb >> shift) & 0xff) + delta))

const mixedPixels = () => {
  const out: number[] = []
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const argb = PALETTE[((x >> 4) + (y >> 4)) % PALETTE.length]
      const rgb =
        (clampChan(argb, 16, jitter(x, y, 0)) << 16) |
        (clampChan(argb, 8, jitter(x, y, 1)) << 8) |
        clampChan(argb, 0, jitter(x, y, 2))
      out.push(((0xff << 24) | rgb) >>> 0)
    }
  }
  return out
}

test('同一份像素重复取色必须给同一个源色（上游 quantizer_wsmeans 用裸 Math.random）', () => {
  const pixels = mixedPixels()
  const first = analyzeArgbPixels(pixels)!.source
  for (let i = 0; i < 50; i++) {
    assert.equal(analyzeArgbPixels(pixels)!.source, first, `第 ${i + 1} 次取色漂了源色`)
  }
})

test('canary：量化确实在消费 Math.random —— 计数归零就该删掉 seeding 包裹', () => {
  let calls = 0
  const original = Math.random
  Math.random = () => {
    calls += 1
    return original()
  }
  try {
    analyzeArgbPixels(mixedPixels())
  } finally {
    Math.random = original
  }
  // 这条是承重的墓碑用例：@material 的 JS 移植版把随机留在 quantizer_wsmeans.js:95。
  // 哪天上游改成确定性实现，calls 变 0，这里会红 —— 那时请删掉 withSeededRandom，不要留着。
  assert.ok(calls > 0, 'Math.random 未被消费：seeding 包裹已成死代码，删掉 withSeededRandom')
})
