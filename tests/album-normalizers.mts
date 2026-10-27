import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createAlbumListId,
  getAlbumRawId,
  isAlbumListId,
  normalizeKgAlbumSearch,
  normalizeKwAlbumSearch,
  normalizeMgAlbumSearch,
  normalizeTxAlbumSearch,
  normalizeTxAlbumSongs,
  normalizeWyAlbumSearch,
  normalizeWyAlbumSongs,
} from '../src/utils/musicSdk/albumNormalizers.ts'

test('专辑结果使用 album__ 前缀与原始 id 互转', () => {
  assert.equal(createAlbumListId(18905), 'album__18905')
  assert.equal(createAlbumListId('000MkMni19ClKG'), 'album__000MkMni19ClKG')
  assert.equal(isAlbumListId('album__18905'), true)
  assert.equal(isAlbumListId('album__'), false)
  assert.equal(isAlbumListId('18905'), false)
  assert.equal(getAlbumRawId('album__18905'), '18905')
  assert.equal(getAlbumRawId('18905'), '18905')
})

test('kg 专辑搜索：取 data.info / data.total 并补全封面尺寸', () => {
  const result = normalizeKgAlbumSearch({
    status: 1,
    data: {
      total: 104,
      info: [{
        albumid: 12345,
        albumname: '叶惠美',
        singername: '周杰伦',
        imgurl: 'http://imge.kugou.com/msoft/{size}/album.jpg',
        publishtime: '2003-07-31',
        songcount: 11,
        intro: '第四张专辑',
      }],
    },
  })

  assert.equal(result.total, 104)
  assert.deepEqual(result.list[0], {
    id: 'album__12345',
    name: '叶惠美',
    author: '周杰伦',
    img: 'http://imge.kugou.com/msoft/480/album.jpg',
    time: '2003-07-31',
    desc: '第四张专辑',
    total: '11',
    source: 'kg',
  })
})

test('kw 专辑搜索：解析 albumlist / TOTAL，封面回退 hts_img', () => {
  const result = normalizeKwAlbumSearch({
    TOTAL: '79',
    albumlist: [{
      DC_TARGETID: '54321',
      name: '范特西',
      artist: '周杰伦',
      img: '',
      hts_img: 'http://img4.kuwo.cn/star/albumcover/{size}/x.jpg',
      musiccnt: 10,
      pub: '2001-09-14',
      info: '第二张专辑',
    }],
  })

  assert.equal(result.total, 79)
  assert.deepEqual(result.list[0], {
    id: 'album__54321',
    name: '范特西',
    author: '周杰伦',
    img: 'http://img4.kuwo.cn/star/albumcover/480/x.jpg',
    time: '2001-09-14',
    desc: '第二张专辑',
    total: '10',
    source: 'kw',
  })
})

test('tx 专辑搜索：从 SearchCgiService.data 取列表，总数优先 meta.sum', () => {
  const result = normalizeTxAlbumSearch({
    code: 0,
    'music.search.SearchCgiService': {
      code: 0,
      data: {
        body: {
          album: {
            list: [{
              albumMID: '000MkMni19ClKG',
              albumName: '叶惠美',
              singerName: '周杰伦',
              albumPic: 'https://y.gtimg.cn/music/photo_new/T002R300x300M000000MkMni19ClKG.jpg',
              publicTime: '2003-07-31',
              song_count: 11,
            }],
          },
        },
        meta: { sum: 47, estimate_sum: 48 },
      },
    },
  })

  assert.equal(result.total, 47)
  assert.deepEqual(result.list[0], {
    id: 'album__000MkMni19ClKG',
    name: '叶惠美',
    author: '周杰伦',
    img: 'https://y.gtimg.cn/music/photo_new/T002R500x500M000000MkMni19ClKG.jpg',
    time: '2003-07-31',
    desc: '',
    total: '11',
    source: 'tx',
  })
})

test('wy 专辑搜索：解析 artists / publishTime / albumCount', () => {
  const result = normalizeWyAlbumSearch({
    code: 200,
    result: {
      albumCount: 3,
      albums: [{
        id: 18905,
        name: '叶惠美',
        picUrl: 'http://p1.music.126.net/abc.jpg',
        artists: [{ id: 6452, name: '周杰伦' }],
        publishTime: Date.UTC(2003, 6, 31, 4),
        size: 11,
        description: '第四张专辑',
      }],
    },
  })

  assert.equal(result.total, 3)
  assert.deepEqual(result.list[0], {
    id: 'album__18905',
    name: '叶惠美',
    author: '周杰伦',
    img: 'http://p1.music.126.net/abc.jpg',
    time: '2003-07-31',
    desc: '第四张专辑',
    total: '11',
    source: 'wy',
  })
})

