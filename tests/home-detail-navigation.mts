import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const src = (rel: string) => readFileSync(path.join(import.meta.dirname, '..', rel), 'utf8')

const tabBarSource = src('src/screens/Home/Vertical/BottomTabBar.tsx')
const contentSource = src('src/screens/Home/Vertical/Content.tsx')
const mainSource = src('src/screens/Home/Vertical/Main.tsx')
const stackSource = src('src/screens/Home/DetailStack.tsx')
const stateSource = src('src/store/homeDetail/state.ts')
const actionSource = src('src/store/homeDetail/action.ts')
const hookSource = src('src/store/homeDetail/hook.ts')

const slice = (source: string, from: string, to: string) => {
  const start = source.indexOf(from)
  assert.ok(start >= 0, `anchor not found: ${from}`)
  const end = source.indexOf(to, start)
  assert.ok(end >= 0, `end anchor not found: ${to}`)
  return source.slice(start, end)
}

test('三个导航页各有一份详情栈，互不共用', () => {
  assert.match(stateSource, /HOME_DETAIL_TAB_IDS = \['nav_discover', 'nav_love', 'nav_search'\] as const/)
  assert.match(stateSource, /nav_discover: \[\],\s*nav_love: \[\],\s*nav_search: \[\]/)
  assert.match(hookSource, /useHomeDetailStack = \(tabId\?: HomeDetailTabId\)/)
})

