import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getBottomBarHeight,
  getBottomBarInset,
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

// 位移量必须等于"实际渲染出来的那条高度"（内容区 + 系统栏那一条）。
// 内容区高度用 scaleSizeH 换算过（54 的设计值在 2.88 缩放下是 59），位移量若按未换算的 54 算，
// 收起时条形会留下 5dp、展开时卡片下缘与条形上沿错开 5dp。
test('位移量取换算后的实际高度，而不是设计值', () => {
  const contentHeight = 59
  const barHeight = getBottomBarHeight({ baseHeight: contentHeight, bottomInset: 48 })
  assert.equal(barHeight, 107)
  assert.equal(getBottomBarRiseRange({ barHeight }).outputRange[0], 107)
})

// 转场期间 inset 晚到（Android 15 冷启动实测：先 0，约 300ms 后才报到 48dp）不能让条形改高度：
// 展开动画正在逐帧位移，条形一变高，被 flex 顶着的播放栏一起位移，就是用户看到的"跳一下"。
test('转场期间沿用冻结值，落定后才采信实时值', () => {
  assert.equal(getBottomBarInset({ liveInset: 48, frozenInset: 0, settled: false }), 0)
  assert.equal(getBottomBarInset({ liveInset: 48, frozenInset: 0, settled: true }), 48)
  assert.equal(getBottomBarInset({ liveInset: 0, frozenInset: 48, settled: false }), 48)
  // 异常值按 0 处理，不能把条形压成负高度
  assert.equal(getBottomBarInset({ liveInset: Number.NaN, frozenInset: 48, settled: true }), 0)
  assert.equal(getBottomBarInset({ liveInset: 48, frozenInset: -1, settled: false }), 0)
})
