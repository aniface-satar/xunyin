import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { getOverlayRootPointerEvents } from '../src/components/player/PlayerOverlay/transition.ts'

const overlaySource = readFileSync(
  path.join(import.meta.dirname, '..', 'src/components/player/PlayerOverlay/index.tsx'),
  'utf8',
)

// 转场里卡片整层是 pointerEvents:none（动画期间不让误触子控件），如果根层同时是 box-none，
// 空白处的点就匹配不到 overlay 树里的任何视图，Android 的命中测试会继续找下一个兄弟节点 ——
// 也就是叠在下面的首页/列表页。表现就是"点在播放页空白处，却点开了下面列表里的一行"。
test('overlay 根层在挂载期间自己就是命中目标，空白处不再穿透到下面那一页', () => {
  assert.equal(getOverlayRootPointerEvents(true), 'auto')
  assert.equal(getOverlayRootPointerEvents(false), 'none')
})

test('根层走这条规则，而不是 box-none', () => {
  assert.match(
    overlaySource,
    /ref=\{rootRef\} pointerEvents=\{\(0, require\("\.\/transition"\)\.getOverlayRootPointerEvents\)\(mounted\)\}/,
  )
  assert.doesNotMatch(overlaySource, /ref=\{rootRef\} pointerEvents=\{mounted \? 'box-none' : 'none'\}/)
})

test('根层兜住整屏之后，卡片在转场里仍然不可点', () => {
  assert.match(overlaySource, /pointerEvents: mounted && !isTransitioning \? 'auto' : 'none'/)
})
