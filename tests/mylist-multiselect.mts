import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const src = (rel: string) => readFileSync(path.join(import.meta.dirname, '..', rel), 'utf8')

test('我喜欢的「多选」那一行在多选态左侧留空，右侧只剩「取消 / 全选」', () => {
  const detail = src('src/screens/MylistDetail/index.tsx')
  // 不再渲染内置的「已选 N 项」选择栏
  assert.doesNotMatch(detail, /list_select_selected_count/)
  assert.match(detail, /multiSelectUi="external"/)
  // 多选态与常态共用同一处按钮：取消 + 全选 / 多选 + 排序
  assert.match(detail, /isMultiSelectMode\s*\n?\s*\?\s*\(\s*\n?\s*<>[\s\S]*?list_select_cancel/)
  assert.match(detail, /list_select_all/)
  assert.match(detail, /mylist_multi_select/)
  assert.match(detail, /handleSelectAll/)
  assert.match(detail, /selectAll\(true\)/)
})

test('自建歌单与我喜欢共用同一套操作行', () => {
  const detail = src('src/screens/MylistDetail/index.tsx')
  assert.match(detail, /const playlistActionBar = showPlaylistActions \? \([\s\S]{0,200}\{actionButtons\}/)
  assert.match(detail, /showDetailActions\s*\n?\s*\?\s*<View style=\{styles\.tabActions\}>\{actionButtons\}<\/View>/)
})

test('列表组件在多选态不再自绘选择栏，但底部批量操作栏保留', () => {
  const musicList = src('src/screens/Home/Views/Mylist/MusicList/index.tsx')
  assert.match(musicList, /multiSelectUi\?: 'builtin' \| 'external'/)
  assert.match(musicList, /multiSelectUi == 'builtin'[\s\S]{0,220}<MultipleModeBar/)
  assert.match(musicList, /selectAll\(isAll\)[\s\S]{0,120}multipleModeBarRef/)
  assert.match(musicList, /isMultiSelectMode\s*\n?\s*\?\s*<MultipleActions selectedList=\{selectedList\}/)
})
