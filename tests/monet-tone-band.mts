import test from 'node:test'
import assert from 'node:assert/strict'

import { Contrast } from '@material/material-color-utilities/contrast/contrast.js'
import { Hct } from '@material/material-color-utilities/hct/hct.js'

import {
  BAND_HEADROOM,
  LIGHT_ANCHOR_TONE,
  MIN_CONTRAST,
  ON_COVER_FONT,
  TEXTURE_ANCHOR_TONE,
  TEXTURE_TONE_SWING,
  buildCoverSurface,
  buildToneBand,
  parseCssColor,
} from '../src/utils/monet/surface.ts'

// 仓库 17 套内置主题里 c-font 恒等于 c-850（src/theme/themes/index.ts:77），实测只有两个值
const LIGHT_FONT = parseCssColor('rgb(66,66,66)')!
const DARK_FONT = parseCssColor('rgb(219,219,219)')!
const ORANGE = 0xFFE8551F
const GATE = MIN_CONTRAST + BAND_HEADROOM

/** 封面侧走 CoverMeasure：夹具里三张封面都是纯色块，所以三个测量值同值。
 *  拆成对象是为了让"average 与 highlight 传反"这种错在测试里也写不出来。 */
const m = (argb: number) => ({ sourceArgb: argb, averageArgb: argb, highlightArgb: argb })

// 带按锚点那一支颜色自己算，不借 buildCoverSurface 的底色（亮支两者同值，暗支不同：见下）
const anchorBase = (tone: number) => Hct.from(Hct.fromInt(ORANGE).hue, 12, tone).toInt() >>> 0

// 纯色方案恢复后，带只喂纹理支（现在没接进 UI，留着是为了可逆）。
// 旧文件里"暗主题的带是 [0, 36]"那类用例钉的是 swing=26 + 锚点 88 的旧参数，已随取色一起重标。
test('亮主题的带是实测那条：[72, 88]（靠字色那端被对比度卡死，另一端被 swing 卡死）', () => {
  const band = buildToneBand(anchorBase(LIGHT_ANCHOR_TONE), LIGHT_FONT)!
  assert.equal(band.lo, 72)
  assert.equal(band.hi, 88)

  const fontTone = Hct.fromInt(LIGHT_FONT).tone
  // 72 合法（4.6572）、71 破线（4.5164）：下界是对比度给的
  assert.ok(Contrast.ratioOfTones(band.lo, fontTone) >= GATE)
  assert.ok(Contrast.ratioOfTones(band.lo - 1, fontTone) < GATE)
  // 上界 88 = floor(77.99) + swing(11)，而 89 对字色还剩 7.5769 —— 完全是 swing 卡的，不是闸门
  assert.equal(band.hi - Math.floor(Hct.fromInt(anchorBase(LIGHT_ANCHOR_TONE)).tone), TEXTURE_TONE_SWING)
  assert.ok(Contrast.ratioOfTones(band.hi + 1, fontTone) >= GATE, '上界应由 swing 卡住，不是对比度')
})

test('带塌了就是塌了：暗主题那支中灰字色在带锚 48 上够不着闸门，白墨才摆得开', () => {
  // 内置暗主题字色 L*87.4（不是纯白），48 这一端离它太近，整数 tone 里没有一档过 4.6。
  assert.equal(buildToneBand(anchorBase(TEXTURE_ANCHOR_TONE), DARK_FONT), null)
  // 换回真正的白墨（ON_COVER_FONT，动态背景的目标墨色），同一带锚就有 14 格可摆 —— 塌的不是带数学，是字色。
  assert.deepEqual(buildToneBand(anchorBase(TEXTURE_ANCHOR_TONE), ON_COVER_FONT), { lo: 36, hi: 49 })
})

test('带一定落在 tone 域内、宽度不超过 2×swing，且两端都留得住', () => {
  for (const [base, font] of [[LIGHT_ANCHOR_TONE, LIGHT_FONT]] as [number, number][]) {
    const baseArgb = anchorBase(base)
    const band = buildToneBand(baseArgb, font)!
    const fontTone = Hct.fromInt(font).tone
    const anchor = Math.floor(Hct.fromInt(baseArgb).tone)
    assert.ok(Contrast.ratioOfTones(band.lo, fontTone) >= GATE)
    assert.ok(Contrast.ratioOfTones(band.hi, fontTone) >= GATE)
    assert.ok(band.lo >= 0 && band.hi <= 100 && Number.isInteger(band.lo) && Number.isInteger(band.hi))
    assert.ok(band.hi - band.lo <= TEXTURE_TONE_SWING * 2)
    // 端点必须"顶到东西"：tone 域边界 / swing 上限 / 再往字色那边一步就破线，三者必居其一，
    // 否则带只是合法而没吃满（把 swing 调小或把 headroom 调大都会红在这里）。
    assert.ok(band.lo === 0 || anchor - band.lo === TEXTURE_TONE_SWING || Contrast.ratioOfTones(band.lo - 1, fontTone) < GATE, `lo=${band.lo} 既没顶到 0 也没顶到 swing，下一步也还没破线`)
    assert.ok(band.hi === 100 || band.hi - anchor === TEXTURE_TONE_SWING || Contrast.ratioOfTones(band.hi + 1, fontTone) < GATE, `hi=${band.hi} 既没顶到 100 也没顶到 swing，下一步也还没破线`)
  }
})

