import test from 'node:test'
import assert from 'node:assert/strict'

import themes from '../src/theme/themes/themes.ts'
import { Contrast } from '@material/material-color-utilities/contrast/contrast.js'
import { Hct } from '@material/material-color-utilities/hct/hct.js'

import {
  ON_COVER_FONT,
  PROVISIONAL_BLUR_SURFACE,
  buildBlurSurface,
  buildCoverSurface,
  cssRgb,
  parseCssColor,
  type BlurMeasure,
  type CoverMeasure,
  type CoverSurface,
} from '../src/utils/monet/surface.ts'
import { BLUR_LYRIC_COMPONENT_OPACITY, COVER_PLATE_KEYS, COVER_RULE_KEYS, applyOnCoverTheme, buildOnCoverInk, cssArgb } from '../src/utils/monet/onCoverTheme.ts'

const varColorRxp = /^var\((.+)\)$/

/**
 * 把内置主题摊平成 useTheme() 拿到的那张表。
 *
 * 为什么不直接 import src/theme/themes/index.ts 里的 buildActiveThemeColors：
 * 那个文件带 @/utils/fs（原生桥）与 @/utils/data，node --test 加载不了。
 * 所以这里是一份对应 src/theme/themes/index.ts:71-95 的抄本 —— 抄本会脱拍，
 * 脱拍的探测器是下面"17 套主题里每条规则的键都真实存在"那条用例：
 * 生产端改了别名表或删了某个键，这里会红，不会静默少测。
 */
const flatten = (theme: any): Record<string, string> => {
  const extInfo: Record<string, string> = { ...theme.config.extInfo }
  for (const [k, v] of Object.entries(extInfo) as Array<[string, string]>) {
    if (typeof v !== 'string' || !v.startsWith('var(')) continue
    extInfo[k] = theme.config.themeColors[v.replace(varColorRxp, '$1')]
  }
  const tc = theme.config.themeColors
  return {
    ...theme.config.themeColors,
    ...extInfo,
    'c-font': tc['c-850'],
    'c-font-label': tc['c-450'],
    'c-primary-font': tc['c-primary'],
    'c-primary-font-hover': tc['c-primary-alpha-300'],
    'c-primary-font-active': tc['c-primary-dark-100-alpha-200'],
    'c-primary-background': tc['c-primary-light-400-alpha-700'],
    'c-primary-background-hover': tc['c-primary-light-300-alpha-800'],
    'c-primary-background-active': tc['c-primary-light-100-alpha-800'],
    'c-primary-input-background': tc['c-primary-light-400-alpha-700'],
    'c-button-font': tc['c-primary-alpha-100'],
    'c-button-font-selected': tc['c-primary-dark-100-alpha-100'],
    'c-button-background': tc['c-primary-light-400-alpha-700'],
    'c-button-background-selected': tc['c-primary-alpha-600'],
    'c-button-background-hover': tc['c-primary-light-300-alpha-600'],
    'c-button-background-active': tc['c-primary-light-100-alpha-600'],
    'c-list-header-border-bottom': tc['c-primary-alpha-900'],
    'c-content-background': tc['c-primary-light-1000'],
    'c-border-background': tc['c-primary-light-100-alpha-700'],
  }
}

const ALL_THEMES = themes.map(t => ({ id: t.id, active: flatten(t) }))

// 三条夹具按"用户真正看到的场"分档：暗封面几乎不透出、真夹具的典型档、亮封面被蒙版顶到接近不透。
// 走的是生产链路（buildCoverSurface + ON_COVER_FONT），不是手搓 surface 字面量 —— 手搓的话
// 结构改了（比如新增 fieldTone）测试还会跟着谎报平安。
const COVERS: Array<{ name: string, measure: CoverMeasure }> = [
  { name: '暗场', measure: { sourceArgb: 0xFF2C4A6E, averageArgb: 0xFF1B2C40, highlightArgb: 0xFF3A5474 } },
  { name: '典型', measure: { sourceArgb: 0xFFE8551F, averageArgb: 0xFF7A4A2A, highlightArgb: 0xFFFFE9B8 } },
  { name: '亮场', measure: { sourceArgb: 0xFFD8C8A8, averageArgb: 0xFFEFEFEF, highlightArgb: 0xFFFFFFFF } },
]