test('mg 专辑搜索：解析 albumResultData.result / totalCount', () => {
  const result = normalizeMgAlbumSearch({
    code: '000000',
    albumResultData: {
      totalCount: '12',
      result: [{
        id: '1130000001',
        name: '叶惠美',
        singer: '周杰伦',
        imgItems: [{ img: 'http://d.musicapp.migu.cn/album.jpg' }],
        publishDate: '2003-07-31',
        desc: '第四张专辑',
      }],
    },
  })

  assert.equal(result.total, 12)
  assert.deepEqual(result.list[0], {
    id: 'album__1130000001',
    name: '叶惠美',
    author: '周杰伦',
    img: 'http://d.musicapp.migu.cn/album.jpg',
    time: '2003-07-31',
    desc: '第四张专辑',
    total: '',
    source: 'mg',
  })
})

test('tx 专辑详情歌曲：把 songInfo 映射成可用于播放的旧版结构', () => {
  const list = normalizeTxAlbumSongs([{
    id: 123456,
    mid: '003w1X2Y3Z',
    title: '以父之名',
    singer: [{ id: 4558, mid: '0025NhlN2yWrP4', name: '周杰伦' }],
    album: { id: 8220, mid: '000MkMni19ClKG', name: '叶惠美' },
    file: {
      media_mid: '002ExFMX2Jt6gv',
      size_128mp3: 5473371,
      size_320mp3: 13682683,
      size_flac: 33950377,
      size_hires: 0,
    },
    interval: 342,
    language: 0,
  }])

  const song = list[0]
  assert.equal(song.singer, '周杰伦')
  assert.equal(song.name, '以父之名')
  assert.equal(song.albumName, '叶惠美')
  assert.equal(song.albumId, '000MkMni19ClKG')
  assert.equal(song.songId, 123456)
  assert.equal(song.songmid, '003w1X2Y3Z')
  assert.equal(song.strMediaMid, '002ExFMX2Jt6gv')
  assert.equal(song.interval, '05:42')
  assert.equal(song.lang, 0)
  assert.equal(song.img, 'https://y.gtimg.cn/music/photo_new/T002R500x500M000000MkMni19ClKG.jpg')
  assert.deepEqual(song.types.map((item: { type: string }) => item.type), ['128k', '320k', 'flac'])
  assert.equal(song._types['128k'].size, '5.22 MiB')
  assert.equal(song._types['320k'].size, '13.05 MiB')
  assert.equal(song._types.flac.size, '32.38 MiB')
})

test('wy 专辑详情歌曲：从顶层 songs 生成音质档与封面', () => {
  const list = normalizeWyAlbumSongs([{
    id: 18875,
    name: '以父之名',
    dt: 342000,
    ar: [{ id: 6452, name: '周杰伦' }],
    al: { id: 18905, name: '叶惠美', picUrl: 'http://p1.music.126.net/abc.jpg' },
    h: { size: 13682683 },
    l: { size: 5473371 },
    sq: { size: 33950377 },
    hr: null,
  }, {
    id: 18876,
    name: '晴天',
    dt: 269000,
    ar: [{ id: 6452, name: '周杰伦' }],
    al: { id: 18905, name: '叶惠美', picUrl: 'http://p1.music.126.net/abc.jpg' },
    h: { size: 13682683 },
    l: { size: 5473371 },
    sq: { size: 33950377 },
    hr: { size: 85000000 },
  }])

  const song = list[0]
  assert.equal(song.singer, '周杰伦')
  assert.equal(song.name, '以父之名')
  assert.equal(song.albumName, '叶惠美')
  assert.equal(song.albumId, 18905)
  assert.equal(song.songmid, 18875)
  assert.equal(song.interval, '05:42')
  assert.equal(song.img, 'http://p1.music.126.net/abc.jpg')
  assert.deepEqual(song.types.map((item: { type: string }) => item.type), ['128k', '320k', 'flac'])
  assert.deepEqual(list[1].types.map((item: { type: string }) => item.type), ['128k', '320k', 'flac', 'flac24bit'])
  assert.equal(list[1]._types.flac24bit.size, '81.06 MiB')
})
