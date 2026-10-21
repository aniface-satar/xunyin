import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CHROMA_CAP,
  DARK_ANCHOR_TONE,
  LIGHT_ANCHOR_TONE,
  MIN_CONTRAST,
  ON_COVER_FONT,
  SCRIM_MAX,
  SCRIM_MIN,
  buildCoverSurface,
  parseCssColor,
} from '../src/utils/monet/surface.ts'
import { Contrast } from '@material/material-color-utilities/contrast/contrast.js'
import { Hct } from '@material/material-color-utilities/hct/hct.js'
import { argbFromRgb, blueFromArgb, greenFromArgb, redFromArgb } from '@material/material-color-utilities/utils/color_utils.js'

const LIGHT_FONT = parseCssColor('rgb(33, 33, 33)')!
const DARK_FONT = parseCssColor('rgb(229, 229, 229)')!
const ORANGE = 0xFFE8551F
const WHITE = 0xFFFFFFFF
const GRAY = 0xFF808080

/** 封面侧走对象：average 与 highlight 传位置参数传反了不会报错，只会让闸门悄悄变乐观 —— 用例也不许图省事。 */
const m = (sourceArgb: number, averageArgb = sourceArgb, highlightArgb = sourceArgb) => ({ sourceArgb, averageArgb, highlightArgb })

const baseArgb = (s: { base: string }) => parseCssColor(s.base)!

/** 与 surface.ts 内部同一套合成：RN/Android 的 alpha 混合就在 sRGB 编码值上做，不是线性光。
 *  测试要独立复现这条才算真的核过 —— 只读 s.fieldTone 的话，实现里混法写错也一起错。 */
const fieldTone = (baseArgb: number, highlightArgb: number, a: number) => Hct.fromInt(argbFromRgb(
  Math.round(a * redFromArgb(baseArgb) + (1 - a) * redFromArgb(highlightArgb)),
  Math.round(a * greenFromArgb(baseArgb) + (1 - a) * greenFromArgb(highlightArgb)),
  Math.round(a * blueFromArgb(baseArgb) + (1 - a) * blueFromArgb(highlightArgb)),
) >>> 0).tone

test('parseCssColor 支持 rgb 与 rgba，非 rgb 字符串返回 null', () => {
  assert.equal(parseCssColor('rgb(33, 33, 33)'), 0xFF212121)
  assert.equal(parseCssColor('rgba(255, 255, 255, 0.9)'), 0xFFFFFFFF)
  assert.equal(parseCssColor('#212121'), null)
  assert.equal(parseCssColor(''), null)
})

test('①没有分台：压暗层 δ 恒 0、亮台与歌词台同一格（②的两台不许渗过来）', () => {
  // ① 的场是按"最亮块 vs 底色"解的一支蒙版，两台布光是 ② 专属的设计；
  // ① 若某一支算出非零 δ，说明 ② 的新字段被错用到了共用分支上。
  for (const font of [LIGHT_FONT, DARK_FONT]) {
    for (const cover of [0xFF1B2C40, GRAY, 0xFFFAFAFA]) {
      const s = buildCoverSurface(m(cover, cover, WHITE), font)
      if (s == null) continue
      assert.equal(s.browseScrimAlpha, s.scrimAlpha, `底色 ${cover.toString(16)}：亮台与歌词台不同值`)
      assert.equal(s.stageDimAlpha, 0, `底色 ${cover.toString(16)}：① 长出了压暗层 δ=${s.stageDimAlpha}`)
    }
  }
})

test('亮主题：底色落在高 tone 端，色相跟封面走', () => {
  const s = buildCoverSurface(m(ORANGE), LIGHT_FONT)!
  const tone = Hct.fromInt(baseArgb(s)).tone
  // 锚点只是目标明度：HCT→sRGB 夹完色域会往回拽一点（实测 88 → 87.93），所以判"贴着锚点"要留这点余量。
  assert.ok(tone >= LIGHT_ANCHOR_TONE - 0.5, `tone ${tone} 应贴着 ${LIGHT_ANCHOR_TONE}（允许夹色域回落 0.5）`)
  assert.ok(Math.abs(Hct.fromInt(baseArgb(s)).hue - Hct.fromInt(ORANGE).hue) < 12)
})

