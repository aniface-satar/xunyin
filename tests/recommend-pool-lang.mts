import test from 'node:test'
import assert from 'node:assert/strict'

import { buildFinalQueueItems, capPoolSize, mergePoolCandidates, poolStats, resolvePoolLang } from '../src/core/recommend/candidatePool.ts'
import { createPoolCandidate } from '../src/core/recommend/candidatePool.ts'
import { computeLangTargets, computePoolBucketLimits } from '../src/core/recommend/languageQuota.ts'
import type { ArtistLangTable } from '../src/core/recommend/language.ts'

const entryOf = (over: Record<string, any> = {}) => ({
  musicInfo: {
    id: `kg_${over.songmid ?? 'x'}`,
    name: over.name ?? '喜欢你',
    singer: over.singer ?? '邓紫棋',
    source: over.source ?? 'kg',
    interval: '03:55',
    meta: { songId: over.songmid ?? 'x', albumName: '新的心跳', lang: over.lang ?? null },
  },
})

// now 钉死：capPoolSize 的同分排序靠 addedAt 打破平局，不钉就会随 Date.now() 是否跳毫秒改变扫描顺序
const baseInput = (musicInfo: any) => ({ musicInfo, channel: 'A' as const, sourceId: 'pl-1', now: 1 })

test('resolvePoolLang：已存的 L1 事实优先，其次接口字段、批次提示、歌手表、字面统计', () => {
  const table: ArtistLangTable = { 陈奕迅: { bucket: 'yue', hits: 3, strength: 1, updatedAt: 1 } }
  assert.deepEqual(resolvePoolLang({ lang: 'en', musicInfo: entryOf().musicInfo as any }, table), { bucket: 'en', level: 1 })
  assert.deepEqual(resolvePoolLang({ musicInfo: entryOf({ lang: '粤语' }).musicInfo as any }, table), { bucket: 'yue', level: 1 })
  assert.deepEqual(resolvePoolLang({ langHint: 'ja', musicInfo: entryOf({ singer: '新人' }).musicInfo as any }, table), { bucket: 'ja', level: 2 })
  assert.deepEqual(resolvePoolLang({ artistKeys: ['陈奕迅'], musicInfo: entryOf({ singer: '陈奕迅', name: '富士山下' }).musicInfo as any }, table), { bucket: 'yue', level: 3 })
  assert.deepEqual(resolvePoolLang({ musicInfo: entryOf({ singer: '陌生人', name: '第一封情书' }).musicInfo as any }), { bucket: 'zh', level: 4 })
  assert.deepEqual(resolvePoolLang({ musicInfo: entryOf({ singer: 'New Act', name: 'Yesterday' }).musicInfo as any }), { bucket: 'unknown', level: 0 })
})

test('池桶限额按池规模等比放大并留宽松系数', () => {
  const limits = computePoolBucketLimits({
    targets: computeLangTargets({ zh: 10 }),
    maxSize: 1500,
    windowSize: 20,
    slack: 1.5,
  })
  assert.deepEqual(limits, { zh: 225 })
  assert.deepEqual(computePoolBucketLimits({ targets: computeLangTargets({}), maxSize: 1500, windowSize: 20, slack: 1.5 }), {})
})

test('capPoolSize 无限额时行为与今天完全一致', () => {
  const candidates = Array.from({ length: 12 }, (_, i) =>
    createPoolCandidate(baseInput(entryOf({ songmid: `a${i}`, lang: '粤语' }).musicInfo as any)))
  const capped = capPoolSize(candidates, 10)
  assert.equal(capped.length, 10)
})

test('capPoolSize 按桶限额淘汰：超配桶先出局，缺口由它补位且池子照样凑满', () => {
  const candidates = [
    ...Array.from({ length: 8 }, (_, i) => createPoolCandidate(baseInput(entryOf({ songmid: `z${i}`, lang: '粤语' }).musicInfo as any))),
    ...Array.from({ length: 8 }, (_, i) => createPoolCandidate(baseInput(entryOf({ songmid: `e${i}`, source: 'tx', lang: 5 }).musicInfo as any))),
  ]
  const capped = capPoolSize(candidates, 10, { limits: { yue: 3 } })
  assert.equal(capped.length, 10)
  assert.equal(capped.filter(candidate => candidate.lang == 'yue').length, 3)
  assert.equal(capped.filter(candidate => candidate.lang == 'en').length, 7)
})

