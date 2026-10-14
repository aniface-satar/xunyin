import test from 'node:test'
import assert from 'node:assert/strict'

import { Contrast } from '@material/material-color-utilities/contrast/contrast.js'
import { Hct } from '@material/material-color-utilities/hct/hct.js'

import {
  CHROMA_FLOOR,
  COVER_SPAN_REF,
  COVER_WEIGHT,
  MARBLE_FREQ,
  TEXTURE_OUT_HEIGHT,
  TEXTURE_OUT_WIDTH_MAX,
  TEXTURE_ROWS_PER_CHUNK,
  WARP_STRENGTH,
  buildTextureRgba,
  textureWidthFor,
} from '../src/utils/monet/texture.ts'
import { CHROMA_CAP, MIN_CONTRAST, parseCssColor } from '../src/utils/monet/surface.ts'

const LIGHT_FONT = parseCssColor('rgb(66,66,66)')!
const DARK_FONT = parseCssColor('rgb(219,219,219)')!
const BAND_LIGHT = { lo: 72, hi: 100 }
const BAND_DARK = { lo: 0, hi: 36 }

// 与真机那张专辑同构的假封面：左上暗、右下亮、中间一道暖色带，保证有"结构"可跟
const cover = (w = 32, h = 32) => {
  const pixels: number[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round(40 + 190 * ((x / (w - 1)) * 0.6 + (y / (h - 1)) * 0.4))
      pixels.push((0xff << 24 | Math.min(255, v + 20) << 16 | Math.min(255, v) << 8 | Math.max(0, v - 60)) >>> 0)
    }
  }
  return { pixels, width: w, height: h }
}

const lum = (r: number, g: number, b: number) => {
  const chan = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * chan(r / 255) + 0.7152 * chan(g / 255) + 0.0722 * chan(b / 255)
}
const wcag = (a: number[], b: number[]) => {
  const la = lum(a[0], a[1], a[2])
  const lb = lum(b[0], b[1], b[2])
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
const argbToRgb = (argb: number) => [(argb >> 16) & 255, (argb >> 8) & 255, argb & 255]
const fontRgb = (argb: number) => argbToRgb(argb >>> 0)

test('同一份输入两次生成逐字节相同（纹理绝不能跟着重绘变样）', async() => {
  const req = { source: cover(), band: BAND_LIGHT, outWidth: 16, outHeight: 36 }
  assert.deepEqual(Array.from(await buildTextureRgba(req)), Array.from(await buildTextureRgba(req)))
})

test('每个 texel 都落在合法色阶带里（允许色域夹断的 tolerance）', async() => {
  const band = BAND_LIGHT
  const rgba = await buildTextureRgba({ source: cover(), band, outWidth: 16, outHeight: 36 })
  const tones: number[] = []
  for (let i = 0; i < rgba.length; i += 4) {
    const tone = Hct.fromInt((0xff << 24 | rgba[i] << 16 | rgba[i + 1] << 8 | rgba[i + 2]) >>> 0).tone
    assert.ok(tone >= band.lo - 1.5 && tone <= band.hi + 1.5, `tone ${tone} 越界（带 ${band.lo}~${band.hi}）`)
    tones.push(tone)
  }
  // 量 p5~p95 而不是 min/max：去掉混合后那次秩归一，两端各剩几个 texel 照样顶到带边，只有中段塌（实测 90% → 65%）
  tones.sort((a, b) => a - b)
  const spread = tones[Math.floor(tones.length * 0.95)] - tones[Math.floor(tones.length * 0.05)]
  assert.ok(spread >= (band.hi - band.lo) * 0.8, `p5~p95 只有 ${spread.toFixed(1)}，没吃满合法带 ${(band.hi - band.lo)}`)
})

test('每个 texel 对字色的真实 WCAG 对比度都 >= 4.5（夹色域也算进去了）', async() => {
  for (const [source, band, font] of [
    [cover(), BAND_LIGHT, LIGHT_FONT],
    [cover(), BAND_DARK, DARK_FONT],
    [cover(128, 96), BAND_LIGHT, LIGHT_FONT],
    [cover(96, 128), BAND_DARK, DARK_FONT],
  ] as [ReturnType<typeof cover>, typeof BAND_LIGHT, number][]) {
    const rgba = await buildTextureRgba({ source, band, outWidth: 16, outHeight: 36 })
    const text = fontRgb(font)
    let worst = Infinity
    for (let i = 0; i < rgba.length; i += 4) {
      worst = Math.min(worst, wcag([rgba[i], rgba[i + 1], rgba[i + 2]], text))
    }
    assert.ok(worst >= MIN_CONTRAST, `最差纹理对字色只剩 ${worst.toFixed(3)}（要求 >= ${MIN_CONTRAST}）`)
  }
})

// HCT 的彩度在这里不能当判据：纯 sRGB 灰本身就读出 1.9~2.9（#ffffff 2.869）。染没染色只看 RGB 三通道齐不齐。
test('灰封面（彩度 0）不会自己染上色：每个 texel 的 RGB 三通道差 <= 1', async() => {
  for (const g of [0x10, 0x80, 0xF0]) {
    const gray = { pixels: new Array(64 * 64).fill((0xFF000000 | g << 16 | g << 8 | g) >>> 0), width: 64, height: 64 }
    for (const band of [BAND_LIGHT, BAND_DARK]) {
      const rgba = await buildTextureRgba({ source: gray, band, outWidth: 16, outHeight: 36 })
      for (let i = 0; i < rgba.length; i += 4) {
        const spread = Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) - Math.min(rgba[i], rgba[i + 1], rgba[i + 2])
        assert.ok(spread <= 1, `灰 ${g} 带 ${JSON.stringify(band)}：texel ${rgba[i]},${rgba[i + 1]},${rgba[i + 2]} 染了色`)
      }
    }
  }
})

