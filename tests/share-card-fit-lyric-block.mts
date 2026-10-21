import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { EXTENDED_TIER_FLOOR, LYRIC_FOOTER_SINGER_FONT_SIZE, LYRIC_LINE_HEIGHT_RATIO, LYRIC_MIN_FONT_SIZE, LYRIC_TIERS, WRAP_SLACK_ROWS, estimateRowCount, fitsSingleRow, fitLyricBlock, lyricFontSizes, resolveNoWrap } from '../src/components/ShareCard/fitLyricBlock.ts'
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

// —— 换行感知模型（textWidth 给了才启用）——
// 旧模型把"一句"当一行算高度，窄卡上每句实际渲染两行，真实高度几乎是预算两倍
// （图一：字体取最高档时五句以内的短歌词照样顶穿圆角卡）。估宽判据按数字钉住。

test('estimateRowCount follows the wrap width and is conservative via ceil', () => {
  // 全角 5 字 = 5em；textWidth 100、字号 20 → em 宽 5 → 1 行
  assert.equal(estimateRowCount('一二三四五', 20, 100), 1)
  // 字号翻倍 → em 宽减半 → 2 行（ceil 0.5 只能向上）
  assert.equal(estimateRowCount('一二三四五', 40, 100), 2)
  // 拉丁 + 空格取 0.55em："hello world" = 11 × 0.55 = 6.05em → 20dp 下需要 1.21 → 2 行
  assert.equal(estimateRowCount('hello world', 20, 100), 2)
  // 空白句不占行；宽度无效时退回"一句一行"
  assert.equal(estimateRowCount('   ', 20, 100), 0)
  assert.equal(estimateRowCount('hello', 20, 0), 1)
  assert.equal(estimateRowCount('hello', 20, NaN), 1)
})

test('wrap mode reserves one body row as estimation slack', () => {
  assert.equal(WRAP_SLACK_ROWS, 1)
  const lines = [line('一二三四'), line('四三四二')]
  // 不折行（旧行为）：2 × 36 = 72 ≤ 100，24 档两句全装
  assert.deepEqual(fitLyricBlock(lines, { maxHeight: 100 }), {
    fontSize: 24, extendedFontSize: 22, visibleCount: 2, truncated: false,
  })
  // 折行 120：24 档预算 100−36=64，第二句 36+36=72 装不下；22 档预算 100−33=67，两行 66 → 全装
  assert.deepEqual(fitLyricBlock(lines, { maxHeight: 100, textWidth: 120 }), {
    fontSize: 22, extendedFontSize: 20, visibleCount: 2, truncated: false,
  })
})

test('wrap-aware budget counts wrapped rows, not sentences', () => {
  const lines = [line('一二三四五六七八九十'), line('一二三四五六七')]
  // 逐档往下（textWidth 120）：24 档两句都是 2 行 72 > 预算 64；22 档 2×33=66 ≤ 67 → 1 句；
  // 20/18 档都只有 1 句（不赢）；16 档：48 + 24 = 72 ≤ 76 → 两句全装
  assert.deepEqual(fitLyricBlock(lines, { maxHeight: 100, textWidth: 120 }), {
    fontSize: 16, extendedFontSize: EXTENDED_TIER_FLOOR, visibleCount: 2, truncated: false,
  })
})

test('wrapped translations are part of the same block budget', () => {
  const lines = [line('一二三', ['一二三四五六七八九十'])]
  // 24 档：正文 36 + 译文(10 字 → 2 行) 66 = 102 > 64；22/20/18 档块高 93/84/75 仍压不进各自的预算；
  // 16 档：24 + floor 12 一行 18 = 42 ≤ 76 → 整块（绝不只画正文把译文切掉）。没有句被丢 → 不算截断
  assert.deepEqual(fitLyricBlock(lines, { maxHeight: 100, textWidth: 120 }), {
    fontSize: 16, extendedFontSize: EXTENDED_TIER_FLOOR, visibleCount: 1, truncated: false,
  })
})

test('degenerate width keeps the all-zero tie at the top tier', () => {
  // 每档都 0 句 → 平局不换档，留最高档（与旧模型的平局规则同一判据）
  const r = fitLyricBlock([line('很长很长的一句话')], { maxHeight: 10, textWidth: 120 })
  assert.equal(r.visibleCount, 0)
  assert.equal(r.truncated, true)
  assert.equal(r.fontSize, LYRIC_TIERS[0])
})

// —— 逐 dp 下探（歌词卡走的那一支：fontSize + minFontSize）——
// 用户 2026-10-19 的两条要求：① 卡片里每句的换行跟歌词页对齐；② 选了多句就在最大卡片空间里
// 逐档缩小字号多装几句，地板是"卡内歌手名"那一档。行模型还是原始 dp × 1.5，
// 只是档位从"五档"换成"从用户那一档逐 dp 到地板"。

