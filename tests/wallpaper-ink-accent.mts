import test from 'node:test'
import assert from 'node:assert/strict'

import { buildWallpaperTheme, WALLPAPER_INK, getWallpaperLyricPalette, WALLPAPER_LYRIC_OPACITY } from '../src/utils/wallpaper/palette.ts'

// 绿主题那支强调色，跟 themes.ts 里 green 的一致
const GREEN = 'rgb(77, 175, 124)'

/** buildWallpaperTheme 只改已经存在的键（不凭空造键），所以夹具要把被测的那几个键先带上 */
const fakeTheme = () => ({
  id: 'green',
  name: '绿意盎然',
  isDark: false,
  'c-primary': GREEN,
  'c-primary-alpha-100': 'rgba(77, 175, 124, 0.90)',
  'c-primary-alpha-900': 'rgba(77, 175, 124, 0.10)',
  'c-primary-dark-100': 'rgb(69,158,112)',
  'c-primary-dark-100-alpha-200': 'rgba(69, 158, 112, 0.80)',
  'c-primary-dark-300-alpha-800': 'rgba(56, 128, 91, 0.20)',
  'c-primary-light-100': 'rgb(113,191,150)',
  'c-primary-light-100-alpha-100': 'rgba(113, 191, 150, 0.90)',
  'c-primary-light-1000': 'rgb(255,255,255)',
  // 进度条那六支（ProgressBar.tsx / PlayerOverlay 的进度层）
  'c-primary-light-300-alpha-800': 'rgba(56, 128, 91, 0.20)',
  'c-primary-light-400-alpha-700': 'rgba(50, 115, 82, 0.30)',
  'c-primary-light-100-alpha-400': 'rgba(69, 158, 112, 0.60)',
  'c-primary-light-100-alpha-600': 'rgba(69, 158, 112, 0.40)',
  'c-primary-light-100-alpha-700': 'rgba(69, 158, 112, 0.30)',
  'c-content-background': 'rgb(255,255,255)',
  'c-font': 'rgb(66,66,66)',
  'is-wallpaper': false,
})

const alphaOf = (css: string) => {
  const matched = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/.exec(css)
  return matched ? Number(matched[1]) : 1
}

test('壁纸模式下强调色恒为字色那支白', () => {
  const theme = buildWallpaperTheme(fakeTheme())
  assert.equal(theme['is-wallpaper'], true)
  assert.equal(theme['c-primary'], WALLPAPER_INK)
  // 悬停 / 按下那两支 dark 族跟着一起走：照片上一支绿配一支白绿比全白更难认
  assert.equal(theme['c-primary-dark-100'], 'rgb(255, 255, 255)')
  assert.equal(theme['c-primary-dark-100-alpha-200'], 'rgba(255, 255, 255, 0.80)')
})

test('强调色与播控页背景那档无关：同一份主题只导出一个结果', () => {
  // applyToPlayer 只是"图铺不铺到播控页"，不再是 buildWallpaperTheme 的入参 ——
  // 用户切一次播控页背景就会重拼一次主题，强调色若还挂在那上面，整个 App 的配色会跟着翻。
  // 这条钉住"同一输入恒等"，防止以后又把某个设置开关接回强调色。
  assert.deepEqual(buildWallpaperTheme(fakeTheme()), buildWallpaperTheme(fakeTheme()))
  assert.equal(buildWallpaperTheme(fakeTheme())['c-primary'], WALLPAPER_INK)
})

test('alpha 命名是反的：alpha-100 最实、alpha-900 最透', () => {
  const theme = buildWallpaperTheme(fakeTheme())
  assert.equal(theme['c-primary-alpha-100'], 'rgba(255, 255, 255, 0.90)')
  assert.equal(theme['c-primary-alpha-900'], 'rgba(255, 255, 255, 0.10)')
})

test('light 族仍是"深色面"：它一动，弹窗头部就变成白底白字', () => {
  const theme = buildWallpaperTheme(fakeTheme())
  // 浅族按主题自己那支主色往黑走，只有充当前景的那几支（进度条）例外，见下一条
  assert.equal(theme['c-primary-light-100-alpha-100'], 'rgba(69, 158, 112, 0.90)')
  assert.equal(theme['c-primary-light-1000'], 'rgb(0, 0, 0)')
  for (const key of ['c-primary-light-100-alpha-100', 'c-primary-light-1000'] as const) {
    assert.notEqual(theme[key], WALLPAPER_INK, `${key} 不该跟着抽白`)
  }
})