// 上黑下白、每一行都不同而第 0 行恒定：模糊若只读第 0 行，封面场就塌成常数，上下半区不再有明暗差
test('封面的上下结构能穿过模糊进纹理（上半明显比下半暗）', async() => {
  const w = 32
  const h = 32
  const pixels: number[] = []
  for (let y = 0; y < h; y++) {
    const v = y < h / 2 ? 0 : 255
    for (let x = 0; x < w; x++) pixels.push((0xFF000000 | v << 16 | v << 8 | v) >>> 0)
  }
  const outWidth = 16
  const outHeight = 36
  const rgba = await buildTextureRgba({ source: { pixels, width: w, height: h }, band: BAND_LIGHT, outWidth, outHeight })
  const meanTone = (y0: number, y1: number) => {
    let sum = 0
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < outWidth; x++) {
        const o = (y * outWidth + x) * 4
        sum += Hct.fromInt((0xff << 24 | rgba[o] << 16 | rgba[o + 1] << 8 | rgba[o + 2]) >>> 0).tone
      }
    }
    return sum / ((y1 - y0) * outWidth)
  }
  const top = meanTone(0, outHeight / 4)
  const bottom = meanTone(outHeight * 3 / 4, outHeight)
  assert.ok(bottom - top >= 5, `上 ${top.toFixed(1)} / 下 ${bottom.toFixed(1)}：封面结构没进纹理`)
})

test('1×1 退化封面不产 NaN，且 alpha 恒 255', async() => {
  const rgba = await buildTextureRgba({ source: { pixels: [0xFFF3DC2F], width: 1, height: 1 }, band: BAND_LIGHT, outWidth: 16, outHeight: 36 })
  assert.equal(rgba.length, 16 * 36 * 4)
  for (let i = 0; i < rgba.length; i += 4) {
    assert.ok(Number.isFinite(rgba[i]) && Number.isFinite(rgba[i + 1]) && Number.isFinite(rgba[i + 2]), `第 ${i / 4} 个 texel 不是有限数`)
    assert.equal(rgba[i + 3], 255)
  }
})

test('分块让路不改变结果（yieldRows 只影响调度，不影响像素）', async() => {
  const req = { source: cover(), band: BAND_LIGHT, outWidth: 17, outHeight: 33 }
  let yields = 0
  const withYield = await buildTextureRgba(req, async() => {
    yields += 1
  })
  const plain = await buildTextureRgba(req)
  assert.deepEqual(Array.from(withYield), Array.from(plain))
  // 17×33：两遍各按 8 行让一次，行数不整除时最后一遍也要让
  assert.ok(yields >= 2 * Math.floor(33 / TEXTURE_ROWS_PER_CHUNK), `只让了 ${yields} 次`)
})

test('输出宽度按屏幕宽高比折算并钳在 [40, 200]', () => {
  assert.equal(textureWidthFor(360, 800), 132)
  assert.equal(textureWidthFor(1080, 2400), 132)
  assert.equal(textureWidthFor(360, 360), TEXTURE_OUT_WIDTH_MAX)
  assert.equal(textureWidthFor(360, 3600), 40)
  assert.equal(textureWidthFor(2000, 800), 200)
})