const flat = (text: string) => ({ text, extendedLyrics: [], noWrap: true })

test('the floor is the card singer-name size and nothing else', () => {
  assert.equal(LYRIC_FOOTER_SINGER_FONT_SIZE, 14)
  assert.equal(LYRIC_MIN_FONT_SIZE, LYRIC_FOOTER_SINGER_FONT_SIZE)
})

test('lyricFontSizes walks down by 1dp and always lands on the floor', () => {
  assert.deepEqual(lyricFontSizes(20, 14), [20, 19, 18, 17, 16, 15, 14])
  // 上界不是整步（歌词页设置 ÷10 可能是 21.5 这种）：末尾补地板，否则那一档探不到
  assert.deepEqual(lyricFontSizes(14.5, 14), [14.5, 14])
  // 起点比地板还小（理论上不该发生）：只走那一档，不往上冒
  assert.deepEqual(lyricFontSizes(13, 14), [13])
  assert.deepEqual(lyricFontSizes(14, 14), [14])
  // 无效上界没有档位可探
  assert.deepEqual(lyricFontSizes(0, 14), [])
  assert.deepEqual(lyricFontSizes(NaN, 14), [])
})

test('the descent starts at the lyric page size and stays there when all fits', () => {
  const lines = [flat('第一句'), flat('第二句'), flat('第三句')]
  // 3 字 = 3em，列宽 100 时 20dp 只要 60 ⇒ 一句一行；三句 3×30=90 ≤ 100 ⇒ 起步就装得下
  assert.deepEqual(fitLyricBlock(lines, { maxHeight: 100, textWidth: 100, fontSize: 20, minFontSize: 14, extendedRatio: 0.8 }), {
    fontSize: 20, extendedFontSize: 16, visibleCount: 3, truncated: false,
  })
})

test('the descent shrinks one dp at a time until the whole selection fits', () => {
  const lines = [flat('第一句'), flat('第二句'), flat('第三句')]
  // 预算 70：20 档两句 60、三句 90 超；19/18/17/16 都还是两句（平局留大字号）；
  // 15 档三句 3×22.5=67.5 ≤ 70 ⇒ 全装下，当场收工
  assert.deepEqual(fitLyricBlock(lines, { maxHeight: 70, textWidth: 100, fontSize: 20, minFontSize: 14, extendedRatio: 0.8 }), {
    fontSize: 15, extendedFontSize: 12, visibleCount: 3, truncated: false,
  })
})

test('the descent stops at the floor and truncates whole sentences there', () => {
  const lines = Array.from({ length: 10 }, (_, i) => flat(`第${i}句`))
  // 预算 85：20/19 档 2 句、18/17/16/15 档 3 句、14 档 4 句（85/21=4.05）⇒ 地板那档装得最多
  const r = fitLyricBlock(lines, { maxHeight: 85, textWidth: 100, fontSize: 20, minFontSize: 14, extendedRatio: 0.8 })
  assert.equal(r.fontSize, LYRIC_MIN_FONT_SIZE)
  assert.equal(r.visibleCount, 4)
  assert.equal(r.truncated, true)
})

test('the descent keeps the bigger font when two tiers show the same count', () => {
  const lines = Array.from({ length: 10 }, (_, i) => flat(`第${i}句`))
  // 预算 100：20~17 档 3 句，16 档 4 句（100/24=4.17），15/14 档还是 4 句 ⇒ 平局停在 16
  assert.deepEqual(fitLyricBlock(lines, { maxHeight: 100, textWidth: 100, fontSize: 20, minFontSize: 14, extendedRatio: 0.8 }), {
    fontSize: 16, extendedFontSize: 12.8, visibleCount: 4, truncated: true,
  })
})

// —— 换行跟歌词页对齐 ——

test('fitsSingleRow only constrains lines the lyric page shows as one row', () => {
  // 6 个全角 = 6em：列宽 100 里 20dp 要 120 ⇒ 两行，钉不住；16dp 要 96 ⇒ 钉得住
  assert.equal(fitsSingleRow({ text: '一二三四五六', noWrap: true }, 20, 100), false)
  assert.equal(fitsSingleRow({ text: '一二三四五六', noWrap: true }, 16, 100), true)
  assert.equal(fitsSingleRow({ text: '一二三', noWrap: true }, 20, 100), true)
  // 歌词页上就折了行的句子（没有 noWrap）压根不在约束里，卡里照常自动换行
  assert.equal(fitsSingleRow({ text: '一二三四五六七八九十' }, 20, 100), true)
  // 连地板都放不进一行的长句（40 个拉丁 = 22em，14dp 要 308 > 100）不该把整张卡拖到地板
  assert.equal(fitsSingleRow({ text: 'a'.repeat(40), noWrap: true }, 14, 100), false)
})

