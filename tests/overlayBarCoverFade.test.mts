import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BAR_COVER_FULL_PROGRESS,
  BAR_COVER_VISIBLE_PROGRESS,
  getBarCoverFadeConfig,
} from '../src/components/player/PlayerOverlay/transition.ts'

// 播放栏封面与 morph 层封面是两份独立的 Image：转场一开始 morph 那份就从同一位置起飞，
// 而播放栏整栏的淡出排在 progress ∈ [0.9, 1]，比封面的位移窗口 [textMoveThreshold, 1] 慢得多。
// 于是"飞走的封面"和"还留在原地的静态封面"同时可见 —— 自定义背景下卡片是透明的膜，遮不住下面那份，
// 结果就是两个封面。这条闸门只给封面，且必须整段落在整栏淡出窗口之内。
const valueAt = (config: { inputRange: number[], outputRange: number[] }, progress: number) => {
  const { inputRange, outputRange } = config
  if (progress <= inputRange[0]) return outputRange[0]
  if (progress >= inputRange[inputRange.length - 1]) return outputRange[outputRange.length - 1]
  const i = inputRange.findIndex((v, index) => index > 0 && progress <= v)
  const t = (progress - inputRange[i - 1]) / (inputRange[i] - inputRange[i - 1])
  return outputRange[i - 1] + (outputRange[i] - outputRange[i - 1]) * t
}

test('bar cover is gone as soon as the transition leaves the bar', () => {
  const config = getBarCoverFadeConfig()
  // p=1 是两端重合的那一帧：静态封面必须还在，否则收起动画最后一步会少一份封面
  assert.equal(valueAt(config, 1), 1)
  // 一离开 1（展开动画第一帧 progress 就已经到 ~0.91）就必须让位
  assert.equal(valueAt(config, 0.95), 0, 'first frames of the open animation must not draw the static cover')
  assert.equal(valueAt(config, BAR_COVER_VISIBLE_PROGRESS), 0)
  assert.equal(valueAt(config, 0.9), 0)
  assert.equal(valueAt(config, 0.5), 0)
  assert.equal(valueAt(config, 0), 0)
})

test('the cover gate sits inside the whole-bar fade window, so it never fights it', () => {
  // 整栏闸门是 [0.9, 1]（PlayerBar/index.tsx 的 barVisibility）：
  // 封面的闸门必须比它更窄，否则会在整栏已经消失之后还单独留下一个封面
  assert.ok(BAR_COVER_VISIBLE_PROGRESS > 0.9, `cover gate ${BAR_COVER_VISIBLE_PROGRESS} must be inside the bar fade window`)
  // 与 PlayerBar 的 progressVisible 同一条线：p > 0.99 才算"栏自己才是当前可见层"
  assert.equal(BAR_COVER_VISIBLE_PROGRESS, 0.99)

  const config = getBarCoverFadeConfig()
  assert.equal(config.extrapolate, 'clamp')
  assert.equal(config.inputRange.length, config.outputRange.length)
  // Animated 要求 inputRange 严格递增
  assert.ok(config.inputRange[1] > config.inputRange[0], `inputRange not increasing: ${config.inputRange}`)
  // 单调：progress 越大越不透明，方向不会反
  let last = -1
  for (const progress of [0, 0.5, 0.9, 0.98, 0.99, 0.995, 0.997, 0.998, 0.999, 1]) {
    const value = valueAt(config, progress)
    assert.ok(value >= last, `not monotonic at ${progress}`)
    last = value
  }
})

test('a spring that settles just short of 1 still leaves the cover fully opaque', () => {
  // Animated.spring 的 restDisplacementThreshold 是 0.002：收起方向可能停在 0.998x 而不是精确的 1。
  // 满值点必须落在这之前，否则封面会永久停在九成不透明（比整栏淡出窗口窄 20 倍，肉眼看得出来）
  assert.ok(BAR_COVER_FULL_PROGRESS < 1, 'the full-value point must close before 1')
  assert.ok(BAR_COVER_FULL_PROGRESS >= 1 - 0.002, 'and must not close so early that the last frames pop')
  const config = getBarCoverFadeConfig()
  for (const progress of [0.998, 0.9985, 0.999, 1]) {
    assert.equal(valueAt(config, progress), 1, `cover must be fully opaque at ${progress}`)
  }
})