test('暗主题：底色贴着暗锚 32 —— 改动这里之前先读 surface.ts 那段锚点注释', () => {
  // 动态背景生效后播放页的墨色恒为白（ON_COVER_FONT），锚点从 40 降下来才给得出"白字 + 次级色"两层。
  // 26 那一档能让 白/灰/图标/强调 四层都分开，但用户嫌底色太暗；32 把底色提 6 档，
  // 代价是中间三层在明度上并成 83、只靠彩度区分（真机蓝封面实测场 30.8 → 36.5）。
  // 这条盯的是绝对值不是区间：把锚点调回 40 会让白字闸门只剩 4.6、四层全塌成一片白，
  // 而那正是本次改动要解决的问题 —— 所以它必须红，不能只判"<= 某上限"。
  const s = buildCoverSurface(m(ORANGE), ON_COVER_FONT)!
  const tone = Hct.fromInt(baseArgb(s)).tone
  assert.ok(Math.abs(tone - DARK_ANCHOR_TONE) <= 0.5, `tone ${tone} 应贴着 ${DARK_ANCHOR_TONE}`)
  assert.equal(DARK_ANCHOR_TONE, 32)
})

test('底色与字色对比度恒 >= 4.5（任意封面，底色和合成层都核）', () => {
  const sources = [ORANGE, WHITE, GRAY, 0xFF0000FF, 0xFF00FF00, 0xFF123456, 0xFFFEDCBA]
  for (const font of [LIGHT_FONT, DARK_FONT, ON_COVER_FONT]) {
    for (const src of sources) {
      const s = buildCoverSurface(m(src), font)!
      const fontTone = Hct.fromInt(font).tone
      const baseTone = Hct.fromInt(baseArgb(s)).tone
      const ratio = Contrast.ratioOfTones(baseTone, fontTone)
      assert.ok(ratio >= MIN_CONTRAST, `src=${src.toString(16)} font=${font.toString(16)} ratio=${ratio}`)
      // 用户看到的是"蒙版盖在糊掉的封面上"那一层，闸门必须也核它
      const fieldRatio = Contrast.ratioOfTones(fieldTone(baseArgb(s), src, s.scrimAlpha), fontTone)
      assert.ok(fieldRatio >= MIN_CONTRAST, `src=${src.toString(16)} font=${font.toString(16)} 合成 ratio=${fieldRatio.toFixed(2)} scrim=${s.scrimAlpha}`)
    }
  }
})

test('fieldTone 就是"最亮块上合成之后"那一层的明度（前景色阶的依托面）', () => {
  // 前景（onCoverTheme）只读这一个数，所以它必须等于手工复现的值，而且必须比底色亮出可见的一截：
  // 对着 base 算前景会拿到乐观结果，白字恰好破在透出最多的那块上。
  const highlight = 0xFFFFF0C0
  const s = buildCoverSurface(m(ORANGE, ORANGE, highlight), ON_COVER_FONT)!
  assert.equal(s.fieldTone, fieldTone(baseArgb(s), highlight, s.scrimAlpha))
  assert.ok(s.fieldTone > Hct.fromInt(baseArgb(s)).tone, '亮块透出后场应当比底色更亮')
  assert.ok(Contrast.ratioOfTones(s.fieldTone, Hct.fromInt(ON_COVER_FONT).tone) >= MIN_CONTRAST)
})

test('参照物换成最亮块：同一张封面，块比整张亮时蒙版要更实', () => {
  // 旧实现拿全图平均色当参照物，实测三张夹具的最亮块比平均亮 25~41 个 L*，闸门对亮封面系统性乐观。
  const dim = buildCoverSurface(m(GRAY, GRAY, 0xFF101010), ON_COVER_FONT)!
  const bright = buildCoverSurface(m(GRAY, GRAY, WHITE), ON_COVER_FONT)!
  assert.ok(bright.scrimAlpha > dim.scrimAlpha, `亮块 ${bright.scrimAlpha} 应比暗块 ${dim.scrimAlpha} 更实`)
  assert.ok(bright.scrimAlpha >= 0.85, `亮块 scrim=${bright.scrimAlpha}：亮封面必须把蒙版顶到接近完全不透`)
})

