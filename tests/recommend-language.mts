import test from 'node:test'
import assert from 'node:assert/strict'

import type { ArtistLangTable } from '../src/core/recommend/language.ts'
import {
  LANG_BUCKETS,
  QUOTA_LANG_BUCKETS,
  mapKgLanguageWord,
  mapTxLanguageCode,
  bucketFromLangField,
  countLangChars,
  bucketFromScript,
  bucketFromLyric,
  updateArtistLangTable,
  resolveLang,
} from '../src/core/recommend/language.ts'

test('bucket sets: quota buckets exclude instr and unknown', () => {
  assert.deepEqual([...LANG_BUCKETS], ['zh', 'yue', 'en', 'ja', 'ko', 'other', 'instr', 'unknown'])
  assert.deepEqual([...QUOTA_LANG_BUCKETS], ['zh', 'yue', 'en', 'ja', 'ko', 'other'])
})

test('kg language words map by exact trimmed chinese word', () => {
  assert.equal(mapKgLanguageWord('国语'), 'zh')
  assert.equal(mapKgLanguageWord(' 粤语 '), 'yue')
  assert.equal(mapKgLanguageWord('英语'), 'en')
  assert.equal(mapKgLanguageWord('日语'), 'ja')
  assert.equal(mapKgLanguageWord('韩语'), 'ko')
  assert.equal(mapKgLanguageWord('西班牙语'), 'other')
  assert.equal(mapKgLanguageWord('法语'), 'other')
  // 不认识的词不许猜：交回下一级，最终由 resolveLang 落 unknown
  assert.equal(mapKgLanguageWord('自译解词'), null)
  assert.equal(mapKgLanguageWord(null), null)
})

test('tx numeric language codes map and mixed-semantics codes return null', () => {
  assert.equal(mapTxLanguageCode(0), 'zh')
  assert.equal(mapTxLanguageCode(1), 'yue')
  assert.equal(mapTxLanguageCode(3), 'ja')
  assert.equal(mapTxLanguageCode(4), 'ko')
  assert.equal(mapTxLanguageCode('5'), 'en')
  assert.equal(mapTxLanguageCode(6), 'other')
  assert.equal(mapTxLanguageCode(13), 'other')
  assert.equal(mapTxLanguageCode(16), 'other')
  assert.equal(mapTxLanguageCode(24), 'other')
  // 7=中英交替、8=自译解词、11/12/15 实测不符实际：宁缺毋滥
  assert.equal(mapTxLanguageCode(7), null)
  assert.equal(mapTxLanguageCode(8), null)
  assert.equal(mapTxLanguageCode(12), null)
  assert.equal(mapTxLanguageCode(99), null)
  assert.equal(mapTxLanguageCode(null), null)
})

test('bucketFromLangField dispatches by source only', () => {
  assert.equal(bucketFromLangField('tx', 1), 'yue')
  assert.equal(bucketFromLangField('kg', '粤语'), 'yue')
  assert.equal(bucketFromLangField('wy', '粤语'), null)
  assert.equal(bucketFromLangField(undefined, 1), null)
})

test('countLangChars ignores digits, spaces and punctuation', () => {
  const c = countLangChars('晴天 2004, Jay Chou（周杰伦）')
  assert.equal(c.han, 5)
  assert.equal(c.latin, 7)
  assert.equal(c.letters, 12)
})

test('bucketFromScript pins ja/ko/zh/other and refuses to guess en', () => {
  assert.equal(bucketFromScript('First Love', '宇多田ヒカル'), 'ja')
  assert.equal(bucketFromScript('Dynamite', 'BTS(방탄소년단)'), 'ko')
  assert.equal(bucketFromScript('告白气球', '周杰伦'), 'zh')
  assert.equal(bucketFromScript('Despacito', 'Luis Fonsi'), null)
  // 纯拉丁不判 en（翻唱率最高，误判代价最大）
  assert.equal(bucketFromScript('Shape of You', 'Ed Sheeran'), null)
  // 西里尔等非拉丁非中日韩文字走 otherLetter 占比通道
  assert.equal(bucketFromScript('Bello', 'Михаил Круг'), 'other')
  assert.equal(bucketFromScript('1234', ''), null)
})

