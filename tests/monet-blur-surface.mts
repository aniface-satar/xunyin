import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BLUR_ANCHOR_TONE,
  BLUR_BROWSE_MIN_CONTRAST,
  BLUR_MIN_CONTRAST,
  BLUR_SCRIM_MIN,
  CHROMA_CAP,
  DARK_ANCHOR_TONE,
  MIN_CONTRAST,
  ON_COVER_FONT,
  PROVISIONAL_BLUR_SURFACE,
  SCRIM_MAX,
  buildBlurSurface,
  buildCoverSurface,
  parseCssColor,
} from '../src/utils/monet/surface.ts'
import { Contrast } from '@material/material-color-utilities/contrast/contrast.js'
import { Hct } from '@material/material-color-utilities/hct/hct.js'
import { argbFromRgb, blueFromArgb, greenFromArgb, redFromArgb } from '@material/material-color-utilities/utils/color_utils.js'

const WHITE_FONT = ON_COVER_FONT
const ORANGE = 0xFFE8551F
const WHITE = 0xFFFFFFFF
const GRAY = 0xFF808080

/** ②只要两个测量值：源色由官方量化挑出来那一支在这条路上不存在。 */
const m = (averageArgb: number, highlightArgb = averageArgb) => ({ averageArgb, highlightArgb })

const baseArgb = (s: { base: string }) => parseCssColor(s.base)!

/** 与 surface.ts 内部同一套合成：RN/Android 的 alpha 混合就在 sRGB 编码值上做，不是线性光。
 *  两支共用这一个定义才算"闸门只有一个版本"，测试把它独立复现一遍，实现偷偷换混法才侦测得到。 */
const fieldTone = (base: number, highlight: number, a: number) => Hct.fromInt(argbFromRgb(
  Math.round(a * redFromArgb(base) + (1 - a) * redFromArgb(highlight)),
  Math.round(a * greenFromArgb(base) + (1 - a) * greenFromArgb(highlight)),
  Math.round(a * blueFromArgb(base) + (1 - a) * blueFromArgb(highlight)),
) >>> 0).tone

test('②不用源色也出得了色：mode 是 blur，provisional 是假', () => {
  const s = buildBlurSurface(m(ORANGE), WHITE_FONT)!
  assert.equal(s.mode, 'blur')
  assert.equal(s.provisional, false)
})

test('②的底色钉在自己的锚点上：照片层贡献起伏，底色只当那张"底"', () => {
  for (const cover of [0xFF1A1A22, ORANGE, 0xFFFAFAFA, GRAY]) {
    const s = buildBlurSurface(m(cover), WHITE_FONT)!
    const tone = Hct.fromInt(baseArgb(s)).tone
    // 夹完 sRGB 色域会回落一点（同 §7.4 那条），判"贴着锚点"要留这一截
    assert.ok(Math.abs(tone - BLUR_ANCHOR_TONE) <= 0.6, `${cover.toString(16)} 的 tone=${tone}，锚点 ${BLUR_ANCHOR_TONE}`)
  }
  // 锚点 28 是用户从六档小样里挑的那一支（spec §14.1），这一格上 ② 的底色仍比 ① 的 32 暗 4.07。
  // 2026-10-18 那一天的四步抬亮（30 → 32 → 34 → 36）连同判据一起从全屏播控页回退掉了：那时防线一路挪到
  // `<= 32`（两档并平）再到 `< 38`（"底色自己过不了闸门"）。回退后回到 §15 那一条更严的：**② 必须比 ① 暗**。
  // 往前看的物理上限也记在这儿，免得下次抬过了头才想起来：38 起 2250 格 hue×chroma 里 2113 格
  // 底色自己过不了 7 的闸门，buildBlurSurface 直接 return null —— 整档静默回落成纯色，那一格没有"再亮一点"可言。
  assert.ok(BLUR_ANCHOR_TONE < DARK_ANCHOR_TONE, `锚点 ${BLUR_ANCHOR_TONE} 亮过了莫奈支 ${DARK_ANCHOR_TONE}，② 正在往平涂走，这一格该由人重新拍板`)
})

