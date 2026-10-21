import test from 'node:test'
import assert from 'node:assert/strict'

import { getBackdropFrame, getCardMorphTransformRange } from '../src/components/player/PlayerOverlay/transition.ts'

// 真机实测（vivo V2302A，1260×2800，3.5px/dp）：展开播放页只有屏幕顶部 y=0..400px 带上封面色，
// 下方整片是卡片白底。400px = 114dp = winHeight(800dp) - bar.y(685.7dp)，
// 正是旧实现把背景层按 -bar.y 上推之后还留在屏幕里的那一截。
// 主题背景图（bg-image）走同一个背景层，所以带背景图的主题有一样的症状。
const WINDOW = { width: 360, height: 800 }
const BAR = { x: 0, y: 685.714, width: 360, height: 114.286 }

test('backdrop box is the card itself and carries no slide of its own', () => {
  assert.deepEqual(getBackdropFrame(WINDOW.width, WINDOW.height), {
    position: 'absolute',
    left: 0,
    top: 0,
    width: WINDOW.width,
    height: WINDOW.height,
  })
})

test('expanded endpoint paints the card from the top edge down to the bottom edge', () => {
  const card = getCardMorphTransformRange({
    bar: BAR,
    windowHeight: WINDOW.height,
    windowWidth: WINDOW.width,
  }).from
  const frame = getBackdropFrame(WINDOW.width, WINDOW.height)
  assert.equal(card.translateY + frame.top * card.scaleY, 0)
  assert.equal(card.translateY + frame.height * card.scaleY, WINDOW.height)
})
