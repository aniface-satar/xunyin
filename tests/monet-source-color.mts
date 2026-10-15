import test from 'node:test'
import assert from 'node:assert/strict'

import { QUANTIZE_COLORS, analyzeArgbPixels, type CoverPixels } from '../src/utils/monet/sourceColor.ts'
import { Hct } from '@material/material-color-utilities/hct/hct.js'

const fill = (argb: number, n: number) => new Array(n).fill(argb >>> 0)
const GRAY = 0xFF808080
const RED = 0xFFCC2222

/** 原生桥交上来的是"一维行主序 + 真实行列数"，所以入参是 CoverPixels 而不是裸数组。
 *  夹具默认摊成一行（width = 像素数、height = 1）：分块按列切，一行也切得出 8 块。 */
const cv = (pixels: number[], width = pixels.length, height = 1) => ({ pixels, width, height })

test('灰底 + 少量红：源色取红（面积让位于色度），平均色仍是灰', () => {
  const result = analyzeArgbPixels(cv([...fill(GRAY, 900), ...fill(RED, 100)]))!
  assert.ok(Hct.fromInt(result.source).chroma > 20, `source chroma=${Hct.fromInt(result.source).chroma}`)
  assert.ok(Hct.fromInt(result.average).chroma < 15, `average chroma=${Hct.fromInt(result.average).chroma}`)
})

test('全灰像素不崩，源色取的是这张图自己的灰而不是内置常量灰', () => {
  // 只断言色度挡不住"把 fallbackColorARGB 写成常量 0xff808080"这种改法：
  // 中灰封面照样全绿，深灰/浅灰封面就会被涂成中灰。三档灰都要求 source === 本图平均色 === 输入色。
  for (const gray of [0xFF808080, 0xFF2A2A2A, 0xFFEFEFEF]) {
    const result = analyzeArgbPixels(cv(fill(gray, 4096), 64, 64))!
    assert.equal(result.average, gray)
    // 均匀图没有"最亮那块"可言，块均色必须原样等于输入色（分块索引写错会串到别的行上去）
    assert.equal(result.highlight, gray, `highlight=${result.highlight.toString(16)}`)
    assert.equal(result.source, result.average, `gray=${gray.toString(16)}`)
    assert.ok(Hct.fromInt(result.source).chroma < 5)
  }
})

test('输出 alpha 恒为 255（供 Hct.fromInt 使用）', () => {
  const result = analyzeArgbPixels(cv([...fill(GRAY, 100), ...fill(RED, 100)]))!
  assert.equal(result.source >>> 24, 255)
  assert.equal(result.average >>> 24, 255)
  assert.equal(result.highlight >>> 24, 255)
})

test('半透明像素被跳过（图标/带透明通道封面不污染结果）', () => {
  const transparent = fill(0x00FF00FF, 3000)
  const result = analyzeArgbPixels(cv([...transparent, ...fill(GRAY, 1000)]))!
  // 断言要钉死数值：除以 pixels.length 而不是 opaque.length 时平均色会变成 0xff202020，
  // 色度仍是 1.9，只比色度的话这条就漏过了 —— 而 Task 2 的蒙版正好吃这个平均色。
  assert.equal(result.average, GRAY, `average=${result.average.toString(16)}`)
  assert.equal(result.source, GRAY, `source=${result.source.toString(16)}`)
  // 全透明的那几块要整块跳过（count=0），不能算成黑：否则最亮参照物上会凭空多出一块黑
  assert.equal(result.highlight, GRAY, `highlight=${result.highlight.toString(16)}`)
  assert.ok(Hct.fromInt(result.source).chroma < 5)
})

test('空数组 / 全透明 / 非法输入返回 null', () => {
  assert.equal(analyzeArgbPixels(cv([])), null)
  assert.equal(analyzeArgbPixels(cv(fill(0x00FFFFFF, 100))), null)
  assert.equal(analyzeArgbPixels(null as unknown as CoverPixels), null)
  assert.equal(analyzeArgbPixels(undefined as unknown as CoverPixels), null)
  // array-like 是 Array.isArray 这道守卫存在的理由，不测它就是没守卫
  assert.equal(analyzeArgbPixels({ length: 3 } as unknown as CoverPixels), null)
})

test('行列数与像素数不自洽一律 null：分块按行主序索引，行宽错了取样就花屏', () => {
  // 不是洁癖：行宽报错时 y * width + x 会读到数组外的 undefined，
  // 而 undefined >>> 0 === 0 正好被当成"透明像素"跳过 —— 不报错，只是最亮块静默少采样，
  // 交出来的参照物比真实的最亮块更暗，闸门又变回乐观的那一侧。所以自洽性必须在门口就判死。
  assert.equal(analyzeArgbPixels({ pixels: fill(GRAY, 1000), width: 100, height: 12 }), null) // 100×12 ≠ 1000
  assert.equal(analyzeArgbPixels({ pixels: fill(GRAY, 1000), width: 0, height: 1 }), null) // 行列数非法
  assert.equal(analyzeArgbPixels({ pixels: fill(GRAY, 1000), width: 31.5, height: 31.7 }), null) // 非整数
})

