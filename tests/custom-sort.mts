import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getCustomSortOffset,
  getCustomSortTargetIndex,
  moveItemToIndex,
} from '../src/screens/Home/Views/Mylist/MusicList/customSort.ts'

const ITEM_HEIGHT = 68

test('向下拖动：被拖歌曲落到目标行，中间的行往前补位', () => {
  assert.deepEqual(moveItemToIndex(['A', 'B', 'C', 'D'], 0, 2), ['B', 'C', 'A', 'D'])
})

test('向上拖动：被拖歌曲插到目标行，中间的行往后让位', () => {
  assert.deepEqual(moveItemToIndex(['A', 'B', 'C', 'D'], 3, 1), ['A', 'D', 'B', 'C'])
})

test('位置没变也返回新数组，避免调用方误把原数组当成已更新', () => {
  const list = ['A', 'B', 'C']
  const result = moveItemToIndex(list, 1, 1)
  assert.deepEqual(result, list)
  assert.notEqual(result, list)
})

test('目标越界时夹到列表两端，来源越界时原样返回副本', () => {
  assert.deepEqual(moveItemToIndex(['A', 'B', 'C', 'D'], 0, 99), ['B', 'C', 'D', 'A'])
  assert.deepEqual(moveItemToIndex(['A', 'B', 'C'], 99, 0), ['A', 'B', 'C'])
})

test('落点下标按浮动行顶部四舍五入，过半行才换位', () => {
  assert.equal(getCustomSortTargetIndex(2, 30, 0, ITEM_HEIGHT, 5), 2)
  assert.equal(getCustomSortTargetIndex(2, 40, 0, ITEM_HEIGHT, 5), 3)
})

test('落点下标把自动滚动带来的内容位移算进去', () => {
  assert.equal(getCustomSortTargetIndex(2, 0, ITEM_HEIGHT, ITEM_HEIGHT, 5), 3)
  assert.equal(getCustomSortTargetIndex(2, -ITEM_HEIGHT, 0, ITEM_HEIGHT, 5), 1)
})

test('落点下标不会越过列表两端', () => {
  assert.equal(getCustomSortTargetIndex(0, -500, 0, ITEM_HEIGHT, 5), 0)
  assert.equal(getCustomSortTargetIndex(4, 500, 0, ITEM_HEIGHT, 5), 4)
  assert.equal(getCustomSortTargetIndex(0, 0, 0, ITEM_HEIGHT, 0), 0)
})

test('往下拖时，来源之后到落点之间的行整体上移一行', () => {
  const offset = (index: number) => getCustomSortOffset(index, 1, 3, ITEM_HEIGHT)
  assert.deepEqual([0, 1, 2, 3, 4].map(offset), [0, 0, -ITEM_HEIGHT, -ITEM_HEIGHT, 0])
})

test('往上拖时，落点到来源之前的行整体下移一行', () => {
  const offset = (index: number) => getCustomSortOffset(index, 3, 1, ITEM_HEIGHT)
  assert.deepEqual([0, 1, 2, 3, 4].map(offset), [0, ITEM_HEIGHT, ITEM_HEIGHT, 0, 0])
})

test('落点等于来源时谁都不让位', () => {
  const offset = (index: number) => getCustomSortOffset(index, 2, 2, ITEM_HEIGHT)
  assert.deepEqual([0, 1, 2, 3].map(offset), [0, 0, 0, 0])
})
