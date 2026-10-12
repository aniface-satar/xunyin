import test from 'node:test'
import assert from 'node:assert/strict'

import { createPoolCandidate, mergePoolCandidates } from '../src/core/recommend/candidatePool.ts'

const musicInfoOf = (over: Record<string, any>) => ({
  id: `kg_${over.songmid ?? 'x'}`,
  name: over.name ?? '喜欢你',
  singer: over.singer ?? '邓紫棋',
  source: over.source ?? 'kg',
  interval: '03:55',
  meta: { songId: over.songmid ?? 'x', albumName: '新的心跳', lang: over.lang, ...over.meta },
})

const baseInput = (musicInfo: any) => ({
  musicInfo,
  channel: 'A' as const,
  sourceId: 'pl-1',
})

test('createPoolCandidate maps kg chinese language word into lang bucket', () => {
  const candidate = createPoolCandidate(baseInput(musicInfoOf({ lang: '粤语' })))
  assert.equal(candidate.lang, 'yue')
})

test('createPoolCandidate maps tx numeric language code into lang bucket', () => {
  const candidate = createPoolCandidate(baseInput(musicInfoOf({ source: 'tx', lang: 1 })))
  assert.equal(candidate.lang, 'yue')
})

test('createPoolCandidate omits lang when the source value is unusable', () => {
  const candidate = createPoolCandidate(baseInput(musicInfoOf({ lang: '自译解词' })))
  assert.equal(candidate.lang, undefined)
  assert.equal('lang' in candidate, false)
})

test('createPoolCandidate keeps langHint from the batch it came from', () => {
  const candidate = createPoolCandidate({ ...baseInput(musicInfoOf({ lang: null })), langHint: 'en' })
  assert.equal(candidate.langHint, 'en')
})

test('mergePoolCandidates takes the newer L1 fact and keeps the first langHint', () => {
  const hinted = createPoolCandidate({ ...baseInput(musicInfoOf({ lang: null, songmid: 'a1' })), langHint: 'ja' })
  const known = createPoolCandidate(baseInput(musicInfoOf({ lang: '粤语', songmid: 'a1' })))
  const [merged] = mergePoolCandidates([hinted], [known])
  assert.equal(merged.lang, 'yue')
  // 已有 langHint 时不被后来批次覆盖
  assert.equal(merged.langHint, 'ja')
})

test('mergePoolCandidates lets a later L1 fact win over an older one', () => {
  const old = createPoolCandidate(baseInput(musicInfoOf({ lang: '国语', songmid: 'a2' })))
  const fresh = createPoolCandidate(baseInput(musicInfoOf({ lang: '粤语', songmid: 'a2' })))
  const [merged] = mergePoolCandidates([old], [fresh])
  assert.equal(merged.lang, 'yue')
})

test('mergePoolCandidates keeps langHint from incoming when existing has none', () => {
  const bare = createPoolCandidate(baseInput(musicInfoOf({ lang: '国语', songmid: 'a3' })))
  const hinted = createPoolCandidate({ ...baseInput(musicInfoOf({ lang: null, songmid: 'a3' })), langHint: 'en' })
  const [merged] = mergePoolCandidates([bare], [hinted])
  assert.equal(merged.lang, 'zh')
  assert.equal(merged.langHint, 'en')
})

test('mergePoolCandidates keeps the lang key absent when neither side knows it', () => {
  const bare = createPoolCandidate(baseInput(musicInfoOf({})))
  const [merged] = mergePoolCandidates([bare], [createPoolCandidate(baseInput(musicInfoOf({})))])
  assert.equal('lang' in merged, false)
  assert.equal('langHint' in merged, false)
})

test('mergePoolCandidates output survives a JSON round trip', () => {
  // 候选池落盘是整池 JSON 重写，所以"键缺席"必须能穿过序列化仍然是缺席
  // trackKey 只由 name+singer 决定，所以两首必须用不同歌名才真的是池里的两条候选
  const known = createPoolCandidate(baseInput(musicInfoOf({ songmid: 'a', name: '喜欢你', lang: '粤语' })))
  const bare = createPoolCandidate(baseInput(musicInfoOf({ songmid: 'b', name: '泡沫' })))
  const revived = JSON.parse(JSON.stringify(mergePoolCandidates([known], [bare])))
  assert.equal(revived.length, 2)
  const withLang = revived.find((c: any) => c.musicInfo.id == 'kg_a')
  const withoutLang = revived.find((c: any) => c.musicInfo.id == 'kg_b')
  assert.equal(withLang.lang, 'yue')
  assert.equal('lang' in withoutLang, false)
})
