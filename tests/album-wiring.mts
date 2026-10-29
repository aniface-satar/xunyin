import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const src = (rel: string) => readFileSync(path.join(import.meta.dirname, '..', rel), 'utf8')

const coreSonglist = src('src/core/songlist.ts')
const searchTypeState = src('src/store/search/state.ts')
const searchTypeSelector = src('src/screens/Home/Views/Search/SearchTypeSelector.tsx')
const searchTypes = src('src/screens/Home/Views/Search/searchTypes.ts')
const searchList = src('src/screens/Home/Views/Search/List.tsx')
const searchIndex = src('src/screens/Home/Views/Search/index.tsx')
const albumAction = src('src/store/search/album/action.ts')

test('album__ 歌单 id 在 core 层路由到 album.getAlbumDetail', () => {
  assert.match(coreSonglist, /isAlbumListId\(id\)/)
  assert.match(coreSonglist, /getAlbumRawId\(id\)/)
  assert.match(coreSonglist, /\.album\?\.getAlbumDetail/)
  assert.match(coreSonglist, /\.songList\.getListDetail/)
})

test('搜索页把 album 作为第三种搜索类型接入', () => {
  assert.match(searchTypeState, /export type SearchType = 'music' \| 'songlist' \| 'album'/)
  assert.match(searchTypes, /'album',\s*'songlist',/)
  assert.match(searchTypeSelector, /SEARCH_TYPES\.map/)
  assert.match(searchList, /<AlbumList ref=\{albumListRef\}/)
  assert.match(searchIndex, /searchAlbumState/)
})

test('滑动切标签复用已加载结果，只有手动搜索才强制重新拉取', () => {
  assert.match(searchList, /loadedRef\.current\[type\] == signature/)
  assert.match(searchList, /if \(!force &&/)
  assert.match(searchIndex, /loadList\(text, searchInfo\.current\.source, searchInfo\.current\.searchType, true\)/)
})

test('单源和聚合都按 total 计算最大页，空结果也至少一页', () => {
  assert.match(albumAction, /state\.maxPages\[source\.source\] = Math\.max\(1, Math\.ceil\(source\.total \/ source\.limit\)\)/)
  assert.match(albumAction, /state\.maxPages\.all = Math\.max\(1,/)
})
