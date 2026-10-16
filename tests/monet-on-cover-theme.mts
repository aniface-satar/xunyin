import test from 'node:test'
import assert from 'node:assert/strict'

import themes from '../src/theme/themes/themes.ts'
import { Contrast } from '@material/material-color-utilities/contrast/contrast.js'
import { Hct } from '@material/material-color-utilities/hct/hct.js'

import { ON_COVER_FONT, buildCoverSurface, parseCssColor, type CoverMeasure } from '../src/utils/monet/surface.ts'
import { COVER_PLATE_KEYS, COVER_RULE_KEYS, applyOnCoverTheme, buildOnCoverInk } from '../src/utils/monet/onCoverTheme.ts'

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
