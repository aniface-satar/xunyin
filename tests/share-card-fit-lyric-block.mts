import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { EXTENDED_TIER_FLOOR, LYRIC_LINE_HEIGHT_RATIO, LYRIC_TIERS, fitLyricBlock } from '../src/components/ShareCard/fitLyricBlock.ts'
import { cardTextSizes } from '../src/components/ShareCard/cardTypography.ts'

const line = (text: string, extendedLyrics: string[] = []) => ({ text, extendedLyrics })

test('picks the largest tier that fits every line', () => {
  const lines = [line('第一句'), line('第二句')]
  // 两句 × 24 × 1.5 = 72，给 100 应该拿到最大档 24
  assert.deepEqual(fitLyricBlock(lines, { maxHeight: 100 }), {
    fontSize: 24, extendedFontSize: 22, visibleCount: 2, truncated: false,
  })
})

test('steps down one tier at a time before it truncates', () => {
  const lines = Array.from({ length: 6 }, (_, i) => line(`第${i}句`))
  // 6 × 24 × 1.5 = 216 装不进 150；6 × 22 × 1.5 = 198 也装不进；6 × 20 × 1.5 = 180 装不进；
  // 6 × 18 × 1.5 = 162 装不进；6 × 16 × 1.5 = 144 装得进 → 最低档
  assert.equal(fitLyricBlock(lines, { maxHeight: 150 }).fontSize, 16)
  assert.equal(fitLyricBlock(lines, { maxHeight: 150 }).truncated, false)
})

test('truncates at the smallest tier instead of shrinking further', () => {
  const lines = Array.from({ length: 30 }, (_, i) => line(`第${i}句`))
  const r = fitLyricBlock(lines, { maxHeight: 200 })
  assert.equal(r.fontSize, 16)
  assert.equal(r.extendedFontSize, EXTENDED_TIER_FLOOR)
  // 200 / (16 × 1.5) = 8.33 → 只装得下 8 句
  assert.equal(r.visibleCount, 8)
  assert.equal(r.truncated, true)
})

test('keeps the bigger font when both tiers show the same line count', () => {
  // 两句 × 24 档 36 = 72 超了，但 40 高每档都恰好装得下 1 句（16 档 24 ≤ 40 < 48）：
  // 一路算到最低档都是 1 句，改判只在"严格更多"时发生，所以留最大字号
  const r = fitLyricBlock([line('第一句'), line('第二句')], { maxHeight: 40 })
  assert.deepEqual(r, { fontSize: 24, extendedFontSize: 22, visibleCount: 1, truncated: true })
})

test('a body line and its translation are one block that never splits', () => {
  const lines = [line('正文一', ['译文一']), line('正文二', ['译文二'])]
  // 一句 = 正文一行 + 译文一行。40 高时 24 档要 24×1.5 + 22×1.5 = 69，一句都放不下；
  // 降到 16 档要 16×1.5 + 12×1.5 = 42，仍超 40 → 五档全部显示 0 句。
  // 关键判据：绝不"只画正文、把译文切掉"，宁可整块不显示。
  assert.deepEqual(fitLyricBlock(lines, { maxHeight: 40 }), {
    fontSize: 24, extendedFontSize: 22, visibleCount: 0, truncated: true,
  })
  // 45 高时 16 档那一句（42）刚好装得下，但两句（84）超了 → 显示 1 句并截断
  assert.deepEqual(fitLyricBlock(lines, { maxHeight: 45 }), {
    fontSize: 16, extendedFontSize: 12, visibleCount: 1, truncated: true,
  })
})

test('empty selection yields the top tier with nothing shown', () => {
  assert.deepEqual(fitLyricBlock([], { maxHeight: 300 }), {
    fontSize: LYRIC_TIERS[0], extendedFontSize: LYRIC_TIERS[1], visibleCount: 0, truncated: false,
  })
})

test('blank body with only a translation still occupies a row', () => {
  const lines = [line('', ['只有译文']), line('', ['只有译文二'])]
  const r = fitLyricBlock(lines, { maxHeight: 300 })
  // 正文全空 → 24 档下每句只有译文一行 22×1.5=33，两句 66，装得下
  assert.equal(r.visibleCount, 2)
  assert.equal(r.fontSize, 24)
})

test('a single line taller than maxHeight shows nothing rather than overflowing', () => {
  const r = fitLyricBlock([line('很长很长的一句话')], { maxHeight: 10 })
  assert.equal(r.visibleCount, 0)
  assert.equal(r.truncated, true)
  // 五档全显示 0 句 → 平局留大字号，所以是最高档而不是最低档
  assert.equal(r.fontSize, LYRIC_TIERS[0])
})