test('②的色相与彩度都跟着封面整体走，但彩度不超过 CHROMA_CAP', () => {
  const s = buildBlurSurface(m(ORANGE, 0xFFFFA060), WHITE_FONT)!
  const hct = Hct.fromInt(baseArgb(s))
  assert.ok(Math.abs(hct.hue - Hct.fromInt(ORANGE).hue) < 12, `hue=${hct.hue}`)
  const coverChroma = Hct.fromInt(ORANGE).chroma
  assert.ok(hct.chroma <= Math.min(coverChroma, CHROMA_CAP) + 0.5, `chroma=${hct.chroma}，封面自己才 ${coverChroma}`)
  // 灰封面不硬造色相：彩度是从封面平均色读来的，不是常量。
  // 判据用通道极差而不是 HCT 彩度 —— 锚点抬到 28 之后 Hct→sRGB 的回落会在中性灰上添 2.09 的彩度
  // （rgb(65,66,66)），那是色域形状给的、不是封面给的；通道差 1 才是"肉眼一块中性灰"的真身。
  const grayBase = baseArgb(buildBlurSurface(m(GRAY), WHITE_FONT)!)
  const grayChannels = [redFromArgb(grayBase), greenFromArgb(grayBase), blueFromArgb(grayBase)]
  assert.ok(Math.max(...grayChannels) - Math.min(...grayChannels) <= 2,
    `灰封面的底色有了色相：rgb(${grayChannels.join(', ')})`)
  assert.ok(Hct.fromInt(grayBase).chroma < 3, `灰封面的底色彩度 ${Hct.fromInt(grayBase).chroma}，色域回落也不该超过这一格`)
})

test('②暗封面停在最少透出量：蒙版不动用，轮廓原样在', () => {
  const s = buildBlurSurface(m(0xFF2A2A35, 0xFF3C3C48), WHITE_FONT)!
  assert.equal(s.scrimAlpha, BLUR_SCRIM_MIN)
})

test('②亮封面把蒙版顶上去，直到合成那一层对白字过 ② 自己的线', () => {
  const measure = m(0xFF40404A, WHITE)
  const s = buildBlurSurface(measure, WHITE_FONT)!
  assert.ok(s.scrimAlpha > BLUR_SCRIM_MIN, `没顶起来：${s.scrimAlpha}`)
  assert.ok(s.scrimAlpha <= SCRIM_MAX)
  assert.ok(Contrast.ratioOfTones(fieldTone(baseArgb(s), WHITE, s.scrimAlpha), 100) >= BLUR_MIN_CONTRAST)
})

test('②的白字线卡在 5.0~5.5 这条带里：再松实白自己站不住，再紧就把亮度还给平涂', () => {
  // ② 的前景是一支不随背景变的白（onCoverTheme.BLUR_INK），连小字层都是实白 —— 文字只有一档，
  // 所以"这一档站不站得住"完全等于"场最多有多亮"：场上限 = 116·∛(1.05/线 − 0.05) − 16。
  // 为什么不低于 5.0：4.5 那一条把场放到 L*49.9，真夹具 Lucky/sunset 解出 L*49.6/49.7，实白只有 4.53/4.54，
  // 再吃进 5dp 实测的块模型偏差（真机峰值比 8×8 块均色亮约 1.7 个 L*）就只剩 4.2x —— 破线的是控件自己。
  // 为什么不高于 5.5：6.0 那一格把场按到 L*41.5~42.0、蒙版每张多压 6~11 个百分点，照片只剩大块色。
  // 这一条现在取带上沿的 5.5：2026-10-19 用户要"当前行与非当前行拉开"（组件 0.75 → 0.50，
  // 见 .scratch/t166_gap.mts 的两维扫描），压下去的那两层要的正是一个更暗的场 —— 5.0 上它们只有 2.38/2.25，
  // 5.5 上 2.52/2.39，实白自己也从 4.74 抬到 5.04。再往上就是拿"看得出是封面"换 0.1 的余量。
  assert.ok(BLUR_MIN_CONTRAST > MIN_CONTRAST, `②的线 ${BLUR_MIN_CONTRAST} 没高于莫奈支的 ${MIN_CONTRAST}`)
  assert.ok(BLUR_MIN_CONTRAST >= 5.0, `②的线 ${BLUR_MIN_CONTRAST} 低到一支白摆不开：场上限 L*${(116 * Math.cbrt(1.05 / BLUR_MIN_CONTRAST - 0.05) - 16).toFixed(1)}`)
  assert.ok(BLUR_MIN_CONTRAST <= 5.5, `②的线 ${BLUR_MIN_CONTRAST} 收得太紧：场上限 L*${(116 * Math.cbrt(1.05 / BLUR_MIN_CONTRAST - 0.05) - 16).toFixed(1)}，②正在往平涂走`)
})

test('真夹具 Lucky Block：按 ② 的线重核之后，蒙版要比 4.5 那一版更实', () => {
  // 这两个数是 .scratch/t85 从真封面 128px 样本量出来的（avg L*48.1 / 最亮块 L*89.3）。
  // 拿 4.5 交出去时 alpha=0.60、模型场 49.6，真机重渲染量到白字只有 4.29 —— 破线就破在这里。
  const measure = m(0xFF787351, 0xFFCBE6E4)
  const s = buildBlurSurface(measure, WHITE_FONT)!
  assert.ok(s.scrimAlpha > 0.6, `alpha 还停在 4.5 那一版的 ${s.scrimAlpha}`)
  assert.ok(s.scrimAlpha < SCRIM_MAX, '这张封面顶到完全不透才过闸的话，②就又是纯底了')
  assert.ok(Contrast.ratioOfTones(fieldTone(baseArgb(s), measure.highlightArgb, s.scrimAlpha), 100) >= BLUR_MIN_CONTRAST)
})

