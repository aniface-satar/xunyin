import test from 'node:test'
import assert from 'node:assert/strict'

import { Contrast } from '@material/material-color-utilities/contrast/contrast.js'
import { Hct } from '@material/material-color-utilities/hct/hct.js'

import { BAND_HEADROOM, DARK_ANCHOR_TONE, LIGHT_ANCHOR_TONE, MIN_CONTRAST, TEXTURE_TONE_SWING, buildCoverSurface, buildToneBand, parseCssColor } from '../src/utils/monet/surface.ts'

// 仓库 17 套内置主题里 c-font 恒等于 c-850（src/theme/themes/index.ts:77），实测只有两个值
const LIGHT_FONT = parseCssColor('rgb(66,66,66)')!
const DARK_FONT = parseCssColor('rgb(219,219,219)')!
const ORANGE = 0xFFE8551F
const GATE = MIN_CONTRAST + BAND_HEADROOM

// buildCoverSurface 交出去的底色就是这两个锚点夹完色域的值（tone 实测 96.1149 / 10.0143）
const anchorBase = (tone: number) => Hct.from(Hct.fromInt(ORANGE).hue, 12, tone).toInt() >>> 0

test('亮主题的带就是实测那条：[72, 100]，宽 28', () => {
  const band = buildToneBand(anchorBase(LIGHT_ANCHOR_TONE), LIGHT_FONT)!
  assert.equal(band.lo, 72)
  assert.equal(band.hi, 100)
})

test('暗主题的带是 [0, 36]，宽 36（被 swing 而非对比度卡住）', () => {
  const band = buildToneBand(anchorBase(DARK_ANCHOR_TONE), DARK_FONT)!
  assert.equal(band.lo, 0)
  assert.equal(band.hi, 36)
})

test('带的两端对字色都留得住：tone 判据 >= MIN_CONTRAST + BAND_HEADROOM', () => {
  for (const [base, font] of [[LIGHT_ANCHOR_TONE, LIGHT_FONT], [DARK_ANCHOR_TONE, DARK_FONT]] as [number, number][]) {
    const baseArgb = anchorBase(base)
    const band = buildToneBand(baseArgb, font)!
    const fontTone = Hct.fromInt(font).tone
    const anchor = Math.floor(Hct.fromInt(baseArgb).tone)
    assert.ok(Contrast.ratioOfTones(band.lo, fontTone) >= GATE)
    assert.ok(Contrast.ratioOfTones(band.hi, fontTone) >= GATE)
    // 端点必须"顶到东西"：tone 域边界 / swing 上限 / 再往字色那边一步就破线，三者必居其一，
    // 否则带只是合法而没吃满（把 swing 调小或把 headroom 调大都会红在这里）。
    assert.ok(band.lo === 0 || anchor - band.lo === TEXTURE_TONE_SWING || Contrast.ratioOfTones(band.lo - 1, fontTone) < GATE, `lo=${band.lo} 既没顶到 0 也没顶到 swing，下一步也还没破线`)
    assert.ok(band.hi === 100 || band.hi - anchor === TEXTURE_TONE_SWING || Contrast.ratioOfTones(band.hi + 1, fontTone) < GATE, `hi=${band.hi} 既没顶到 100 也没顶到 swing，下一步也还没破线`)
  }
})

