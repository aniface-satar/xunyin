import test from 'node:test'
import assert from 'node:assert/strict'

import { CARD_MAX_HEIGHT_RATIO, CARD_WIDTH_RATIO, RATIO_OPTIONS, cardScale, shotRect } from '../src/components/ShareCard/cardScale.ts'

// 2026-10-17 用户定的那套：全屏档那张卡是"基准整体"，其它比例只把这个整体等比缩到画布里并居中，
// 卡内内容的大小比例一律不动。所以缩放因子只能由画布矩形决定，且必须两轴同一个数（等比）。
// 屏幕按 vivo 的 360×800dp 取值：基准卡盒 = 360×0.78 宽、800×0.62 高。

const MASTER = { masterWidth: 360, masterHeight: 800 }
const BOX_W = MASTER.masterWidth * CARD_WIDTH_RATIO
const BOX_H = MASTER.masterHeight * CARD_MAX_HEIGHT_RATIO

test('fullscreen canvas keeps the master card at exactly 1', () => {
  assert.equal(cardScale({ rectWidth: MASTER.masterWidth, rectHeight: MASTER.masterHeight, ...MASTER }), 1)
})

test('the factor never grows past 1: the fullscreen card is the largest one', () => {
  // 画布给得比屏幕还宽（理论上不会发生，但封顶就是这条判据的定义）：卡片不能放大过基准整体。
  assert.equal(cardScale({ rectWidth: 400, rectHeight: 900, ...MASTER }), 1)
})

test('a short canvas is bound by height: the whole card shrinks by that one factor', () => {
  const rectHeight = 416
  const rectWidth = 312
  const scale = cardScale({ rectWidth, rectHeight, ...MASTER })
  assert.equal(scale, rectHeight / BOX_H)
})

test('a narrow canvas is bound by width', () => {
  const rectWidth = 200
  const scale = cardScale({ rectWidth, rectHeight: 700, ...MASTER })
  assert.equal(scale, rectWidth / BOX_W)
})

test('the scaled card box always fits the canvas without cropping', () => {
  for (const [rectWidth, rectHeight] of [[312, 468], [312, 416], [312, 554], [360, 800]]) {
    const scale = cardScale({ rectWidth, rectHeight, ...MASTER })
    assert.ok(BOX_W * scale <= rectWidth + 1e-9, `width overflows at ${rectWidth}x${rectHeight}`)
    assert.ok(BOX_H * scale <= rectHeight + 1e-9, `height overflows at ${rectWidth}x${rectHeight}`)
  }
})

test('the factor is the largest fitting one, so the card is as big as the frame allows', () => {
  const rectWidth = 312
  const rectHeight = 416
  const scale = cardScale({ rectWidth, rectHeight, ...MASTER })
  // 再大一档就要裁卡：高的那一条先顶到边。
  assert.ok(BOX_H * (scale + 1e-6) > rectHeight)
  assert.ok(BOX_W * scale < rectWidth)
})

// 2026-10-17 第二次改口径（用户指定）：比例**只改长度**，被拍面的宽恒等于屏宽。
// 旧算法是把矩形钳进"屏幕减去头部/底部控件"的可用区，于是宽也会跟着比例一起缩。
// 代价写在 spec/注释里：9:16 与全屏那两档面会伸到按钮底下，导出图不受影响。

test('every ratio keeps the captured width at exactly the screen width', () => {
  for (const { key } of RATIO_OPTIONS) {
    assert.equal(shotRect(key, 360, 800).width, 360, `${key} 档的宽应当恒等于屏宽`)
  }
})

test('only the length changes with the ratio', () => {
  assert.equal(shotRect('2:3', 360, 800).height, 360 * 3 / 2)
  assert.equal(shotRect('5:7', 360, 800).height, 360 * 7 / 5)
  assert.equal(shotRect('3:4', 360, 800).height, 360 * 4 / 3)
  assert.equal(shotRect('9:16', 360, 800).height, 360 * 16 / 9)
  // 全屏档不吃比例：长就是屏长。
  assert.equal(shotRect('fullscreen', 360, 800).height, 800)
})

test('5:7 is offered between 2:3 and 3:4', () => {
  assert.deepEqual(RATIO_OPTIONS.map(o => o.key), ['2:3', '5:7', '3:4', '9:16', 'fullscreen'])
  assert.deepEqual(RATIO_OPTIONS.find(o => o.key === '5:7'), { key: '5:7', w: 5, h: 7 })
})

test('with width pinned to the screen the card mostly stays at master size', () => {
  // 这条钉的是新几何的实质后果：面只变短、不变窄，所以基准卡盒基本放得下，k=1；
  // 只有把面压到比卡盒还矮的那一档（3:4）才需要缩。
  const scaleFor = (key: '2:3' | '5:7' | '3:4' | '9:16' | 'fullscreen') => {
    const rect = shotRect(key, 360, 800)
    return cardScale({ rectWidth: rect.width, rectHeight: rect.height, masterWidth: 360, masterHeight: 800 })
  }
  assert.equal(scaleFor('2:3'), 1)
  assert.equal(scaleFor('5:7'), 1)
  assert.equal(scaleFor('9:16'), 1)
  assert.equal(scaleFor('fullscreen'), 1)
  const threeFour = scaleFor('3:4')
  assert.ok(threeFour < 1 && threeFour > 0.95, `3:4 只该轻微缩，实际 ${threeFour}`)
})
