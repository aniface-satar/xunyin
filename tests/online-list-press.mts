import test from 'node:test'
import assert from 'node:assert/strict'
import { getListPressAction } from '../src/components/OnlineList/pressAction.ts'

test('pressing a song uses the source list when a source play callback exists', () => {
  let calledIndex = -1
  const action = getListPressAction('song', 2, index => {
    calledIndex = index
  })

  assert.equal(action.kind, 'sourceList')
  assert.equal(action.index, 2)
  action.onPlayList(action.index)
  assert.equal(calledIndex, 2)
})

test('pressing a song falls back to the current music item without a source callback', () => {
  const action = getListPressAction('song', 2, undefined)

  assert.equal(action.kind, 'music')
  assert.equal(action.musicInfo, 'song')
})
