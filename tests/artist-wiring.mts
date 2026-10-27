import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const src = (rel: string) => readFileSync(path.join(import.meta.dirname, '..', rel), 'utf8')

const searchTypeState = src('src/store/search/state.ts')
const searchTypeSelector = src('src/screens/Home/Views/Search/SearchTypeSelector.tsx')
const searchList = src('src/screens/Home/Views/Search/List.tsx')
const searchIndex = src('src/screens/Home/Views/Search/index.tsx')
const artistState = src('src/store/search/artist/state.ts')
const artistAction = src('src/store/search/artist/action.ts')
const artistGrid = src('src/screens/Home/Views/Search/ArtistGrid.tsx')
const artistList = src('src/screens/Home/Views/Search/ArtistList.tsx')
const homeDetailState = src('src/store/homeDetail/state.ts')
const detailStack = src('src/screens/Home/DetailStack.tsx')
const coreArtist = src('src/core/artist.ts')

test('搜索页把 artist 作为第四种搜索类型接入', () => {
  assert.match(searchTypeState, /export type SearchType = 'music' \| 'songlist' \| 'album' \| 'artist'/)
  assert.match(searchTypeSelector, /'album',\s*'artist',/)
  assert.match(searchList, /listType == 'artist'[\s\S]{0,120}<ArtistList/)
  assert.match(searchIndex, /searchArtistState/)
  assert.match(artistState, /\.artist\?\.search/)
})

test('五个源都暴露 artist.search', () => {
  for (const source of ['kg', 'kw', 'tx', 'wy', 'mg']) {
    const index = src(`src/utils/musicSdk/${source}/index.js`)
    assert.match(index, /artist,/, `${source} 缺少 artist 模块`)
    const artist = src(`src/utils/musicSdk/${source}/artist.js`)
    assert.match(artist, /search\s*\(/, `${source} 缺少 artist.search`)
  }
})

test('单源和聚合都按 total 计算最大页，空结果也至少一页', () => {
  assert.match(artistAction, /state\.maxPages\[datas\.source\] = Math\.max\(1, Math\.ceil\(datas\.total \/ datas\.limit\)\)/)
  assert.match(artistAction, /state\.maxPages\.all = Math\.max\(1,/)
})

test('搜索类型有中文/繁体/英文文案', () => {
  for (const lang of ['zh-cn', 'zh-tw', 'en-us']) {
    const json = JSON.parse(src(`src/lang/${lang}.json`)) as Record<string, string>
    assert.ok(json.search_type_artist, `${lang} 缺少 search_type_artist`)
  }
})

test('点击歌手卡片推入当前 tab 的详情栈', () => {
  assert.match(artistGrid, /onPressItem: \(item: ArtistSearchItem\) => void/)
  assert.match(artistGrid, /onPress=\{\(\) => \{ onPressItem\(item\) \}\}/)
  assert.match(artistList, /homeDetailActions\.push\(\{ type: 'artist', info: item \}\)/)
  assert.match(homeDetailState, /\{ id: string, type: 'artist', info: ArtistSearchItem \}/)
  assert.match(detailStack, /route\.type == 'artist'/)
  assert.match(detailStack, /<ArtistDetail info=\{route\.info\} onBack=\{popDetail\} \/>/)
  assert.doesNotMatch(detailStack, /<ArtistDetail[^>]*embedded/)
})

test('core/artist 负责规范化歌曲与专辑 ID', () => {
  assert.match(coreArtist, /mergeArtistDetail/)
  assert.match(coreArtist, /toNewMusicInfo/)
  assert.match(coreArtist, /deduplicationList/)
  assert.match(coreArtist, /createAlbumListId\(item\.id\)/)
  for (const method of ['getArtistDetail', 'getArtistSongs', 'getArtistAlbums']) {
    assert.match(coreArtist, new RegExp(`export const ${method}`))
  }
})

test('五源 artist 都提供详情、歌曲、专辑三个方法', () => {
  for (const source of ['kg', 'kw', 'tx', 'wy', 'mg']) {
    const artist = src(`src/utils/musicSdk/${source}/artist.js`)
    for (const method of ['getDetail', 'getSongs', 'getAlbums']) {
      assert.match(artist, new RegExp(`${method}\\s*\\(`), `${source} 缺少 artist.${method}`)
    }
  }
})

test('歌手详情页由头像区、三个标签和三个内容页组成', () => {
  const index = src('src/screens/ArtistDetail/index.tsx')
  const header = src('src/screens/ArtistDetail/Header.tsx')
  const songTab = src('src/screens/ArtistDetail/SongTab.tsx')
  const albumTab = src('src/screens/ArtistDetail/AlbumTab.tsx')
  const introTab = src('src/screens/ArtistDetail/IntroTab.tsx')

  assert.match(header, /artist_song_count/)
  assert.match(header, /artist_album_count/)
  assert.match(header, /borderRadius/)
  // 详情栈的覆盖层从屏幕顶开始，歌手顶栏必须自己让出状态栏高度
  assert.match(header, /const statusBarHeight = useStatusbarHeight\(\)/)
  assert.match(header, /paddingTop: statusBarHeight/)
  assert.match(index, /'songs' \| 'albums' \| 'intro'/)
  assert.match(index, /<SongTab/)
  assert.match(index, /<AlbumTab/)
  assert.match(index, /<IntroTab/)
  // 三个页常驻挂载，切标签不丢滚动位置
  assert.match(index, /display: activeTab == .+ \? 'flex' : 'none'/)
  assert.match(songTab, /<OnlineList/)
  assert.match(songTab, /setTempList/)
  assert.match(albumTab, /<Songlist/)
  assert.match(introTab, /<ScrollView/)
})

test('详情页标签有中文/繁体/英文文案', () => {
  for (const lang of ['zh-cn', 'zh-tw', 'en-us']) {
    const json = JSON.parse(src(`src/lang/${lang}.json`)) as Record<string, string>
    for (const key of ['artist_tab_songs', 'artist_tab_albums', 'artist_tab_intro', 'artist_desc_empty']) {
      assert.ok(json[key], `${lang} 缺少 ${key}`)
    }
  }
})