const surfaces = COVERS.map(c => ({ ...c, surface: buildCoverSurface(c.measure, ON_COVER_FONT)! }))

const alphaRxp = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(\d*\.?\d+)\s*\)/
const alphaOf = (color: string): number | null => {
  const matched = alphaRxp.exec(color)
  return matched ? Number(matched[1]) : null
}

// solid 规则表在 onCoverTheme.ts 里；这里只挑出"字会落在它上面"的那几个键核对对比度，
// 下限按角色走（正文/图标 4.5，歌词大字号 3.0）—— 与 INK_* 角色表同一套数，见各条注释。
const TEXT_KEYS: Array<{ key: string, min: number }> = [
  { key: 'c-font', min: 4.5 },
  { key: 'c-primary-font', min: 4.5 },
  { key: 'c-font-label', min: 4.5 },
  { key: 'c-button-font', min: 4.5 },
  { key: 'c-button-font-selected', min: 4.5 },
  { key: 'c-primary', min: 4.5 },
  { key: 'c-primary-light-100', min: 4.5 },
  { key: 'c-350', min: 3.0 },
  { key: 'c-300', min: 3.0 },
]
const PANEL_KEYS = ['c-content-background', 'c-main-background', 'c-primary-light-900-alpha-200']
// 组件里读得到、但场上必须跟着封面走的两个"条"键：见下面那条用例的注释。
const SLIDER_AND_DRAG_KEYS = ['c-primary-light-100-alpha-600', 'c-primary-alpha-500']

test('内置主题共 17 套，且每条映射规则打的键都真实存在', () => {
  assert.equal(ALL_THEMES.length, 17)
  for (const theme of ALL_THEMES) {
    const missing = COVER_RULE_KEYS.filter(key => typeof theme.active[key] !== 'string')
    assert.deepEqual(missing, [], `${theme.id}：这些键在摊平后的主题里不存在，映射会静默跳过（本夹具与 src/theme/themes/index.ts:71-95 脱拍？）`)
  }
})

test('surface 为空（功能关着 / 主题自带背景图 / 没过闸门）时返回同一个引用', () => {
  for (const theme of ALL_THEMES) {
    assert.equal(applyOnCoverTheme(theme.active, null), theme.active, theme.id)
  }
})

test('三条场上，每个被映射的键都解析成合法颜色', () => {
  for (const { surface } of surfaces) {
    for (const theme of ALL_THEMES) {
      const next = applyOnCoverTheme(theme.active, surface)
      for (const key of COVER_RULE_KEYS) {
        const value = next[key]
        assert.equal(typeof value, 'string', `${theme.id} ${key} 不是字符串`)
        assert.ok(parseCssColor(value) != null, `${theme.id} ${key}=${value} 解析不出颜色`)
      }
    }
  }
})

test('字色族对两条依托面（页面场 / 面板）都过自己的下限', () => {
  for (const { name, surface } of surfaces) {
    const ink = buildOnCoverInk(surface)!
    const panelTone = Hct.fromInt(ink.panel).tone
    for (const theme of ALL_THEMES) {
      const next = applyOnCoverTheme(theme.active, surface)
      for (const { key, min } of TEXT_KEYS) {
        const tone = Hct.fromInt(parseCssColor(next[key])!).tone
        // 阈值写死（4.5 / 3.0）而不是引 MIN_CONTRAST：这条守的是"WCAG 线没破"，
        // 引实现常量的话把常量调小它也不会红。MIN_CONTRAST 本身另有 monet-surface 那条守着。
        for (const [where, backing] of [['场', surface.fieldTone], ['面板', panelTone]] as const) {
          const ratio = Contrast.ratioOfTones(tone, backing)
          assert.ok(ratio >= min, `${name}/${theme.id} ${key} 落在${where}(L*${backing.toFixed(1)}) 上只有 ${ratio.toFixed(2)}，下限 ${min}`)
        }
      }
    }
  }
})