test('切走再切回来：详情栈与页面都不重置', () => {
  // 旧的单栈实现会在 navActiveId 变化时整体 reset，这正是“切回来就没了”的根因
  assert.doesNotMatch(stackSource, /navActiveIdUpdated/)
  assert.doesNotMatch(stackSource, /homeDetailActions\.reset/)
  // 三个栈始终挂载，只靠 opacity 切换可见性；页面实例不卸载，栈里的路由也一直留着
  assert.match(stackSource, /style=\{\[styles\.container, active \? styles\.stackActive : styles\.stackHidden\]\}/)
  assert.match(stackSource, /pointerEvents=\{active \? 'auto' : 'none'\}/)
  assert.match(stackSource, /HOME_DETAIL_TAB_IDS\.map\(id => \(/)
  assert.match(stackSource, /<DetailStack key=\{id\} navId=\{id\} active=\{activeId == id\} \/>/)
})

test('系统返回与页内返回都只弹当前 tab 的栈顶一级', () => {
  assert.match(stackSource, /homeDetailActions\.pop\(navId\)/)
  const backBody = slice(stackSource, 'const back = useCallback(() => {', 'useBackHandler(back)')
  assert.match(backBody, /if \(!active \|\| !stack\.length\) return false/, '非当前 tab 不能抢系统返回键')
  assert.match(backBody, /popDetail\(\)/)
  assert.match(stackSource, /useBackHandler\(back\)/)
})

test('重复点当前导航按钮：清空该页详情栈并回到子页最初态', () => {
  const onPressBody = slice(tabBarSource, 'onPress={() => {', 'onTabPress?.(id)')
  assert.match(onPressBody, /if \(activeId == id\)/)
  assert.match(onPressBody, /homeDetailActions\.reset\(id\)/, '回最初页要先退出所有详情层级')
  assert.match(onPressBody, /homeTabReset\(\)/, '子 tab / 抽屉等页内状态也要回到最初态')
})

test('切到别的导航页不重置离开页的状态', () => {
  const onPressBody = slice(tabBarSource, 'onPress={() => {', 'onTabPress?.(id)')
  const resetAt = onPressBody.indexOf('homeDetailActions.reset(id)')
  const guardAt = onPressBody.indexOf('if (activeId == id)')
  assert.ok(guardAt >= 0 && resetAt > guardAt, 'reset 必须被 activeId == id 包住')
  // homeTabReset 也必须在同一个守卫里，不能在切换 tab 时无条件发
  const resetBlock = onPressBody.slice(guardAt, onPressBody.indexOf('}', onPressBody.indexOf('homeTabReset()')))
  assert.match(resetBlock, /homeTabReset\(\)/)
  assert.doesNotMatch(onPressBody.slice(0, guardAt), /homeTabReset\(\)|\.reset\(/)
})

test('详情页只做覆盖层，不能把分页器摘下', () => {
  // 根因：详情页打开时若把含 PagerView 的 Main 设为 display:none，返回后 ViewPager2
  // 重新挂载会画出第 0 页（发现），而原生页码未变导致 setPage 是空操作
  assert.doesNotMatch(contentSource, /display: 'none'/, 'Main 只能隐掉绘制，不能退出布局')
  assert.match(contentSource, /style=\{detailVisible \? styles\.mainCovered : styles\.main\}/)
  const coveredStyle = slice(contentSource, 'mainCovered: {', '},')
  assert.match(coveredStyle, /opacity: 0/)
  assert.match(contentSource, /pointerEvents=\{detailVisible \? 'none' : 'auto'\}/)
  assert.match(contentSource, /pointerEvents=\{detailVisible \? 'auto' : 'none'\}/)
  const detailStyle = slice(contentSource, 'detailContainer: {', '},')
  assert.match(detailStyle, /position: 'absolute'/, '详情栈必须脱离文档流盖在 Main 上')
  assert.match(detailStyle, /top: 0/)
  assert.match(detailStyle, /bottom: 0/)
  assert.doesNotMatch(mainSource, /hasDetail/, '分页器常驻布局，定位只跟着 activeId')
  assert.match(mainSource, /setPageWithoutAnimation\(index\)/)
})

test('详情栈内的下层页面也不能被摘出布局', () => {
  // 同一根因再往下一层：我喜欢页的标签也是 PagerView。push 子页时把它 display:none，
  // 返回后 ViewPager2 重挂画出第 0 页（歌曲）并回调 onPageSelected(0)，
  // 「歌曲/专辑/歌单/创作者」的标签状态会被一起改回「歌曲」
  assert.doesNotMatch(stackSource, /display: isTop \? 'flex' : 'none'/, '下层详情页只能隐掉绘制，不能退出布局')
  const pageStyle = slice(stackSource, 'page: {', '},')
  assert.match(pageStyle, /position: 'absolute'/, '详情页按绝对定位叠放，不再靠 display 切换')
  assert.match(pageStyle, /top: 0/)
  assert.match(pageStyle, /bottom: 0/)
  const behindStyle = slice(stackSource, 'pageBehind: {', '},')
  assert.match(behindStyle, /opacity: 0/)
  assert.match(stackSource, /style=\{\[styles\.page, isTop \? null : styles\.pageBehind/)
  assert.match(stackSource, /pointerEvents=\{isTop \? 'auto' : 'none'\}/)
  // pop 回来时目标页已经在 revealed 集合里，必须直接渲染，不能再经历一帧卸载重建
  assert.match(stackSource, /revealedRouteIdsRef\.current\.has\(route\.id\)/)
})

test('我喜欢页隐藏期间收到的页码回调不改标签', () => {
  const detailSource = src('src/screens/MylistDetail/index.tsx')
  const body = slice(detailSource, 'const handlePageSelected = useCallback(', 'const index = tabs.indexOf(activeTab)')
  assert.match(body, /if \(embedded && !detailPageActive\) return/, '遮住时的页码回调必须忽略')
  assert.match(body, /const tab = tabs\[nativeEvent\.position\]/)
})

test('新推入的详情页归到当前 tab，设置页里的推入归到进入设置前的 tab', () => {
  assert.match(actionSource, /push\(route: HomeDetailPushRoute, tabId: HomeDetailTabId = getActiveTabId\(\)\)/)
  assert.match(stateSource, /navActiveId == 'nav_setting' \? lastNavActiveId : navActiveId/)
})
