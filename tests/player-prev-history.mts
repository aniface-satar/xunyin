import test from 'node:test'
import assert from 'node:assert/strict'

import { resolvePrevAnchor } from '../src/core/player/prevHistory.ts'

const mkPlay = (id, isTempPlay) => ({ musicInfo: { id }, isTempPlay })
const mkPlayed = (id, isTempPlay = false, listId = 'list1') => ({ musicInfo: { id }, isTempPlay, listId })

test('radio temp track recorded in history anchors prev to itself', () => {
  const playedList = [mkPlayed('a', true), mkPlayed('b', true)]
  const result = resolvePrevAnchor(mkPlay('b', true), playedList, 'old_song')
  assert.equal(result.currentId, 'b')
  assert.equal(result.tempInHistory, true)
})

test('plain later-play temp track without history keeps old semantics (anchor to underlying list music)', () => {
  const playedList = [mkPlayed('a', true)]
  const result = resolvePrevAnchor(mkPlay('x', true), playedList, 'old_song')
  assert.equal(result.currentId, 'old_song')
  assert.equal(result.tempInHistory, false)
})

test('plain later-play temp track with empty history anchors to underlying list music', () => {
  const result = resolvePrevAnchor(mkPlay('x', true), [], 'old_song')
  assert.equal(result.currentId, 'old_song')
  assert.equal(result.tempInHistory, false)
})

test('non-temp track anchors to its own id and never re-queues', () => {
  const playedList = [mkPlayed('a'), mkPlayed('b')]
  const result = resolvePrevAnchor(mkPlay('b', false), playedList, 'b')
  assert.equal(result.currentId, 'b')
  assert.equal(result.tempInHistory, false)
})

test('history entry for same id recorded as non-temp does not count as temp history', () => {
  const playedList = [mkPlayed('a', false)]
  const result = resolvePrevAnchor(mkPlay('a', true), playedList, 'old_song')
  assert.equal(result.currentId, 'old_song')
  assert.equal(result.tempInHistory, false)
})

test('no underlying list (radio started from empty state): temp track still anchors to itself', () => {
  const playedList = [mkPlayed('a', true), mkPlayed('b', true)]
  const result = resolvePrevAnchor(mkPlay('b', true), playedList, null)
  assert.equal(result.currentId, 'b')
  assert.equal(result.tempInHistory, true)
})
