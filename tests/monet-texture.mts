import test from 'node:test'
import assert from 'node:assert/strict'

import { Contrast } from '@material/material-color-utilities/contrast/contrast.js'
import { Hct } from '@material/material-color-utilities/hct/hct.js'

import {
  CALM_END_V,
  CALM_START_V,
  COVER_CHROMA_RATIO,
  LIFT_MAX,
  MARBLE_FREQ,
  TEXTURE_CHROMA_MAX,
  TEXTURE_OUT_HEIGHT,
  TEXTURE_OUT_WIDTH_MAX,
  TEXTURE_ROWS_PER_CHUNK,
  TEXT_SPREAD_MAX,
  TEXT_TOP_V,
  WARP_STRENGTH,
  buildTextureRgba,
  textureWidthFor,
} from '../src/utils/monet/texture.ts'
import { CHROMA_CAP, MIN_CONTRAST, ON_COVER_FONT, TEXTURE_ANCHOR_TONE, buildCoverSurface, buildToneBand, parseCssColor } from '../src/utils/monet/surface.ts'

const LIGHT_FONT = parseCssColor('rgb(66,66,66)')!
const ORANGE = 0xFFE8551F
// 带不再自己编：就用 buildCoverSurface / buildToneBand 真正交出去那两条，纹理与闸门两层要能对上。
const BAND_LIGHT = buildCoverSurface({ sourceArgb: ORANGE, averageArgb: ORANGE, highlightArgb: ORANGE }, LIGHT_FONT)!.band!
const BAND_ON_COVER = buildToneBand(Hct.from(Hct.fromInt(ORANGE).hue, 12, TEXTURE_ANCHOR_TONE).toInt() >>> 0, ON_COVER_FONT)!
// buildCoverSurface 现在会把整片背景共用的那一支颜色一起交给纹理（色相取源色、彩度已按封面平均色定过）。
// 这里给的是合成夹具的固定值，纹理只认它，不再自己从 source 猜色相。
const TINT = { hue: Hct.fromInt(ORANGE).hue, chroma: 12 }

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
  const req = { source: cover(), band: BAND_LIGHT, tint: TINT, outWidth: 16, outHeight: 36 }
  assert.deepEqual(Array.from(await buildTextureRgba(req)), Array.from(await buildTextureRgba(req)))
})

// 这条是红的，而且是故意的：纹理支已经从界面摘下（纯色方案恢复），但它现在越顶。
// 实测（带 = buildCoverSurface 真正交出的 [72,88]）：正文区 tone 80.86~89.84，比上沿多出 1.84；
// 换白墨那条带 [36,49] 时正文区到 50.77，对纯白字只剩 4.362 < 4.5。
// texture.ts 里 LIFT_MAX 的注释说"闸门钉在正文区所以 4.5 不受影响"，代码没做到。
// 等纹理方向定了要么把正文区夹回 band.hi，要么整条删掉；在此之前别把它改成绿。
test('正文区必须钉在色阶带上沿以下（lift 区另计）', async() => {
  for (const [band, outHeight] of [[BAND_LIGHT, 36], [BAND_ON_COVER, 36]] as [typeof BAND_LIGHT, number][]) {
    const rgba = await buildTextureRgba({ source: cover(), band, tint: TINT, outWidth: 16, outHeight })
    const tones: number[] = []
    for (let y = 0; y < outHeight; y++) {
      for (let x = 0; x < 16; x++) {
        const o = (y * 16 + x) * 4
        const tone = Hct.fromInt((0xff << 24 | rgba[o] << 16 | rgba[o + 1] << 8 | rgba[o + 2]) >>> 0).tone
        if ((y + 0.5) / outHeight < TEXT_TOP_V) {
          // lift 区按它自己的账：允许比带上沿最亮 LIFT_MAX，且不许越出 tone 域
          assert.ok(tone <= band.hi + LIFT_MAX + 1.5 && tone <= 100, `lift 区 tone ${tone.toFixed(2)} 越出带 + 提亮量`)
        } else {
          assert.ok(tone >= band.lo - 1.5 && tone <= band.hi + 1.5, `正文区 tone ${tone.toFixed(2)} 越界（带 ${band.lo}~${band.hi}）`)
        }
        tones.push(tone)
      }
    }
    // 量 p5~p95 而不是 min/max：去掉混合后那次秩归一，两端各剩几个 texel 照样顶到带边，只有中段塌（实测 90% → 65%）
    tones.sort((a, b) => a - b)
    const spread = tones[Math.floor(tones.length * 0.95)] - tones[Math.floor(tones.length * 0.05)]
    assert.ok(spread >= (band.hi - band.lo) * 0.8, `p5~p95 只有 ${spread.toFixed(1)}，没吃满合法带 ${band.hi - band.lo}`)
  }
})

