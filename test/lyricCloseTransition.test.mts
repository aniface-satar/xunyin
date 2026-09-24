import test from 'node:test'
import assert from 'node:assert/strict'

import * as transition from '../src/components/player/PlayerOverlay/transition.ts'
import {
  getCardMorphTransformRange,
  getLyricBridgeFadeConfig,
  getGhostFadeConfig,
  getLyricCurrentPreviewLayout,
  getLyricPagerVisibility,
  shouldRenderLyricCurrentPreview,
} from '../src/components/player/PlayerOverlay/transition.ts'

test('places the lyric close preview in a single-line area below the summary', () => {
  assert.deepEqual(getLyricCurrentPreviewLayout({
    coverBottom: 132,
    windowWidth: 390,
  }), {
    left: 20,
    top: 148,
    width: 350,
    height: 20,
  })
})

test('keeps the lyric pager mounted during open, close, and drag transitions', () => {
  assert.equal(getLyricPagerVisibility({
    isLyricOrigin: true,
    isTransitioning: true,
    gestureEnabled: false,
  }), true)
  assert.equal(getLyricPagerVisibility({
    isLyricOrigin: true,
    isTransitioning: false,
    gestureEnabled: true,
  }), true)
  assert.equal(getLyricPagerVisibility({
    isLyricOrigin: true,
    isTransitioning: false,
    gestureEnabled: false,
  }), false)
  assert.equal(getLyricPagerVisibility({
    isLyricOrigin: false,
    isTransitioning: true,
    gestureEnabled: true,
  }), false)
})

test('uses transform scaling instead of card layout for close morphing', () => {
  const range = getCardMorphTransformRange({
    bar: { x: 24, y: 680, width: 200, height: 36 },
    windowHeight: 844,
    windowWidth: 390,
  })

  assert.deepEqual(range.from, {
    translateX: 0,
    translateY: 0,
    scaleX: 1,
    scaleY: 1,
  })
  assert.deepEqual(range.to, {
    translateX: -71,
    translateY: 276,
    scaleX: 200 / 390,
    scaleY: 36 / 844,
  })
})

test('crossfades the lyric bridge out when the static page is fully visible', () => {
  assert.deepEqual(getLyricBridgeFadeConfig(), {
    inputRange: [0, 0.04, 1],
    outputRange: [0, 1, 1],
  })
})

test('does not render an extra current lyric preview on the lyric page', () => {
  assert.equal(shouldRenderLyricCurrentPreview(true), false)
  assert.equal(shouldRenderLyricCurrentPreview(false), true)
})

test('uses the song page timing for non-moving ghost elements on both pages', () => {
  assert.deepEqual(getGhostFadeConfig(), {
    inputRange: [0, 0.04, 0.9, 0.96],
    outputRange: [1, 0, 0, 0],
  })
})

test('fades the real lyric page with the same fullscreen timing as ghosts', () => {
  assert.equal(typeof transition.getLyricPagerFadeConfig, 'function')
  assert.deepEqual(transition.getLyricPagerFadeConfig(), getGhostFadeConfig())
})

test('activates close drag after a short threshold and maps relative movement', () => {
  assert.equal(transition.getCloseGestureActivationThreshold(), 4)
  assert.equal(transition.getCloseGestureDistance(46, 4), 42)
  assert.equal(transition.getCloseGestureDistance(3, 0), 3)
})
