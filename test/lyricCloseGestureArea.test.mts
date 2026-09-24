import test from 'node:test'
import assert from 'node:assert/strict'

import { getLyricCloseGestureArea } from '../src/components/player/PlayerOverlay/transition.ts'

test('allows downward close gestures from the top through the lyric summary cover', () => {
  assert.deepEqual(getLyricCloseGestureArea({
    coverBottom: 132,
    windowWidth: 390,
  }), {
    top: 0,
    bottom: 132,
    left: 0,
    right: 390,
  })
})
