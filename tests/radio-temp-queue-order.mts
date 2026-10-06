import test from 'node:test'
import assert from 'node:assert/strict'

import { hasUserTrackAfterRadio } from '../src/core/recommend/tempQueueOrder.ts'
import { buildPlaylistQueue } from '../src/screens/PlayDetail/Vertical/Player/components/playlistQueue.ts'

const mkTemp = (id, listId = '') => ({ musicInfo: { id }, listId })

// true = 电台补位曲, false = 用户稍后播放曲
test('user track appended after committed radio filler needs reorder (bug repro)', () => {
  assert.equal(hasUserTrackAfterRadio([true, true, false]), true)
})

test('interleaved order needs reorder', () => {
  assert.equal(hasUserTrackAfterRadio([true, false, true]), true)
})

test('user tracks already before radio filler need no reorder', () => {
  assert.equal(hasUserTrackAfterRadio([false, true, true]), false)
})

test('all radio tracks need no reorder', () => {
  assert.equal(hasUserTrackAfterRadio([true, true]), false)
})

test('all user tracks need no reorder', () => {
  assert.equal(hasUserTrackAfterRadio([false, false]), false)
})

test('empty queue needs no reorder', () => {
  assert.equal(hasUserTrackAfterRadio([]), false)
})

const radioIds = new Set(['r1', 'r2'])
const isRadioTrack = musicInfo => musicInfo != null && radioIds.has(musicInfo.id)
const hideRadioOptions = { hideRadioTracks: true, isRadioTrack }

test('radio mode hides filler tracks but keeps user play-later tracks with real queue indexes', () => {
  const temp = [mkTemp('r1'), mkTemp('s1'), mkTemp('r2'), mkTemp('s2')]
  const items = buildPlaylistQueue([], temp, null, undefined, hideRadioOptions)
  assert.deepEqual(items.map(i => [i.route, i.musicInfo.id, i.index]), [
    ['playLater', 's1', 1],
    ['playLater', 's2', 3],
  ])
})

test('radio mode with only filler tracks yields empty visible list (status line shown instead)', () => {
  const items = buildPlaylistQueue([], [mkTemp('r1'), mkTemp('r2')], null, undefined, hideRadioOptions)
  assert.equal(items.length, 0)
})

test('non-radio mode keeps all temp tracks untouched', () => {
  const temp = [mkTemp('r1'), mkTemp('s1')]
  const items = buildPlaylistQueue([], temp, null)
  assert.deepEqual(items.map(i => i.musicInfo.id), ['r1', 's1'])
})
