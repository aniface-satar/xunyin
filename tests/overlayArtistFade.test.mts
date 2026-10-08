import test from 'node:test'
import assert from 'node:assert/strict'

import { getMorphArtistFadeConfig } from '../src/components/player/PlayerOverlay/transition.ts'

const valueAt = (config: { inputRange: number[], outputRange: number[] }, progress: number) => {
  const { inputRange, outputRange } = config
  if (progress <= inputRange[0]) return outputRange[0]
  if (progress >= inputRange[inputRange.length - 1]) return outputRange[outputRange.length - 1]
  const i = inputRange.findIndex((v, index) => index > 0 && progress <= v)
  const t = (progress - inputRange[i - 1]) / (inputRange[i] - inputRange[i - 1])
  return outputRange[i - 1] + (outputRange[i] - outputRange[i - 1]) * t
}

// 真机全屏页实测：歌名盒行高 26、歌手盒在其下方 4px 起（即相距 30），
// 两者沿同一行程收敛到同一行，剩余间距小于歌名行高就是它们重合的开始
const TITLE_START = { y: 500, height: 26 }
const ARTIST_START = { y: 530, height: 20 }

test('singer stays opaque through the hold phase and is fully gone at the bar', () => {
  const config = getMorphArtistFadeConfig([0, 0.06, 0.5, 1], TITLE_START, ARTIST_START)
  assert.equal(valueAt(config, 0), 1)
  assert.equal(valueAt(config, 0.5), 1, 'still opaque when the text leaves the fullscreen position')
  assert.ok(valueAt(config, 0.8) < 0.5, 'mostly faded by the time the two rows would overlap')
  assert.equal(valueAt(config, 1), 0)
})

test('fade starts when the two text boxes first overlap', () => {
  const config = getMorphArtistFadeConfig([0, 0.06, 0.5, 1], TITLE_START, ARTIST_START)
  // 剩余间距 = 30 * (1 - u) 首次小于歌名行高 26 的行程度 u = 1 - 26/30
  const overlapPoint = 0.5 + 0.5 * (1 - 26 / 30)
  assert.ok(Math.abs(config.inputRange[2] - overlapPoint) < 1e-9, `fade starts at ${config.inputRange[2]}, expected ${overlapPoint}`)
  assert.ok(valueAt(config, overlapPoint + 0.01) < 1, 'opacity starts dropping the moment the rows touch')
})

test('a late travel start and a stacked lyric summary both keep inputRange increasing', () => {
  for (const thresholds of [[0, 0.02, 0.08, 1], [0, 0.08, 0.94, 1], [0, 0.02, 0.94, 1]]) {
    for (const artist of [ARTIST_START, { y: 526, height: 20 }, { y: 500, height: 20 }]) {
      const config = getMorphArtistFadeConfig(thresholds, TITLE_START, artist)
      assert.equal(config.outputRange[config.outputRange.length - 1], 0)
      assert.equal(config.extrapolate, 'clamp')
      assert.equal(config.inputRange.length, config.outputRange.length)
      // Animated 要求 inputRange 严格递增，否则首渲就抛 "must be monotonically non-decreasing"
      config.inputRange.forEach((value, index) => {
        if (index == 0) return
        assert.ok(value > config.inputRange[index - 1], `inputRange not increasing at ${index}: ${config.inputRange}`)
      })
      assert.equal(valueAt(config, 0), 1, 'expanding back to fullscreen fades the singer in')
    }
  }
})
