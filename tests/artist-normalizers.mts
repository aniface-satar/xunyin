import test from 'node:test'
import assert from 'node:assert/strict'
import {
  hasMoreByLength,
  hasMoreByTotal,
  mergeArtistDetail,
  normalizeKgArtistAlbums,
  normalizeKgArtistDetail,
  normalizeKgArtistSearch,
  normalizeKwArtistAlbums,
  normalizeKwArtistDetail,
  normalizeKwArtistSearch,
  normalizeMgArtistAlbums,
  normalizeMgArtistDetail,
  normalizeMgArtistSearch,
  normalizeTxArtistAlbums,
  normalizeTxArtistDetail,
  normalizeTxArtistSearch,
  normalizeWyArtistAlbums,
  normalizeWyArtistDetail,
  normalizeWyArtistSearch,
} from '../src/utils/musicSdk/artistNormalizers.ts'

test('kg 歌手搜索：data 是数组，短页按已返回数量收口', () => {
  const result = normalizeKgArtistSearch({
    status: 1,
    errcode: 0,
    data: [{ singername: '周杰伦', singerid: 3520 }],
  })

  assert.equal(result.total, 1)
  assert.deepEqual(result.list[0], {
    id: '3520',
    name: '周杰伦',
    alias: '',
    img: '',
    songCount: '',
    albumCount: '',
    source: 'kg',
  })
})

test('kg 歌手搜索只支持一页：total 固定为返回条数，不按 limit 放页', () => {
  const data = Array.from({ length: 18 }, (_, i) => ({ singername: `歌手${i}`, singerid: i + 1 }))
  const result = normalizeKgArtistSearch({ data })

  assert.equal(result.total, 18)
  assert.equal(result.list.length, 18)
})

test('kw 歌手搜索：拼 BASEPICPATH 头像，id 回退 DC_TARGETID', () => {
  const result = normalizeKwArtistSearch({
    TOTAL: '58',
    BASEPICPATH: 'http://img1.kuwo.cn/star/starheads/',
    abslist: [{
      ARTISTID: '336',
      ARTIST: '周杰伦',
      AARTIST: 'Jay Chou',
      PICPATH: '240/s4s56/58/291211030.jpg',
      SONGNUM: '1708',
      ALBUMNUM: '45',
    }, {
      DC_TARGETID: '5528928',
      ARTIST: '地下歌手',
      AARTIST: '',
      PICPATH: '',
      SONGNUM: '1',
      ALBUMNUM: '0',
    }],
  })

  assert.equal(result.total, 58)
  assert.deepEqual(result.list[0], {
    id: '336',
    name: '周杰伦',
    alias: 'Jay Chou',
    img: 'http://img1.kuwo.cn/star/starheads/240/s4s56/58/291211030.jpg',
    songCount: '1708',
    albumCount: '45',
    source: 'kw',
  })
  assert.equal(result.list[1].id, '5528928')
  assert.equal(result.list[1].img, '')
})

test('tx 歌手搜索：singerMID 当 id，头像统一换成 500 尺寸', () => {
  const result = normalizeTxArtistSearch({
    code: 0,
    'music.search.SearchCgiService': {
      code: 0,
      data: {
        meta: { sum: 11 },
        body: {
          singer: {
            list: [{
              singerID: 4558,
              singerMID: '0025NhlN2yWrP4',
              singerName: '周杰伦',
              singerPic: 'http://y.gtimg.cn/music/photo_new/T001R150x150M0000025NhlN2yWrP4_11.jpg',
              songNum: 1012,
              albumNum: 43,
            }],
          },
        },
      },
    },
  })

  assert.equal(result.total, 11)
  assert.deepEqual(result.list[0], {
    id: '0025NhlN2yWrP4',
    name: '周杰伦',
    alias: '',
    img: 'https://y.gtimg.cn/music/photo_new/T001R500x500M0000025NhlN2yWrP4.jpg',
    songCount: '1012',
    albumCount: '43',
    source: 'tx',
  })
})

test('wy 歌手搜索：解析 artists / alias / musicSize', () => {
  const result = normalizeWyArtistSearch({
    code: 200,
    result: {
      artistCount: 83,
      artists: [{
        id: 6452,
        name: '周杰伦',
        picUrl: 'http://p2.music.126.net/NWv6PtSBkyWZzqbJVzBr7g==/109951169164936450.jpg',
        alias: ['Jay Chou', '周董'],
        albumSize: 42,
        musicSize: 582,
      }],
    },
  })

  assert.equal(result.total, 83)
  assert.deepEqual(result.list[0], {
    id: '6452',
    name: '周杰伦',
    alias: 'Jay Chou、周董',
    img: 'http://p2.music.126.net/NWv6PtSBkyWZzqbJVzBr7g==/109951169164936450.jpg',
    songCount: '582',
    albumCount: '42',
    source: 'wy',
  })
})