test('红封面的纹理还是红色系，彩度不超封顶，且越暗的云团越饱和', async() => {
  const w = 64
  const pixels: number[] = []
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round(90 + 120 * (x / (w - 1)))
      pixels.push((0xff << 24 | v << 16 | 20 << 8 | 30) >>> 0)
    }
  }
  const redHue = Hct.fromInt(0xFFC81E1E).hue
  // 用中段色阶带而不是亮主题那条：tone 72~100 里红色的色域本身就随明度收窄，
  // 彩度斜坡反过来也看不出来；40~66 里红色能给到远超 CHROMA_CAP 的彩度，斜坡和封顶都只能靠实现自己
  const rgba = await buildTextureRgba({ source: { pixels, width: w, height: w }, band: { lo: 40, hi: 66 }, outWidth: 24, outHeight: 54 })
  const rows: { tone: number; chroma: number }[] = []
  let hueOff = 0
  for (let i = 0; i < rgba.length; i += 4) {
    const hct = Hct.fromInt((0xff << 24 | rgba[i] << 16 | rgba[i + 1] << 8 | rgba[i + 2]) >>> 0)
    const d = Math.abs(hct.hue - redHue) % 360
    hueOff += Math.min(d, 360 - d)
    rows.push({ tone: hct.tone, chroma: hct.chroma })
    assert.ok(hct.chroma <= CHROMA_CAP + 2, `彩度 ${hct.chroma.toFixed(1)} 冲破封顶 ${CHROMA_CAP}`)
  }
  assert.ok(hueOff / rows.length < 25, `平均色相偏了 ${(hueOff / rows.length).toFixed(1)}°`)
  rows.sort((a, b) => a.tone - b.tone)
  const third = Math.floor(rows.length / 3)
  const mean = (xs: typeof rows) => xs.reduce((s, r) => s + r.chroma, 0) / xs.length
  const darkChroma = mean(rows.slice(0, third))
  const lightChroma = mean(rows.slice(-third))
  assert.ok(darkChroma > lightChroma * 1.5, `暗部彩度 ${darkChroma.toFixed(1)} 没明显高于亮部 ${lightChroma.toFixed(1)}`)
})

test('几乎是平的封面（暗角、底噪）不出硬边和白点：相邻 texel 的 RGB 跳变有上限', async() => {
  let seed = 7
  const rnd = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    return seed / 4294967296
  }
  const argb = (d: number) => (0xff << 24 | (180 + d) << 16 | (150 + d) << 8 | (120 + d)) >>> 0
  const noisy = Array.from({ length: 128 * 128 }, () => argb(Math.round((rnd() * 2 - 1) * 3)))
  const vignette = Array.from({ length: 128 * 128 }, (_, i) => {
    const r = Math.hypot(i % 128 - 64, Math.floor(i / 128) - 64) / 64
    return argb(Math.round(4 * (1 - Math.min(1, r))))
  })
  for (const [name, pixels] of [['底噪 ±3', noisy], ['暗角 4 级', vignette]] as const) {
    const W = 132
    const H = TEXTURE_OUT_HEIGHT
    const o = await buildTextureRgba({ source: { pixels, width: 128, height: 128 }, band: BAND_LIGHT, outWidth: W, outHeight: H })
    let worst = 0
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4
        for (const q of [x + 1 < W ? p + 4 : -1, y + 1 < H ? p + W * 4 : -1]) {
          if (q < 0) continue
          worst = Math.max(worst, Math.abs(o[p] - o[q]), Math.abs(o[p + 1] - o[q + 1]), Math.abs(o[p + 2] - o[q + 2]))
        }
      }
    }
    // 修前实测：底噪 100、暗角 49；修后两者 35 / 33，与完全平的封面（30）同档
    assert.ok(worst <= 40, `${name}：相邻 texel 最大跳 ${worst} 级`)
  }
})

test('算法常量的取值有实测出处，改动要连 spec 一起（防止有人顺手调着玩）', () => {
  assert.equal(MARBLE_FREQ, 7)
  assert.equal(WARP_STRENGTH, 0.12)
  assert.equal(COVER_WEIGHT, 0.45)
  assert.equal(CHROMA_FLOOR, 0.35)
  assert.equal(COVER_SPAN_REF, 12)
  assert.equal(TEXTURE_OUT_HEIGHT, 294)
})
