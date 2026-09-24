import test from 'node:test'
import assert from 'node:assert/strict'

import { buildAddModalLists } from '../src/components/MusicAddModal/listOptions.ts'

test('adds the favorite list to add-to modal options', () => {
  const userList = {
    id: 'userlist_1',
    name: 'My Playlist',
    locationUpdateTime: null,
  }

  assert.deepEqual(
    buildAddModalLists([userList], '我喜欢'),
    [
      { id: 'love', name: '我喜欢', locationUpdateTime: null },
      userList,
    ],
  )
})

test('does not show the favorite list as a move target when it is the source list', () => {
  const userList = {
    id: 'userlist_1',
    name: 'My Playlist',
    locationUpdateTime: null,
  }

  assert.deepEqual(
    buildAddModalLists([userList], '我喜欢', 'love'),
    [userList],
  )
})

test('excludes the current user list from add-to modal options', () => {
  const userList = {
    id: 'userlist_1',
    name: 'My Playlist',
    locationUpdateTime: null,
  }

  assert.deepEqual(
    buildAddModalLists([userList], '我喜欢', 'userlist_1'),
    [{ id: 'love', name: '我喜欢', locationUpdateTime: null }],
  )
})

test('does not show the favorite list as a move target', () => {
  const sourceList = {
    id: 'userlist_1',
    name: 'Source Playlist',
    locationUpdateTime: null,
  }
  const targetList = {
    id: 'userlist_2',
    name: 'Target Playlist',
    locationUpdateTime: null,
  }

  assert.deepEqual(
    buildAddModalLists([sourceList, targetList], '我喜欢', 'userlist_1', { isMove: true }),
    [targetList],
  )
})