test('mg 歌手搜索：优先取 imgSizeType=03 的大头像', () => {
  const result = normalizeMgArtistSearch({
    code: '000000',
    singerResultData: {
      totalCount: '4',
      result: [{
        id: '112',
        name: '周杰伦',
        albumCount: 41,
        songCount: 413,
        singerPicUrl: [
          { img: 'https://d.musicapp.migu.cn/small.webp', imgSizeType: '01' },
          { img: 'https://d.musicapp.migu.cn/large.webp', imgSizeType: '03' },
        ],
      }],
    },
  })

  assert.equal(result.total, 4)
  assert.deepEqual(result.list[0], {
    id: '112',
    name: '周杰伦',
    alias: '',
    img: 'https://d.musicapp.migu.cn/large.webp',
    songCount: '413',
    albumCount: '41',
    source: 'mg',
  })
})

test('kg 歌手详情：头像补 480 尺寸，简介取 profile', () => {
  const result = normalizeKgArtistDetail({
    status: 1,
    data: {
      singername: '周杰伦',
      singerid: 3520,
      songcount: 1850,
      albumcount: 49,
      imgurl: 'http://singerimg.kugou.com/uploadpic/softhead/{size}/20260324/x.jpg',
      profile: '周杰伦简介',
      intro: '备用简介',
      alias: '',
    },
  })

  assert.deepEqual(result, {
    name: '周杰伦',
    alias: '',
    img: 'http://singerimg.kugou.com/uploadpic/softhead/480/20260324/x.jpg',
    songCount: '1850',
    albumCount: '49',
    desc: '周杰伦简介',
  })
})

test('kg 歌手详情：没有 profile 时回退 intro', () => {
  const result = normalizeKgArtistDetail({ data: { singername: '某歌手', profile: '', intro: '简介' } })

  assert.equal(result.desc, '简介')
})

test('kw 歌手详情：hts_pic 当头像，aartist 当别名，简介解码实体', () => {
  const result = normalizeKwArtistDetail({
    name: '周杰伦',
    hts_pic: 'https://img2.kuwo.cn/star/starheads/240/x.jpg',
    aartist: 'Jay Chou',
    musicnum: '1708',
    albumnum: '45',
    desc: '周杰伦（Jay Chou）&quot;简介&quot;',
  })

  assert.deepEqual(result, {
    name: '周杰伦',
    alias: 'Jay Chou',
    img: 'https://img2.kuwo.cn/star/starheads/240/x.jpg',
    songCount: '1708',
    albumCount: '45',
    desc: '周杰伦（Jay Chou）"简介"',
  })
})

test('tx 歌手详情：从模块键里取 basic_info 与 ex_info', () => {
  const result = normalizeTxArtistDetail({
    code: 0,
    'music.musichallSinger.SingerInfoInter': {
      code: 0,
      data: {
        singer_list: [{
          basic_info: { name: '周杰伦', singer_mid: '0025NhlN2yWrP4' },
          ex_info: { desc: '周杰伦简介', foreign_name: 'Jay Chou' },
        }],
      },
    },
  })

  assert.deepEqual(result, {
    name: '周杰伦',
    alias: 'Jay Chou',
    img: '',
    songCount: '',
    albumCount: '',
    desc: '周杰伦简介',
  })
})

test('wy 歌手详情：别名为数组，音乐数与专辑数都映射', () => {
  const result = normalizeWyArtistDetail({
    artist: {
      name: '周杰伦',
      alias: ['Jay Chou', '周董'],
      picUrl: 'http://p1.music.126.net/x.jpg',
      briefDesc: '网易简介',
      musicSize: 582,
      albumSize: 45,
    },
  })

  assert.deepEqual(result, {
    name: '周杰伦',
    alias: 'Jay Chou、周董',
    img: 'http://p1.music.126.net/x.jpg',
    songCount: '582',
    albumCount: '45',
    desc: '网易简介',
  })
})

test('mg 歌手详情：只从简介卡片取 desc，其余留空由搜索卡片兜底', () => {
  const result = normalizeMgArtistDetail({
    data: {
      contents: [
        { view: 'ZJ-Title', txt: '歌手' },
        {
          view: 'ZJ-Singer-Intro-Scroll',
          contents: [{ view: 'ZJ-Singer-Intro-Item', txt: '歌手简介', txt2: '　　周杰伦简介' }],
        },
      ],
    },
  })

  assert.deepEqual(result, {
    name: '',
    alias: '',
    img: '',
    songCount: '',
    albumCount: '',
    desc: '周杰伦简介',
  })
})

test('详情与搜索卡片合并：详情优先，空字段不覆盖已有值', () => {
  const base = {
    id: '0025NhlN2yWrP4',
    name: '周杰伦',
    alias: 'Jay Chou',
    img: 'https://y.gtimg.cn/music/photo_new/T001R500x500M0000025NhlN2yWrP4.jpg',
    songCount: '1012',
    albumCount: '43',
    source: 'tx' as const,
  }
  const result = mergeArtistDetail(base, {
    name: '',
    alias: '',
    img: '',
    songCount: '',
    albumCount: '',
    desc: '详情简介',
  })

  assert.deepEqual(result, {
    name: '周杰伦',
    alias: 'Jay Chou',
    img: 'https://y.gtimg.cn/music/photo_new/T001R500x500M0000025NhlN2yWrP4.jpg',
    songCount: '1012',
    albumCount: '43',
    desc: '详情简介',
  })
})

