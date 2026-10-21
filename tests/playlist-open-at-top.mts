import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const src = (rel: string) => readFileSync(path.join(import.meta.dirname, '..', rel), 'utf8')

const mylistSource = src('src/screens/Home/Views/Mylist/MusicList/List.tsx')
const onlineSource = src('src/components/OnlineList/List.tsx')
const stackSource = src('src/screens/Home/DetailStack.tsx')
const stateSource = src('src/store/homeDetail/state.ts')

/** 断言只盯着两个锚点之间的那段逻辑，别被文件别处的同名调用糊过去 */
const slice = (source: string, from: string, to: string) => {
  const start = source.indexOf(from)
  assert.ok(start >= 0, `anchor not found: ${from}`)
  const end = source.indexOf(to, start)
  assert.ok(end >= 0, `end anchor not found: ${to}`)
  return source.slice(start, end)
}

const TOP_RESET = /scrollToOffset\(\{ offset: 0, animated: false \}\)/

test('我的歌单：加载完只回顶部，不再自己滚到正在播放的那首', () => {
  const body = slice(mylistSource, 'const updateList = (id: string) => {', 'const handleChange')
  assert.match(body, TOP_RESET)
  assert.doesNotMatch(body, /scrollToIndex/, '刚加载好的歌单不该自己跳到别处')
})

test('我的歌单：跨调用暂存跳转意图的那套机制整个删掉了', () => {
  assert.doesNotMatch(mylistSource, /waitJumpListPosition/)
  assert.doesNotMatch(mylistSource, /isUpdateingList/)
})

test('滚动位置不再被记住，也就无从恢复', () => {
  assert.doesNotMatch(mylistSource, /getListPosition|saveListPosition/)
})

test('长按播放器标题/封面：只把所属歌单打开，定位交给浮窗', () => {
  const body = slice(mylistSource, 'const handleOpenPlayingList = () => {', 'const openPlayingList')
  assert.match(body, /setActiveList\(listId\)/, '正在播放的歌单还是得切出来')
  assert.doesNotMatch(body, /scrollTo/, '切完歌单不许再顺手滚到播放曲')
})

test('主动定位只剩两个入口：搜索命中与右下角浮窗', () => {
  assert.match(mylistSource, /scrollToInfo\(info\)[\s\S]{0,400}scrollToIndex/)
  assert.match(mylistSource, /const handleLocate = \(\) => \{[\s\S]{0,300}scrollToIndex/)
  assert.match(mylistSource, /<LocateButton onPress=\{handleLocate\} \/>/)
  assert.match(onlineSource, /<LocateButton onPress=\{handleLocate\} \/>/)
})

test('在线歌单/榜单：换一份列表从顶部看起，往下翻页不算', () => {
  const body = slice(onlineSource, 'setList(list, isAppend, showSource) {', 'setIsMultiSelectMode')
  assert.match(body, /if \(!isAppend\)/, '翻页追加数据时要把用户停着的位置留住')
  assert.match(body, TOP_RESET)
})

test('被遮住的下层详情页重新露出时也回顶部', () => {
  const cases = [
    ['我的歌单', mylistSource, 'const playMusicInfo'],
    ['在线歌单', onlineSource, 'const handleUpdateSelectedList'],
  ] as const
  for (const [name, source, endAnchor] of cases) {
    const body = slice(source, 'const detailPageActive = useContext(DetailPageActiveContext)', endAnchor)
    assert.match(body, /becameActive = detailPageActive && !wasPageActiveRef\.current/, `${name}：只在"由隐藏变露出"的上升沿归零`)
    assert.match(body, /wasPageActiveRef\.current = detailPageActive/, `${name}：不记下上一次的状态就会每次渲染都归零`)
    assert.match(body, /if \(becameActive\)[\s\S]{0,120}scrollToOffset\(\{ offset: 0, animated: false \}\)/, `${name}：露出来了却没回顶部`)
  }
})

test('这条上升沿信号只在详情栈里存在', () => {
  // 三个 tab 各有一份栈且始终挂载：非当前 tab 的顶层页不能算“露出来”，否则切回来时上升沿已经错过
  assert.match(stackSource, /value=\{active && isTop && revealedRouteId == route\.id\}/)
  // 被遮住的页面靠 display:'none' 藏着、从不卸载 —— 这正是滚动位置会自己留着的原因
  assert.match(stackSource, /display: isTop \? 'flex' : 'none'/)
  // 默认值必须是 false：搜索结果页和原生 push 出来的详情页在栈外，收不到上升沿，行为保持原样
  assert.match(stateSource, /createContext\(false\)/)
})
