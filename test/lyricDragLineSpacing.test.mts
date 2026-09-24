import test from 'node:test'
import assert from 'node:assert/strict'

import { getLyricDragLineSpacing, getLyricFallbackDragLineSpacing } from '../src/components/player/PlayerOverlay/transition.ts'

test('uses the space between the drag-to-play line and the cover summary', () => {
  assert.equal(getLyricDragLineSpacing({
    pageHeight: 700,
    summaryTop: 24,
    summaryHeight: 52,
  }), 204)
})

test('does not create a negative lyric spacing on short pages', () => {
  assert.equal(getLyricDragLineSpacing({
    pageHeight: 100,
    summaryTop: 24,
    summaryHeight: 52,
  }), 0)
})

test('derives first-frame spacing from the static summary layout', () => {
  assert.equal(getLyricFallbackDragLineSpacing({
    pageHeight: 700,
    coverGap: 24,
    coverSize: 52,
    buttonWidth: 36,
  }), 204)
})