test('kg 歌手专辑：imgurl 补尺寸，分页总数取 data.total', () => {
  const result = normalizeKgArtistAlbums({
    data: {
      total: 49,
      info: [{
        albumid: 179652761,
        albumname: '太阳之子',
        singername: '周杰伦',
        imgurl: 'http://imge.kugou.com/stdmusic/{size}/20260319/x.jpg',
        publishtime: '2026-03-25 00:00:00',
        songcount: 13,
        intro: '专辑简介',
      }],
    },
  })

  assert.equal(result.total, 49)
  assert.deepEqual(result.list[0], {
    id: '179652761',
    name: '太阳之子',
    author: '周杰伦',
    img: 'http://imge.kugou.com/stdmusic/480/20260319/x.jpg',
    time: '2026-03-25 00:00:00',
    desc: '专辑简介',
    total: '13',
    source: 'kg',
  })
})

test('kw 歌手专辑：albumlist 与 total 都是小写', () => {
  const result = normalizeKwArtistAlbums({
    total: 45,
    albumlist: [{
      albumid: '87758985',
      name: '太阳之子',
      artist: '周杰伦',
      img: 'http://img2.sycdn.kuwo.cn/star/albumcover/240/x.jpg',
      pub: '2026-03-25',
      musiccnt: '13',
      info: '专辑简介',
    }],
  })

  assert.equal(result.total, 45)
  assert.deepEqual(result.list[0], {
    id: '87758985',
    name: '太阳之子',
    author: '周杰伦',
    img: 'http://img2.sycdn.kuwo.cn/star/albumcover/240/x.jpg',
    time: '2026-03-25',
    desc: '专辑简介',
    total: '13',
    source: 'kw',
  })
})

test('tx 歌手专辑：从模块键取 albumList，totalNum 为 0 时不显示曲目数', () => {
  const result = normalizeTxArtistAlbums({
    'music.musichallAlbum.AlbumListServer': {
      code: 0,
      data: {
        albumList: [{
          albumMid: '0041WVfh2vtlJE',
          albumName: '太阳之子',
          publishDate: '2026-03-25',
          totalNum: 0,
          singerName: '周杰伦',
        }],
        total: 43,
      },
    },
  })

  assert.equal(result.total, 43)
  assert.deepEqual(result.list[0], {
    id: '0041WVfh2vtlJE',
    name: '太阳之子',
    author: '周杰伦',
    img: 'https://y.gtimg.cn/music/photo_new/T002R500x500M0000041WVfh2vtlJE.jpg',
    time: '2026-03-25',
    desc: '',
    total: '',
    source: 'tx',
  })
})

test('wy 歌手专辑：hotAlbums 取 artists 名字，发布时间转日期', () => {
  const result = normalizeWyArtistAlbums({
    total: 45,
    hotAlbums: [{
      id: 403900711,
      name: '太阳之子',
      picUrl: 'http://p1.music.126.net/x.jpg',
      publishTime: 1609459200000,
      size: 13,
      description: '',
      briefDesc: '',
      artists: [{ name: '周杰伦' }],
    }],
  })

  assert.equal(result.total, 45)
  assert.deepEqual(result.list[0], {
    id: '403900711',
    name: '太阳之子',
    author: '周杰伦',
    img: 'http://p1.music.126.net/x.jpg',
    time: '2021-01-01',
    desc: '',
    total: '13',
    source: 'wy',
  })
})

test('mg 歌手专辑：顶层就是专辑卡片，没有总数', () => {
  const result = normalizeMgArtistAlbums({
    data: {
      header: { nextPageUrl: 'http://app.c.nf.migu.cn/bmw/singer/album/v1.0?singerId=112&pageNo=2' },
      contents: [{
        view: 'ZJ-Album-Item',
        resId: '600927015009001083',
        img: 'https://d.musicapp.migu.cn/data/oss/resource/x',
        txt: '太阳之子',
        txt2: '周杰伦',
        txt3: '2026-03-19',
      }],
    },
  })

  assert.equal(result.total, 0)
  assert.deepEqual(result.list[0], {
    id: '600927015009001083',
    name: '太阳之子',
    author: '周杰伦',
    img: 'https://d.musicapp.migu.cn/data/oss/resource/x',
    time: '2026-03-19',
    desc: '',
    total: '',
    source: 'mg',
  })
})

test('分页判据：有总数看总数，没总数看本页是否满额', () => {
  assert.equal(hasMoreByTotal(49, 30), true)
  assert.equal(hasMoreByTotal(49, 49), false)
  assert.equal(hasMoreByTotal(0, 30), false)
  assert.equal(hasMoreByLength(30, 30), true)
  assert.equal(hasMoreByLength(29, 30), false)
})
