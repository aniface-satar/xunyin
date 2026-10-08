import test from 'node:test'
import assert from 'node:assert/strict'

import { getMorphSeparatorRect, getMorphSeparatorFadeConfig } from '../src/components/player/PlayerOverlay/transition.ts'

// 静态底部栏是一整段 "歌名 - 歌手"，morph 层的标题/歌手是两个独立盒子，
// 中间空出来的位置就是 " - "；收尾时必须按测量值补回这段连接符，
// 否则动画结束、overlay 卸载的那一帧连接符会凭空跳出
const COLUMN_RIGHT = 801

test('bar separator box is derived from the measured title and artist rects', () => {
  const title = { x: 100, y: 0, width: 200, height: 20 }
  assert.deepEqual(getMorphSeparatorRect(title, { x: 321, y: 0, width: 80, height: 20 }, COLUMN_RIGHT), {
    left: 300,
    width: 21,
  })
})

test('bar separator collapses to zero width when nothing separates title and artist', () => {
  const title = { x: 100, y: 0, width: 200, height: 20 }
  // 标题与歌手紧贴
  assert.equal(getMorphSeparatorRect(title, { x: 300, y: 0, width: 80, height: 20 }, COLUMN_RIGHT).width, 0)
  // 长标题被夹取后歌手被推到标题右缘之内，宽度不得为负
  const rect = getMorphSeparatorRect(title, { x: 250, y: 0, width: 80, height: 20 }, COLUMN_RIGHT)
  assert.equal(rect.width, 0)
  assert.equal(rect.left, 300)
})

// 真机实测：歌名长到占满文字栏时，歌手盒子的自然位置在栏外，
// 不夹住文字栏右缘的话连接符会画到 819-834，孤零零一颗短横压在上一曲按钮前面
test('bar separator never reaches past the text column when a long title fills it', () => {
  const title = { x: 213, y: 0, width: COLUMN_RIGHT - 213, height: 20 }
  const rect = getMorphSeparatorRect(title, { x: 950, y: 0, width: 200, height: 20 }, COLUMN_RIGHT)
  assert.equal(rect.left, COLUMN_RIGHT)
  assert.equal(rect.width, 0)
})

test('bar separator fades in across the text travel and holds at the bar end state', () => {
  const thresholds = [0, 0.05, 0.6, 1]
  assert.deepEqual(getMorphSeparatorFadeConfig(thresholds), {
    inputRange: thresholds,
    outputRange: [0, 0, 1, 1],
  })
})