// 白墨那一对（BAND_ON_COVER）的破线原因和上一条同源（正文区越顶），红点只留一个信号，这里先不重复钉。
test('纹理对字色的真实 WCAG 对比度都 >= 4.5（夹色域也算进去了）', async() => {
  for (const source of [cover(), cover(128, 96)] as ReturnType<typeof cover>[]) {
    const rgba = await buildTextureRgba({ source, band: BAND_LIGHT, tint: TINT, outWidth: 16, outHeight: 36 })
    const text = fontRgb(LIGHT_FONT)
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
    for (const band of [BAND_LIGHT, BAND_ON_COVER]) {
      const rgba = await buildTextureRgba({ source: gray, band, tint: TINT, outWidth: 16, outHeight: 36 })
      for (let i = 0; i < rgba.length; i += 4) {
        const spread = Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) - Math.min(rgba[i], rgba[i + 1], rgba[i + 2])
        assert.ok(spread <= 1, `灰 ${g} 带 ${JSON.stringify(band)}：texel ${rgba[i]},${rgba[i + 1]},${rgba[i + 2]} 染了色`)
      }
    }
  }
})

// 旧判据是"封面的上下结构能穿过模糊进纹理（下半比上半亮）"。上一轮加了纵向提亮层之后这条方向反了：
// 屏顶整段被抬上去（实测 98.9），正文区又被 CALM_*/TEXT_SPREAD_MAX 压平（上段 84.0 / 下段 84.1），
// 封面自己的上下差已经没有落脚处。现在核的是这两层自己的账：顶部亮、正文区平。
// "模糊确实读了整张封面而不是第 0 行"由上面吃满带宽那条 + 平封面/灰封面两条一起守着。
test('屏顶被提亮层抬起，正文区保持平整好读字', async() => {
  const w = 32
  const h = 32
  const pixels: number[] = []
  for (let y = 0; y < h; y++) {
    const v = y < h / 2 ? 0 : 255
    for (let x = 0; x < w; x++) pixels.push((0xFF000000 | v << 16 | v << 8 | v) >>> 0)
  }
  const outWidth = 16
  const outHeight = 36
  const rgba = await buildTextureRgba({ source: { pixels, width: w, height: h }, band: BAND_LIGHT, tint: TINT, outWidth, outHeight })
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
  assert.ok(top - bottom >= 5, `上 ${top.toFixed(1)} / 下 ${bottom.toFixed(1)}：提亮层没起作用`)
  const textStart = Math.round(outHeight * TEXT_TOP_V)
  const half = Math.round((outHeight - textStart) / 2)
  const spread = Math.abs(meanTone(textStart + half, outHeight) - meanTone(textStart, textStart + half))
  assert.ok(spread <= TEXT_SPREAD_MAX, `正文区内上下段差 ${spread.toFixed(2)}，超过 ${TEXT_SPREAD_MAX} —— 字底下来回摆`)
})

test('1×1 退化封面不产 NaN，且 alpha 恒 255', async() => {
  const rgba = await buildTextureRgba({ source: { pixels: [0xFFF3DC2F], width: 1, height: 1 }, band: BAND_LIGHT, tint: TINT, outWidth: 16, outHeight: 36 })
  assert.equal(rgba.length, 16 * 36 * 4)
  for (let i = 0; i < rgba.length; i += 4) {
    assert.ok(Number.isFinite(rgba[i]) && Number.isFinite(rgba[i + 1]) && Number.isFinite(rgba[i + 2]), `第 ${i / 4} 个 texel 不是有限数`)
    assert.equal(rgba[i + 3], 255)
  }
})

