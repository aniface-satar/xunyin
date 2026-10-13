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
