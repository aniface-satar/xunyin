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

// —— 以下 5 条是任务评审补的用例。前 3 条对旧实现（未钳制通道、未挡 NaN/透明、未做 gamut 后校验）
//    实测为红；后 2 条实测旧实现也为绿 —— 它们守的是"循环/削彩真的在起作用"，删掉对应防护才红。
//    每条期望值都本机复现过，见行内注释。

test('底色 tone 钳制循环真的会触发：中灰字色逼底色压到暗锚以下', () => {
  const font = 0xFF787878 // tone 50.43，走暗分支
  assert.ok(Hct.fromInt(font).tone > 50)
  const base = Hct.fromInt(parseCssColor(buildCoverSurface(ORANGE, ORANGE, font)!.base)!)
  assert.ok(base.tone < DARK_ANCHOR_TONE, `baseTone ${base.tone} 应低于暗锚 ${DARK_ANCHOR_TONE}，实测 1.93`)
  assert.ok(Contrast.ratioOfTones(base.tone, Hct.fromInt(font).tone) >= MIN_CONTRAST)
})

test('字色落在分支切分线附近时不跨侧硬凑，宁可按 null 回落', () => {
  // 实测：字色 tone 49.92 被判为"亮主题"→ 走高 tone 端，纯白 rgb(255,255,255) 也只有 4.4962 < 4.5。
  // 低 tone 端其实够得到（tone 0 → 4.6706），但底色跨侧意味着整页从亮翻成黑，是看得见的乱来，
  // 所以设计上是"够不到就 null"，不是"换一侧再试"。
  const font = Hct.from(0, 20, 49.95).toInt() >>> 0
  assert.ok(Hct.fromInt(font).tone < 50, '夹具要落在切分线的亮侧')
  assert.equal(buildCoverSurface(ORANGE, ORANGE, font), null)
})

test('削彩上限真的在削：hue 115 在高 tone 端有色度空间，必须压到 CHROMA_CAP 以下', () => {
  const src = Hct.from(115, 120, 50).toInt() >>> 0
  assert.ok(Hct.fromInt(src).chroma > CHROMA_CAP + 10, '夹具要能被上限咬到')
  const base = Hct.fromInt(parseCssColor(buildCoverSurface(src, src, LIGHT_FONT)!.base)!)
  assert.ok(base.chroma <= CHROMA_CAP + 1, `base chroma ${base.chroma} 实测 36.07；不削彩则为 50.21`)
})

test('CSS 通道越界按 255 钳制，不做位运算溢出', () => {
  assert.equal(parseCssColor('rgb(300, 0, 0)'), 0xFFFF0000)
})

test('入参非整数或 alpha 不足 255 一律 null，不被 >>> 0 吞成黑色', () => {
  assert.equal(buildCoverSurface(NaN, ORANGE, LIGHT_FONT), null)
  assert.equal(buildCoverSurface(ORANGE, NaN, LIGHT_FONT), null)
  assert.equal(buildCoverSurface(ORANGE, ORANGE, NaN), null)
  assert.equal(buildCoverSurface(0x80E8551F, ORANGE, LIGHT_FONT), null)
})

test('buildCoverSurface 交出合法色阶带（纹理层的明度只能在这个区间里摆）', () => {
  const s = buildCoverSurface(ORANGE, ORANGE, LIGHT_FONT)!
  assert.ok(s.band.hi - s.band.lo >= 20, `带宽只有 ${s.band.hi - s.band.lo}，纹理没得摆`)
  for (const t of [s.band.lo, s.band.hi]) {
    assert.ok(Contrast.ratioOfTones(t, Hct.fromInt(LIGHT_FONT).tone) >= MIN_CONTRAST)
  }
})
