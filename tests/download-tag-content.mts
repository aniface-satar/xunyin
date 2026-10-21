import test from 'node:test'
import assert from 'node:assert/strict'

import { buildTagContent, toLrcText } from '../src/core/download/tagContent.ts'

const musicInfo = (over: Record<string, unknown> = {}) => ({
  id: 'song_1',
  name: '晴天',
  singer: '周杰伦',
  source: 'wy',
  interval: '04:29',
  meta: { albumName: '叶惠美' },
  ...over,
})

test('tag content carries the title, artist and album the player pages show', () => {
  assert.deepEqual(buildTagContent(musicInfo()), {
    name: '晴天',
    singer: '周杰伦',
    albumName: '叶惠美',
  })
})

test('a missing album becomes an empty field, never undefined', () => {
  const info = musicInfo()
  delete (info as { meta: { albumName?: string } }).meta.albumName
  assert.deepEqual(buildTagContent(info), { name: '晴天', singer: '周杰伦', albumName: '' })
})

test('lrc lines keep their timestamps and lose the per-word marks', () => {
  const raw = '[00:01.00]词：周杰伦\n[01:13.25]<0,514>重<514,300>檐<814,1300>下\n'
  assert.equal(toLrcText(raw), '[00:01.00]词：周杰伦\n[01:13.25]重檐下')
})

test('lyric text without any timestamp line is not written into the file', () => {
  assert.equal(toLrcText('这是一段没有时间轴的纯文本'), '')
  assert.equal(toLrcText(''), '')
  assert.equal(toLrcText(null), '')
})
