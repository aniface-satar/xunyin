import test from 'node:test'
import assert from 'node:assert/strict'

import { buildWallpaperTheme, WALLPAPER_INK } from '../src/utils/wallpaper/palette.ts'

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
  'c-content-background': 'rgb(255,255,255)',
  'c-font': 'rgb(66,66,66)',
  'is-wallpaper': false,
})

test('图没铺到播控页：强调色还是主题那支', () => {
  const theme = buildWallpaperTheme(fakeTheme())
  assert.equal(theme['is-wallpaper'], true)
  assert.equal(theme['c-primary'], GREEN)
  assert.equal(theme['c-primary-alpha-900'], 'rgba(77, 175, 124, 0.10)')
})

test('图铺到播控页：强调色换成字色那支白', () => {
  const theme = buildWallpaperTheme(fakeTheme(), true)
  assert.equal(theme['c-primary'], WALLPAPER_INK)
  // 悬停 / 按下那两支 dark 族跟着一起走：照片上一支绿配一支白绿比全白更难认
  assert.equal(theme['c-primary-dark-100'], 'rgb(255, 255, 255)')
  assert.equal(theme['c-primary-dark-100-alpha-200'], 'rgba(255, 255, 255, 0.80)')
})

test('alpha 命名是反的：alpha-100 最实、alpha-900 最透', () => {
  const theme = buildWallpaperTheme(fakeTheme(), true)
  assert.equal(theme['c-primary-alpha-100'], 'rgba(255, 255, 255, 0.90)')
  assert.equal(theme['c-primary-alpha-900'], 'rgba(255, 255, 255, 0.10)')
})

test('light 族留在暗面：它一动，弹窗头部的深底就变成白底白字', () => {
  const plain = buildWallpaperTheme(fakeTheme())
  const ink = buildWallpaperTheme(fakeTheme(), true)
  for (const key of ['c-primary-light-100', 'c-primary-light-100-alpha-100', 'c-primary-light-1000'] as const) {
    assert.equal(ink[key], plain[key], `${key} 不该跟着抽白`)
  }
})

test('文字阴影那条是实黑，不能被白强调色替掉', () => {
  for (const inkAccent of [false, true]) {
    assert.equal(buildWallpaperTheme(fakeTheme(), inkAccent)['c-primary-dark-300-alpha-800'], 'rgba(0, 0, 0, 0.65)')
  }
})
