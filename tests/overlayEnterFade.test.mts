import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ENTER_FADE_FIELD_END,
  ENTER_FADE_INK_START,
  ENTER_FADE_INK_END,
  getEnterFieldRange,
  getEnterInkRange,
  getEnterInkOpacityRanges,
  getEnterBackdropOpacityRange,
} from '../src/components/player/PlayerOverlay/transition.ts'

const BAR = '#ffffff' // progress=1：播放栏那一面的主题色
const COVER = '#1b2340' // progress=0：全屏那一面的封面色

const isMonotonic = (values: number[]) => values.every((v, i) => i == 0 || v > values[i - 1])

test('四条淡入表都落在 progress 有效域内且单调', () => {
  const ink = getEnterInkOpacityRanges(true)
  for (const config of [
    getEnterFieldRange(BAR, COVER),
    getEnterInkRange(BAR, COVER),
    ink.expanded,
    ink.collapsed,
    getEnterBackdropOpacityRange(),
    getEnterBackdropOpacityRange(true),
  ]) {
    assert.equal(config.inputRange[0], 0)
    assert.equal(config.inputRange.at(-1), 1)
    assert.equal(isMonotonic(config.inputRange), true, JSON.stringify(config.inputRange))
    assert.equal(config.outputRange.length, config.inputRange.length)
  }
})

test('progress=1 交主题色，progress=0 交封面色', () => {
  for (const range of [getEnterFieldRange(BAR, COVER), getEnterInkRange(BAR, COVER)]) {
    assert.equal(range.outputRange[0], COVER)
    assert.equal(range.outputRange.at(-1), BAR)
  }
})

test('底色先走、墨色后翻，交叉只占行程的一小段', () => {
  // 两者必须互换（白底深字 → 深底白字），交叉点消不掉，只能把墨色那条压窄，
  // 让"糊在一起"只发生在行程里很小的一截，而不是整段。
  assert.equal(ENTER_FADE_INK_START >= ENTER_FADE_FIELD_END, true)
  assert.equal(ENTER_FADE_INK_END > ENTER_FADE_INK_START, true)
  assert.equal(ENTER_FADE_INK_END <= 1, true)
  assert.equal(ENTER_FADE_INK_END - ENTER_FADE_INK_START <= 0.25, true)
})

test('底色到位之后直到全屏都是终态，收尾不再拖着一层灰', () => {
  const range = getEnterFieldRange(BAR, COVER)
  const firstAfter = range.inputRange.findIndex(v => v > ENTER_FADE_FIELD_END)
  assert.equal(range.outputRange.slice(0, firstAfter).every(c => c == COVER), true)
})

test('图标两份副本逐档互补：任何一帧只有一份在画', () => {
  const { expanded, collapsed } = getEnterInkOpacityRanges(true)
  assert.deepEqual(expanded.inputRange, collapsed.inputRange)
  expanded.outputRange.forEach((value, i) => {
    assert.equal(value + collapsed.outputRange[i], 1)
  })
})

test('动态背景没生效时不交叉淡，只留主题那一份（等于改之前的行为）', () => {
  const { expanded, collapsed } = getEnterInkOpacityRanges(false)
  assert.equal(expanded.outputRange.every(v => v == 0), true)
  assert.equal(collapsed.outputRange.every(v => v == 1), true)
})

test('背景层的 progress 闸门：收起到播放栏时整层为 0，别把封面色留在栏上', () => {
  for (const fullLength of [false, true]) {
    const range = getEnterBackdropOpacityRange(fullLength)
    assert.equal(range.outputRange[0], 1)
    assert.equal(range.outputRange.at(-1), 0)
  }
})

test('铺底层闸门两支形状：② 铺满整段行程，① 仍是窄窗', () => {
  // ②「封面模糊」那一档整层就是主背景，要跟着展开/收起那一下淡到底：
  // 两端之间没有"已经满上"的平台段 —— 0.45 就定格在 1 的那种窄窗在 ease 过的补间上
  // 只用掉行程前 ~15% 的时间，观感是"一开整层就在那里"，不是淡入淡出。
  const full = getEnterBackdropOpacityRange(true)
  assert.deepEqual(full.inputRange, [0, 1])
  assert.deepEqual(full.outputRange, [1, 0])
  assert.equal(full.outputRange.filter(v => v == 1).length, 1)
  // ① 一字不动：0.45 那一格已经满上，之后才往 0 走（它的洗色只是蒙版底下的一层纹路）。
  const narrow = getEnterBackdropOpacityRange()
  assert.deepEqual(narrow.inputRange, [0, ENTER_FADE_FIELD_END, 1])
  assert.deepEqual(narrow.outputRange, [1, 1, 0])
})
