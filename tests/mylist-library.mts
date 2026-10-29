import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLikedAlbumRows, isLikedAlbumList, isLikedNetworkPlaylist } from '../src/core/mylistLibrary.ts'

const userList = (over: Record<string, any> = {}): any => ({
  id: 'userlist_1',
  name: '列表',
  locationUpdateTime: null,
  ...over,
})

const albumList = userList({ id: 'al1', name: '范特西', isLove: true, source: 'tx', sourceListId: 'album__11' })
const networkPlaylist = userList({ id: 'pl1', name: '网络歌单', isLove: true, source: 'wy', sourceListId: '123' })

test('显式喜欢的专辑只归入专辑', () => {
  assert.equal(isLikedAlbumList(albumList), true)
  assert.equal(isLikedNetworkPlaylist(albumList), false)
})

test('网络歌单只归入歌单', () => {
  assert.equal(isLikedNetworkPlaylist(networkPlaylist), true)
  assert.equal(isLikedAlbumList(networkPlaylist), false)
})

test('榜单收藏按网络歌单归类', () => {
  const board = userList({ isLove: true, source: 'wy', sourceListId: 'board__wy__19723756' })
  assert.equal(isLikedNetworkPlaylist(board), true)
  assert.equal(isLikedAlbumList(board), false)
})

test('自建列表、未喜欢、缺源信息的都不进入两个标签', () => {
  const cases = [
    userList({ sourceListId: 'album__11' }),
    userList({ isLove: true }),
    userList({ isLove: true, source: 'tx' }),
    userList({ isLove: true, sourceListId: 'album__' }),
  ]
  for (const item of cases) {
    assert.equal(isLikedAlbumList(item), false)
    assert.equal(isLikedNetworkPlaylist(item), false)
  }
})

test('专辑行只收显式喜欢的专辑，封面/歌手/曲数来自已存歌曲', () => {
  const rows = buildLikedAlbumRows([
    albumList,
    networkPlaylist,
    userList({ id: 'self', name: '自建' }),
  ], {
    al1: { count: 10, cover: 'https://p/1.jpg', author: '周杰伦' },
  })
  assert.deepEqual(rows, [
    {
      key: 'al1',
      listId: 'al1',
      id: 'album__11',
      name: '范特西',
      author: '周杰伦',
      source: 'tx',
      cover: 'https://p/1.jpg',
      count: 10,
    },
  ])
})

test('专辑元信息缺失时回退为空串与 0', () => {
  assert.deepEqual(buildLikedAlbumRows([albumList], {}), [
    {
      key: 'al1',
      listId: 'al1',
      id: 'album__11',
      name: '范特西',
      author: '',
      source: 'tx',
      cover: '',
      count: 0,
    },
  ])
})
