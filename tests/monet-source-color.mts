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

test('全灰像素不崩，源色与平均色都无色度', () => {
  const result = analyzeArgbPixels(fill(GRAY, 4096))!
  assert.ok(Hct.fromInt(result.source).chroma < 5)
  assert.ok(Hct.fromInt(result.average).chroma < 5)
})

test('输出 alpha 恒为 255（供 Hct.fromInt 使用）', () => {
  const result = analyzeArgbPixels([...fill(GRAY, 100), ...fill(RED, 100)])!
  assert.equal(result.source >>> 24, 255)
  assert.equal(result.average >>> 24, 255)
})

test('半透明像素被跳过（图标/带透明通道封面不污染结果）', () => {
  const transparent = fill(0x00FF00FF, 3000)
  const result = analyzeArgbPixels([...transparent, ...fill(GRAY, 1000)])!
  assert.ok(Hct.fromInt(result.source).chroma < 5)
})

test('空数组 / 全透明 / 非法输入返回 null', () => {
  assert.equal(analyzeArgbPixels([]), null)
  assert.equal(analyzeArgbPixels(fill(0x00FFFFFF, 100)), null)
  assert.equal(analyzeArgbPixels(null as unknown as number[]), null)
})

test('量化色数用官方 128', () => {
  assert.equal(QUANTIZE_COLORS, 128)
})