test('进度条换成白，但槽 / 缓冲 / 已播的 alpha 阶梯原样保留', () => {
  const base = fakeTheme()
  const theme = buildWallpaperTheme(base)
  const keys = [
    'c-primary-light-300-alpha-800',
    'c-primary-light-400-alpha-700',
    'c-primary-light-100-alpha-400',
    'c-primary-light-100-alpha-600',
    'c-primary-light-100-alpha-700',
  ] as const
  for (const key of keys) {
    // 只换颜料：alpha 必须与主题自己那条一模一样，否则"拖拽中 / 拖拽目标"的分档会走样
    assert.equal(alphaOf(theme[key]), alphaOf(base[key]), `${key} 的 alpha 被改了`)
    assert.match(theme[key]!, /^rgba\(255, 255, 255, /, `${key} 的颜料不是白`)
  }
  // 圆点：整支实白，它在照片上要是最亮的那一点
  assert.equal(theme['c-primary-light-100'], WALLPAPER_INK)
  // 阶梯：槽 0.20 < 缓冲 0.30 < 已播 0.60 < 圆点 1.00
  assert.ok(alphaOf(theme['c-primary-light-300-alpha-800']) < alphaOf(theme['c-primary-light-400-alpha-700']))
  assert.ok(alphaOf(theme['c-primary-light-400-alpha-700']) < alphaOf(theme['c-primary-light-100-alpha-400']))
  assert.ok(alphaOf(theme['c-primary-light-100-alpha-400']) < alphaOf(theme['c-primary-light-100']))
})

test('文字阴影那条是实黑，不能被白强调色替掉', () => {
  assert.equal(buildWallpaperTheme(fakeTheme())['c-primary-dark-300-alpha-800'], 'rgba(0, 0, 0, 0.65)')
})

// —— 歌词页非当前行（getWallpaperLyricPalette）——
// 最坏的场：纯白照片压默认 0.55 柔光（WALLPAPER_SCRIM 近黑）→ 场上 sRGB 119、Y=0.1846。
// 这条账在 palette.ts 的注释里也写了一份，改常量必须两边一起改。
const FIELD_SRGB = 119
const relLum = (srgb: number) => {
  const c = srgb / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
const overField = (alpha: number) => relLum(alpha * 255 + (1 - alpha) * FIELD_SRGB)
const contrast = (alpha: number) => (overField(alpha) + 0.05) / (relLum(FIELD_SRGB) + 0.05)

test('歌词页非当前行：照片上过 3.0，且与当前行仍差出明显一档', () => {
  const inks = getWallpaperLyricPalette(WALLPAPER_INK)
  const onScreen = alphaOf(inks.ink) * WALLPAPER_LYRIC_OPACITY
  const translation = alphaOf(inks.translation) * WALLPAPER_LYRIC_OPACITY
  // 当前行是实白（wallpaper 模式下 c-primary = WALLPAPER_INK），它的屏上透明度恒为 1
  assert.ok(contrast(1) > 4.4, `当前行对最坏场应当有 4.4 以上，实际 ${contrast(1).toFixed(2)}`)
  assert.ok(contrast(onScreen) >= 3.0, `非当前行对最坏场要过大字号 3.0，实际 ${contrast(onScreen).toFixed(2)}`)
  // "显著区分"：屏上透明度至少低 0.25（约 14 个 L*），又不能让译文压过正文
  assert.ok(1 - onScreen >= 0.25, `非当前行与当前行差 ${(1 - onScreen).toFixed(3)}，太小`)
  assert.ok(translation < onScreen - 0.1, '译文要比正文再退一档')
  assert.ok(contrast(translation) >= 2.3, `译文对最坏场至少 2.3，实际 ${contrast(translation).toFixed(2)}`)
})

test('当前行的描边是实黑、比主题默认那条重：色值到顶后只能压暗部', () => {
  // 当前行颜色是 c-primary = 纯白，255 已经到顶 —— 想再"加深"只能是笔画外沿那一圈暗部。
  const inks = getWallpaperLyricPalette(WALLPAPER_INK)
  const defaultShadowAlpha = alphaOf(buildWallpaperTheme(fakeTheme())['c-primary-dark-300-alpha-800'])
  const activeAlpha = alphaOf(inks.activeShadow.color)
  assert.match(inks.activeShadow.color, /^rgba\(0, 0, 0, /, '当前行的描边必须是黑的')
  assert.ok(activeAlpha >= defaultShadowAlpha + 0.2, `描边要比默认那条（${defaultShadowAlpha}）实一档，实际 ${activeAlpha}`)
  assert.ok(inks.activeShadow.radius > 2, '半径要比主题默认的 2 宽，暗环才压得住照片的高光')
  assert.ok(inks.activeShadow.offset.width > 0.2 || inks.activeShadow.offset.height > 0.2, '偏移要比默认的 0.2 大')
})
