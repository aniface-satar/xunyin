import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  addLikedArtist,
  artistKey,
  filterLikedArtists,
  isLikedArtist,
  removeLikedArtist,
  toArtistSearchItem,
  toggleLikedArtist,
} from '../src/core/artistLibrary.ts'

const src = (rel: string) => readFileSync(path.join(import.meta.dirname, '..', rel), 'utf8')

const jay = { source: 'tx' as const, id: '001', name: '周杰伦', alias: 'Jay Chou', img: 'https://p/1.jpg' }
const fei = { source: 'wy' as const, id: '002', name: '费玉清' }

test('喜欢创作者按源+ID 去重，新喜欢的排在最前', () => {
  const first = addLikedArtist([], jay, 1000)
  assert.equal(first.length, 1)
  assert.deepEqual(first[0], { ...jay, likedAt: 1000 })
  assert.equal(isLikedArtist(first, 'tx', '001'), true)
  assert.equal(isLikedArtist(first, 'wy', '001'), false)

  const second = addLikedArtist(first, fei, 2000)
  assert.deepEqual(second.map(item => item.name), ['费玉清', '周杰伦'])
  assert.equal(second[1].alias, 'Jay Chou')

  assert.deepEqual(addLikedArtist(second, jay, 3000), second)
})

test('再点一次取消喜欢，只移除对应源的同一位创作者', () => {
  const list = addLikedArtist(addLikedArtist([], jay, 1000), fei, 2000)
  assert.deepEqual(toggleLikedArtist(list, { source: 'tx', id: '001', name: '周杰伦' }, 3000), {
    list: [list[0]],
    liked: false,
  })
  assert.deepEqual(removeLikedArtist(list, 'wy', '002'), [list[1]])
  assert.equal(isLikedArtist(list, 'wy', '002'), true)
})

test('搜索按名称或别名匹配，空关键词返回全部', () => {
  const list = addLikedArtist(addLikedArtist([], jay, 1000), fei, 2000)
  assert.deepEqual(filterLikedArtists(list, '').map(item => item.name), ['费玉清', '周杰伦'])
  assert.deepEqual(filterLikedArtists(list, 'jay').map(item => item.name), ['周杰伦'])
  assert.deepEqual(filterLikedArtists(list, '周杰').map(item => item.name), ['周杰伦'])
  assert.deepEqual(filterLikedArtists(list, '  不存在  '), [])
})

test('已喜欢的创作者可还原成歌手详情页参数', () => {
  const [item] = addLikedArtist([], jay, 1000)
  assert.deepEqual(toArtistSearchItem(item), {
    id: '001',
    name: '周杰伦',
    alias: 'Jay Chou',
    img: 'https://p/1.jpg',
    songCount: '',
    albumCount: '',
    source: 'tx',
  })
  assert.equal(artistKey('tx', '001'), 'tx__001')
})

test('创作者收藏持久化与启动加载接线', () => {
  const data = src('src/utils/data.ts')
  assert.match(data, /getLikedArtists/)
  assert.match(data, /saveLikedArtists/)
  assert.match(src('src/config/constant.ts'), /likedArtist: '@liked_artist'/)
  assert.match(src('src/core/init/dataInit.ts'), /initLikedArtists/)
})

test('创作者页喜欢按钮与头像同一行并实时反映状态', () => {
  const header = src('src/screens/ArtistDetail/Header.tsx')
  assert.match(header, /LoveIcon/)
  assert.match(header, /liked: boolean/)
  assert.match(header, /onToggleLike/)
  assert.match(header, /love_add/)
  assert.match(header, /love_remove/)
  assert.match(header, /likeBtn/)
  // 按钮挂在头像/信息行里（水平对齐头像），不能退回顶栏右上角
  assert.ok(header.indexOf('style={styles.likeBtn}') > header.indexOf('style={styles.infoRow}'))
  const topRow = header.slice(header.indexOf('topRow: {'), header.indexOf('backBtn: {'))
  assert.doesNotMatch(topRow, /likeBtn/)

  const page = src('src/screens/ArtistDetail/index.tsx')
  assert.match(page, /useLikedArtists/)
  assert.match(page, /isLikedArtist/)
  assert.match(page, /toggleLikedArtist/)
  assert.match(page, /liked=\{liked\}/)
})

test('我的收藏-创作者标签展示显式喜欢的创作者', () => {
  const tab = src('src/screens/MylistDetail/ArtistTab.tsx')
  assert.match(tab, /useLikedArtists/)
  assert.match(tab, /filterLikedArtists/)
  assert.match(tab, /removeLikedArtist/)
  assert.match(tab, /toArtistSearchItem/)
  assert.match(tab, /mylist_no_artist/)
  assert.match(src('src/screens/MylistDetail/index.tsx'), /<ArtistTab keyword=\{searchKeyword\}/)
})

test('多创作者选择面板文案改为选择创作者', () => {
  assert.match(src('src/components/ArtistPickerSheet/index.tsx'), /artist_picker_title/)
  const expect: Record<string, string> = {
    'zh-cn': '选择创作者',
    'zh-tw': '選擇創作者',
    'en-us': 'Choose creator',
  }
  for (const [lang, title] of Object.entries(expect)) {
    const json = JSON.parse(src(`src/lang/${lang}.json`)) as Record<string, string>
    assert.equal(json.artist_picker_title, title, `${lang} 的 artist_picker_title`)
  }
})