test('面板键确实比页面场更暗一档（浮层读得出边界，又没塌成纯黑）', () => {
  for (const { name, surface } of surfaces) {
    const next = applyOnCoverTheme(ALL_THEMES[0].active, surface)
    for (const key of PANEL_KEYS) {
      const tone = Hct.fromInt(parseCssColor(next[key])!).tone
      assert.ok(tone < surface.fieldTone, `${name} ${key} tone=${tone} 应比场 ${surface.fieldTone.toFixed(1)} 更暗`)
      assert.ok(tone >= 12, `${name} ${key} tone=${tone} 暗过 PANEL_MIN_TONE`)
      // 面板不是文字，但它自己得跟场分得开（否则卡片没有"浮起来"的那一层）
      assert.ok(Math.abs(surface.fieldTone - tone) >= 4, `${name} ${key} 与场只差 ${(surface.fieldTone - tone).toFixed(1)} 个色阶`)
    }
  }
})

test('透光键保住主题自己那条 alpha，只换颜料', () => {
  // 主题的 alpha 命名是反的（alpha-900 = 0.10），它构成组件自己的层次语言；
  // 换色不动 alpha，才能既跟上墨色又不把边框/按钮底洗成一坨实色。
  for (const { surface } of surfaces) {
    for (const theme of ALL_THEMES) {
      const next = applyOnCoverTheme(theme.active, surface)
      for (const key of COVER_PLATE_KEYS) {
        const before = alphaOf(theme.active[key])
        const after = alphaOf(next[key])
        if (before == null) {
          assert.equal(after, null, `${theme.id} ${key}：主题本来是不透明，映射不该造出 alpha`)
          continue
        }
        assert.equal(after, before, `${theme.id} ${key}：alpha ${before} 被改成了 ${after}`)
      }
    }
  }
})

test('进度条拖拽段与设置滑动条的槽都跟着封面墨色走', () => {
  // 2026-10-16 真机反馈的两处漏网，两处症状各对应一个键：
  //   c-primary-light-100-alpha-600 —— ProgressBar.tsx 拖拽时"跟手那一段"（非拖拽态的已填充段用 alpha-400，早就在表里）
  //   c-primary-alpha-500          —— common/Slider.tsx 的轨道，播放器设置里音量/倍速/字号/歌词偏移四条都走它
  // 规则表没打这两个键时，场上留的是主题自己的颜料，于是"一拖进度条就冒出主题色"。
  // 断言写成"颜料等于 primary 那档墨色"而不是"不等于原值"：后者任何无关改动都能糊过去。
  for (const key of SLIDER_AND_DRAG_KEYS) {
    assert.ok(COVER_RULE_KEYS.includes(key), `${key} 没进规则表：场上会留主题色`)
  }
  for (const { name, surface } of surfaces) {
    const ink = buildOnCoverInk(surface)!
    for (const theme of ALL_THEMES) {
      const next = applyOnCoverTheme(theme.active, surface)
      for (const key of SLIDER_AND_DRAG_KEYS) {
        // parseCssColor 只看 rgb 三个通道（alpha 恒被它丢成 255），所以这里量的是颜料，
        // alpha 有没有被改写归上面"透光键保住 alpha"那条管。
        const argb = parseCssColor(next[key])
        assert.ok(argb != null, `${name}/${theme.id} ${key}=${next[key]} 解析不出颜色`)
        assert.equal(Hct.fromInt(argb!).tone, Hct.fromInt(ink.primary).tone,
          `${name}/${theme.id} ${key} 的明度不是 primary 那档（拿到的是主题色？）`)
      }
    }
  }
})

test('未映射的键一律原样穿过（其他页面/其他组件不受影响）', () => {
  for (const { surface } of surfaces) {
    for (const theme of ALL_THEMES) {
      const next = applyOnCoverTheme(theme.active, surface)
      const mapped = new Set(COVER_RULE_KEYS)
      const changed = Object.keys(theme.active).filter(key => !mapped.has(key) && next[key] !== theme.active[key])
      assert.deepEqual(changed, [], `${theme.id} 这些未映射的键被改了：${changed.join(', ')}`)
    }
  }
})