test('②交出去的蒙版就是渲染层拿到的那一格：两位小数，且证书核这一格', () => {
  for (const measure of [m(0xFFFAFAFA, WHITE), m(GRAY, 0xFFEFEFEF), m(0xFFE8E8E8, 0xFFFAFAFA)]) {
    const s = buildBlurSurface(measure, WHITE_FONT)!
    const centi = Math.round(s.scrimAlpha * 100)
    assert.equal(centi / 100, s.scrimAlpha, `不在百分格上：${s.scrimAlpha}`)
    // 拿"交出去的那一格"过闸，而不是拿未取整的那一个 —— §7.4 里那 0.005 就是往多透的方向差的
    assert.ok(Contrast.ratioOfTones(fieldTone(baseArgb(s), measure.highlightArgb, centi / 100), 100) >= BLUR_MIN_CONTRAST)
  }
})

test('②的 fieldTone 是真那一层的明度，不是底色的明度', () => {
  const s = buildBlurSurface(m(0xFF55555F, 0xFFE8E8E8), WHITE_FONT)!
  assert.ok(s.scrimAlpha < SCRIM_MAX, '夹具要留透出量才测得到这一条')
  assert.equal(s.fieldTone, fieldTone(baseArgb(s), 0xFFE8E8E8, s.scrimAlpha))
  assert.ok(s.fieldTone > Hct.fromInt(baseArgb(s)).tone, '亮块透出后场应当比底色更亮')
})

test('②的前景色相没有可跟的东西：tint 彩度恒 0、band 恒 null（于是 onCoverTheme 自动退成白+灰）', () => {
  for (const cover of [ORANGE, GRAY, 0xFF2A2A35]) {
    const s = buildBlurSurface(m(cover), WHITE_FONT)!
    assert.equal(s.tint.chroma, 0, `chroma=${s.tint.chroma}`)
    assert.ok(Number.isFinite(s.tint.hue))
    assert.equal(s.band, null)
  }
})

test('②非法入参返回 null，不交出一份看起来正常的黑', () => {
  assert.equal(buildBlurSurface(m(0x7F808080), WHITE_FONT), null)
  assert.equal(buildBlurSurface(m(GRAY, NaN), WHITE_FONT), null)
  assert.equal(buildBlurSurface(m(GRAY), NaN), null)
  assert.equal(buildBlurSurface(null, WHITE_FONT), null)
})

test('②顶到完全不透还过不了闸就 null，不跨侧硬凑（这条与莫奈支同处置）', () => {
  // 字色 tone 落在暗锚 20 与亮锚 80 之间：往哪一侧凑都要把整页从亮翻成黑，那是看得见的乱来
  const midFont = parseCssColor('rgb(150, 150, 150)')!
  assert.ok(Hct.fromInt(midFont).tone > BLUR_ANCHOR_TONE && Hct.fromInt(midFont).tone < 100 - BLUR_ANCHOR_TONE)
  assert.equal(buildBlurSurface(m(WHITE, WHITE), midFont), null)
})

