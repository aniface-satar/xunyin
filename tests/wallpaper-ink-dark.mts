import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildWallpaperTheme,
  dominantWallpaperScrim,
  getWallpaperLyricPalette,
  isDarkWallpaperInk,
  matchWallpaperInkBase,
  normalizeWallpaperInk,
  wallpaperInkColor,
  wallpaperInkFromBase,
  WALLPAPER_INK,
  WALLPAPER_INK_BASES,
  WALLPAPER_INK_DARK,
  WALLPAPER_SCRIM,
  WALLPAPER_SCRIM_LIGHT,
} from '../src/utils/wallpaper/palette.ts'

// 与 wallpaper-ink-accent.mts 同一份夹具：buildWallpaperTheme 只改已经存在的键
const GREEN = 'rgb(77, 175, 124)'

// buildWallpaperTheme<T extends object> 原样返回入参类型，而夹具只钉了被断言的那些键 ——
// 宽成一个索引签名再取，免得为了 `wallpaper-ink` 这种壁纸模式才有的键往夹具里塞默认值
const fakeTheme = (): Record<string, string | boolean> => ({
  id: 'green',
  name: '绿意盎然',
  isDark: false,
  'c-primary': GREEN,
  'c-primary-alpha-100': 'rgba(77, 175, 124, 0.90)',
  'c-primary-alpha-200': 'rgba(77, 175, 124, 0.80)',
  'c-primary-alpha-900': 'rgba(77, 175, 124, 0.10)',
  'c-primary-dark-100': 'rgb(69,158,112)',
  'c-primary-dark-100-alpha-200': 'rgba(69, 158, 112, 0.80)',
  'c-primary-dark-300-alpha-800': 'rgba(56, 128, 91, 0.20)',
  'c-primary-light-100': 'rgb(113,191,150)',
  'c-primary-light-100-alpha-100': 'rgba(113, 191, 150, 0.90)',
  'c-primary-light-1000': 'rgb(255,255,255)',
  'c-primary-light-300-alpha-800': 'rgba(56, 128, 91, 0.20)',
  'c-primary-light-400-alpha-700': 'rgba(50, 115, 82, 0.30)',
  'c-primary-light-100-alpha-400': 'rgba(69, 158, 112, 0.60)',
  'c-primary-light-100-alpha-600': 'rgba(69, 158, 112, 0.40)',
  'c-primary-light-100-alpha-700': 'rgba(69, 158, 112, 0.30)',
  'c-primary-light-900-alpha-200': 'rgba(56, 128, 91, 0.20)',
  'c-primary-background': 'rgba(113, 191, 150, 0.30)',
  'c-primary-background-hover': 'rgba(113, 191, 150, 0.20)',
  'c-primary-background-active': 'rgba(113, 191, 150, 0.10)',
  'c-primary-input-background': 'rgba(113, 191, 150, 0.30)',
  'c-button-font': 'rgba(77, 175, 124, 0.90)',
  'c-button-font-selected': 'rgba(69, 158, 112, 0.90)',
  'c-button-background': 'rgba(113, 191, 150, 0.30)',
  'c-button-background-hover': 'rgba(113, 191, 150, 0.40)',
  'c-button-background-active': 'rgba(113, 191, 150, 0.50)',
  'c-list-header-border-bottom': 'rgba(77, 175, 124, 0.10)',
  'c-border-background': 'rgba(113, 191, 150, 0.30)',
  'c-font': 'rgb(66,66,66)',
  'c-font-label': 'rgb(155,155,155)',
  'c-primary-font': 'rgb(77, 175, 124)',
  'c-primary-font-hover': 'rgba(77, 175, 124, 0.70)',
  'c-primary-font-active': 'rgba(69, 158, 112, 0.80)',
  'c-content-background': 'rgb(255,255,255)',
  'c-000': 'rgb(255,255,255)',
  'c-050': 'rgb(244,244,244)',
  'c-100': 'rgb(233,233,233)',
  'c-150': 'rgb(222,222,222)',
  'c-200': 'rgb(211,211,211)',
  'c-250': 'rgb(200,200,200)',
  'c-300': 'rgb(188,188,188)',
  'c-350': 'rgb(177,177,177)',
  'c-400': 'rgb(166,166,166)',
  'c-450': 'rgb(155,155,155)',
  'c-500': 'rgb(144,144,144)',
  'c-550': 'rgb(133,133,133)',
  'c-600': 'rgb(122,122,122)',
  'c-650': 'rgb(111,111,111)',
  'c-700': 'rgb(100,100,100)',
  'c-750': 'rgb(89,89,89)',
  'c-800': 'rgb(77,77,77)',
  'c-850': 'rgb(66,66,66)',
  'c-900': 'rgb(55,55,55)',
  'c-950': 'rgb(44,44,44)',
  'c-1000': 'rgb(33, 33, 33)',
  'is-wallpaper': false,
})