test('两端各被哪个约束卡住（实测数字）：亮主题靠字色那端是对比度，暗主题那端是 swing', () => {
  const lightBaseArgb = anchorBase(LIGHT_ANCHOR_TONE)
  const lightFontTone = Hct.fromInt(LIGHT_FONT).tone
  const light = buildToneBand(lightBaseArgb, LIGHT_FONT)!
  // 72 合法（4.6572）、71 破线（4.5164）：亮主题 28 的带宽全是对比度给的，上界才被 tone<=100 顶死
  assert.ok(Contrast.ratioOfTones(light.lo, lightFontTone) >= GATE)
  assert.ok(Contrast.ratioOfTones(light.lo - 1, lightFontTone) < GATE)
  assert.equal(light.hi, 100)

  const darkBaseArgb = anchorBase(DARK_ANCHOR_TONE)
  const darkFontTone = Hct.fromInt(DARK_FONT).tone
  const dark = buildToneBand(darkBaseArgb, DARK_FONT)!
  // 36 = floor(10.0143) + 26，是被 swing 卡住的：37 对字色还剩 5.2165，根本没破线。
  // 这条与上一条相反 —— 拿 "hi+1 必须破线" 去统一要求两端是错的，暗主题会当场红。
  assert.ok(Contrast.ratioOfTones(dark.hi + 1, darkFontTone) >= GATE, '暗主题的 hi 应当被 swing 而不是对比度卡住')
  assert.equal(dark.hi - Math.floor(Hct.fromInt(darkBaseArgb).tone), TEXTURE_TONE_SWING)
  assert.equal(dark.lo, 0)
})

test('带一定包住底色本身，且总宽不超过 2×swing', () => {
  for (const font of [LIGHT_FONT, DARK_FONT]) {
    for (const src of [ORANGE, 0xFFFFFFFF, 0xFF808080, 0xFF123456]) {
      const s = buildCoverSurface(src, src, font)
      if (s == null) continue
      const baseTone = Hct.fromInt(parseCssColor(s.base)!).tone
      assert.ok(s.band.lo <= baseTone + 1e-6 && s.band.hi >= baseTone - 1e-6, `底色 tone ${baseTone} 不在带 ${JSON.stringify(s.band)} 内`)
      assert.ok(s.band.hi - s.band.lo <= TEXTURE_TONE_SWING * 2)
      assert.ok(s.band.lo >= 0 && s.band.hi <= 100)
    }
  }
})

test('非法 argb 不产带（NaN / 带透明通道）', () => {
  assert.equal(buildToneBand(NaN, LIGHT_FONT), null)
  assert.equal(buildToneBand(0x80E8551F, LIGHT_FONT), null)
  assert.equal(buildToneBand(ORANGE, NaN), null)
})

// 内置主题只有两种字色，但用户主题从存储读（src/theme/themes/index.ts:22），字色 tone 可以贴着 50。
// 那一带取整会把靠字色的端点推过线（实测 rgb(111,111,111) + 黑封面：带 [95,100]，95 只有 4.4323）。
test('任意灰阶字色：带内每一个整数 tone 都 >= MIN_CONTRAST + BAND_HEADROOM，否则整个 surface 回落 null', () => {
  let checked = 0
  for (let g = 0; g <= 255; g += 3) {
    const font = (0xFF000000 | (g << 16) | (g << 8) | g) >>> 0
    const fontTone = Hct.fromInt(font).tone
    for (const src of [0xFF000000, 0xFF808080, ORANGE, 0xFF123456, 0xFFFFFFFF]) {
      const s = buildCoverSurface(src, src, font)
      if (s == null) continue
      checked++
      assert.ok(Number.isInteger(s.band.lo) && Number.isInteger(s.band.hi) && s.band.lo <= s.band.hi)
      for (let t = s.band.lo; t <= s.band.hi; t++) {
        assert.ok(Contrast.ratioOfTones(t, fontTone) >= GATE, `字色 rgb(${g},${g},${g}) 封面 ${src.toString(16)}：带 ${JSON.stringify(s.band)} 里 tone ${t} 只有 ${Contrast.ratioOfTones(t, fontTone).toFixed(4)}`)
      }
    }
  }
  assert.ok(checked > 300, `只检查了 ${checked} 例，扫描退化了`)
})

test('reviewer 复现的那例：rgb(111,111,111) + 黑封面，亮端收到 97（4.6631），底色 95.84 让位给可读性', () => {
  const s = buildCoverSurface(0xFF000000, 0xFF000000, parseCssColor('rgb(111,111,111)')!)!
  assert.deepEqual(s.band, { lo: 97, hi: 100 })
})