test('isDark 在场上翻真：状态栏图标靠它选亮色，别的键不受这条影响', () => {
  for (const { surface } of surfaces) {
    for (const theme of ALL_THEMES) {
      // 先宽化成 unknown 再加布尔键：ActiveTheme 本来就是"字符串表 + 少量非字符串键"，
      // 直接对 Record<string,string> 展开一个 boolean 会被索引签名拒掉。
      const base: Record<string, unknown> = { ...theme.active }
      for (const isDark of [false, true]) {
        assert.equal(applyOnCoverTheme({ ...base, isDark }, surface).isDark, true, `${theme.id} 原本 isDark=${isDark}`)
      }
    }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// ②「动态取色」（重度模糊封面铺底）那一档的前景：2026-10-17 定稿
// 「控件统一为一个颜色、近乎白、不随背景改变」+「一定要保证可读性」+「当前/非当前歌词要分得开」，
// 2026-10-18 按要求把背景整体调亮（锚 20、两台闸门 5.0）；2026-10-19 又按「当前歌词要更实」把歌词那条梯队压开
// （两台闸门就此分岔成 5.0/5.5、组件 0.50、当前行译文 0.66、译文墨色退到 0.88）。
// 文字只剩一档实白，层次只有两处 —— 歌词那条 alpha 梯队与面板那层黑纱。
// 所以这一档的墨色是常量表，不由场导出 —— 而常量站不站得住必须对着真场核：
// 层次全靠 alpha，带 alpha 的墨要先合成才是用户看到的那一格，不能拿"白字过闸"顺推。
// 歌词那两层还要乘组件自己那条透明度（② 用 BLUR_LYRIC_COMPONENT_OPACITY，普通主题与 ① 用 0.6）：
// 上一版就是只核了主题色、漏了这层乘法，亮封面上非当前行实际只剩 1.88:1。
// ─────────────────────────────────────────────────────────────────────────────

/** ②的封面夹具：暗封面基本不透出，两张真封面的测量值来自 .scratch/t85（128px 样本），
 *  保守支没有测量值（alpha 恒为 1，场就是底色本身）。 */
const BLUR_COVERS: Array<{ name: string, measure: BlurMeasure }> = [
  { name: '暗封面', measure: { averageArgb: 0xFF2A2A35, highlightArgb: 0xFF3C3C48 } },
  { name: 'Faces 真封面', measure: { averageArgb: 0xFF884245, highlightArgb: 0xFFC37F87 } },
  { name: 'Lucky 真封面', measure: { averageArgb: 0xFF787351, highlightArgb: 0xFFCBE6E4 } },
  // 闸门把这一支的场正好顶在上限（白字贴着 BLUR_MIN_CONTRAST），它是白阶梯最暗命的那一格：
  // BLUR_LYRIC_MIN 那两条下限就是按它定的（模型场 2.58 / 2.37，峰值场 2.52 / 2.31），比在暗封面上过线算数得多。
  { name: '亮到闸门口', measure: { averageArgb: 0xFFFAFAFA, highlightArgb: 0xFFFFFFFF } },
]

const blurCases: Array<{ name: string, measure: BlurMeasure | null, surface: CoverSurface }> = [
  ...BLUR_COVERS.map(({ name, measure }) => ({ name, measure, surface: buildBlurSurface(measure, ON_COVER_FONT)! })),
  { name: '保守支', measure: null, surface: PROVISIONAL_BLUR_SURFACE },
]

const rgbaStringRxp = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+))?\s*\)$/
interface Paint { r: number, g: number, b: number, a: number }
const paint = (color: string): Paint => {
  const matched = rgbaStringRxp.exec(color.trim())
  assert.ok(matched, `${color} 不是合法的 rgb/rgba`)
  return { r: Number(matched[1]), g: Number(matched[2]), b: Number(matched[3]), a: matched[4] === undefined ? 1 : Number(matched[4]) }
}
const toneOf = (p: Paint) => Hct.fromInt((0xff000000 | (p.r << 16) | (p.g << 8) | p.b) >>> 0).tone
/** RN/安卓的 alpha 混合在 sRGB 编码值上做（同 surface.ts 的混法）：带 alpha 的墨要先合成才有明度。 */
const blend = (ink: Paint, backing: Paint): Paint => ({
  r: Math.round(ink.a * ink.r + (1 - ink.a) * backing.r),
  g: Math.round(ink.a * ink.g + (1 - ink.a) * backing.g),
  b: Math.round(ink.a * ink.b + (1 - ink.a) * backing.b),
  a: 1,
})
/** 用户看到的场 = 蒙版色按交出去那一格 alpha 压在糊封面的最亮块上 */
const blurField = (surface: CoverSurface, measure: BlurMeasure | null): Paint => {
  const base = paint(surface.base)
  return blend({ ...base, a: surface.scrimAlpha }, measure == null ? base : paint(cssRgb(measure.highlightArgb)))
}