test('②两台分岔在 2026-10-19：歌词台那格比浏览台厚，浏览格本身仍过自己那条线', () => {
  // 旧版这里判的是"浏览台不超过歌词台 + 暗封面两台都在最少透出量那一格收手"（那时两条线同值，δ 恒 0）。
  // 现在歌词台是 5.5、浏览台还是 5.0：这一格差就是"读词要更大落差"与"看封面要亮"之间的分工，
  // 机制本身没变（solveStages 各解一格 + stageDimAlpha），只是两条线第一次真的分开。
  const cases = [
    m(0xFF787351, 0xFFCBE6E4),
    m(0xFFFAFAFA, 0xFFFFFFFF),
    m(0xFFE8E8E8, 0xFFFAFAFA),
  ]
  for (const measure of cases) {
    const s = buildBlurSurface(measure, WHITE_FONT)!
    assert.ok(s.scrimAlpha >= BLUR_SCRIM_MIN && s.scrimAlpha <= SCRIM_MAX, `歌词台 ${s.scrimAlpha} 越界`)
    assert.ok(s.browseScrimAlpha < s.scrimAlpha, `浏览台 ${s.browseScrimAlpha} 没有比歌词台 ${s.scrimAlpha} 薄`)
    assert.ok(s.browseScrimAlpha >= BLUR_SCRIM_MIN, `亮台 ${s.browseScrimAlpha} 低于最少透出量`)
    assert.ok(s.stageDimAlpha > 0 && s.stageDimAlpha <= 1, `两条线分岔了却没解出压暗层：δ=${s.stageDimAlpha}`)
    // 渲染层铺亮台那格、再叠 δ 压回歌词台 —— 合成必须逐位回到证书核过的那一格
    const composed = 1 - (1 - s.browseScrimAlpha) * (1 - s.stageDimAlpha)
    assert.ok(Math.abs(composed - s.scrimAlpha) < 1e-9, `合成 ${composed} != 歌词台 ${s.scrimAlpha}`)
    // 亮台自己的场过自己那条线（更松，不是没有）
    assert.ok(Contrast.ratioOfTones(fieldTone(baseArgb(s), measure.highlightArgb, s.browseScrimAlpha), 100) >= BLUR_BROWSE_MIN_CONTRAST)
    assert.ok(Contrast.ratioOfTones(fieldTone(baseArgb(s), measure.highlightArgb, s.scrimAlpha), 100) >= BLUR_MIN_CONTRAST)
  }
  // 暗封面：亮块本身就暗，两台都在最少透出量那一格收手（"轮廓原样在"那条的下半段）—— 分岔解不出来也不该硬造一层纱
  const dark = buildBlurSurface(m(0xFF2A2A35, 0xFF3C3C48), WHITE_FONT)!
  assert.equal(dark.browseScrimAlpha, BLUR_SCRIM_MIN)
  assert.equal(dark.scrimAlpha, dark.browseScrimAlpha)
  assert.equal(dark.stageDimAlpha, 0, '两台都停在最少透出量时不该再造一层压暗层')
})

test('②浏览台闸门仍低于歌词台：它们一旦并平或反超，白阶梯与压暗层要成对重核', () => {
  // 这一条不是"证明谁大谁小"，是给下一个改闸门的人留的桩：两条线分开本身不违法（2026-10-19 起就是分开的），
  // 但只看一张台的余量就发货会漏掉另一张（上一版就是浏览台 0.86 只核了浏览台自己的场）。
  // 真改到并平或反超那天要重跑 .scratch/t166_gap.mts、t170_final.py 与 tests/monet-on-cover-theme.mts
  // 里那两条 ② 的用例（歌词页 / 浏览页各核一遍）再放开这条。
  assert.ok(BLUR_BROWSE_MIN_CONTRAST < BLUR_MIN_CONTRAST,
    `两台闸门并平或反超了（浏览 ${BLUR_BROWSE_MIN_CONTRAST} / 歌词 ${BLUR_MIN_CONTRAST}），白阶梯与 δ 要一起重核`)
})

test('保守那一支：同一个引用、完全不透、两台同值、对白字当场过闸', () => {
  const s = PROVISIONAL_BLUR_SURFACE
  assert.equal(s.mode, 'blur')
  assert.equal(s.provisional, true)
  assert.equal(s.scrimAlpha, SCRIM_MAX)
  assert.equal(s.browseScrimAlpha, SCRIM_MAX)
  assert.equal(s.stageDimAlpha, 0)
  assert.equal(s.band, null)
  assert.equal(s.tint.chroma, 0)
  assert.ok(Contrast.ratioOfTones(s.fieldTone, 100) >= MIN_CONTRAST, `白字只 ${Contrast.ratioOfTones(s.fieldTone, 100)}`)
  assert.ok(Hct.fromInt(baseArgb(s)).tone < 20, `保守底太亮：${s.base}`)
  // 必须是同一个对象：store 的 isSame 按引用比 surface，每帧造一份会把订阅子树白刷一遍
  assert.equal(PROVISIONAL_BLUR_SURFACE, s)
})

test('莫奈支一字未改：仍然出 monet、带色相的 tint 与自己的锚点', () => {
  const s = buildCoverSurface({ sourceArgb: ORANGE, averageArgb: ORANGE, highlightArgb: 0xFFFFA060 }, WHITE_FONT)!
  assert.equal(s.mode, 'monet')
  assert.equal(s.provisional, false)
  assert.ok(s.tint.chroma > 0, '莫奈支的强调色还在，这是两档的区别之一')
  // 原来这条写的是 `tone > BLUR_ANCHOR_TONE` —— 借 ② 的锚点当"① 还在自己那一格"的替身，
  // 两支并平的 32 上只赢 1e-5，锚点一抬就假红。直接钉自己的锚点（夹 sRGB 色域的那一截容差同 ② 那条）。
  assert.ok(Math.abs(Hct.fromInt(baseArgb(s)).tone - DARK_ANCHOR_TONE) <= 0.6,
    `莫奈支的底色 ${s.base} 不在自己的锚点 ${DARK_ANCHOR_TONE} 上了`)
})