const rgbOf = (css: unknown) => {
  const matched = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(String(css))
  assert.ok(matched, `不是 rgb 串：${css}`)
  return [Number(matched[1]), Number(matched[2]), Number(matched[3])]
}

const alphaOf = (css: unknown) => {
  const matched = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/.exec(String(css))
  return matched ? Number(matched[1]) : 1
}

const relLum = (rgb: number[]) => {
  const [r, g, b] = rgb.map((value) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

test('设置值收口：老字面量、hex、rgb 全收成同一支颜色', () => {
  // 老存档里的两个字面量要落回原来看起来的那两支
  assert.equal(normalizeWallpaperInk('black'), WALLPAPER_INK_DARK)
  assert.equal(normalizeWallpaperInk('white'), WALLPAPER_INK)
  // 现在是任意颜色：色板给的是 hex，条目里存的是 rgb —— 两种写法必须收敛到同一个值
  assert.equal(normalizeWallpaperInk('#141418'), WALLPAPER_INK_DARK)
  assert.equal(normalizeWallpaperInk('#FFF'), WALLPAPER_INK)
  assert.equal(normalizeWallpaperInk('rgb(20, 20, 24)'), WALLPAPER_INK_DARK)
  // 老存档没有这个键、或者被写成别的东西，都不该把界面推到一个没有定义的状态
  for (const weird of [undefined, null, '', 'dark', 0, {}]) {
    assert.equal(normalizeWallpaperInk(weird), WALLPAPER_INK)
  }
  assert.equal(wallpaperInkColor('black'), WALLPAPER_INK_DARK)
  // 柔光与墨已经解绑：底色是两支常量，只按两层里开得更深的那支取方向
  assert.equal(dominantWallpaperScrim(0.3, 0), WALLPAPER_SCRIM)
  assert.equal(dominantWallpaperScrim(0, 0.3), WALLPAPER_SCRIM_LIGHT)
  assert.equal(dominantWallpaperScrim(0.2, 0.6), WALLPAPER_SCRIM_LIGHT)
  assert.equal(dominantWallpaperScrim(0.6, 0.2), WALLPAPER_SCRIM)
})

test('基础色板：14 支、首支白 / 含近黑、全部可解析且不重复，彩色支都够鲜', () => {
  assert.equal(WALLPAPER_INK_BASES.length, 14, `基础色应该是 14 支：${WALLPAPER_INK_BASES.length}`)
  assert.equal(WALLPAPER_INK_BASES[0].color, '#FFFFFF')
  assert.ok(WALLPAPER_INK_BASES.some((base) => base.color === '#141418'), '近黑支必须在盘里（老存档 black 的落点）')
  const seen = new Set<string>()
  for (const base of WALLPAPER_INK_BASES) {
    assert.match(normalizeWallpaperInk(base.color), /^rgb\(\d+, \d+, \d+\)$/)
    assert.ok(!seen.has(base.color), `基础色重复：${base.color}`)
    seen.add(base.color)
    if (base.achromatic) continue
    // 鲜 = 饱和度给到位：歌词页等页面挑主色 / 次色要挑得开
    assert.ok(base.sat >= 0.6, `${base.color} 饱和度只有 ${base.sat.toFixed(2)}`)
  }
  assert.equal(WALLPAPER_INK_BASES.filter((base) => base.achromatic).length, 3, '白 / 灰 / 近黑三支消色差')
})

test('基础色 × 滑杆（由白到鲜）：满档回本色、0 是白、半档按明度反推不跑偏', () => {
  for (const base of WALLPAPER_INK_BASES) {
    assert.equal(wallpaperInkFromBase(base, 1), base.color, `满档没回到 ${base.color}`)
  }
  const blue = WALLPAPER_INK_BASES.find((base) => base.color === '#0091FF')
  assert.ok(blue)
  // 0 是纯白（"由白到鲜"的起点）
  assert.equal(wallpaperInkFromBase(blue, 0), '#FFFFFF')
  // 半档再反推：向白混合的明度线性走（l = 1 − r(1 − l_base)），8bit 取整误差 < 2%
  const rematched = matchWallpaperInkBase(wallpaperInkFromBase(blue, 0.5))
  assert.equal(rematched.base, blue)
  assert.ok(Math.abs(rematched.ratio - 0.5) < 0.02, `半档还原成 ${rematched.ratio}`)
  // 老存档的两个字面量、老网格的灰阶与彩色各归各位
  assert.equal(matchWallpaperInkBase('white').base.color, '#FFFFFF')
  assert.equal(matchWallpaperInkBase('black').base.color, '#141418')
  assert.equal(matchWallpaperInkBase('#94949E').base.color, '#8E8E98')
  assert.equal(matchWallpaperInkBase('#3080CF').base.color, '#0091FF')
})

test('任意颜色都走同一段算法：蓝色、黄色各拼一次，方向由亮度决定', () => {
  const blue = buildWallpaperTheme(fakeTheme(), '#2F6BFF')
  assert.equal(blue['wallpaper-ink'], 'rgb(47, 107, 255)')
  assert.equal(blue['c-font'], 'rgb(47, 107, 255)')
  assert.equal(blue['c-primary'], 'rgb(47, 107, 255)')
  // 蓝是深色 → 状态栏图标转深（isDark 翻假）；柔光方向不再由墨决定
  assert.equal(blue.isDark, false)

  const amber = buildWallpaperTheme(fakeTheme(), '#E8B93B')
  assert.equal(amber['wallpaper-ink'], 'rgb(232, 185, 59)')
  // 黄是浅色 → 状态栏图标转亮
  assert.equal(amber.isDark, true)
})

test('亮度判定：白/米白/浅灰/黄算浅墨，近黑/深灰/藏青算深墨', () => {
  for (const light of ['#FFFFFF', '#F2EDE4', '#D5D5D9', '#E8B93B']) {
    assert.equal(isDarkWallpaperInk(light), false, `${light} 应该算浅墨`)
  }
  for (const dark of ['#141418', '#000000', '#45454C', '#1F3A5F', '#2F6BFF']) {
    assert.equal(isDarkWallpaperInk(dark), true, `${dark} 应该算深墨`)
  }
})

test('多支颜色交替拼不会串味：缓存按颜色分开存', () => {
  const blue = buildWallpaperTheme(fakeTheme(), '#2F6BFF')
  const white = buildWallpaperTheme(fakeTheme(), 'white')
  const blueAgain = buildWallpaperTheme(fakeTheme(), '#2F6BFF')
  assert.equal(white['c-font'], WALLPAPER_INK)
  assert.equal(white.isDark, true)
  assert.equal(blueAgain['c-font'], 'rgb(47, 107, 255)')
  assert.deepEqual(blueAgain, blue)
})

test('黑字那套：isDark 翻假（状态栏图标转深），整棵树换墨', () => {
  const theme = buildWallpaperTheme(fakeTheme(), 'black')
  assert.equal(theme['is-wallpaper'], true)
  // 场是亮的，状态栏图标必须是深色 —— StatusBar 读的就是这个布尔
  assert.equal(theme.isDark, false)
  assert.equal(theme['wallpaper-ink'], WALLPAPER_INK_DARK)
  // 强调色跟上：换回白字那套时它得跟着回去，两套不能互相污染
  assert.equal(theme['c-primary'], WALLPAPER_INK_DARK)
  assert.equal(buildWallpaperTheme(fakeTheme(), 'white')['c-primary'], WALLPAPER_INK)
})

test('全套换成近黑：主字/次级字/图标/分割线/按钮/输入框/进度条一个都不留白', () => {
  const theme = buildWallpaperTheme(fakeTheme(), 'black')
  const ink = rgbOf(WALLPAPER_INK_DARK)
  const keys = [
    'c-font',
    'c-font-label',
    'c-primary-font',
    'c-primary-font-hover',
    'c-primary-font-active',
    'c-button-font',
    'c-button-font-selected',
    'c-border-background',
    'c-list-header-border-bottom',
    'c-primary-background',
    'c-primary-background-hover',
    'c-primary-background-active',
    'c-primary-input-background',
    'c-button-background',
    'c-button-background-hover',
    'c-button-background-active',
    'c-primary-light-900-alpha-200',
    'c-primary-light-300-alpha-800',
    'c-primary-light-400-alpha-700',
    'c-primary-light-100-alpha-400',
    'c-primary-light-100-alpha-600',
    'c-primary-light-100-alpha-700',
  ] as const
  for (const key of keys) {
    const color = theme[key]
    assert.notEqual(color, WALLPAPER_INK, `${key} 还留在白色那套`)
    // 同一支墨的 alpha 变体：色相/明度必须就是那支近黑，不能混回主题绿
    assert.deepEqual(rgbOf(color), ink, `${key} 的颜料不是那支近黑`)
  }
})

test('灰阶阶梯也翻成墨 @alpha：c-000 最淡、c-1000 满墨', () => {
  const theme = buildWallpaperTheme(fakeTheme(), 'black')
  // 次级说明文字（c-450）在亮场上是"淡墨"，仍然读得出，但不该和主字一样重
  assert.ok(alphaOf(theme['c-450']) < alphaOf(theme['c-850']))
  assert.ok(alphaOf(theme['c-850']) < alphaOf(theme['c-1000']))
  assert.equal(alphaOf(theme['c-1000']), 1)
  for (const key of ['c-000', 'c-450', 'c-850', 'c-1000'] as const) {
    assert.deepEqual(rgbOf(theme[key]), rgbOf(WALLPAPER_INK_DARK), `${key} 不是墨色的 alpha 变体`)
  }
})

test('面往白走：弹层头部那条、纸面白在亮场里必须还是浅色', () => {
  const theme = buildWallpaperTheme(fakeTheme(), 'black')
  // 这两支在壁纸模式里当"底板"用（Dialog 头部条 / 弹层纸面），黑字压在上面
  assert.equal(theme['c-primary-light-1000'], 'rgb(255, 255, 255)')
  const header = rgbOf(theme['c-primary-light-100-alpha-100'])
  const primary = rgbOf(GREEN)
  // 往白走 = 三个通道都不低于主色（不能像白字那套那样往黑压）
  for (const [index, value] of header.entries()) {
    assert.ok(value >= primary[index], `头部条的第 ${index} 个通道（${value}）比主色（${primary[index]}）还深`)
  }
  assert.ok(alphaOf(theme['c-primary-light-100-alpha-100']) == 0.90)
})

test('深墨不描边：白环去掉（浅色柔光已经够亮），浅墨仍是实黑描边', () => {
  // 需求原话："黑色下边缘有白色描边，把这个效果去掉" —— 深墨那套的阴影必须是无
  for (const ink of ['black', '#141418', '#2F6BFF'] as const) {
    assert.equal(buildWallpaperTheme(fakeTheme(), ink)['c-primary-dark-300-alpha-800'], 'transparent')
  }
  // 浅墨那套仍靠实黑描边兜住照片高光，两边不能一起变
  assert.equal(buildWallpaperTheme(fakeTheme(), 'white')['c-primary-dark-300-alpha-800'], 'rgba(0, 0, 0, 0.65)')
})

test('歌词页跟着墨走：非当前行同一支墨、深墨不再套白环', () => {
  const inks = getWallpaperLyricPalette(WALLPAPER_INK_DARK)
  assert.deepEqual(rgbOf(inks.ink), rgbOf(WALLPAPER_INK_DARK))
  assert.deepEqual(rgbOf(inks.translation), rgbOf(WALLPAPER_INK_DARK))
  // 与白字那套同一条阶梯：正文 0.98 > 译文 0.74，页面那层 0.72 再乘一次
  assert.equal(alphaOf(inks.ink), 0.98)
  assert.equal(alphaOf(inks.translation), 0.74)
  assert.equal(inks.opacity, 0.72)
  // 深墨当前行不描边（"黑色字白描边"那个观感就是这里来的）
  assert.equal(inks.activeShadow.color, 'transparent')
  // 白字那套的描边仍是黑的
  assert.match(getWallpaperLyricPalette(WALLPAPER_INK).activeShadow.color, /^rgba\(0, 0, 0, /)
})

test('近黑墨对最浅的场（纯白照片 + 默认柔光）仍远超正文对比度', () => {
  // 最坏情况反过来：照片全白时，浅色柔光把场推到接近 WALLPAPER_SCRIM_LIGHT 那一档
  const ratio = contrast(rgbOf(WALLPAPER_INK_DARK), rgbOf(WALLPAPER_SCRIM_LIGHT))
  assert.ok(ratio >= 15, `近黑对最亮的场只有 ${ratio.toFixed(2)}:1`)
})

test('默认参数就是白字那套：老调用点（不传第二个参数）逐字节不变', () => {
  assert.deepEqual(buildWallpaperTheme(fakeTheme()), buildWallpaperTheme(fakeTheme(), 'white'))
  // 传黑之后再拼一次白，结果不能被缓存的黑色覆盖
  buildWallpaperTheme(fakeTheme(), 'black')
  const white = buildWallpaperTheme(fakeTheme(), 'white')
  assert.equal(white['c-font'], WALLPAPER_INK)
  assert.equal(white.isDark, true)
})
