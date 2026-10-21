import test from 'node:test'
import assert from 'node:assert/strict'

import { buildLyricCopyText, hasLyricText, invertLyricSelection, pickLyricLinesForCopy, selectAllLyricLines } from '../src/core/lyricCopy.ts'

const threeLines = [
  { text: '徘徊着的 在路上的', extendedLyrics: [] },
  { text: '', extendedLyrics: [] },
  { text: '你要走吗 via via', extendedLyrics: [] },
]

test('copies lyric lines in screen order without time tags', () => {
  const lines = [
    { text: '徘徊着的 在路上的', extendedLyrics: [] },
    { text: '你要走吗 via via', extendedLyrics: [] },
  ]
  assert.equal(buildLyricCopyText(lines), '徘徊着的 在路上的\n你要走吗 via via')
})

test('copies only the lyric body, never the title or the singer', () => {
  const lines = [{ text: '徘徊着的 在路上的', extendedLyrics: [] }]
  assert.equal(buildLyricCopyText(pickLyricLinesForCopy(lines, new Set([0]))), '徘徊着的 在路上的')
  assert.ok(!buildLyricCopyText(lines).includes('平凡之路'))
})

test('keeps the translation right below its own line', () => {
  const lines = [
    { text: '徘徊着的 在路上的', extendedLyrics: ['Wandering, on the road'] },
    { text: '你要走吗 via via', extendedLyrics: [] },
  ]
  assert.equal(buildLyricCopyText(lines), '徘徊着的 在路上的\nWandering, on the road\n你要走吗 via via')
})

test('drops instrumental blank lines', () => {
  const lines = [
    { text: '徘徊着的 在路上的', extendedLyrics: [] },
    { text: '', extendedLyrics: [] },
    { text: '   ', extendedLyrics: ['', '  '] },
    { text: '你要走吗 via via', extendedLyrics: [] },
  ]
  assert.equal(buildLyricCopyText(lines), '徘徊着的 在路上的\n你要走吗 via via')
})

test('falls back to the translation when the main line is empty', () => {
  const lines = [{ text: '', extendedLyrics: ['Wandering, on the road'] }]
  assert.equal(buildLyricCopyText(lines), 'Wandering, on the road')
})

test('returns empty text when there is no lyric at all', () => {
  assert.equal(buildLyricCopyText([]), '')
  assert.equal(buildLyricCopyText([{ text: '', extendedLyrics: [] }]), '')
})

test('keeps the original lyric order instead of the tap order', () => {
  const lines = [
    { text: '徘徊着的 在路上的', extendedLyrics: [] },
    { text: '你要走吗 via via', extendedLyrics: [] },
    { text: '易碎的 骄傲着', extendedLyrics: [] },
  ]
  assert.deepEqual(pickLyricLinesForCopy(lines, new Set([2, 0])).map(l => l.text), ['徘徊着的 在路上的', '易碎的 骄傲着'])
})

test('copies nothing when nothing is selected', () => {
  assert.deepEqual(pickLyricLinesForCopy(threeLines, new Set()), [])
  assert.equal(buildLyricCopyText(pickLyricLinesForCopy(threeLines, new Set())), '')
})

test('takes the translation along with its own line', () => {
  const lines = [
    { text: '徘徊着的 在路上的', extendedLyrics: ['Wandering, on the road'] },
    { text: '你要走吗 via via', extendedLyrics: ['Are you leaving, via via'] },
  ]
  assert.equal(buildLyricCopyText(pickLyricLinesForCopy(lines, new Set([1]))), '你要走吗 via via\nAre you leaving, via via')
})

test('selecting only a blank line copies nothing', () => {
  assert.equal(buildLyricCopyText(pickLyricLinesForCopy(threeLines, new Set([1]))), '')
})

test('recognises a line that only carries a translation', () => {
  assert.equal(hasLyricText({ text: '', extendedLyrics: [] }), false)
  assert.equal(hasLyricText({ text: '   ', extendedLyrics: ['', '  '] }), false)
  assert.equal(hasLyricText({ text: '', extendedLyrics: ['Wandering, on the road'] }), true)
  assert.equal(hasLyricText({ text: '徘徊着的 在路上的' }), true)
})

test('select all marks the lines that actually carry text', () => {
  assert.deepEqual([...selectAllLyricLines(threeLines)], [0, 2])
  assert.deepEqual([...selectAllLyricLines([])], [])
})

test('invert takes the complement inside the lines that carry text', () => {
  assert.deepEqual([...invertLyricSelection(threeLines, new Set())], [0, 2])
  assert.deepEqual([...invertLyricSelection(threeLines, selectAllLyricLines(threeLines))], [])
  assert.deepEqual([...invertLyricSelection(threeLines, new Set([0]))], [2])
  // 空白行既不会被选中也不会被反选点亮
  assert.equal(invertLyricSelection(threeLines, new Set([1])).has(1), false)
})
