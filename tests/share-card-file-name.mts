import test from 'node:test'
import assert from 'node:assert/strict'

import { cardFileName } from '../src/utils/shareCard/cardFileName.ts'

test('joins name and singer with a separator', () => {
  assert.equal(cardFileName('平凡之路', '朴树'), '平凡之路 - 朴树')
})

test('drops characters the filesystem refuses', () => {
  // 非法字符直接去掉（不是替换成下划线），剩下的字不动
  assert.equal(cardFileName('A/B:C*D?E"F<G>H|I', '朴树'), 'ABCDEFGHI - 朴树')
})

test('falls back to the title alone when the singer is empty', () => {
  assert.equal(cardFileName('平凡之路', ''), '平凡之路')
  assert.equal(cardFileName('平凡之路', '   '), '平凡之路')
})

test('truncates very long titles so the path stays writable', () => {
  const long = '字'.repeat(400)
  assert.ok(cardFileName(long, '歌手').length <= 80)
})

test('collapses the whitespace left behind by stripped characters', () => {
  assert.equal(cardFileName('歌 名', 'A  B'), '歌 名 - A B')
})
