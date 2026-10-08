import test from 'node:test'
import assert from 'node:assert/strict'

import { getMorphCoverShadowFadeConfig } from '../src/components/player/PlayerOverlay/transition.ts'

// 阴影只属于全屏页的大封面：静态控制栏封面在安卓上没有 elevation，画不出影子。
// 收起时阴影必须随封面飞行整段淡掉、在 progress=1 归零，否则 overlay 卸载那一帧会看到影子凭空消失
const valueAt = (config: { inputRange: number[], outputRange: number[] }, progress: number) => {
  const { inputRange, outputRange } = config
  if (progress <= inputRange[0]) return outputRange[0]
  if (progress >= inputRange[inputRange.length - 1]) return outputRange[outputRange.length - 1]
  const i = inputRange.findIndex((v, index) => index > 0 && progress <= v)
  const t = (progress - inputRange[i - 1]) / (inputRange[i] - inputRange[i - 1])
  return outputRange[i - 1] + (outputRange[i] - outputRange[i - 1]) * t
}

test('song page keeps the fullscreen shadow, then fades it out across the whole cover travel', () => {
  const config = getMorphCoverShadowFadeConfig(false, 0.6)
  assert.equal(valueAt(config, 0), 1)
  assert.equal(valueAt(config, 0.6), 1)
  assert.ok(valueAt(config, 0.8) > 0, 'shadow still partially present mid-flight')
  assert.ok(Math.abs(valueAt(config, 0.8) - 0.5) < 1e-6, 'shadow is halfway through the fade at the midpoint of the travel')
  assert.ok(valueAt(config, 0.9) < 0.3, 'shadow already mostly gone by the bar')
  assert.equal(valueAt(config, 1), 0)
})

test('lyric summary fades its shadow in to hold the flying card, then out again before the bar', () => {
  const config = getMorphCoverShadowFadeConfig(true, 0.8)
  assert.equal(valueAt(config, 0), 0)
  assert.equal(valueAt(config, 0.64), 1)
  assert.equal(valueAt(config, 0.8), 1)
  assert.equal(valueAt(config, 1), 0)
})

test('both branches end at zero so the last frame matches the static bar', () => {
  for (const isLyricOrigin of [false, true]) {
    for (const travelStart of [0.02, 0.08, 0.5, 0.94, 0.99]) {
      const config = getMorphCoverShadowFadeConfig(isLyricOrigin, travelStart)
      assert.equal(config.outputRange[config.outputRange.length - 1], 0)
      assert.equal(config.extrapolate, 'clamp')
      // Animated 要求 inputRange 严格递增，否则首渲就抛 "must be monotonically non-decreasing"
      config.inputRange.forEach((value, index) => {
        if (index == 0) return
        assert.ok(value > config.inputRange[index - 1], `inputRange not increasing at ${index}: ${config.inputRange}`)
      })
      assert.equal(config.inputRange.length, config.outputRange.length)
    }
  }
})
