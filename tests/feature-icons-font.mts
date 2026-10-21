import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { FEATURE_ICON_FONT_FILE, featureIconGlyphs } from '../src/resources/fonts/featureIcons.ts'

// 这个文件只干一件事：钉住「新图标跟现有图标是同一套规格」这件事。
// 字体是脚本生成的二进制产物，肉眼看不出错，所以这里用最小的 sfnt 读取把它量一遍。
// 读取器本身先用 icomoon.ttf（全站正在用、码点已知）验一遍，量得准才谈得上量新字体。

const FONT_DIR = path.join(import.meta.dirname, '../src/resources/fonts')
const ANDROID_FONT_DIR = path.join(import.meta.dirname, '../android/app/src/main/assets/fonts')

interface Font {
  unitsPerEm: number
  ascent: number
  descent: number
  numGlyphs: number
  glyphIdFor: (codePoint: number) => number
  bboxOf: (glyphId: number) => Box | null
  advanceOf: (glyphId: number) => number
}
interface Box { xMin: number, yMin: number, xMax: number, yMax: number }

const readFont = (buf: Buffer): Font => {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const tagAt = (o: number) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3))
  const tables: Record<string, number> = {}
  for (let i = 0; i < dv.getUint16(4); i++) {
    const o = 12 + i * 16
    tables[tagAt(o)] = dv.getUint32(o + 8)
  }
  const head = tables.head
  const hhea = tables.hhea
  const unitsPerEm = dv.getUint16(head + 18)
  const longLoca = dv.getInt16(head + 50) === 1
  const ascent = dv.getInt16(hhea + 4)
  const descent = dv.getInt16(hhea + 6)
  const numGlyphs = dv.getUint16(tables.maxp + 4)
  const numHMetrics = dv.getUint16(hhea + 34)

  const cmap = tables.cmap
  let sub = -1
  for (let i = 0; i < dv.getUint16(cmap + 2); i++) {
    const rec = cmap + 4 + i * 8
    const platform = dv.getUint16(rec)
    const encoding = dv.getUint16(rec + 2)
    if (platform === 3 && (encoding === 1 || encoding === 0)) sub = cmap + dv.getUint32(rec + 4)
    if (platform === 0 && sub < 0) sub = cmap + dv.getUint32(rec + 4)
  }
  const glyphIdFor = (codePoint: number) => {
    if (sub < 0) return 0
    const format = dv.getUint16(sub)
    if (format === 4) {
      const segX2 = dv.getUint16(sub + 6)
      const segCount = segX2 / 2
      const ends = sub + 14
      const starts = ends + segX2 + 2
      const deltas = starts + segX2
      const ranges = deltas + segX2
      for (let s = 0; s < segCount; s++) {
        if (codePoint > dv.getUint16(ends + s * 2)) continue
        if (codePoint < dv.getUint16(starts + s * 2)) break
        const rangeOffset = dv.getUint16(ranges + s * 2)
        if (rangeOffset === 0) return (codePoint + dv.getInt16(deltas + s * 2)) & 0xffff
        const idOffset = ranges + s * 2 + rangeOffset + (codePoint - dv.getUint16(starts + s * 2)) * 2
        const id = dv.getUint16(idOffset)
        if (id === 0) return 0
        return (id + dv.getInt16(deltas + s * 2)) & 0xffff
      }
      return 0
    }
    if (format === 12) {
      const groups = dv.getUint32(sub + 12)
      for (let i = 0; i < groups; i++) {
        const rec = sub + 16 + i * 12
        const start = dv.getUint32(rec)
        if (codePoint < start || codePoint > dv.getUint32(rec + 4)) continue
        return dv.getUint32(rec + 8) + (codePoint - start)
      }
      return 0
    }
    throw new Error(`未支持的 cmap 格式 ${format}`)
  }
  const loca = tables.loca
  const locOf = (g: number) => longLoca ? dv.getUint32(loca + g * 4) : dv.getUint16(loca + g * 2) * 2
  const bboxOf = (g: number): Box | null => {
    const start = locOf(g)
    if (start === locOf(g + 1)) return null
    const o = tables.glyf + start
    return { xMin: dv.getInt16(o + 2), yMin: dv.getInt16(o + 4), xMax: dv.getInt16(o + 6), yMax: dv.getInt16(o + 8) }
  }
  const advanceOf = (g: number) => dv.getUint16(tables.hmtx + Math.min(g, numHMetrics - 1) * 4)

  return { unitsPerEm, ascent, descent, numGlyphs, glyphIdFor, bboxOf, advanceOf }
}

