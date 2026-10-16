import test from 'node:test'
import assert from 'node:assert/strict'

import { DARK_CARD_THEME, LIGHT_CARD_TONE, LIGHT_CARD_THEME, LYRIC_CARD_THEME, isLightCover, pickMusicCardTheme } from '../src/components/ShareCard/cardTheme.ts'

const argb = (r: number, g: number, b: number) => ((255 << 24) | (r << 16) | (g << 8) | b) >>> 0

test('a white cover reads light', () => {
  assert.equal(isLightCover(argb(255, 255, 255)), true)
})

test('a black cover reads dark', () => {
  assert.equal(isLightCover(argb(0, 0, 0)), false)
})

test('tone 50 is the boundary and it is exclusive', () => {
  assert.equal(LIGHT_CARD_TONE, 50)
  // 逐灰阶找翻转点：tone 严格大于 50 才算亮。
  // 注意 HCT 的 tone 就是 CIE L*，不是 sRGB 通道值 —— 实测 L*=50 对应灰阶 119（118 判暗、119 判亮）。
  let lastDark = 0
  let firstLight = 0
  for (let v = 0; v <= 255; v++) {
    if (isLightCover(argb(v, v, v))) { if (!firstLight) firstLight = v } else { lastDark = v }
  }
  assert.equal(lastDark, 118)
  assert.equal(firstLight, 119)
})

test('missing or broken argb falls back to dark', () => {
  assert.equal(isLightCover(null), false)
  assert.equal(isLightCover(undefined), false)
  assert.equal(isLightCover(Number.NaN), false)
  assert.equal(isLightCover('0' as unknown as number), false)
})

test('music card theme follows the cover', () => {
  assert.equal(pickMusicCardTheme(argb(250, 245, 240)), LIGHT_CARD_THEME)
  assert.equal(pickMusicCardTheme(argb(20, 20, 24)), DARK_CARD_THEME)
  assert.equal(pickMusicCardTheme(null), DARK_CARD_THEME)
})

test('lyric card never follows the cover', () => {
  assert.equal(LYRIC_CARD_THEME.cardBackground, 'rgba(28,28,30,0.72)')
})

test('light card is opaque and dark card is translucent', () => {
  assert.equal(LIGHT_CARD_THEME.cardBackground, '#FFFFFF')
  assert.equal(DARK_CARD_THEME.cardBackground, 'rgba(28,28,30,0.72)')
  assert.equal(LIGHT_CARD_THEME.titleColor, '#1C1C1E')
  assert.equal(DARK_CARD_THEME.titleColor, '#FFFFFF')
})
