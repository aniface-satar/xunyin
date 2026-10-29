import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const root = path.join(import.meta.dirname, '..')
const src = (rel: string) => readFileSync(path.join(root, rel), 'utf8')

const actionBarSource = src('src/screens/SonglistDetail/ActionBar.tsx')
const listActionSource = src('src/screens/SonglistDetail/listAction.ts')
const headerSource = src('src/screens/SonglistDetail/Header.tsx')
const musicListSource = src('src/screens/SonglistDetail/MusicList.tsx')
const onlineListSource = src('src/components/OnlineList/index.tsx')

const importBody = listActionSource.slice(
  listActionSource.indexOf('export const handleImportAsList'),
  listActionSource.indexOf('\n}', listActionSource.indexOf('export const handleImportAsList')) + 2,
)

const langs = ['zh-cn', 'zh-tw', 'en-us'].map(name => ({
  name,
  entries: JSON.parse(readFileSync(path.join(root, `src/lang/${name}.json`), 'utf8')) as Record<string, string>,
}))

test('外部歌单页的通栏按钮不再是"播放全部"，也不再是往别的歌单里塞歌', () => {
  assert.doesNotMatch(actionBarSource, /handlePlay|play_all/, '播放全部还挂在这个按钮上')
  assert.match(actionBarSource, /t\(isLoading \? 'songlist_add_to_mylist_loading' : 'songlist_add_to_mylist'\)/)
  assert.doesNotMatch(actionBarSource, /onAddToList|showAddModal/, '又退回弹选框那套了')
})

test('一键存成一张新的自建歌单，整张外部歌单是它的歌', () => {
  assert.match(actionBarSource, /handleImportAsList\(info\.source, info\.id, name\)/)
  assert.match(importBody, /await createList\(\{/)
  // 取整张歌单而不是页面上已加载的那几十首：用户可能根本没往下滚
  // getListDetailAll 是 (source, id)，而隔壁 getListDetail 是 (id, source, page) —— 顺序反了不会报错，只会静默抓到空歌单
  assert.match(importBody, /getListDetailAll\(source, id\)/)
  assert.doesNotMatch(importBody, /getListDetailAll\(id, source\)/, '参数顺序反了')
  assert.doesNotMatch(listActionSource, /listDetailInfo\.list/, '只拿到当前分页就等于漏歌')
})

test('新歌单绑住来源，"更新歌单"同步才认它', () => {
  // 只写 source, 会被上面 isSameSourceList(l, source, id) 空过，必须钉在 createList 的入参对象里
  assert.match(importBody, /createList\(\{[\s\S]{0,200}?\bsource,[\s\S]{0,200}?sourceListId: id,/)
  // 这颗按钮建的是普通自建歌单；打收藏标记是右上角爱心的事
  assert.doesNotMatch(importBody, /isLove/)
  // 收藏用的 id 是 ${source}_${md5}，这里用 userlist_ 时间戳，避开和它抢同一个 id
  assert.match(importBody, /id: `userlist_\$\{Date\.now\(\)\}`/)
  assert.doesNotMatch(importBody, /toMD5/)
})

test('同一张外部歌单不许建第二张，判定要在抓全量之前', () => {
  assert.match(importBody, /listState\.userList\.some\(l => isSameSourceList\(l, source, id\)\)/, '重复保护没走收藏那套按 source+sourceListId 认人的逻辑')
  const guard = importBody.indexOf('isSameSourceList')
  const fetch = importBody.indexOf('getListDetailAll')
  assert.ok(guard >= 0 && fetch >= 0)
  assert.ok(guard < fetch, '重复点一次就白抓一整张歌单')
  assert.match(importBody, /songlist_add_to_mylist_exists/)
})

test('歌单名还没加载出来时不许建无名歌单', () => {
  assert.match(actionBarSource, /if \(!name\)[\s\S]{0,80}songlist_add_to_mylist_failed/)
  assert.match(headerSource, /<ActionBar name=\{detailInfo\.name \|\| info\.name\} \/>/)
})

test('读全量的几秒里按钮不许再点', () => {
  assert.match(actionBarSource, /if \(isLoading\) return/)
  assert.match(actionBarSource, /disabled=\{isLoading\}/)
  assert.match(actionBarSource, /setIsLoading\(false\)/, '转完了要放行，不然按钮永久卡死')
})

test('抓到空歌单或抓失败都有反馈', () => {
  assert.match(importBody, /if \(!list\.length\)[\s\S]{0,120}songlist_add_to_mylist_failed[\s\S]{0,80}return/)
  assert.match(actionBarSource, /\.catch\(\(\) => \{[\s\S]{0,120}toast\(/)
})

test('这条链路自己不落库，加歌走既有 createList 一套', () => {
  assert.doesNotMatch(actionBarSource, /addListMusics|listMusicAdd|createList\(/, '按钮不该绕过 core/list 自己写添加逻辑')
  assert.doesNotMatch(onlineListSource, /showAddModal/, '给这个按钮开的句柄没人用了还留着')
  assert.doesNotMatch(musicListSource, /handleAddToList|onAddToList/, 'MusicList 还在转发这根线')
  for (const file of readdirSync(path.join(root, 'src/screens/SonglistDetail'))) {
    assert.doesNotMatch(src(`src/screens/SonglistDetail/${file}`), /MusicMultiAddModal/, `${file} 里多挂了一个弹窗实例`)
  }
})

test('专辑页不挂「加入自建歌单」按钮', () => {
  assert.match(musicListSource, /hideActionBar/, '专辑页没有关掉按钮')
  assert.match(headerSource, /hideActionBar \? null : <ActionBar name=\{detailInfo\.name \|\| info\.name\} \/>/)
})

test('三个语言都有文案，繁简不共用一条', () => {
  const keys = ['songlist_add_to_mylist', 'songlist_add_to_mylist_done', 'songlist_add_to_mylist_exists', 'songlist_add_to_mylist_failed', 'songlist_add_to_mylist_loading']
  for (const { name, entries } of langs) {
    for (const key of keys) assert.ok(entries[key], `${name} 缺 ${key}`)
  }
  const [zhCn, zhTw] = langs
  for (const key of keys) {
    assert.notEqual(zhCn.entries[key], zhTw.entries[key], `${key} 繁体那条是从简体抄来的`)
  }
  assert.match(zhTw.entries.songlist_add_to_mylist_done, /歌單$/)
})