test('default ratio is 1.5 and is overridable', () => {
  assert.equal(LYRIC_LINE_HEIGHT_RATIO, 1.5)
  const lines = Array.from({ length: 4 }, (_, i) => line(`第${i}句`))
  // 4 × 24 × 1.2 = 115.2 装得进 120，但 4 × 24 × 1.5 = 144 装不进
  assert.equal(fitLyricBlock(lines, { maxHeight: 120, lineHeightRatio: 1.2 }).fontSize, 24)
  // 1.5 档下逐档：24→144 超、22→132 超、20→120 **恰好等于**上限（判据是 >，等于算装得下）
  assert.equal(fitLyricBlock(lines, { maxHeight: 120 }).fontSize, 20)
})

// 上面每一档、每一个 `fontSize × 1.5` 的行模型都是**原始 dp**。它们对得上真实行高，只在两个前提成立时：
// ① 安卓的**系统**字号没有乘上去（allowFontScaling 默认 true，1.3 档就是 +30%，文字块顶穿
//    index.tsx 的 MUSIC_CARD_TEXT_RESERVE / 这里的 lyricMaxHeight，溢出发生在导出的成品图里）；
// ② App 的 theme.fontShadow 没有跟着 common/Text 铺进产物图（spec §3：分享图不跟 App 设置走）。
// 这两条都是渲染层的事，node --test 载不动组件，所以按源码数一遍（读源码判据同 tests/feature-icons-font.mts）：
// 剥掉注释后 ① `<Text` 的个数 == `allowFontScaling={false}` 的个数，
// ② `noShadow` 出现 textCount + 1 次（一处定义 + 每枚字铺一次）—— 只声明不铺用也算漏。
const CARD_TEXT_FILES = ['MusicCard.tsx', 'LyricCard.tsx', 'BrandLine.tsx']
const CARD_DIR = path.join(import.meta.dirname, '../src/components/ShareCard')
const stripComments = (src: string) => src
  .split('\n')
  .filter(l => !/^\s*(\/\/|\/?\*)/.test(l))
  .join('\n')

for (const file of CARD_TEXT_FILES) {
  test(`${file} keeps card text out of both font settings`, () => {
    const src = stripComments(readFileSync(path.join(CARD_DIR, file), 'utf8'))
    const texts = src.match(/<Text\b/g) ?? []
    assert.ok(texts.length > 0, `${file} 里一个 <Text> 都没有：这条判据该重看了`)
    assert.equal((src.match(/allowFontScaling=\{false\}/g) ?? []).length, texts.length)
    assert.equal((src.match(/\bnoShadow\b/g) ?? []).length, texts.length + 1)
    assert.match(src, /textShadowColor:\s*'transparent'/)
    assert.match(src, /textShadowRadius:\s*0/)
  })
}

// §11.11 的字号判据：一行最多容纳 26 个平均英文字母（字宽 0.5em 是 arial.ttf 量出来的，见 cardTypography.ts）。
// 这一档是纯函数，node 直接载得动，所以判据按数字钉住而不是按源码扫。

test('26 letters fill the line on a 360dp screen', () => {
  // 360 × CARD_WIDTH_RATIO 0.78 = 280.8，减掉两侧 CARD_PADDING 20 ⇒ 文字列 240.8dp
  const sizes = cardTextSizes(240.8)
  assert.equal(sizes.title, 18.5)
  assert.equal(sizes.singer, 13.9)
  assert.equal(sizes.titleLineHeight, 23.1)
  // 判据本体：26 个字母 × 0.5em × 字号 ≈ 列宽（四舍五入到 0.1 之后仍应在 1dp 内）
  assert.ok(Math.abs(26 * 0.5 * sizes.title - 240.8) < 1)
})

test('the rule is capped at the old hand-written 24dp and floored at 14dp', () => {
  assert.equal(cardTextSizes(1000).title, 24) // 卡再宽也不把字放回去
  assert.equal(cardTextSizes(100).title, 14) // 小屏上按判据会算到读不动，宁可一行装下更多字母
})

test('a width that cannot be measured falls back to the cap, not NaN', () => {
  // Math.min/Math.max 会把 NaN 一路传到 fontSize（同 §11.6 记的 fitLyricBlock 那一类漏子）
  for (const w of [NaN, Infinity, -Infinity]) {
    const sizes = cardTextSizes(w)
    assert.equal(sizes.title, 24)
    assert.ok(Number.isFinite(sizes.singer) && Number.isFinite(sizes.titleLineHeight))
  }
})

test('MusicCard takes its font sizes from the rule instead of hard-coded numbers', () => {
  const src = stripComments(readFileSync(path.join(CARD_DIR, 'MusicCard.tsx'), 'utf8'))
  assert.match(src, /fontSize:\s*sizes\.title/)
  assert.match(src, /lineHeight:\s*sizes\.titleLineHeight/)
  assert.match(src, /fontSize:\s*sizes\.singer/)
  assert.doesNotMatch(src, /fontSize:\s*\d/)
})
