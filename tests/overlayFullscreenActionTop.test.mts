import test from 'node:test'
import assert from 'node:assert/strict'

import { getFullscreenActionTop } from '../src/components/player/PlayerOverlay/transition.ts'

// 静态全屏页 MusicInfo 的 actionColumn 带 paddingTop: scaleSizeH(2)，
// 喜欢/更多按钮顶部 = 容器顶 + paddingTop；动画层终点必须带上同样的偏移，
// 否则展开动画收尾切换到静态页时按钮会竖向跳变
test('fullscreen action top always includes the action column paddingTop', () => {
  const paddingTop = 2
  // 实测 actionY 是操作列容器自身的 frame y（titleRow alignItems: flex-start 下恒为 0），不含 paddingTop
  assert.equal(getFullscreenActionTop(300, 0, 0, paddingTop), 302)
  // 只有标题测量值可用时的回退路径同样保持 +paddingTop
  assert.equal(getFullscreenActionTop(300, null, 0, paddingTop), 302)
  // 完全没有测量值时
  assert.equal(getFullscreenActionTop(300, null, null, paddingTop), 302)
  // actionY 非 0 时 paddingTop 也要叠加
  assert.equal(getFullscreenActionTop(300, 4, 1, paddingTop), 306)
})