/** 恒为**实**白的那一层：标题、小字/时间、控件图标、进度条已填充、当前歌词行。
 *  ② 选定档的文字只有这一档（c-font-label 从 0.78 回充实白，见 onCoverTheme.BLUR_INK）。 */
const ONE_PAINT_KEYS = ['c-font', 'c-primary-font', 'c-font-label', 'c-button-font', 'c-button-font-selected', 'c-primary', 'c-primary-light-100']
/** 歌词那两层：主题色之外还要乘组件自己那条透明度，才是屏上真正的那一格。 */
const LYRIC_KEYS = ['c-350', 'c-300']
const onScreen = (ink: Paint, key: string): Paint =>
  LYRIC_KEYS.includes(key) ? { ...ink, a: ink.a * BLUR_LYRIC_COMPONENT_OPACITY } : ink

test('②的前景是一支白靠 alpha 分层：控件、小字与歌词三层一个字节都不动', () => {
  // "不随背景改变"要能被字面量验出来，不是验"差不多"：同一支主题贴到四张封面上，
  // 被映射的键必须逐串相同（透光键也相同 —— 颜料恒定，alpha 取自主题自己那条阶梯）。
  const first = applyOnCoverTheme(ALL_THEMES[0].active, blurCases[0].surface)
  for (const { name, surface } of blurCases) {
    const next = applyOnCoverTheme(ALL_THEMES[0].active, surface)
    for (const key of ONE_PAINT_KEYS) {
      assert.equal(next[key], 'rgb(255, 255, 255)', `${name} ${key} 不是那支统一的白：${next[key]}`)
    }
    // 层次全靠 alpha，所以除了黑纱和那两键，其余颜料必须逐字节是白：掺进任何一支灰就等于又开始跟色了
    const offWhite = COVER_RULE_KEYS
      .filter(key => !PANEL_KEYS.includes(key))
      .filter((key) => {
        const p = paint(next[key])
        return !(p.r === 255 && p.g === 255 && p.b === 255)
      })
    assert.deepEqual(offWhite, [], `${name} 这些键的颜料不是那支白：${offWhite.join(', ')}`)
    const drifted = COVER_RULE_KEYS.filter(key => next[key] !== first[key])
    assert.deepEqual(drifted, [], `${name} 这些键跟着封面变了：${drifted.join(', ')}`)
  }
})

/** ② 那两条歌词梯队自 2026-10-19 起有意压到 3.0 之下 —— 用户在四档小样里选了最强烈的一档
 *  （闸门 5.5 / 组件 0.50，见 .scratch/t166_gap.mts、t170_final.py 与 t171_ship.mts）：
 *  最坏（白底）封面上 非当前行 2.52、译文 2.31（模型场 2.58 / 2.37）。这两格是**用户拍板的交换**，
 *  不是漏核；深色封面（多数）上仍在 4 以上。下限按实测留 0.07~0.13 的余量。
 *  别顺手把它改回 3.0：那等于把这档偷偷改回 0.70。 */
const BLUR_LYRIC_MIN: Record<string, number> = { 'c-350': 2.45, 'c-300': 2.3 }

