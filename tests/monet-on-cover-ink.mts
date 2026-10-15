import test from 'node:test'
import assert from 'node:assert/strict'

import { Contrast } from '@material/material-color-utilities/contrast/contrast.js'
import { Hct } from '@material/material-color-utilities/hct/hct.js'

import {
  INK_ACCENT,
  INK_FONT,
  INK_HEADROOM,
  INK_LABEL,
  INK_LYRIC,
  INK_LYRIC_SOFT,
  INK_PRIMARY,
  PANEL_CHROMA_CAP,
  PANEL_MIN_TONE,
  PANEL_TONE_DROP,
  buildOnCoverInk,
  pickInkArgb,
  type InkRole,
} from '../src/utils/monet/onCoverTheme.ts'

// 场的三档极端值不是随手挑的：L*20 = 极暗封面（蒙版几乎没得顶），L*30 = 旧锚点 26 下真夹具的合成场
// （sunset 实测 30.26），L*44 = 蒙版被顶到完全不透之前场能到的最亮一侧。
// 当前锚点 32 下同一张真机夹具是 36.5，正落在 30~44 中间 —— 换锚点不用改这里的档位，它夹得住。
// 前景的可读性承诺必须在这三档上同时成立，中间值是单调插出来的。
const FIELDS = [20, 30, 44]

const roles: Array<[string, InkRole]> = [
  ['font', INK_FONT],
  ['fontLabel', INK_LABEL],
  ['accent', INK_ACCENT],
  ['primary', INK_PRIMARY],
  ['lyric', INK_LYRIC],
  ['lyricSoft', INK_LYRIC_SOFT],
]

test('每个角色对三档极端场都过自己的下限（还带 INK_HEADROOM）', () => {
  for (const field of FIELDS) {
    for (const hue of [40, 100, 260]) {
      for (const [name, role] of roles) {
        const argb = pickInkArgb(hue, role, 34, field)
        assert.ok(argb != null, `field=${field} hue=${hue} ${name} 取不到墨`)
        const tone = Hct.fromInt(argb).tone
        const ratio = Contrast.ratioOfTones(tone, field)
        assert.ok(ratio >= role.min + INK_HEADROOM,
          `field=${field} hue=${hue} ${name}：ratio=${ratio.toFixed(3)} 下限=${role.min} 实测 tone=${tone.toFixed(2)}`)
      }
    }
  }
})

test('彩度上限跟着封面自己有多浓走：灰封面不许长出鲜艳高亮', () => {
  for (const name of ['accent', 'primary'] as const) {
    const role = name === 'accent' ? INK_ACCENT : INK_PRIMARY
    const vivid = Hct.fromInt(pickInkArgb(40, role, 34, 30)!)
    const washed = Hct.fromInt(pickInkArgb(40, role, 4, 30)!)
    assert.ok(vivid.chroma > washed.chroma, `${name}：cap 34 的彩度(${vivid.chroma})应高于 cap 4(${washed.chroma})`)
    assert.ok(washed.chroma <= 4 + 0.5, `${name} 超出上限：${washed.chroma}`)
  }
  // cap 0 = 中性灰，这一档是"退让退到底"的兜底，必须仍然存在且仍过闸。
  // 阈值取 5 而不是 0：HCT 的中性轴落到 8 bit sRGB 上会因取整读出 C*≈2.7，那不是彩度是量化噪声。
  const neutral = pickInkArgb(40, INK_FONT, 0, 30)!
  assert.ok(Hct.fromInt(neutral).chroma < 5, `cap 0 拿到 chroma=${Hct.fromInt(neutral).chroma}`)
  assert.ok(Contrast.ratioOfTones(Hct.fromInt(neutral).tone, 30) >= INK_FONT.min + INK_HEADROOM)
})

test('夹完 sRGB 色域再读回来的明度才算数：黄在高明度端装不下 24 彩度', () => {
  // pickInkArgb 交出去之前会把颜色读回来重核一次。少了这一步，Hct.from(hue, 24, 74) 在黄色端
  // 夹完色域实际只剩 L*≈72 附近，而闸门是按输入的 74 算的 —— 差的就是那 0.1 的余量都不止。
  const yellow = Hct.fromInt(pickInkArgb(100, INK_ACCENT, 34, 30)!)
  const blue = Hct.fromInt(pickInkArgb(260, INK_ACCENT, 34, 30)!)
  assert.ok(yellow.chroma < blue.chroma - 5, `黄色 C*=${yellow.chroma} 没被色域夹下来（蓝 C*=${blue.chroma}）`)
  for (const ink of [yellow, blue]) {
    assert.ok(Math.abs(ink.tone - INK_ACCENT.tone) < 2, `实际 tone=${ink.tone.toFixed(2)} 目标=${INK_ACCENT.tone}`)
    assert.ok(Contrast.ratioOfTones(ink.tone, 30) >= INK_ACCENT.min + INK_HEADROOM)
  }
})