test('亮主题：带与底色同源，所以带必包住纯色底', () => {
  // 亮支的带锚就是 LIGHT_ANCHOR_TONE，和底色是同一支颜色，包住是结构性的。
  // 暗支不包（带锚 48、底色 40），用户主题的字色下带会整个消失 —— 纯色底都不受影响。
  for (const src of [ORANGE, 0xFFFFFFFF, 0xFF808080, 0xFF123456]) {
    const s = buildCoverSurface(m(src), LIGHT_FONT)!
    assert.ok(s.band != null, `src=${src.toString(16)} 亮主题不该没带`)
    const baseTone = Hct.fromInt(parseCssColor(s.base)!).tone
    assert.ok(s.band.lo <= baseTone + 1e-6 && s.band.hi >= baseTone - 1e-6, `底色 tone ${baseTone} 不在带 ${JSON.stringify(s.band)} 内`)
  }
})

test('非法 argb 不产带（NaN / 带透明通道）', () => {
  assert.equal(buildToneBand(NaN, LIGHT_FONT), null)
  assert.equal(buildToneBand(0x80E8551F, LIGHT_FONT), null)
  assert.equal(buildToneBand(ORANGE, NaN), null)
})

// 内置主题只有两种字色，但用户主题从存储读（src/theme/themes/index.ts:22），字色 tone 可以贴着 50。
// 旧实现在那一带会"整支 surface 回落 null"（rgb(111,111,111) + 黑封面实测带 [95,100]，95 只有 4.4323）；
// 现在带可以为 null 而纯色底照旧交出，所以这里只核"带存在时段内每档都过闸门"。
test('任意灰阶字色：只要带存在，段内每一个整数 tone 都 >= MIN_CONTRAST + BAND_HEADROOM', () => {
  let withBand = 0
  let bandNull = 0
  let surfaces = 0
  for (let g = 0; g <= 255; g += 3) {
    const font = (0xFF000000 | (g << 16) | (g << 8) | g) >>> 0
    const fontTone = Hct.fromInt(font).tone
    for (const src of [0xFF000000, 0xFF808080, ORANGE, 0xFF123456, 0xFFFFFFFF]) {
      const s = buildCoverSurface(m(src), font)
      if (s == null) continue
      surfaces++
      if (s.band == null) {
        bandNull++
        continue
      }
      withBand++
      assert.ok(Number.isInteger(s.band.lo) && Number.isInteger(s.band.hi) && s.band.lo <= s.band.hi)
      for (let t = s.band.lo; t <= s.band.hi; t++) {
        assert.ok(Contrast.ratioOfTones(t, fontTone) >= GATE, `字色 rgb(${g},${g},${g}) 封面 ${src.toString(16)}：带 ${JSON.stringify(s.band)} 里 tone ${t} 只有 ${Contrast.ratioOfTones(t, fontTone).toFixed(4)}`)
      }
    }
  }
  assert.ok(withBand > 100, `只检查了 ${withBand} 例有带的情况，扫描退化了`)
  // 实测 415 支里有 256 支带是 null（暗主题整档都是）：这条钉住"带不是必需"这个结局，
  // 哪天有人把 return null 的连坐改回来，这里不会红、monet-surface 那边会红。
  assert.ok(bandNull > 100, `${bandNull} 例带为 null，说明扫描没覆盖到塌带那一带字色`)
  assert.ok(surfaces > 300, `纯色底只交出 ${surfaces} 支，扫描退化`)
})

test('reviewer 复现的那例：rgb(111,111,111) + 黑封面，底色 95.84 照旧交出，带为 null', () => {
  const s = buildCoverSurface(m(0xFF000000), parseCssColor('rgb(111,111,111)')!)!
  assert.equal(s.band, null)
  const baseTone = Hct.fromInt(parseCssColor(s.base)!).tone
  assert.ok(baseTone > 95 && baseTone < 96, `底色 tone 实测 95.84，跑偏了：${baseTone}`)
  assert.ok(Contrast.ratioOfTones(baseTone, Hct.fromInt(parseCssColor('rgb(111,111,111)')!).tone) >= MIN_CONTRAST)
})
