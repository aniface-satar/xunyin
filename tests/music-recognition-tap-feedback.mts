import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// 2026-10-12 修真机症状：冷启动进识曲页立刻按圆盘，要等两三秒才有识曲动画。
// 根因不在录音链路，而在 `listening` 这个状态翻得太晚 —— 它排在
// `await guard.check()`（首读 AsyncStorage 要等原生存储起来）与
// `await createActiveEngines()`（运营配置冷缓存时串行探五个镜像）之后，
// 而 `busy` 只看 phase，那段时间盘面不翻色、声纹不跳、涟漪不出现。
//
// 面板是 RN 组件，node --test 起不来渲染，所以这里钉的是**源码里的先后顺序**：
// 反馈要早于第一个 await，录音要晚于全部前置。两条一起钉，改的人才不会只顾一头
// —— 只把 `recordPcm` 提前同样"修好"了手感，代价是白亮麦克风灯、被关停的引擎照发请求。

const PANEL = readFileSync(path.join(import.meta.dirname, '../src/screens/MusicRecognition/RecognizePanel.tsx'), 'utf8')

const runBody = (() => {
  const start = PANEL.indexOf('const run = async()')
  assert.ok(start >= 0, 'RecognizePanel.tsx 里找不到 run()，这个测试跟实现脱钩了')
  const end = PANEL.indexOf('\n  const busy =', start)
  assert.ok(end > start, '找不到 run() 的结尾，切片不可信')
  // 这段实现靠注释讲道理，注释里就写着 recordPcm、await 这些词。
  // 整行注释先剥掉，下面的定位才是代码之间的定位。
  return PANEL.slice(start, end).split('\n').filter(line => !line.trim().startsWith('//')).join('\n')
})()

const at = (needle: string): number => {
  const index = runBody.indexOf(needle)
  assert.ok(index >= 0, `run() 里应当有 ${needle}`)
  return index
}

test('按下圆盘的第一时间就进 listening，识别动画不等网络', () => {
  const flip = at("setPhase('listening')")
  assert.ok(flip < at('await guard.check()'), '翻 listening 排在了闸门 await 之后，那就是"按下没反应"的那两三秒')
  assert.equal(runBody.slice(0, flip).includes('await'), false, '翻状态之前还有一个 await，识曲动画就得再等它一程')
})

test('但录音仍然排在全部前置之后：麦克风灯不白亮，被关停的引擎不白跑', () => {
  const record = at('recordPcm(')
  const permission = at('await requestRecordPermission()')
  assert.ok(at('await guard.check()') < record, '冷却判定必须早于录音')
  assert.ok(at('await createActiveEngines()') < record, '引擎装配必须早于录音')
  assert.ok(permission < record, '权限必须早于录音')
  // 这条就是"提前反馈"与"提前录音"的分界线：谁把 recordPcm 挪到翻状态之前，谁就在这里红。
  assert.ok(at("setPhase('listening')") < record)
})
