import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getBottomBarHeight,
  getBottomBarRiseRange,
} from '../src/components/player/PlayerOverlay/transition.ts'

// Android 15 起 targetSdk >= 35 强制边到边：系统导航栏（三键约 48dp）半透明压在内容上。
// 底部导航栏必须自己让出这条高度，否则图标/文字会被虚拟键挡住。
const TAB_BAR_HEIGHT = 54

test('三键导航时底部导航栏总高 = 自身高度 + 系统导航栏高度', () => {
  assert.equal(getBottomBarHeight({ baseHeight: TAB_BAR_HEIGHT, bottomInset: 48 }), 102)
})

test('手势导航（无占用）时高度不变', () => {
  assert.equal(getBottomBarHeight({ baseHeight: TAB_BAR_HEIGHT, bottomInset: 0 }), TAB_BAR_HEIGHT)
})

test('内边距异常（负值 / NaN）按 0 处理，不会把导航栏压成负数', () => {
  assert.equal(getBottomBarHeight({ baseHeight: TAB_BAR_HEIGHT, bottomInset: -12 }), TAB_BAR_HEIGHT)
  assert.equal(getBottomBarHeight({ baseHeight: TAB_BAR_HEIGHT, bottomInset: Number.NaN }), TAB_BAR_HEIGHT)
  assert.equal(getBottomBarHeight({ baseHeight: TAB_BAR_HEIGHT, bottomInset: Number.POSITIVE_INFINITY }), TAB_BAR_HEIGHT)
})

test('收起状态（progress = 0）整条导航栏要完全移出屏幕下缘', () => {
  const barHeight = getBottomBarHeight({ baseHeight: TAB_BAR_HEIGHT, bottomInset: 48 })
  const { inputRange, outputRange } = getBottomBarRiseRange({ barHeight })
  // p = 0 是"整屏"那一面：位移量必须 >= 自身高度，条形下沿才不会在屏幕里露出半截
  assert.ok(outputRange[0] >= barHeight)
  // p = 1 回到原位
  assert.equal(outputRange[outputRange.length - 1], 0)
  assert.deepEqual(inputRange, [0, 0.4, 1])
})
