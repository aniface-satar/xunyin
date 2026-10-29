import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const src = (rel: string) => readFileSync(path.join(import.meta.dirname, '..', rel), 'utf8')

const commentSource = src('src/screens/Comment/index.tsx')
const searchSource = src('src/screens/Home/Views/Search/index.tsx')
const overlaySource = src('src/components/player/PlayerOverlay/index.tsx')
const versionModalSource = src('src/navigation/components/VersionModal.tsx')
const noticeModalSource = src('src/navigation/components/NoticeModal.tsx')

const slice = (source: string, from: string, to: string) => {
  const start = source.indexOf(from)
  assert.ok(start >= 0, `anchor not found: ${from}`)
  const end = source.indexOf(to, start)
  assert.ok(end >= 0, `end anchor not found: ${to}`)
  return source.slice(start, end)
}

// 评论页是从全屏播控页（PlayerOverlay）以原生方式 push 上去的。PlayerOverlay 在全屏打开期间
// 注册的 hardwareBackPress 监听注册得更早，于是返回键会先被它吃掉去收起播控卡片 ——
// 评论页留在原地，播控页却被收起了，用户看到的现象就是"返回不了全屏播控页"。
test('评论页自己接管系统返回：弹掉自己，不把事件让给播控浮层', () => {
  assert.match(commentSource, /useBackHandler/, '评论页必须注册硬件返回监听（后注册者先执行，能先于播控浮层拿到返回键）')
  const backBody = slice(commentSource, 'const handleBack = useCallback(', 'useBackHandler(handleBack)')
  assert.match(backBody, /pop\(componentId\)/, '评论页的返回动作必须是弹出自己这一屏')
  assert.match(backBody, /return true/, '必须消费掉事件，否则会继续落到播控浮层的监听上')
})

// 搜索结果页没有返回处理时，系统返回直接走 BackHandler.exitApp() → 退出/退出栈，
// 不会清空关键词回到"输入框无输入"的空白态（热门/历史搜索）。
test('搜索结果页的系统返回：清空搜索回到无输入的空白态', () => {
  assert.match(searchSource, /useBackHandler/, '搜索页必须注册硬件返回监听')
  const backBody = slice(searchSource, 'const handleBack = useCallback(', 'useBackHandler(handleBack)')
  assert.match(backBody, /navActiveId != 'nav_search'/, '只有搜索 tab 处于前台时才能消费返回键')
  assert.match(backBody, /searchText/, '没有搜索结果时要放行，不能拦掉默认返回')
  assert.match(backBody, /stacks\.nav_search\.length/, '搜索 tab 详情栈非空时先让详情页返回')
  assert.match(backBody, /handleSearch\(''\)/, '复用清空按钮的路径：清空输入并回到空白态')
  assert.match(backBody, /return true/)
})

// 更新窗口是 RNN 的 overlay，盖在设置页之上，但设置页的 useBackHandler 仍然注册着
// （Setting/index.tsx：nav_setting 且 detailId 非空时，把"软件更新"子页退回设置主列表并 return true）。
// 窗口自己不接管返回键，系统返回改的是底下那页的导航状态，窗口却孤零零留在原地。
// RN 的 hardwareBackPress 后注册先执行 —— 本窗口挂载晚于设置页，所以它先拿到返回键。
test('更新窗口自己接管系统返回：先关窗，不让事件落到设置页', () => {
  assert.match(versionModalSource, /useBackHandler/, '更新窗口必须注册硬件返回监听')
  const backBody = slice(versionModalSource, 'const handleBack = useCallback(', 'useBackHandler(handleBack)')
  assert.match(backBody, /hideModal\(componentId\)/, '返回动作必须是关闭窗口')
  assert.match(backBody, /return true/, '必须消费掉事件，否则会继续落到设置页的监听上')
})

test('公告窗口同一手：返回键先关窗', () => {
  assert.match(noticeModalSource, /useBackHandler/, '公告窗口必须注册硬件返回监听')
  const backBody = slice(noticeModalSource, 'const handleBack = useCallback(', 'useBackHandler(handleBack)')
  assert.match(backBody, /hideNoticeModal\(componentId\)/, '返回动作必须是关闭公告窗口')
  assert.match(backBody, /return true/)
})

// 两个修复都不应改动播控浮层自身的返回语义（歌词工具模式 → 退出模式；否则收起卡片）
test('播控浮层的返回逻辑保持原样', () => {
  const handleBackBody = slice(overlaySource, 'var handleBack = (0, _react.useCallback)(function () {', 'var subscription = _reactNative.BackHandler')
  assert.match(handleBackBody, /_lyricCopy\.setLyricToolMode\)\(false\)/)
  assert.match(handleBackBody, /close\(\)/)
})
