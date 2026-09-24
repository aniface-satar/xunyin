import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getLastOverlayPage,
  setLastOverlayPage,
} from '../src/components/player/PlayerOverlay/transition.ts'

test('keeps the last overlay page in runtime state', () => {
  setLastOverlayPage(1)
  assert.equal(getLastOverlayPage(), 1)
})

test('restores the song page after it was last open', () => {
  setLastOverlayPage(0)
  assert.equal(getLastOverlayPage(), 0)
})

test('rejects invalid overlay pages', () => {
  setLastOverlayPage(0)
  setLastOverlayPage(5)
  assert.equal(getLastOverlayPage(), 0)
})
