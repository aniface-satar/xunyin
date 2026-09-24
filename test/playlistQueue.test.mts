import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildPlaylistQueue,
  getDragTargetSourceIndex,
} from '../src/screens/PlayDetail/Vertical/Player/components/playlistQueue.ts'

const createMusic = (id: string): ReturnType<typeof buildPlaylistQueue>[number]['musicInfo'] => ({
  id,
  name: id,
  singer: '',
  source: 'kw',
  interval: null,
  meta: {
    songId: id,
    albumName: '',
    qualitys: [],
    _qualitys: {},
  },
})

const createTempPlayList = (ids: string[]) => ids.map(id => ({
  listId: 'playlist_1',
  musicInfo: createMusic(id),
  isTempPlay: true,
}))

test('shows play-later songs after the playing song in the queue', () => {
  const playlist = [createMusic('a'), createMusic('b'), createMusic('c')]
  const tempPlaylist = createTempPlayList(['later1', 'later2'])

  assert.deepEqual(
    buildPlaylistQueue(playlist, tempPlaylist, 'b').map(({ route, index }) => ({ route, index })),
    [
      { route: 'playlist', index: 0 },
      { route: 'playlist', index: 1 },
      { route: 'playLater', index: 0 },
      { route: 'playLater', index: 1 },
      { route: 'playlist', index: 2 },
    ],
  )
})

test('keeps playlist indexes valid when the current song is temporary', () => {
  const playlist = [createMusic('a'), createMusic('b')]
  const tempPlaylist = createTempPlayList(['later1'])

  assert.deepEqual(
    buildPlaylistQueue(playlist, tempPlaylist, 'later1').map(({ route, index }) => ({ route, index })),
    [
      { route: 'playLater', index: 0 },
      { route: 'playlist', index: 0 },
      { route: 'playlist', index: 1 },
    ],
  )
})

test('maps drops beside play-later songs to the adjacent playlist index', () => {
  const playlist = [createMusic('a'), createMusic('b'), createMusic('c')]
  const queue = buildPlaylistQueue(playlist, createTempPlayList(['later1']), 'a')

  assert.equal(getDragTargetSourceIndex(queue, 1, 2), 1)
})

test('maps drops before the queue to the first playlist song when playing a temporary song', () => {
  const playlist = [createMusic('a'), createMusic('b')]
  const queue = buildPlaylistQueue(playlist, createTempPlayList(['later1']), 'later1')

  assert.equal(getDragTargetSourceIndex(queue, 0, 1), 0)
})