const inkHeight = (box: Box) => box.yMax - box.yMin

const icomoon = readFont(readFileSync(path.join(FONT_DIR, 'icomoon.ttf')))

// --- 先验读取器：拿全站正在用的 icomoon 对答案 ---

test('字体读取器能按已知码点取到 icomoon 的字形（否则下面的断言都不作数）', () => {
  assert.equal(icomoon.unitsPerEm, 1024)
  for (const [name, codePoint] of [['love', 0xE909], ['music_time', 0xE900]] as const) {
    const id = icomoon.glyphIdFor(codePoint)
    assert.ok(id > 0, `${name} @U+${codePoint.toString(16)} 应能解析出字形`)
    assert.ok(icomoon.bboxOf(id), `${name} 应有轮廓数据`)
  }
  assert.equal(icomoon.glyphIdFor(0xE9C0), 0, 'U+E9C0 起是新字体的地盘，icomoon 不该占')
})

// --- 新字体 ---

const feature = readFont(readFileSync(path.join(FONT_DIR, FEATURE_ICON_FONT_FILE)))
const historyTop = icomoon.bboxOf(icomoon.glyphIdFor(0xE900))!.yMax

test('每枚入口字形都在字体里，且各有墨迹', () => {
  for (const [name, char] of Object.entries(featureIconGlyphs)) {
    const codePoint = char.codePointAt(0)!
    const id = feature.glyphIdFor(codePoint)
    assert.ok(id > 0, `${name} 的码点 U+${codePoint.toString(16)} 没进 cmap`)
    const box = feature.bboxOf(id)
    assert.ok(box && inkHeight(box) > 0, `${name} 是空字形`)
    assert.ok(feature.advanceOf(id) > 0, `${name} 没有步进宽度，排版会叠字`)
  }
})

test('度量与 icomoon 一致，22dp 下才能同基线同大小', () => {
  assert.equal(feature.unitsPerEm, icomoon.unitsPerEm)
  assert.equal(feature.ascent, icomoon.ascent)
  assert.equal(feature.descent, icomoon.descent)
  // 只比 yMax（墨迹顶到基线的距离）：svg2ttf 写出的 glyf 头里 xMin/yMin 恒为 0，
  // 只有 xMax/yMax 可信，用墨迹高度比会得出假结论
  for (const [name, char] of Object.entries(featureIconGlyphs)) {
    const box = feature.bboxOf(feature.glyphIdFor(char.codePointAt(0)!))!
    // 观感底线：跟「历史播放」的墨迹顶高差不到一成半，否则同排摆着就是一大一小
    const ratio = box.yMax / historyTop
    assert.ok(ratio > 0.85 && ratio < 1.15, `${name} 墨迹顶高是「历史播放」的 ${(ratio * 100).toFixed(0)}%，超出 ±15%`)
  }
})

test('每枚字形的墨迹都在 em 框内，不会越框被裁或压到相邻文字', () => {
  for (const [name, char] of Object.entries(featureIconGlyphs)) {
    const id = feature.glyphIdFor(char.codePointAt(0)!)
    const box = feature.bboxOf(id)!
    assert.ok(box.yMax <= feature.ascent, `${name} 顶部越出 ascent`)
    assert.ok(box.xMax <= feature.advanceOf(id), `${name} 右侧越出步进宽度`)
  }
})

test('安卓 assets 里那份与 src 下那份是同一个文件', () => {
  const a = readFileSync(path.join(FONT_DIR, FEATURE_ICON_FONT_FILE))
  const b = readFileSync(path.join(ANDROID_FONT_DIR, FEATURE_ICON_FONT_FILE))
  assert.ok(a.equals(b), '两份字体不一致，运行时用的可能是旧的那份')
})

test('码点表用的是单个私用区字符，别写成码点数或代理对', () => {
  for (const [name, char] of Object.entries(featureIconGlyphs)) {
    assert.equal(char.length, 1, `${name} 不该是多个字符`)
    const codePoint = char.codePointAt(0)!
    assert.ok(codePoint >= 0xE000 && codePoint <= 0xF8FF, `${name} 的 U+${codePoint.toString(16)} 不在私用区`)
  }
})