test('②的每个字色族对两条依托面（真场 / 面板）都过自己的下限，alpha 先合成再算', () => {
  for (const { name, surface, measure } of blurCases) {
    const next = applyOnCoverTheme(ALL_THEMES[0].active, surface)
    const field = blurField(surface, measure)
    const panel = blend(paint(next['c-content-background']), field)
    for (const { key, min: baseMin } of TEXT_KEYS) {
      const min = BLUR_LYRIC_MIN[key] ?? baseMin
      const ink = onScreen(paint(next[key]), key)
      for (const [where, backing] of [['场', field], ['面板', panel]] as const) {
        const ratio = Contrast.ratioOfTones(toneOf(blend(ink, backing)), toneOf(backing))
        assert.ok(ratio >= min, `${name} ${key} 落在${where}(L*${toneOf(backing).toFixed(1)}) 上只有 ${ratio.toFixed(2)}，下限 ${min}`)
      }
    }
  }
})

test('②的文字只剩一档实白，分层由歌词那条梯队买：当前行差 17 个 L* 以上、译文自成一档', () => {
  // 用户 2026-10-17 的反馈原文是"当前歌词与非当前歌词的颜色区分并不明显"；10-18 又定稿
  // "控件统一为一个颜色、近乎白"。两条不冲突的地方正在这里：标题/小字/当前行**应该**逐字节同色，
  // 要"一眼分得出"的是当前行 vs 它的译文 vs 非当前行 vs 译文。
  // 2026-10-19 用户点了最强烈那一档（组件 0.50 / 闸门 5.5）：当前行与非当前行从 13 格开到 17 格以上；
  // 同一档下 0.98/0.92 那对 ink 只差 1.7 格、"译文"又并回非当前行，所以译文的 ink 退到 0.88 才留住这一档。
  for (const { name, surface, measure } of blurCases) {
    const next = applyOnCoverTheme(ALL_THEMES[0].active, surface)
    const field = blurField(surface, measure)
    const tone = (key: string) => toneOf(blend(onScreen(paint(next[key]), key), field))
    const font = tone('c-font')
    const lyric = tone('c-350')
    const soft = tone('c-300')
    // 小字层回充实白：哪天它又被调成 0.78/0.86，先问"亮场里那 0.3 的余量是从哪来的"（答不出就是抄旧账）
    assert.equal(next['c-font-label'], 'rgb(255, 255, 255)', `${name} 小字层不是那支统一的白：${next['c-font-label']}`)
    assert.ok(font - lyric >= 17, `${name} 当前行 L*${font.toFixed(1)} 与非当前行 L*${lyric.toFixed(1)} 只差 ${(font - lyric).toFixed(1)}，不够"一眼分得出"`)
    // 0.90/0.86 那一版两行只差 1.1 个 L*，等于没有"译文"这一档；抬到 0.98/0.92 才第一次分开，
    // 而组件落到 0.50 之后 0.92 又不够了 —— 见 BLUR_INK.lyricSoft 那条注释里 1.7 与 7.6 的对比。
    assert.ok(lyric - soft >= 2, `${name} 非当前行 L*${lyric.toFixed(1)} 与译文 L*${soft.toFixed(1)} 只差 ${(lyric - soft).toFixed(1)}，译文不成档`)
    // 当前行那句译文也得留在梯队里：0.66 之下它比非当前行亮、比实白暗（.scratch/t170_C.png 就是这一档）
    const activeTrans = tone('c-primary-alpha-200')
    assert.ok(font - activeTrans >= 10 && activeTrans - lyric >= 5,
      `${name} 当前行译文 L*${activeTrans.toFixed(1)} 夹在实白 L*${font.toFixed(1)} 与非当前行 L*${lyric.toFixed(1)} 之间不成档`)
  }
})