test('capPoolSize 的桶由调用方注入，可按读时推导结果判定老候选', () => {
  const candidates = [
    ...Array.from({ length: 6 }, (_, i) => createPoolCandidate(baseInput(entryOf({ songmid: `n${i}`, singer: '陈奕迅', name: '十年' }).musicInfo as any))),
    // 第二组必须是片假名/平假名占多数：像"僕の色"这种汉字多的日文歌名，L4 会按汉字占比判成 zh
    ...Array.from({ length: 6 }, (_, i) => createPoolCandidate(baseInput(entryOf({ songmid: `j${i}`, singer: '山下達郎', name: 'さよならの夏' }).musicInfo as any))),
  ]
  const table: ArtistLangTable = { 陈奕迅: { bucket: 'zh', hits: 4, strength: 1, updatedAt: 1 } }
  const capped = capPoolSize(candidates, 6, {
    limits: { zh: 2 },
    resolveBucket: candidate => resolvePoolLang(candidate, table).bucket,
  })
  assert.equal(capped.length, 6)
  assert.equal(capped.filter(candidate => resolvePoolLang(candidate, table).bucket == 'zh').length, 2)
})

test('buildFinalQueueItems 用读时推导填 lang，并带出命中级别', () => {
  const table: ArtistLangTable = { 陈奕迅: { bucket: 'yue', hits: 3, strength: 1, updatedAt: 1 } }
  const candidates = [
    createPoolCandidate(baseInput(entryOf({ songmid: 'l1', lang: '英语' }).musicInfo as any)),
    createPoolCandidate(baseInput(entryOf({ songmid: 'l3', singer: '陈奕迅', name: '好久不见' }).musicInfo as any)),
    createPoolCandidate(baseInput(entryOf({ songmid: 'l4', singer: '陌生人', name: '第一封情书' }).musicInfo as any)),
  ]
  const items = buildFinalQueueItems(candidates, { artistLangTable: table })
  assert.deepEqual(items.map(item => item.lang), ['en', 'yue', 'zh'])
  assert.deepEqual(items.map(item => item.langLevel), [1, 3, 4])
})

test('poolStats 报出池内语种分布', () => {
  const candidates = [
    createPoolCandidate(baseInput(entryOf({ songmid: 'p1', lang: '粤语' }).musicInfo as any)),
    createPoolCandidate(baseInput(entryOf({ songmid: 'p2', lang: '粤语' }).musicInfo as any)),
    createPoolCandidate(baseInput(entryOf({ songmid: 'p3', singer: 'New Act', name: 'Yesterday' }).musicInfo as any)),
  ]
  const stats = poolStats(candidates)
  assert.equal(stats.total, 3)
  assert.deepEqual(stats.byLang, { yue: 2, unknown: 1 })
})

test('mergePoolCandidates 把限额透传给合并后的裁剪：超配的旧候选给缺货的新候选让位', () => {
  // 每首都要独立的歌名：buildTrackKey 只认 name+singer（trackKey.ts），同名会被合并成一条
  const zhOld = Array.from({ length: 6 }, (_, i) =>
    createPoolCandidate(baseInput(entryOf({ songmid: `o${i}`, name: `老中文${i}`, lang: '国语' }).musicInfo as any)))
  const enNew = Array.from({ length: 6 }, (_, i) =>
    createPoolCandidate(baseInput(entryOf({ songmid: `n${i}`, source: 'tx', name: `New Track ${i}`, singer: 'Ada', lang: 5 }).musicInfo as any)))
  const merged = mergePoolCandidates(zhOld, enNew, 6, { limits: { zh: 2 } })
  assert.equal(merged.length, 6)
  assert.equal(merged.filter(candidate => candidate.lang == 'zh').length, 2)
  assert.equal(merged.filter(candidate => candidate.lang == 'en').length, 4)
})

test('derive-on-read 只读不写：推导一轮之后候选对象一个键都没多', () => {
  const candidates = [
    createPoolCandidate(baseInput(entryOf({ songmid: 'w1', singer: '陌生人', name: '第一封情书' }).musicInfo as any)),
    createPoolCandidate(baseInput(entryOf({ songmid: 'w2', singer: '山下達郎', name: '僕の色' }).musicInfo as any)),
  ]
  // 深拷一份键清单做对照：任何往 candidate.lang / candidate.langHint 上"顺手补一下"的写法都会在这里被抓到
  const before = candidates.map(candidate => Object.keys(candidate).sort().join(','))
  const snapshot = candidates.map(candidate => ({ lang: candidate.lang, langHint: candidate.langHint }))
  const table: ArtistLangTable = { 陌生人: { bucket: 'zh', hits: 2, strength: 1, updatedAt: 1 } }
  resolvePoolLang(candidates[0], table)
  resolvePoolLang(candidates[1], table)
  capPoolSize(candidates, 2, { limits: { zh: 1 }, resolveBucket: candidate => resolvePoolLang(candidate, table).bucket })
  buildFinalQueueItems(candidates, { artistLangTable: table })
  assert.deepEqual(candidates.map(candidate => Object.keys(candidate).sort().join(',')), before)
  assert.deepEqual(candidates.map(candidate => ({ lang: candidate.lang, langHint: candidate.langHint })), snapshot)
})