test('bucketFromLyric uses lyric body, not the filename', () => {
  const zh = '[00:00.00]作词：林夕\n[00:01.00]作曲：C.Y.Kong\n[00:02.00]风雨里做一个天真的梦'
  assert.equal(bucketFromLyric(zh), 'zh')
  const en = '[00:00.00]Baby we could drive forever tonight'
  assert.equal(bucketFromLyric(en), 'en')
  // 拿不到歌词 ≠ 纯音乐
  assert.equal(bucketFromLyric(null, 'Shape of You'), null)
  assert.equal(bucketFromLyric('', 'Shape of You'), null)
  assert.equal(bucketFromLyric('', '卡农（纯音乐）'), 'instr')
  // 曲名只是包含 inst 这个子串，不算显式标记
  assert.equal(bucketFromLyric('', 'Instinct'), null)
  assert.equal(bucketFromLyric('  \n[00:00.00]\n', 'Canon in D'), null)
})

test('bucketFromLyric recognises cantonese function words', () => {
  const yue = '[00:01.00]嘅世界越似呢个梦\n[00:03.00]唔想讲 冇办法讲'
  assert.equal(bucketFromLyric(yue), 'yue')
})

test('updateArtistLangTable: strength beats hits, same strength votes by hits', () => {
  const table: ArtistLangTable = {}
  updateArtistLangTable(table, ['周杰伦'], 'zh', 'lyric', 500, 1000)
  updateArtistLangTable(table, ['周杰伦'], 'zh', 'lyric', 500, 1001)
  assert.equal(table['周杰伦'].bucket, 'zh')
  assert.equal(table['周杰伦'].hits, 2)
  // 同强度反向票：hits 递减，不清零桶
  updateArtistLangTable(table, ['周杰伦'], 'en', 'lyric', 500, 1002)
  assert.equal(table['周杰伦'].bucket, 'zh')
  assert.equal(table['周杰伦'].hits, 1)
  updateArtistLangTable(table, ['周杰伦'], 'en', 'lyric', 500, 1003)
  assert.equal(table['周杰伦'].bucket, 'zh')
  assert.equal(table['周杰伦'].hits, 0)
  // 高强度直接覆盖
  updateArtistLangTable(table, ['周杰伦'], 'en', 'field', 500, 1004)
  assert.equal(table['周杰伦'].bucket, 'en')
  assert.equal(table['周杰伦'].strength, 2)
  // unknown 不入库
  updateArtistLangTable(table, ['新人'], 'unknown', 'lyric', 500, 1005)
  assert.equal(table['新人'], undefined)
})

test('updateArtistLangTable evicts the weakest entry past the limit', () => {
  const table: ArtistLangTable = {}
  updateArtistLangTable(table, ['A'], 'zh', 'lyric', 2, 1)
  updateArtistLangTable(table, ['A'], 'zh', 'lyric', 2, 2)
  updateArtistLangTable(table, ['B'], 'en', 'lyric', 2, 3)
  updateArtistLangTable(table, ['C'], 'ja', 'lyric', 2, 4)
  assert.equal(Object.keys(table).length, 2)
  // 淘汰的是得票最低的那位（B、C 都只有 1 票，B 更旧所以先走）；A 有 2 票必须留下
  assert.equal(table.B, undefined)
  assert.equal(table.A.bucket, 'zh')
  assert.equal(table.A.hits, 2)
  assert.equal(table.C.bucket, 'ja')
})

test('resolveLang runs L1 -> L2 -> L3 -> L4 and lands on unknown', () => {
  const table: ArtistLangTable = { 陈奕迅: { bucket: 'yue', hits: 3, strength: 1, updatedAt: 1 } }
  assert.deepEqual(resolveLang({ source: 'tx', langField: 0, name: '十年', singer: '陈奕迅' }, table), { bucket: 'zh', level: 1 })
  assert.deepEqual(resolveLang({ name: 'Something', singer: 'New Artist', langHint: 'en' }, table), { bucket: 'en', level: 2 })
  // L3 只认 artistKeys（候选上的归一化歌手键），不认 singer 原串
  assert.deepEqual(resolveLang({ name: '浮夸', singer: '陈奕迅', artistKeys: ['陈奕迅'] }, table), { bucket: 'yue', level: 3 })
  assert.deepEqual(resolveLang({ name: '第一封情书', singer: '陌生人' }), { bucket: 'zh', level: 4 })
  assert.deepEqual(resolveLang({ name: 'Yesterday', singer: 'The Beatles' }), { bucket: 'unknown', level: 0 })
})
