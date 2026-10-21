import test from 'node:test'
import assert from 'node:assert/strict'

import { DARK_CARD_THEME, LIGHT_CARD_THEME, pickCardTheme } from '../src/components/ShareCard/cardTheme.ts'

// 卡色不再看封面脸色（旧 isLightCover/pickMusicCardTheme 已删），跟着应用深浅模式走 ——
// 这几条钉的是 2026-10-17 用户定的那套：黑卡/白卡 + 封面细边界线。

test('dark mode gives the black card', () => {
  assert.equal(pickCardTheme(true), DARK_CARD_THEME)
  assert.equal(DARK_CARD_THEME.cardBackground, '#000000')
  assert.equal(DARK_CARD_THEME.titleColor, '#FFFFFF')
})

test('light mode gives the white card', () => {
  assert.equal(pickCardTheme(false), LIGHT_CARD_THEME)
  assert.equal(LIGHT_CARD_THEME.cardBackground, '#FFFFFF')
  assert.equal(LIGHT_CARD_THEME.titleColor, '#1C1C1E')
})

test('both cards are opaque solids (no translucency left over from the old dark card)', () => {
  for (const theme of [DARK_CARD_THEME, LIGHT_CARD_THEME]) {
    assert.ok(theme.cardBackground.startsWith('#'), theme.cardBackground)
    assert.equal(theme.cardBackground.length, '#RRGGBB'.length)
  }
})

test('cover boundary follows the card polarity (white line on black, black line on white)', () => {
  assert.equal(DARK_CARD_THEME.coverBorderColor, '#FFFFFF')
  assert.equal(LIGHT_CARD_THEME.coverBorderColor, '#000000')
})

test('music card and lyric card share one selector (no separate lyric theme)', () => {
  // 旧的 LYRIC_CARD_THEME（固定深卡）已删：两张卡同一张选票，跟着应用主题走。
  assert.equal(pickCardTheme(true), DARK_CARD_THEME)
  assert.equal(pickCardTheme(false), LIGHT_CARD_THEME)
})