test('层次没塌成一片白：暗场里白、灰、高亮三档明度是分得开的', () => {
  // 这条钉的是本轮真正的 bug：闸门按线性光算场时算亮了 5 个 L*，
  // 于是 label/accent/primary 全被顶到接近白（白+灰的"灰"直接不存在）。
  for (const field of [20, 30]) {
    const ink = buildOnCoverInk({ fieldTone: field, tint: { hue: 40, chroma: 20 } })!
    const tone = (argb: number) => Hct.fromInt(argb).tone
    assert.ok(tone(ink.font) - tone(ink.fontLabel) >= 10,
      `field=${field} 主字色(${tone(ink.font).toFixed(1)}) 与次级灰(${tone(ink.fontLabel).toFixed(1)}) 差太少`)
    assert.ok(tone(ink.fontLabel) - tone(ink.accent) >= 2,
      `field=${field} 次级灰(${tone(ink.fontLabel).toFixed(1)}) 与图标色(${tone(ink.accent).toFixed(1)}) 差太少`)
    assert.ok(tone(ink.accent) < tone(ink.font), `field=${field} 图标色不该亮过主字色`)
  }
})

test('歌词两档：够不着 3.0 就一起往亮退，宁可同亮也不破线', () => {
  // 场 L*30 时译文的目标明度 L*56 只有 2.7 —— pickInkArgb 会朝"远离场"的方向退到 L*62，
  // 结果和 lyric 同亮（只剩彩度差）。这是有意的取舍：可读性优先于层次，
  // 而"自动加亮到过线"也比"交出一个破线的灰"好。红在这里说明退让方向被改反了。
  const ink = buildOnCoverInk({ fieldTone: 30, tint: { hue: 40, chroma: 20 } })!
  const lyricTone = Hct.fromInt(ink.lyric).tone
  const softTone = Hct.fromInt(ink.lyricSoft).tone
  assert.ok(softTone >= INK_LYRIC_SOFT.tone, `译文档 ${softTone} 不该比目标 ${INK_LYRIC_SOFT.tone} 更暗`)
  assert.ok(Math.abs(lyricTone - softTone) <= 1, `场 L*30 下两档应一起退到线上（${lyricTone} / ${softTone}）`)
  for (const argb of [ink.lyric, ink.lyricSoft]) {
    assert.ok(Contrast.ratioOfTones(Hct.fromInt(argb).tone, 30) >= INK_LYRIC.min + INK_HEADROOM)
  }
})

test('面板恒比场暗一档，且不低于 PANEL_MIN_TONE', () => {
  for (const field of FIELDS) {
    const ink = buildOnCoverInk({ fieldTone: field, tint: { hue: 40, chroma: 20 } })!
    const panel = Hct.fromInt(ink.panel)
    assert.ok(panel.tone < field, `panel tone=${panel.tone.toFixed(2)} 应比场 ${field} 更暗`)
    assert.ok(Math.abs(panel.tone - (field - PANEL_TONE_DROP)) < 1.5, `panel tone=${panel.tone.toFixed(2)}，目标 ${field - PANEL_TONE_DROP}`)
    assert.ok(panel.chroma <= PANEL_CHROMA_CAP + 0.5, `panel chroma=${panel.chroma.toFixed(2)}`)
    // 别再暗过这条线：到了纯黑就吃不到封面色相，也跟纯黑主题分不出来
    assert.ok(Math.abs(panel.tone - Math.max(PANEL_MIN_TONE, field - PANEL_TONE_DROP)) < 1.5)
  }
})

test('依托面算不出来就整批返回 null，让调用方保持主题原样', () => {
  assert.equal(buildOnCoverInk({ fieldTone: NaN, tint: { hue: 40, chroma: 20 } }), null)
  assert.equal(buildOnCoverInk({ fieldTone: 30, tint: { hue: NaN, chroma: 20 } }), null)
  assert.equal(buildOnCoverInk({ fieldTone: 30, tint: { hue: 40, chroma: NaN } }), null)
  assert.equal(buildOnCoverInk({ fieldTone: 30, tint: undefined as never }), null)
  // tone 域外（-1 / 101）也判非法：Contrast 拿到那种值会算出看着合理的数
  assert.equal(buildOnCoverInk({ fieldTone: 101, tint: { hue: 40, chroma: 20 } }), null)
})

test('场越亮层次越被压平是已知代价，但可读性不能跟着塌', () => {
  // 不复用 surface 的 MIN_CONTRAST：这条要守的是"白墨在暗场上过 4.5"这件事本身，
  // 跟着实现里的常量走的话，把 MIN_CONTRAST 调小它也不会红。
  const WCAG_BODY = 4.5
  // 场 L*44（蒙版顶到接近不透的最亮一侧）时 4.5 档全被顶到 L*93 附近，白+灰塌成一片白 ——
  // 这是暗锚（现为 32）+ 闸门选边的已知代价，spec §4 记了：锚点往上抬只是把塌层的起点提前。
  // 这条只钉"过线"，
  // 若哪天要求层次也得保住，改的是暗锚而不是这里。
  const ink = buildOnCoverInk({ fieldTone: 44, tint: { hue: 40, chroma: 20 } })!
  for (const [name, argb] of [['font', ink.font], ['fontLabel', ink.fontLabel], ['accent', ink.accent], ['primary', ink.primary]] as const) {
    assert.ok(Contrast.ratioOfTones(Hct.fromInt(argb).tone, 44) >= WCAG_BODY, `field=44 ${name} 破线`)
  }
})