test('highlight 取的是最亮那块，不是全图平均（蒙版与前景闸门都读它）', () => {
  // 左半黑右半白：平均色是中灰（L*≈50），最亮块必须落在纯白那一侧（L*≈100）。
  // 旧实现拿平均色当参照物，实测三张真夹具的最亮块比平均亮 25~41 个 L*，
  // 于是白字 5.59 算过闸、真实场上只有 4.29 —— 亮封面破线就破在这一条上。
  const half = 32
  const pixels: number[] = []
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < half * 2; x++) pixels.push((x < half ? 0xFF000000 : 0xFFFFFFFF) >>> 0)
  }
  const result = analyzeArgbPixels(cv(pixels, half * 2, half))!
  assert.ok(Hct.fromInt(result.highlight).tone > 95, `highlight tone=${Hct.fromInt(result.highlight).tone}`)
  const avgTone = Hct.fromInt(result.average).tone
  assert.ok(avgTone < 55, `average tone=${avgTone}`)
  assert.notEqual(result.highlight, result.average)
  // 全黑图：最亮块也只能是黑，不许因为"取的是块"就凭空造出一块白
  const allBlack = analyzeArgbPixels(cv(fill(0xFF000000, 4096), 64, 64))!
  assert.equal(allBlack.highlight, 0xFF000000)
  assert.equal(allBlack.average, 0xFF000000)
})

test('空块与回落：透明行不污染参照物，块高不足时也拿不到 undefined 当黑', () => {
  // 这两处的失败模式都不抛异常，只是把参照物悄悄算暗（闸门跟着变乐观），所以逐值断言。
  // ① 上 512 个全透明、下 512 个 GRAY：透明的那几块 count=0 必须整块跳过。
  const split = analyzeArgbPixels(cv([...fill(0x00FFFFFF, 512), ...fill(GRAY, 512)], 32, 32))!
  assert.equal(split.average, GRAY, `average=${split.average.toString(16)}`)
  assert.equal(split.highlight, GRAY, `highlight=${split.highlight.toString(16)}`)
  // ② 32×2 的长条：cellH = 2 / 8 = 0.25，四舍五入后每块边界都落在同一行上，
  //  极端情况下块循环一个像素也采不到 —— 此时 blockHighlightArgb 返回 null，
  //  由 `?? average` 回落。少了那条回落，交出去的就是 undefined >>> 0（黑）。
  const strip = analyzeArgbPixels(cv(fill(GRAY, 64), 32, 2))!
  assert.equal(strip.average, GRAY, `average=${strip.average.toString(16)}`)
  assert.equal(strip.highlight, GRAY, `highlight=${strip.highlight.toString(16)}`)
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

// mixedPixels() 的杂度闸门，见下面确定性用例里的用法。
const MIXED_MIN_DISTINCT_COLORS = 100

test('同一份像素重复取色必须给同一个源色（上游 quantizer_wsmeans 用裸 Math.random）', () => {
  const pixels = cv(mixedPixels(), 64, 64)
  // 自检（承重的）：下面这个循环今天之所以抓得住"源色漂移"，靠的是这份 4096 像素混着几百种
  // 颜色（写这条时实测 345）—— 簇够杂时上游那句随机分配初始簇才抖得出不同源色。像素一干净它就废：
  // 把 mixedPixels() 的 ±12 抖动去掉（只剩 6 种纯色块），未钉住的量化 50 次取色出的是**同一种**
  // 源色，于是就算 withSeededRandom 被削成空转，下面的循环照样全绿，而 canary 只数 ambient
  // 调用次数、量不到"用例是否还有效"，也照样绿 —— 整条用例静默变成摆设。
  // 100 这个数是这么定的：现值 345 留 3.4× 余量给合理的瘦身，实测仍能抖出源色的最小
  // 样本是 45，抖不出的是 6；取 100 既能盖住"去掉抖动/大幅缩网格"这类真实退化，又不会
  // 误伤实测过的那些还在抖的变体（amp=6→199、32×32→168 都过）。
  const distinctColors = new Set(pixels.pixels).size
  assert.ok(
    distinctColors > MIXED_MIN_DISTINCT_COLORS,
    `fixture 不够杂（实测 ${distinctColors} 种颜色，闸门 ${MIXED_MIN_DISTINCT_COLORS}）：` +
      '像素太干净时上游的簇抖动很可能抖不出不同源色，上面的确定性用例就会对着空转的 seeding 包裹也变绿。' +
      '红了不一定是 bug：把抖动去掉跑 50 次数一数不同源色，还抖就把阈值调下去，不抖说明该改的是 fixture 数据',
  )
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
    analyzeArgbPixels(cv(mixedPixels(), 64, 64))
  } finally {
    Math.random = original
  }
  // 这条是承重的墓碑用例：@material 的 JS 移植版把随机留在 quantizer_wsmeans.js:95。
  // 哪天上游改成确定性实现，calls 变 0，这里会红 —— 那时请删掉 withSeededRandom，不要留着。
  assert.ok(calls > 0, 'Math.random 未被消费：seeding 包裹已成死代码，删掉 withSeededRandom')
})