test('高饱和封面被削到 CHROMA_CAP，灰封面不造假彩色', () => {
  const vivid = Hct.from(30, 120, 50).toInt()
  assert.ok(Hct.fromInt(baseArgb(buildCoverSurface(m(vivid), LIGHT_FONT)!)).chroma <= CHROMA_CAP + 1)
  const graySurface = buildCoverSurface(m(GRAY), LIGHT_FONT)!
  assert.ok(Hct.fromInt(baseArgb(graySurface)).chroma < 3)
})

test('白封面压在暗底上时蒙版更实，暗封面透得多一些（差距不再像旧参数那样大）', () => {
  // 合成层过闸之后，两端都被顶到接近完全不透：旧写法盯"绝对值 0.85/0.7"，现在能守的只有方向加下限。
  const whiteCover = buildCoverSurface(m(GRAY, WHITE, WHITE), DARK_FONT)!
  const darkCover = buildCoverSurface(m(GRAY, 0xFF101010, 0xFF101010), DARK_FONT)!
  assert.ok(whiteCover.scrimAlpha > darkCover.scrimAlpha, `白${whiteCover.scrimAlpha} 应比暗封面${darkCover.scrimAlpha} 更实`)
  // 实测 0.94 / 0.85（锚点 32）：白封面被顶到几乎不透，暗封面这一侧仍留着透出余量，这是设计要的方向
  assert.ok(darkCover.scrimAlpha >= 0.75, `暗封面 scrim=${darkCover.scrimAlpha}`)
})

test('scrimAlpha 恒在 [SCRIM_MIN, SCRIM_MAX] 且保留两位小数', () => {
  for (const avg of [0xFF000000, 0xFF7F7F7F, 0xFFFFFFFF, ORANGE]) {
    const s = buildCoverSurface(m(ORANGE, avg), LIGHT_FONT)!
    assert.ok(s.scrimAlpha >= SCRIM_MIN && s.scrimAlpha <= SCRIM_MAX, `scrim=${s.scrimAlpha} 越界`)
    assert.equal(s.scrimAlpha, Number(s.scrimAlpha.toFixed(2)))
  }
})

test('字体色非法时返回 null，让调用方回落', () => {
  assert.equal(buildCoverSurface(m(ORANGE), 0x00000000), null)
})

// —— 以下 5 条是任务评审补的用例，守的都是"钳制 / 退让 / 削彩 / gamut 后校验 真的在起作用"，
//    删掉对应防护才红。每条期望值都本机复现过，见行内注释；
//    其中中灰字色那条随暗锚几次调整（40→26→32）一起改写过（旧断言"这一例必为 null"在新锚点下不成立）。

test('中灰字色（tone 50）：暗支从锚点往下退让，退到近黑才涂', () => {
  // 锚点还是 40 时这一例是 null（旧用例钉的就是它）；锚点降下来后同样 8 步退到底：
  // 实测 base rgb(0, 0, 0)、tone 0.00、scrim 0.93、field 2.21，对 tone 50 的字色刚过 4.5 的线。
  // 生产路径上播放页的墨色恒为白，走不到这里，
  // 留这条是为了钉住暗支那条退让循环还在起作用（去掉它底色会停在暗锚上、对这种字色直接过不了闸）。
  const font = 0xFF787878
  assert.ok(Hct.fromInt(font).tone > 50)
  const s = buildCoverSurface(m(ORANGE), font)!
  const baseTone = Hct.fromInt(baseArgb(s)).tone
  assert.ok(baseTone < DARK_ANCHOR_TONE, `base tone ${baseTone} 应已退到暗锚 ${DARK_ANCHOR_TONE} 以下`)
  assert.ok(Contrast.ratioOfTones(baseTone, Hct.fromInt(font).tone) >= MIN_CONTRAST)
  assert.ok(Contrast.ratioOfTones(s.fieldTone, Hct.fromInt(font).tone) >= MIN_CONTRAST)
})

