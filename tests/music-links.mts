import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  splitArtistNames,
  getArtistSearchName,
  getMusicAlbumListInfo,
  normalizeArtistName,
  pickExactArtistMatch,
} from '../src/core/musicLinks.ts'

const src = (rel: string) => readFileSync(path.join(import.meta.dirname, '..', rel), 'utf8')

const onlineSong = (over: Record<string, any> = {}): any => ({
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

test('歌手名按常见分隔符拆分', () => {
  assert.deepEqual(splitArtistNames('周杰伦、费玉清'), ['周杰伦', '费玉清'])
  assert.deepEqual(splitArtistNames('费玉清 / 张惠妹'), ['费玉清', '张惠妹'])
  assert.deepEqual(splitArtistNames('A|B；C;D／E'), ['A', 'B', 'C', 'D', 'E'])
  assert.deepEqual(splitArtistNames('周杰伦&言承旭'), ['周杰伦', '言承旭'])
  assert.deepEqual(splitArtistNames('周杰伦、 费玉清'), ['周杰伦', '费玉清'])
})

test('不拆 AC/DC 与 Simon & Garfunkel', () => {
  assert.deepEqual(splitArtistNames('AC/DC'), ['AC/DC'])
  assert.deepEqual(splitArtistNames('Simon & Garfunkel'), ['Simon & Garfunkel'])
})

test('空歌手名返回空数组，搜索名取第一位', () => {
  assert.deepEqual(splitArtistNames(''), [])
  assert.deepEqual(splitArtistNames(' 、; '), [])
  assert.equal(getArtistSearchName('周杰伦、费玉清'), '周杰伦')
  assert.equal(getArtistSearchName('AC/DC'), 'AC/DC')
  assert.equal(getArtistSearchName('  '), null)
})

test('在线歌曲生成专辑详情路由信息', () => {
  assert.deepEqual(getMusicAlbumListInfo(onlineSong()), {
    id: 'album__11',
    name: '范特西',
    author: '周杰伦',
    img: 'https://p/1.jpg',
    source: 'tx',
  })
  assert.deepEqual(getMusicAlbumListInfo(onlineSong({
    meta: {
      songId: '1',
      albumName: '范特西',
      picUrl: null,
      albumId: 12,
      qualitys: [],
      _qualitys: {},
    },
  })), {
    id: 'album__12',
    name: '范特西',
    author: '周杰伦',
    img: '',
    source: 'tx',
  })
})

test('本地歌曲、缺 albumId 或 albumId 为 0 时不生成专辑入口', () => {
  assert.equal(getMusicAlbumListInfo(onlineSong({
    source: 'local',
    meta: { songId: 'x', albumName: '专辑', filePath: 'x', ext: 'mp3' },
  })), null)
  for (const albumId of [undefined, null, '', 0, '0']) {
    assert.equal(getMusicAlbumListInfo(onlineSong({
      meta: {
        songId: '1',
        albumName: '范特西',
        albumId,
        qualitys: [],
        _qualitys: {},
      },
    })), null)
  }
})

test('歌手名匹配归一化后比对，大小写不敏感且只认精确匹配', () => {
  assert.equal(normalizeArtistName('  周杰伦   Jay  '), '周杰伦 jay')
  const list: Array<{ id: string, name: string }> = [
    { id: '1', name: '周杰伦 Jay' },
    { id: '2', name: '周杰伦' },
  ]
  assert.equal(pickExactArtistMatch(list, ' 周杰伦 ')?.id, '2')
  assert.equal(pickExactArtistMatch([{ id: '3', name: 'AC/DC' }], 'ac/dc')?.id, '3')
  assert.equal(pickExactArtistMatch(list, '费玉清'), null)
  assert.equal(pickExactArtistMatch([], '周杰伦'), null)
})

test('播控页 more sheet 的歌手/专辑行接上跳转', () => {
  const sheet = src('src/screens/PlayDetail/Vertical/Player/components/MusicMoreSheet.tsx')
  assert.match(sheet, /useOpenMusicDetail/)
  assert.match(sheet, /onOpenArtist/)
  assert.match(sheet, /getMusicAlbumListInfo/)
  assert.match(sheet, /chevron-right/)
  assert.match(sheet, /hide\(/)
})

test('主页面歌手名可点击进歌手详情', () => {
  const musicInfo = src('src/screens/PlayDetail/Vertical/Player/components/MusicInfo.tsx')
  assert.match(musicInfo, /useArtistPicker/)
  assert.match(musicInfo, /ArtistPickerSheet/)
})

test('歌词页摘要的歌手名同样可点击进歌手详情', () => {
  const summary = src('src/screens/PlayDetail/Vertical/components/MusicSummary.tsx')
  assert.match(summary, /useArtistPicker/)
  assert.match(summary, /ArtistPickerSheet/)
  assert.match(summary, /<TouchableOpacity[\s\S]{0,200}onPress=\{handleOpenArtist\}/)
})

test('统一跳转 hook 先收全屏页再压详情栈', () => {
  const hook = src('src/utils/hooks/useOpenMusicDetail.ts')
  assert.match(hook, /usePlayerOverlay/)
  assert.match(hook, /overlay\.close\(\)/)
  assert.match(hook, /componentIds\.playDetail/)
  assert.match(hook, /homeDetailActions\.push/)
})

test('歌手解析走歌曲源搜索并缓存成功结果', () => {
  const resolve = src('src/core/artistResolve.ts')
  assert.match(resolve, /artist\?\.search/)
  assert.match(resolve, /pickExactArtistMatch/)
  assert.match(resolve, /new Map/)
  assert.match(resolve, /cache\.delete/)
})

test('我喜欢下的标签页增加专辑和歌手', () => {
  const detail = src('src/screens/MylistDetail/index.tsx')
  assert.match(detail, /\['music', 'album', 'playlist', 'artist'\]/)
  assert.match(detail, /mylist_album_tab/)
  assert.match(detail, /mylist_artist_tab/)

  const albumTab = src('src/screens/MylistDetail/AlbumTab.tsx')
  assert.match(albumTab, /useMyList/)
  assert.match(albumTab, /buildLikedAlbumRows/)
  assert.match(albumTab, /useOpenMusicDetail/)
  assert.match(albumTab, /mylist_no_album/)
  // 页面常驻后，滑回标签不能重复请求封面/数量
  assert.match(albumTab, /loadedIdsRef\.current\.has/)

  const artistTab = src('src/screens/MylistDetail/ArtistTab.tsx')
  assert.match(artistTab, /mylist_no_artist/)
  assert.doesNotMatch(artistTab, /groupLikedArtists/)

  const playlistList = src('src/screens/MylistDetail/PlaylistList/index.tsx')
  assert.match(playlistList, /isLikedNetworkPlaylist/)

  const library = src('src/core/mylistLibrary.ts')
  assert.match(library, /isLikedAlbumList/)
  assert.doesNotMatch(library, /groupLikedAlbums|groupLikedArtists/)
})

test('三语文案包含新标签与空态', () => {
  const keys = [
    'mylist_album_tab',
    'mylist_artist_tab',
    'mylist_no_album',
    'mylist_no_artist',
    'mylist_search_albums',
    'mylist_search_artists',
    'artist_not_found',
  ]
  for (const lang of ['zh-cn', 'zh-tw', 'en-us']) {
    const messages = JSON.parse(src(`src/lang/${lang}.json`))
    for (const key of keys) {
      assert.equal(typeof messages[key], 'string', `${lang} 缺少 ${key}`)
      assert.ok(messages[key].length > 0, `${lang} 的 ${key} 不能为空`)
    }
  }
})
