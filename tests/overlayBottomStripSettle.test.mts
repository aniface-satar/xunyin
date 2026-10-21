import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BOTTOM_STRIP_SETTLE_SPAN,
  getBottomBarRiseRange,
  getCardBottomClampRange,
  getCardMorphTransformRange,
} from '../src/components/player/PlayerOverlay/transition.ts'

// 行程底部那一条（卡片下缘 + 播放栏下面的导航栏）共用同一条窗口：
//   p ≤ SPAN：整屏那一面 —— 卡片下缘停在屏幕下缘（静止的全屏页要盖满），导航栏整条在屏幕外；
//   p = 1：播放栏那一面 —— 卡片下缘收到播放栏下沿（= 导航栏上沿），导航栏升回原位。
// 真机来回修过两轮：
//   ① 窗口开在 [0, 0.75]：收起拖到尽头导航栏才升上来，看起来"跳"一下；
//   ② 挪到 [0, 0.3] 之后展开又反了：进度离开 1 之后导航栏一动不动，等展开到 70% 才开始下移
//      （"导航栏并没有跟着先动"）。
// 现在是 [SPAN, 1]：展开第一帧就跟着走、展开量 60%（progress 到 1 - 0.6 = SPAN）时整条收出屏幕；
// 收起对称，在行程后 60% 里收/升回播放栏下沿。
const valueAt = (config: { inputRange: number[], outputRange: number[] }, progress: number) => {
  const { inputRange, outputRange } = config
  if (progress <= inputRange[0]) return outputRange[0]
  if (progress >= inputRange[inputRange.length - 1]) return outputRange[outputRange.length - 1]
  const i = inputRange.findIndex((v, index) => index > 0 && progress <= v)
  const t = (progress - inputRange[i - 1]) / (inputRange[i] - inputRange[i - 1])
  return outputRange[i - 1] + (outputRange[i] - outputRange[i - 1]) * t
}

const screen = 800
// 真机实测：播放栏上沿 685.7、下沿 753（= 导航栏上沿），整屏 800，导航栏自己 54dp
const bar = { top: 685.7, height: 67.3 }
const barBottom = bar.top + bar.height
const tabBarHeight = 54
// 卡片框（铺底那一层）的上下沿：变换以整屏 layout 盒的中心为原点，只能从 transform 反推
const frameRectAt = (progress: number) => {
  const range = getCardMorphTransformRange({
    bar: { x: 0, y: bar.top, width: 360, height: bar.height },
    windowHeight: screen,
    windowWidth: 360,
  })
  const translateY = valueAt({ inputRange: [0, BOTTOM_STRIP_SETTLE_SPAN, 1], outputRange: [range.from.translateY, range.mid.translateY, range.to.translateY] }, progress)
  const scaleY = valueAt({ inputRange: [0, BOTTOM_STRIP_SETTLE_SPAN, 1], outputRange: [range.from.scaleY, range.mid.scaleY, range.to.scaleY] }, progress)
  return {
    top: screen / 2 + translateY - (screen / 2) * scaleY,
    bottom: screen / 2 + translateY + (screen / 2) * scaleY,
  }
}

test('the settled fullscreen card still covers the whole screen', () => {
  const config = getCardBottomClampRange({ winHeight: screen, barBottom })
  assert.equal(valueAt(config, 0), screen)
  assert.equal(config.outputRange[0], screen)
})

test('the fullscreen side holds the card at the screen bottom from 60% expansion on', () => {
  const config = getCardBottomClampRange({ winHeight: screen, barBottom })
  for (const progress of [0, 0.05, 0.1, 0.2, 0.3, BOTTOM_STRIP_SETTLE_SPAN]) {
    assert.equal(valueAt(config, progress), screen, `card bottom moved at ${progress}`)
  }
  assert.equal(valueAt(config, 1), barBottom)
})

test('the nav bar is already moving on the first frame of the expand', () => {
  const rise = getBottomBarRiseRange({ barHeight: tabBarHeight })
  assert.equal(valueAt(rise, 1), 0, 'at the bar end the nav bar is at rest')
  assert.ok(valueAt(rise, 1 - 0.01) > 0, 'the nav bar has not moved one percent into the expand')
  assert.ok(valueAt(rise, 0.9) > valueAt(rise, 0.99), 'the nav bar should keep sinking as the card expands')
})

test('the nav bar is completely off screen by 60% expansion', () => {
  const rise = getBottomBarRiseRange({ barHeight: tabBarHeight })
  // 展开量 60% <=> progress = 1 - 0.6 = BOTTOM_STRIP_SETTLE_SPAN
  const sixty = 1 - 0.6
  assert.equal(valueAt(rise, sixty), tabBarHeight, 'the nav bar has not finished its travel at 60% expansion')
  assert.ok(barBottom + valueAt(rise, sixty) >= screen, 'the nav bar top is still on screen at 60% expansion')
  // 不是第一帧就整条消失：半程展开时上沿还在屏幕里
  assert.ok(barBottom + valueAt(rise, 1 - 0.5) < screen)
  for (const progress of [0, 0.1, 0.3, BOTTOM_STRIP_SETTLE_SPAN]) {
    assert.equal(valueAt(rise, progress), tabBarHeight, `nav bar moved again at ${progress}`)
  }
})

