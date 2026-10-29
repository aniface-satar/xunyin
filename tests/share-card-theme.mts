import test from 'node:test'
import assert from 'node:assert/strict'

import { DARK_CARD_THEME, LIGHT_CARD_THEME, pickCardTheme } from '../src/components/ShareCard/cardTheme.ts'

// 卡色经历三版判据（细节见 cardTheme.ts 顶部注释）：封面取色 → 跟随应用深浅模式 → 用户自己选。
// 现在是第三版（2026-10-29 用户指定）：预览页底部「白底 / 黑底」，默认白底，**不随应用深浅色变化**。
// 这几条钉的是"两套色本身"与"选择器只认 tone"这两件事。

test('the dark tone gives the black card', () => {
  assert.equal(pickCardTheme('dark'), DARK_CARD_THEME)
  assert.equal(DARK_CARD_THEME.cardBackground, '#000000')
  assert.equal(DARK_CARD_THEME.titleColor, '#FFFFFF')
})

test('the light tone gives the white card', () => {
  assert.equal(pickCardTheme('light'), LIGHT_CARD_THEME)
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

test('both tones keep the same scrim on the blurred backdrop', () => {
  // scrim 只铺在糊底上、与卡色无关：换 tone 不该让糊底忽明忽暗。
  assert.equal(DARK_CARD_THEME.scrimColor, LIGHT_CARD_THEME.scrimColor)
})

test('music card and lyric card share one selector (no separate lyric theme)', () => {
  // 旧的 LYRIC_CARD_THEME（固定深卡）已删：两张卡同一张选票，同一个 tone 出同一套色。
  assert.equal(pickCardTheme('dark'), DARK_CARD_THEME)
  assert.equal(pickCardTheme('light'), LIGHT_CARD_THEME)
})