test('a one-row line on the lyric page pulls the card font down to stay one row', () => {
  // 约束：20 档 6em×20=120 > 100 会折两行，16 档 96 ≤ 100 才是一行 ⇒ 搜索从 16 起步，
  // 那一句装得下（24 ≤ 100）就收，拿到 16 而不是起步的 20。
  assert.deepEqual(fitLyricBlock([flat('一二三四五六')], { maxHeight: 100, textWidth: 100, fontSize: 20, minFontSize: 14, extendedRatio: 0.8 }), {
    fontSize: 16, extendedFontSize: 12.8, visibleCount: 1, truncated: false,
  })
  // 对照组：同一句不带 noWrap（歌词页上它是折行的）就没这条约束，照旧拿起步的 20
  assert.deepEqual(fitLyricBlock([{ text: '一二三四五六', extendedLyrics: [] }], { maxHeight: 100, textWidth: 100, fontSize: 20, minFontSize: 14, extendedRatio: 0.8 }), {
    fontSize: 20, extendedFontSize: 16, visibleCount: 1, truncated: false,
  })
})

test('resolveNoWrap trusts the lyric page measurement first', () => {
  // 量到两行 ⇒ 即使按列宽估只有一行，也不钉（场上真相说了算）
  assert.equal(resolveNoWrap(2, '一二三', 20, 1000), false)
  // 量到一行 ⇒ 即使估宽模型以为它折了 4 行，也照样钉（这就是"估宽猜不准换行点"那条教训的正面）
  assert.equal(resolveNoWrap(1, '一二三四五六七八九十'.repeat(2), 20, 100), true)
})

test('resolveNoWrap falls back to the lyric page geometry for rows never laid out', () => {
  // FlatList 只挂载屏幕附近那几行：全选出来的绝大多数量不到，退回按歌词页宽度+真实渲染字号估。
  // 3 字 × 20dp = 60 ≤ 100 ⇒ 一行
  assert.equal(resolveNoWrap(undefined, '一二三', 20, 100), true)
  // 7 字 × 20dp = 140 > 100 ⇒ 两行（估宽往保守侧抬，误判只会落在"该钉的没钉"这一边）
  assert.equal(resolveNoWrap(undefined, '一二三四五六七', 20, 100), false)
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

// —— "换行跟歌词页对齐"这条链的接线（源码级，同上面 CARD_TEXT_FILES 的判据路数）——
// 这条链断过一次，而且断得很安静：歌词页的 onTextLayout 回调定义了却没接到 renderItem 上，
// 于是 lineRowCountsRef 永远是空的、noWrap 永远给不上，卡里照旧自动折行 —— 纯函数用例全绿，
// 因为判据本身没问题，缺的是喂给它的那个数。组件载不动，就按源码数一遍两端是否都还接在链上。
const LYRIC_PAGE = path.join(import.meta.dirname, '../src/screens/PlayDetail/Vertical/Lyric.tsx')

test('the lyric page actually feeds its own row counts into the poster', () => {
  const src = stripComments(readFileSync(LYRIC_PAGE, 'utf8'))
  // ① 每一行都挂上量行数的回调（少了这一句，后面两条都是死代码）
  assert.match(src, /<LrcLine[^>]*onRowCount=\{handleLineRowCount\}/)
  // ② 量到的行数确实来自 onTextLayout，并且用的是 RN 真有的事件类型
  assert.match(src, /onTextLayout=\{handleTextLayout\}/)
  assert.match(src, /NativeSyntheticEvent<TextLayoutEventData>/)
  assert.doesNotMatch(src, /TextLayoutEvent(?![A-Za-z])/)
  // ③ noWrap 走 resolveNoWrap（量到的优先、没量到的按歌词页几何估），不再只认量到
  assert.match(src, /noWrap:\s*resolveNoWrap\(/)
})

test('the card render layer pins one-row lines to one row', () => {
  const src = stripComments(readFileSync(path.join(CARD_DIR, 'LyricCard.tsx'), 'utf8'))
  // 钉一行必须同时带上"这一档字号在卡宽里仍放得下一行"那半条判据，
  // 只认 noWrap 就钉会把长句裁掉（numberOfLines 截断是有省略号的）
  assert.match(src, /numberOfLines=\{[^}]*\.noWrap[^}]*estimateRowCount\([^)]*\)\s*<=\s*1\s*\?\s*1\s*:\s*undefined\}/)
})