test('the card bottom edge travels on the same window as the nav bar', () => {
  const clamp = getCardBottomClampRange({ winHeight: screen, barBottom })
  for (const progress of [0, 0.2, BOTTOM_STRIP_SETTLE_SPAN, 0.55, 0.7, 0.9, 1]) {
    const frame = frameRectAt(progress)
    assert.ok(Math.abs(frame.bottom - valueAt(clamp, progress)) < 1e-9, `card frame bottom ${frame.bottom} left the clamp at ${progress}`)
    assert.ok(Math.abs(frame.top - bar.top * progress) < 1e-9, `card frame top ${frame.top} left the bar-top line at ${progress}`)
  }
  const settled = frameRectAt(BOTTOM_STRIP_SETTLE_SPAN)
  assert.ok(Math.abs(settled.bottom - screen) < 1e-9, 'the card reaches the screen bottom at 60% expansion')
  const fullscreen = frameRectAt(0)
  assert.equal(fullscreen.top, 0)
  assert.equal(fullscreen.bottom, screen)
  const barEnd = frameRectAt(1)
  assert.ok(Math.abs(barEnd.top - bar.top) < 1e-9)
  assert.ok(Math.abs(barEnd.bottom - barBottom) < 1e-9)
})

test('the lift off the screen bottom is spread over the settle span, not a one frame jump', () => {
  const config = getCardBottomClampRange({ winHeight: screen, barBottom })
  const half = valueAt(config, (BOTTOM_STRIP_SETTLE_SPAN + 1) / 2)
  assert.ok(half < screen, 'already lifted at the midpoint of the span')
  assert.ok(half > barBottom, 'not pinned yet at the midpoint of the span')
  assert.ok(valueAt(config, 0.96) > valueAt(config, 0.98), 'monotonic inside the span')
  assert.ok(BOTTOM_STRIP_SETTLE_SPAN > 0 && BOTTOM_STRIP_SETTLE_SPAN < 0.6)
})

test('a missing bar measurement degrades to the old behaviour instead of clamping at a wrong line', () => {
  for (const invalid of [NaN, 0, screen, screen + 40]) {
    const config = getCardBottomClampRange({ winHeight: screen, barBottom: invalid })
    for (const progress of [0, 0.2, 0.5, 1]) {
      assert.equal(valueAt(config, progress), screen, `barBottom ${String(invalid)} should not clip`)
    }
  }
})

test('the nav bar top never rises above the card bottom, or the card would bite its top edge', () => {
  const clamp = getCardBottomClampRange({ winHeight: screen, barBottom })
  const rise = getBottomBarRiseRange({ barHeight: tabBarHeight })
  const sliver = tabBarHeight - (screen - barBottom)
  // 导航栏上沿 = 播放栏下沿 + 它自己的位移；卡片下沿 = 裁剪高度。上沿必须始终不低于卡片下沿
  for (let progress = 0; progress <= 1.0001; progress += 0.02) {
    const navTop = barBottom + valueAt(rise, progress)
    const cardBottom = valueAt(clamp, progress)
    assert.ok(navTop >= cardBottom - 1e-9, `nav bar top ${navTop} is above the card bottom ${cardBottom} at ${progress.toFixed(2)}`)
    // 两条曲线速率不同（导航栏要走的比卡片下缘多 sliver），中间只许漏出这条缝
    assert.ok(navTop - cardBottom <= sliver + 1e-9, `the gap ${navTop - cardBottom} under the card is wider than ${sliver}dp at ${progress.toFixed(2)}`)
  }
  // 两者速率相同时，谁先收完取决于这两个量；这条恒等式成立的前提写在 transition.ts 的注释里
  assert.ok(tabBarHeight >= screen - barBottom)
})

test('span is folded into a strictly increasing inputRange for Animated', () => {
  for (const span of [0, -1, 0.0001, NaN, 2, undefined]) {
    const config = getCardBottomClampRange({ winHeight: screen, barBottom, span })
    assert.equal(config.inputRange.length, config.outputRange.length)
    config.inputRange.forEach((value, index) => {
      if (index == 0) return
      assert.ok(value > config.inputRange[index - 1], `inputRange not increasing for span ${String(span)}: ${config.inputRange}`)
    })
    assert.equal(config.inputRange[0], 0)
    assert.equal(config.inputRange[config.inputRange.length - 1], 1)
    assert.equal(config.outputRange[0], screen)
    assert.equal(config.outputRange[config.outputRange.length - 1], barBottom)

    const rise = getBottomBarRiseRange({ barHeight: tabBarHeight, span })
    rise.inputRange.forEach((value, index) => {
      if (index == 0) return
      assert.ok(value > rise.inputRange[index - 1], `nav bar rise inputRange not increasing for span ${String(span)}`)
    })
    assert.equal(rise.outputRange[0], tabBarHeight)
    assert.equal(rise.outputRange[rise.outputRange.length - 1], 0)
  }
})

test('a broken bar height keeps the nav bar in place instead of shifting it off by a wrong amount', () => {
  for (const invalid of [NaN, 0, -10]) {
    const rise = getBottomBarRiseRange({ barHeight: invalid })
    for (const progress of [0, 0.3, 1]) assert.equal(valueAt(rise, progress), 0)
  }
})