test('分块让路不改变结果（yieldRows 只影响调度，不影响像素）', async() => {
  const req = { source: cover(), band: BAND_LIGHT, tint: TINT, outWidth: 17, outHeight: 33 }
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

// 莫奈式上色 = 同一支颜料摆明暗。上一轮把"彩度从封面自己猜 + 越暗越饱和"换成了 tint 统一供色，
// 所以这里改成核"跟着 tint 走"：夹具故意用红封面配蓝 tint，输出必须是那支蓝（旧实现会跟着封面变红）。
// 实测（outWidth 24 × 54）：平均色相偏移 1.2°、最大 3.3°，彩度均值 11.99、极差 1.01。
test('纹理的色相与彩度跟 tint 走，不跟封面自己走', async() => {
  const w = 64
  const pixels: number[] = []
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round(90 + 120 * (x / (w - 1)))
      pixels.push((0xff << 24 | v << 16 | 20 << 8 | 30) >>> 0)
    }
  }
  const tint = { hue: Hct.fromInt(0xFF1E4FC8).hue, chroma: 12 }
  const hueOff = (a: number, b: number) => {
    const d = Math.abs(a - b) % 360
    return Math.min(d, 360 - d)
  }
  const rgba = await buildTextureRgba({ source: { pixels, width: w, height: w }, band: { lo: 40, hi: 66 }, tint, outWidth: 24, outHeight: 54 })
  let sum = 0
  let worst = 0
  const chroma: number[] = []
  for (let i = 0; i < rgba.length; i += 4) {
    const hct = Hct.fromInt((0xff << 24 | rgba[i] << 16 | rgba[i + 1] << 8 | rgba[i + 2]) >>> 0)
    const d = hueOff(hct.hue, tint.hue)
    sum += d
    worst = Math.max(worst, d)
    chroma.push(hct.chroma)
    assert.ok(hct.chroma <= Math.min(CHROMA_CAP, TEXTURE_CHROMA_MAX) + 2, `彩度 ${hct.chroma.toFixed(1)} 冲破封顶`)
  }
  const n = chroma.length
  assert.ok(sum / n < 8, `平均色相偏了 ${(sum / n).toFixed(1)}°，纹理没照 tint 上彩`)
  assert.ok(worst < 12, `最偏的 texel 差 ${worst.toFixed(1)}°，已经看得出第二支颜色`)
  const mean = chroma.reduce((s, c) => s + c, 0) / n
  assert.ok(Math.max(...chroma) - Math.min(...chroma) < 3 && Math.abs(mean - tint.chroma) < 2, `彩度散成 ${Math.min(...chroma).toFixed(1)}~${Math.max(...chroma).toFixed(1)}（tint 给的是 ${tint.chroma}）`)
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
    const o = await buildTextureRgba({ source: { pixels, width: 128, height: 128 }, band: BAND_LIGHT, tint: TINT, outWidth: W, outHeight: H })
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
  // 数值全部来自 2026-10-15 那轮"对齐参考图"的实测（spec §7.6）：
  // 参考图去纵向色阶后局部起伏 11~17 色阶 → 摆幅收窄靠 MARBLE_RELIEF/CALM_* 这组，
  // 柔光顶到 TEXT_TOP_V 以下、提亮封顶 LIFT_MAX，彩度由封面平均色按 COVER_CHROMA_RATIO 供。
  assert.equal(MARBLE_FREQ, 6)
  assert.equal(WARP_STRENGTH, 0.07)
  assert.equal(COVER_CHROMA_RATIO, 0.55)
  assert.equal(TEXTURE_CHROMA_MAX, 26)
  assert.equal(CALM_START_V, 0.45)
  assert.equal(CALM_END_V, 0.72)
  assert.equal(TEXT_TOP_V, 0.5)
  assert.equal(LIFT_MAX, 20)
  assert.equal(TEXTURE_OUT_HEIGHT, 294)
})
