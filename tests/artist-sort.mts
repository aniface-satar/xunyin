import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  ARTIST_SONG_SORT_PARAMS,
  normalizeKwArtistSongItem,
} from '../src/utils/musicSdk/artistNormalizers.ts'

const src = (rel: string) => readFileSync(path.join(import.meta.dirname, '..', rel), 'utf8')

test('四源各用自己的热门/最新参数，咪咕不参与排序', () => {
  assert.deepEqual(ARTIST_SONG_SORT_PARAMS, {
    kg: { hot: 2, new: 1 },
    kw: { hot: 0, new: 1 },
    tx: { hot: 5, new: 2 },
    wy: { hot: 'hot', new: 'time' },
  })
  assert.equal('mg' in ARTIST_SONG_SORT_PARAMS, false)
})

test('咪咕歌手歌曲没有最新参数', () => {
  const mg = src('src/utils/musicSdk/mg/artist.js')
  assert.doesNotMatch(mg, /ARTIST_SONG_SORT_PARAMS/)
})

test('kw artist2music 小写字段映射成旧解析器认识的形状', () => {
  assert.deepEqual(normalizeKwArtistSongItem({
    musicrid: '661608480',
    name: '恒星不忘 Forever Forever',
    artist: '周杰伦&言承旭',
    album: '今夜让我带你高飞远走',
    albumid: '105770237',
    duration: '285',
    N_MINFO: 'level:p,bitrate:320,format:mp3,size:10.91Mb',
    web_albumpic_short: '120/s4s7/41/4116299418.jpg',
  }), {
    MUSICRID: '661608480',
    SONGNAME: '恒星不忘 Forever Forever',
    ARTIST: '周杰伦&言承旭',
    ALBUM: '今夜让我带你高飞远走',
    ALBUMID: '105770237',
    DURATION: '285',
    N_MINFO: 'level:p,bitrate:320,format:mp3,size:10.91Mb',
    web_albumpic_short: '120/s4s7/41/4116299418.jpg',
  })
})

test('kw 映射丢掉缺 id 或缺音质的条目', () => {
  assert.equal(normalizeKwArtistSongItem({ name: '无 id', N_MINFO: 'level:p' }), null)
  assert.equal(normalizeKwArtistSongItem({ musicrid: '1', name: '无音质' }), null)
  assert.equal(normalizeKwArtistSongItem(null), null)
})

test('core/artist 把排序透传给五个源', () => {
  const core = src('src/core/artist.ts')
  assert.match(core, /ArtistSongSort/)
  assert.match(core, /getSongs\(id, page, limit, sort\)/)
  assert.match(core, /getArtistSongs = async\([^)]*sort/)
})

test('kg 用 sorttype、tx 用 sort、wy 用 order、kw 用 sortby', () => {
  const kgArtist = src('src/utils/musicSdk/kg/artist.js')
  const kgSinger = src('src/utils/musicSdk/kg/singer.js')
  assert.match(kgArtist, /getSingerSongList\(id, page, limit, sort\)/)
  assert.match(kgSinger, /ARTIST_SONG_SORT_PARAMS\.kg\[sort\]/)
  assert.match(kgSinger, /sorttype=\$\{/)

  const tx = src('src/utils/musicSdk/tx/artist.js')
  assert.match(tx, /ARTIST_SONG_SORT_PARAMS\.tx\[sort\]/)

  const wy = src('src/utils/musicSdk/wy/artist.js')
  assert.match(wy, /ARTIST_SONG_SORT_PARAMS\.wy\[sort\]/)

  const kw = src('src/utils/musicSdk/kw/artist.js')
  assert.match(kw, /stype=artist2music/)
  assert.match(kw, /ARTIST_SONG_SORT_PARAMS\.kw\[sort\]/)
  assert.match(kw, /normalizeKwArtistSongItem/)
})

test('歌曲 tab 顶部有单个排序切换按钮和多选按钮', () => {
  const songTab = src('src/screens/ArtistDetail/SongTab.tsx')
  assert.match(songTab, /handleToggleSort/)
  assert.match(songTab, /sort == 'hot' \? 'new' : 'hot'|sort === 'hot' \? 'new' : 'hot'/)
  assert.match(songTab, /songlist_hot/)
  assert.match(songTab, /songlist_new/)
  assert.match(songTab, /mylist_multi_select/)
  assert.match(songTab, /showMultiSelect/)
  assert.match(songTab, /multiSelectStyle="mylist"/)
  assert.match(songTab, /multiSelectUi="external"/)
  assert.match(songTab, /source != 'mg'|source !== 'mg'/)
})

test('多选态工具条左侧留空，右侧只剩「取消 / 全选」，批量操作栏回到列表底部', () => {
  const songTab = src('src/screens/ArtistDetail/SongTab.tsx')
  // 内置的选择栏交给宿主工具条绘制，避免和「取消 / 全选」重复
  assert.doesNotMatch(songTab, /multiSelectBarPosition="header"/)
  // 页面内不再自己画批量操作条，恢复由列表底部渲染
  assert.doesNotMatch(songTab, /MultipleActionsBar/)
  assert.doesNotMatch(songTab, /onSelectedListChange=/)
  assert.match(songTab, /list_select_cancel/)
  assert.match(songTab, /list_select_all/)
  assert.match(songTab, /selectAll\(true\)/)
})

test('批量操作栏与选择栏解耦，external 形态下仍渲染在列表底部', () => {
  const onlineList = src('src/components/OnlineList/index.tsx')
  assert.match(onlineList, /multiSelectUi\?: 'builtin' \| 'external'/)
  assert.match(onlineList, /multiSelectStyle == 'mylist' && isMultiSelectMode[\s\S]{0,120}<MultipleActionsBar/)
})

test('切换排序会清空列表并回到第一页', () => {
  const songTab = src('src/screens/ArtistDetail/SongTab.tsx')
  assert.match(songTab, /key=\{sort\}/)
  assert.match(songTab, /getArtistSongs\(source, artistId, page, PAGE_SIZE, sort\)/)
})
