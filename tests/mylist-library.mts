import test from 'node:test'
import assert from 'node:assert/strict'
import { groupLikedAlbums, groupLikedArtists } from '../src/core/mylistLibrary.ts'

const song = (over: Record<string, any> = {}): any => ({
  id: '1',
  name: '歌',
  singer: '周杰伦',
  source: 'tx',
  interval: '03:00',
  meta: {
    songId: '1',
    albumName: '范特西',
    picUrl: 'https://p/1.jpg',
    albumId: '11',
    qualitys: [],
    _qualitys: {},
  },
  ...over,
})

const metaWith = (over: Record<string, any> = {}): any => ({
  songId: '1',
  albumName: '范特西',
  qualitys: [],
  _qualitys: {},
  ...over,
})

test('喜欢的歌曲按 source + albumId 聚合专辑', () => {
  const groups = groupLikedAlbums([
    song({ id: '1' }),
    song({ id: '2', meta: metaWith({ albumId: '11', picUrl: 'https://p/2.jpg' }) }),
    song({ id: '3', singer: '费玉清', meta: metaWith({ albumId: '12', albumName: '千里之外' }) }),
  ])
  assert.deepEqual(groups, [
    {
      key: 'tx__11',
      id: 'album__11',
      name: '范特西',
      author: '周杰伦',
      source: 'tx',
      cover: 'https://p/1.jpg',
      count: 2,
    },
    {
      key: 'tx__12',
      id: 'album__12',
      name: '千里之外',
      author: '费玉清',
      source: 'tx',
      cover: '',
      count: 1,
    },
  ])
})

test('专辑聚合跳过本地歌曲、缺 albumId 与 0', () => {
  assert.deepEqual(groupLikedAlbums([
    song({ source: 'local', meta: { songId: 'x', albumName: '专辑', filePath: 'x', ext: 'mp3' } }),
    song({ meta: metaWith({ albumId: undefined }) }),
    song({ meta: metaWith({ albumId: '0' }) }),
    song({ meta: metaWith({ albumId: 0 }) }),
  ]), [])
})

test('不同源的同一个 albumId 不合并', () => {
  const groups = groupLikedAlbums([
    song({ id: '1', source: 'tx', meta: metaWith({ albumId: '11' }) }),
    song({ id: '2', source: 'wy', meta: metaWith({ albumId: '11', albumName: '范特西 (网易)' }) }),
  ])
  assert.equal(groups.length, 2)
  assert.deepEqual(groups.map(group => group.key).sort(), ['tx__11', 'wy__11'])
})

test('专辑按歌曲数降序，数量相同按 key 排序', () => {
  const groups = groupLikedAlbums([
    song({ id: '1', source: 'wy', meta: metaWith({ albumId: '22' }) }),
    song({ id: '2', source: 'tx', meta: metaWith({ albumId: '11' }) }),
    song({ id: '3', source: 'tx', meta: metaWith({ albumId: '11' }) }),
  ])
  assert.deepEqual(groups.map(group => group.key), ['tx__11', 'wy__22'])
})

test('喜欢的歌曲按歌手拆分聚合，同一首歌内去重', () => {
  const groups = groupLikedArtists([
    song({ id: '1', singer: '周杰伦、费玉清' }),
    song({ id: '2', singer: '周杰伦' }),
    song({ id: '3', source: 'wy', singer: '费玉清 / 张惠妹' }),
    song({ id: '4', singer: '周杰伦、周杰伦' }),
  ])
  assert.deepEqual(groups, [
    { key: '周杰伦', name: '周杰伦', count: 3, sources: ['tx'] },
    { key: '费玉清', name: '费玉清', count: 2, sources: ['tx', 'wy'] },
    { key: '张惠妹', name: '张惠妹', count: 1, sources: ['wy'] },
  ])
})

test('歌手聚合跳过本地歌曲与空名', () => {
  assert.deepEqual(groupLikedArtists([
    song({ source: 'local', meta: { songId: 'x', albumName: '专辑', filePath: 'x', ext: 'mp3' } }),
    song({ singer: '  ' }),
  ]), [])
})

test('歌手数量相同时按名字码点排序，源按出现次数降序', () => {
  const groups = groupLikedArtists([
    song({ id: '1', source: 'wy', singer: '费玉清' }),
    song({ id: '2', source: 'tx', singer: '周杰伦' }),
    song({ id: '3', source: 'wy', singer: '周杰伦' }),
    song({ id: '4', source: 'tx', singer: '费玉清' }),
    song({ id: '5', source: 'wy', singer: '费玉清' }),
    song({ id: '6', source: 'wy', singer: '周杰伦' }),
  ])
  assert.deepEqual(groups.map(group => group.name), ['周杰伦', '费玉清'])
  assert.deepEqual(groups[0].sources, ['wy', 'tx'])
  assert.deepEqual(groups[1].sources, ['wy', 'tx'])
})
