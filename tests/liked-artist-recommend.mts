import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildPlaylistKeywords,
  buildRadioProfile,
  buildSimilarArtistSeeds,
  pickSimilarAlbum,
  selectArtistHitTargets,
} from '../src/core/recommend/profile.ts'
import { buildTrackKey, exactPairKey } from '../src/core/recommend/trackKey.ts'
import type { LikedArtistSeed } from '../src/core/recommend/types.ts'

const mkMusic = (id: string, name: string, singer: string, albumName = `${name}-album`, albumId = `album-${id}`): LX.Music.MusicInfo => ({
  id,
  name,
  singer,
  source: 'kw',
  interval: '03:00',
  meta: { songId: id, albumName, albumId, qualitys: [], _qualitys: {} },
})

const liked = (name: string, source = 'tx', id = `artist-${name}`): LikedArtistSeed => ({ name, source, id })

test('收藏歌手只记录在画像里，不注入 topArtists（避免加重同歌手召回）', () => {
  const profile = buildRadioProfile({
    loveTracks: [],
    playlists: [],
    trackPrefs: {},
    likedArtists: [liked('周杰伦')],
    now: 1000,
  })

  assert.deepEqual(profile.likedArtists, [liked('周杰伦')])
  assert.equal(profile.topArtists.length, 0)
})

test('相似歌手种子：收藏歌手排在前面，与画像歌手按名字去重，屏蔽歌手剔除', () => {
  const profile = buildRadioProfile({
    loveTracks: [
      mkMusic('1', '晴天', '周杰伦'),
      mkMusic('2', '江南', '林俊杰'),
      mkMusic('3', '曹操', '林俊杰'),
      mkMusic('4', '小幸运', '田馥甄'),
    ],
    playlists: [],
    trackPrefs: {},
    likedArtists: [liked('陈奕迅'), liked('林俊杰'), liked('Taylor Swift')],
    now: 1000,
  })

  const seeds = buildSimilarArtistSeeds(profile, new Set(['林俊杰']))

  assert.equal(seeds[0], '陈奕迅')
  assert.equal(seeds[1], 'Taylor Swift')
  assert.ok(!seeds.includes('林俊杰'))
  assert.equal(new Set(seeds).size, seeds.length)
})

test('歌手直采目标跳过收藏歌手，只从画像强歌手里轮换', () => {
  const profile = buildRadioProfile({
    loveTracks: [
      mkMusic('1', '晴天', '周杰伦'),
      mkMusic('2', '江南', '林俊杰'),
      mkMusic('3', '小幸运', '田馥甄'),
    ],
    playlists: [],
    trackPrefs: {},
    likedArtists: [liked('周杰伦')],
    now: 1000,
  })

  const targets = selectArtistHitTargets(profile, 0, new Set(), 3)

  assert.ok(targets.length > 0)
  assert.ok(targets.every(item => item.artist != '周杰伦'))
})

test('歌单搜索关键词不含收藏歌手名（避免搜回同歌手歌单）', () => {
  const profile = buildRadioProfile({
    loveTracks: [
      mkMusic('1', '晴天', '周杰伦'),
      mkMusic('2', '江南', '林俊杰'),
    ],
    playlists: [],
    trackPrefs: {},
    likedArtists: [liked('周杰伦')],
    now: 1000,
  })

  const keywords = buildPlaylistKeywords(profile, 8, [], ['周杰伦'])

  assert.ok(!keywords.includes('周杰伦'))
  assert.ok(keywords.includes('林俊杰'))
})

test('相似专辑：跳过整张都已入库的专辑，选还有未入库曲目的那张', () => {
  const imported = mkMusic('1', '已入库的歌', '陈奕迅', '已听过专辑', 'album-old')
  const unheard = mkMusic('2', '没听过的歌', '陈奕迅', '没听过专辑', 'album-new')
  const alsoUnheard = mkMusic('3', '也没听过', '陈奕迅', '没听过专辑', 'album-new')
  const groups = [{
    seedArtist: '周杰伦',
    artistName: '陈奕迅',
    tracks: [imported, unheard, alsoUnheard],
  }]
  const libraryKeys = new Set([buildTrackKey(imported)])

  const pick = pickSimilarAlbum(groups, libraryKeys)

  assert.equal(pick?.albumId, 'album-new')
  assert.equal(pick?.albumName, '没听过专辑')
  assert.equal(pick?.artistName, '陈奕迅')
})

test('相似专辑：同曲同歌手在别的音源已入库，也算整张听过', () => {
  const track = mkMusic('9', '十年', '陈奕迅', '黑·白·灰', 'album-kg')
  const groups = [{ seedArtist: '周杰伦', artistName: '陈奕迅', tracks: [track] }]
  // 库里是 kw 源的同一首，trackKey 不同，只能靠"歌名+歌手"判重
  const libraryKeys = new Set([exactPairKey(track.name, track.singer)])

  assert.equal(pickSimilarAlbum(groups, libraryKeys), null)
})

test('相似专辑：全部已入库或缺少专辑 ID 时不返回', () => {
  const imported = mkMusic('1', '已入库的歌', '陈奕迅', '已听过专辑', 'album-old')
  const noAlbumId = { ...mkMusic('2', '无专辑', '陈奕迅', '无专辑', ''), meta: { songId: '2', albumName: '无专辑', albumId: '' } }

  assert.equal(pickSimilarAlbum([{ seedArtist: '周杰伦', artistName: '陈奕迅', tracks: [imported] }], new Set([buildTrackKey(imported)])), null)
  assert.equal(pickSimilarAlbum([{ seedArtist: '周杰伦', artistName: '陈奕迅', tracks: [noAlbumId] }], new Set()), null)
})