test('②的面板是一条黑纱而不是实色：既让封面轮廓透出来，也永远比场暗', () => {
  for (const { name, surface, measure } of blurCases) {
    const next = applyOnCoverTheme(ALL_THEMES[0].active, surface)
    const field = blurField(surface, measure)
    for (const key of PANEL_KEYS) {
      const veil = paint(next[key])
      assert.ok(veil.a < 1, `${name} ${key}=${next[key]} 是实色，卡片底下就看不见封面了`)
      assert.equal(veil.r + veil.g + veil.b, 0, `${name} ${key} 的黑纱掺了别的颜料`)
      const tone = toneOf(blend(veil, field))
      // 场本身够亮时，卡片要跟页面分出两层；已经接近纯黑时（加载中那一支 L*8）分不出才是对的，
      // 那截差别要靠封面浮上来之后才有意义 —— 强行要求暗出 4 格等于要求纱在 black 上再压出 -4 的 black。
      if (toneOf(field) >= 12) {
        assert.ok(tone < toneOf(field) - 4, `${name} ${key} 合成 L*${tone.toFixed(1)} 没比场 L*${toneOf(field).toFixed(1)} 暗出一条边界`)
      } else {
        assert.ok(tone <= toneOf(field), `${name} ${key} 合成 L*${tone.toFixed(1)} 反而比场 L*${toneOf(field).toFixed(1)} 亮`)
      }
    }
  }
})

/** 浏览台的场：糊封面最亮块按 browseScrimAlpha 压到底色上 —— 渲染层第一层蒙版铺的就是这一格。 */
const blurBrowseField = (surface: CoverSurface, measure: BlurMeasure | null): Paint => {
  const base = paint(surface.base)
  return blend({ ...base, a: surface.browseScrimAlpha }, measure == null ? base : paint(cssRgb(measure.highlightArgb)))
}

/** 浏览台上真正会出现的字色键（歌词页那两层 c-350/c-300 不在这一页；它们在翻页中途的短暂越线见 §15）。 */
const BROWSE_TEXT_KEYS = TEXT_KEYS.filter(({ key }) => key !== 'c-350' && key !== 'c-300')

test('②浏览台那一格蒙版上的整套字色也过线：两台共闸之后它等于歌词台，但读的是另一个数', () => {
  // 这条只管一件事：渲染层第一层蒙版铺的是 browseScrimAlpha，不是 scrimAlpha。今天两条闸门同值、
  // 两格重合（tests/monet-blur-surface.mts 那两条钉着），所以这些读数与上一条逐字相同。
  // 留着它是因为"哪天只把某一台的线单独改动"是这套机制唯一预留的旋钮 —— 那时只有这条会去看亮台的场，
  // 而分岔的代价（小字层要不要跟着加白）必须由人重新拍板，不是由常量表默认。
  // 歌词页那两层不在浏览页出现，翻页中途那一闪的越线归 §15 那本账管。
  for (const { name, surface, measure } of blurCases) {
    const next = applyOnCoverTheme(ALL_THEMES[0].active, surface)
    const field = blurBrowseField(surface, measure)
    for (const { key, min } of BROWSE_TEXT_KEYS) {
      const ink = onScreen(paint(next[key]), key)
      const ratio = Contrast.ratioOfTones(toneOf(blend(ink, field)), toneOf(field))
      assert.ok(ratio >= min, `${name} ${key} 落在浏览台场(L*${toneOf(field).toFixed(1)}) 上只有 ${ratio.toFixed(2)}，下限 ${min}`)
    }
  }
})

test('①莫奈支的墨色仍然由场导出：②的常量表没有渗过去', () => {
  const dim = surfaces.find(s => s.name === '暗场')!
  const ink = buildOnCoverInk(dim.surface)!
  const next = applyOnCoverTheme(ALL_THEMES[0].active, dim.surface)
  assert.equal(next['c-font'], cssRgb(ink.font))
  assert.equal(next['c-font-label'], cssRgb(ink.fontLabel))
  assert.equal(next['c-content-background'], cssRgb(ink.panel))
  // 暗场上导出的主字色是 L*92 那支近白而不是纯白：哪天 ① 也被钉成常量，这条会红
  assert.notEqual(next['c-font'], 'rgb(255, 255, 255)', '① 也跟着变成常量白了')
})