test('字色落在分支切分线附近时不跨侧硬凑，宁可按 null 回落', () => {
  // 实测：字色 tone 49.92 被判为"亮主题"→ 走高 tone 端，纯白 rgb(255,255,255) 也只有 4.4962 < 4.5。
  // 低 tone 端其实够得到（tone 0 → 4.6706），但底色跨侧意味着整页从亮翻成黑，是看得见的乱来，
  // 所以设计上是"够不到就 null"，不是"换一侧再试"。
  const font = Hct.from(0, 20, 49.95).toInt() >>> 0
  assert.ok(Hct.fromInt(font).tone < 50, '夹具要落在切分线的亮侧')
  assert.equal(buildCoverSurface(m(ORANGE), font), null)
})

test('削彩上限真的在削：hue 115 在高 tone 端有色度空间，必须压到 CHROMA_CAP 以下', () => {
  const src = Hct.from(115, 120, 50).toInt() >>> 0
  assert.ok(Hct.fromInt(src).chroma > CHROMA_CAP + 10, '夹具要能被上限咬到')
  const base = Hct.fromInt(baseArgb(buildCoverSurface(m(src), LIGHT_FONT)!))
  assert.ok(base.chroma <= CHROMA_CAP + 1, `base chroma ${base.chroma} 实测 23.9；不削彩则为 50.21`)
})

test('CSS 通道越界按 255 钳制，不做位运算溢出', () => {
  assert.equal(parseCssColor('rgb(300, 0, 0)'), 0xFFFF0000)
})

test('三个测量值与字色任一非法一律 null，不被 >>> 0 吞成黑色', () => {
  assert.equal(buildCoverSurface({ sourceArgb: NaN, averageArgb: ORANGE, highlightArgb: ORANGE }, LIGHT_FONT), null)
  assert.equal(buildCoverSurface({ sourceArgb: ORANGE, averageArgb: NaN, highlightArgb: ORANGE }, LIGHT_FONT), null)
  // 少一个字段（例如原生桥回了半份测量）也不能当成 0 用
  assert.equal(buildCoverSurface({ sourceArgb: ORANGE, averageArgb: ORANGE } as never, LIGHT_FONT), null)
  assert.equal(buildCoverSurface(m(ORANGE), NaN), null)
  assert.equal(buildCoverSurface({ sourceArgb: 0x80E8551F, averageArgb: ORANGE, highlightArgb: ORANGE }, LIGHT_FONT), null)
})

test('buildCoverSurface 交出合法色阶带（纹理层的明度只能在这个区间里摆）', () => {
  const s = buildCoverSurface(m(ORANGE), LIGHT_FONT)!
  assert.ok(s.band != null, '亮主题字色下带应当存在')
  const band = s.band!
  assert.ok(band.hi - band.lo >= 20, `带宽只有 ${band.hi - band.lo}，纹理没得摆`)
  for (const t of [band.lo, band.hi]) {
    assert.ok(Contrast.ratioOfTones(t, Hct.fromInt(LIGHT_FONT).tone) >= MIN_CONTRAST)
  }
})

test('带塌了也不牵连纯色背景：暗主题字色下底色照旧交出，band 才是 null', () => {
  // 旧实现把两件事绑在一起：带算不出来就整支 return null，实测暗主题三支封面全被这条判死，功能静默不生效。
  const s = buildCoverSurface(m(ORANGE), DARK_FONT)!
  assert.equal(s.band, null)
  assert.ok(s.base.startsWith('rgb('))
  assert.ok(Contrast.ratioOfTones(Hct.fromInt(baseArgb(s)).tone, Hct.fromInt(DARK_FONT).tone) >= MIN_CONTRAST)
})
