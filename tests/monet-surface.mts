import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CHROMA_CAP,
  DARK_ANCHOR_TONE,
  LIGHT_ANCHOR_TONE,
  MIN_CONTRAST,
  buildCoverSurface,
  parseCssColor,
} from '../src/utils/monet/surface.ts'
import { Contrast } from '@material/material-color-utilities/contrast/contrast.js'
import { Hct } from '@material/material-color-utilities/hct/hct.js'

const LIGHT_FONT = parseCssColor('rgb(33, 33, 33)')!
const DARK_FONT = parseCssColor('rgb(229, 229, 229)')!
const ORANGE = 0xFFE8551F
const WHITE = 0xFFFFFFFF
const GRAY = 0xFF808080

test('parseCssColor 支持 rgb 与 rgba，非 rgb 字符串返回 null', () => {
  assert.equal(parseCssColor('rgb(33, 33, 33)'), 0xFF212121)
  assert.equal(parseCssColor('rgba(255, 255, 255, 0.9)'), 0xFFFFFFFF)
  assert.equal(parseCssColor('#212121'), null)
  assert.equal(parseCssColor(''), null)
})

test('亮主题：底色落在高 tone 端，色相跟封面走', () => {
  const s = buildCoverSurface(ORANGE, ORANGE, LIGHT_FONT)!
  const tone = Hct.fromInt(parseCssColor(s.base)!).tone
  assert.ok(tone >= LIGHT_ANCHOR_TONE, `tone ${tone} 应 >= ${LIGHT_ANCHOR_TONE}`)
  assert.ok(Math.abs(Hct.fromInt(parseCssColor(s.base)!).hue - Hct.fromInt(ORANGE).hue) < 12)
})

test('暗主题：底色落在低 tone 端', () => {
  const s = buildCoverSurface(ORANGE, ORANGE, DARK_FONT)!
  const tone = Hct.fromInt(parseCssColor(s.base)!).tone
  assert.ok(tone <= DARK_ANCHOR_TONE + 4, `tone ${tone} 应 <= ${DARK_ANCHOR_TONE + 4}`)
})

test('底色与字色对比度恒 >= 4.5（任意封面）', () => {
  const sources = [ORANGE, WHITE, GRAY, 0xFF0000FF, 0xFF00FF00, 0xFF123456, 0xFFFEDCBA]
  for (const font of [LIGHT_FONT, DARK_FONT]) {
    for (const src of sources) {
      const s = buildCoverSurface(src, src, font)!
      const ratio = Contrast.ratioOfTones(Hct.fromInt(parseCssColor(s.base)!).tone, Hct.fromInt(font).tone)
      assert.ok(ratio >= MIN_CONTRAST, `src=${src.toString(16)} font=${font.toString(16)} ratio=${ratio}`)
    }
  }
})

test('高饱和封面被削到 CHROMA_CAP，灰封面不造假彩色', () => {
  const vivid = Hct.from(30, 120, 50).toInt()
  assert.ok(Hct.fromInt(parseCssColor(buildCoverSurface(vivid, vivid, LIGHT_FONT)!.base)!).chroma <= CHROMA_CAP + 1)
  const graySurface = buildCoverSurface(GRAY, GRAY, LIGHT_FONT)!
  assert.ok(Hct.fromInt(parseCssColor(graySurface.base)!).chroma < 3)
})

test('白封面压在暗底上时蒙版变实，暗封面则允许透出', () => {
  const darkFont = DARK_FONT
  const whiteCover = buildCoverSurface(GRAY, WHITE, darkFont)!
  const darkCover = buildCoverSurface(GRAY, 0xFF101010, darkFont)!
  assert.ok(whiteCover.scrimAlpha >= 0.85, `白封面 scrim=${whiteCover.scrimAlpha}`)
  assert.ok(darkCover.scrimAlpha <= 0.5, `暗封面 scrim=${darkCover.scrimAlpha}`)
})

test('scrimAlpha 恒在 [0.45, 0.9] 且保留两位小数', () => {
  for (const avg of [0xFF000000, 0xFF7F7F7F, 0xFFFFFFFF, ORANGE]) {
    const s = buildCoverSurface(ORANGE, avg, LIGHT_FONT)!
    assert.ok(s.scrimAlpha >= 0.45 && s.scrimAlpha <= 0.9)
    assert.equal(s.scrimAlpha, Number(s.scrimAlpha.toFixed(2)))
  }
})

test('字体色非法时返回 null，让调用方回落', () => {
  assert.equal(buildCoverSurface(ORANGE, ORANGE, 0x00000000), null)
})
