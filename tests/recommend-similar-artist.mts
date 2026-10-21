import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applySimilarArtistOutcome,
  completeSimilarArtistTask,
  createSimilarArtistTask,
  inferArtistLangFromTags,
  nextSimilarArtistAction,
  normalizeSimilarArtistCache,
  parseListenBrainzSimilar,
  parseMusicBrainzArtistLookup,
  parseMusicBrainzArtistSearch,
  pickCachedSimilarArtistRecord,
  pickSimilarArtistSeed,
  planCachedSongFetches,
  runSimilarArtistRefresh,
} from '../src/core/recommend/similarArtist.ts'
import type {
  SimilarArtistCache,
  SimilarArtistIo,
  SimilarArtistPolicy,
  SimilarArtistRecord,
} from '../src/core/recommend/similarArtist.ts'
import { resolveLang, updateArtistLangTable } from '../src/core/recommend/language.ts'
import type { ArtistLangTable } from '../src/core/recommend/language.ts'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const policy: SimilarArtistPolicy = {
  aliasLookups: 3,
  songFetchesPerRun: 3,
  cacheTtlMs: 30 * DAY,
  cacheLimit: 200,
  cacheReuseCooldownMs: 6 * HOUR,
}

const emptyCache = (): SimilarArtistCache => ({ byArtist: {}, pending: {} })

const mbArtist = (name: string, mbid = `mbid-${name}`, tags: string[] = []) => ({
  mbid,
  name,
  aliases: [] as string[],
  tags,
})

const record = (overrides: Partial<SimilarArtistRecord> = {}): SimilarArtistRecord => ({
  similar: [{ mbid: 'm1', name: 'a' }, { mbid: 'm2', name: 'b' }, { mbid: 'm3', name: 'c' }, { mbid: 'm4', name: 'd' }],
  source: 'musicbrainz+listenbrainz',
  fetchedAt: 1000,
  nextIndex: 0,
  songsFetchedAt: 0,
  ...overrides,
})

test('MB 搜索解析取首位艺人，别名与标签都收成字符串数组', () => {
  const parsed = parseMusicBrainzArtistSearch({
    artists: [{
      id: 'a223958d-5c56-4b2c-a30a-87e357bc121b',
      name: '周杰倫',
      country: 'TW',
      aliases: [{ name: '周杰伦', locale: 'zh_Hans' }, { name: 'ジェイ・チョウ', locale: 'ja' }],
      tags: [{ name: 'mandarin', count: 3 }, { name: 'taiwanese pop', count: 1 }],
    }],
  })
  assert.deepEqual(parsed, {
    mbid: 'a223958d-5c56-4b2c-a30a-87e357bc121b',
    name: '周杰倫',
    aliases: ['周杰伦', 'ジェイ・チョウ'],
    tags: ['mandarin', 'taiwanese pop'],
  })
  assert.equal(parseMusicBrainzArtistSearch({ artists: [] }), null)
  assert.equal(parseMusicBrainzArtistSearch({}), null)
  assert.equal(parseMusicBrainzArtistSearch(null), null)
})

test('MB 单艺人反查解析结果同形，缺 id 视为没查到', () => {
  assert.deepEqual(parseMusicBrainzArtistLookup({
    id: 'm1',
    name: '方大同',
    aliases: [{ name: 'Khalil Fong' }],
    tags: [{ name: 'mandarin' }],
  }), { mbid: 'm1', name: '方大同', aliases: ['Khalil Fong'], tags: ['mandarin'] })
  assert.equal(parseMusicBrainzArtistLookup({ name: '没有 id' }), null)
  assert.equal(parseMusicBrainzArtistLookup([]), null)
})

test('LB 相似歌手按分数降序、按 mbid 去重，脏条目直接丢', () => {
  const parsed = parseListenBrainzSimilar([
    { artist_mbid: 'b', name: 'B', score: 50 },
    { artist_mbid: 'a', name: 'A', score: 90 },
    { artist_mbid: 'a', name: 'A 的另一个名字', score: 70 },
    { artist_mbid: '', name: '没有 id', score: 99 },
    null,
    'oops',
  ])
  assert.deepEqual(parsed, [
    { mbid: 'a', name: 'A', score: 90 },
    { mbid: 'b', name: 'B', score: 50 },
  ])
  assert.deepEqual(parseListenBrainzSimilar({}), [])
  assert.deepEqual(parseListenBrainzSimilar(null), [])
})

test('MB 标签只认显式语种标签，多语种冲突时不硬判', () => {
  assert.equal(inferArtistLangFromTags(['mandarin', 'taiwanese pop']), 'zh')
  assert.equal(inferArtistLangFromTags(['Cantopop']), 'yue')
  assert.equal(inferArtistLangFromTags(['j-pop']), 'ja')
  assert.equal(inferArtistLangFromTags(['k-pop']), 'ko')
  assert.equal(inferArtistLangFromTags(['english', 'british']), 'en')
  assert.equal(inferArtistLangFromTags(['pop', 'rock']), null)
  assert.equal(inferArtistLangFromTags(['mandarin', 'cantopop']), null)
  assert.equal(inferArtistLangFromTags([]), null)
})

test('链路状态机：搜索→相似→逐位反查→逐位搜歌，别名反查失败也继续推进', () => {
  let task = createSimilarArtistTask('周杰伦', 1000)
  let action = nextSimilarArtistAction(task, policy)
  assert.deepEqual(action, { kind: 'mb_search', seedArtist: '周杰伦', query: '周杰伦' })

  task = applySimilarArtistOutcome(task, action!, { kind: 'mb_search', artist: mbArtist('周杰倫', 'seed') }, 1100, policy)
  assert.equal(task.stage, 'similar')
  assert.equal(task.seedMbid, 'seed')

  action = nextSimilarArtistAction(task, policy)
  assert.deepEqual(action, { kind: 'lb_similar', seedArtist: '周杰伦', mbid: 'seed' })
  task = applySimilarArtistOutcome(task, action!, {
    kind: 'lb_similar',
    entries: [
      { mbid: 'm1', name: '方大同', score: 90 },
      { mbid: 'm2', name: '陶喆', score: 80 },
      { mbid: 'm3', name: '王力宏', score: 70 },
      { mbid: 'm4', name: '林俊杰', score: 60 },
    ],
  }, 1200, policy)
  assert.equal(task.stage, 'aliases')

  action = nextSimilarArtistAction(task, policy)
  assert.deepEqual(action, { kind: 'mb_alias', seedArtist: '周杰伦', mbid: 'm1' })
  task = applySimilarArtistOutcome(task, action!, { kind: 'mb_alias', artist: { mbid: 'm1', name: '方大同' } }, 1300, policy)
  assert.equal(task.aliasCursor, 1)

  action = nextSimilarArtistAction(task, policy)
  task = applySimilarArtistOutcome(task, action!, { kind: 'mb_alias', artist: null }, 1400, policy)
  assert.equal(task.aliasCursor, 2)

  action = nextSimilarArtistAction(task, policy)
  assert.deepEqual(action, { kind: 'mb_alias', seedArtist: '周杰伦', mbid: 'm3' })
  task = applySimilarArtistOutcome(task, action!, { kind: 'mb_alias', artist: { mbid: 'm3', name: '王力宏' } }, 1500, policy)
  // 只反查前 3 位：第 4 位不耗请求
  assert.equal(task.stage, 'songs')
  assert.deepEqual(task.pending, ['方大同', '王力宏'])

  action = nextSimilarArtistAction(task, policy)
  assert.deepEqual(action, { kind: 'kg_songs', seedArtist: '周杰伦', artist: '方大同' })
  task = applySimilarArtistOutcome(task, action!, { kind: 'kg_songs' }, 1600, policy)
  assert.deepEqual(task.pending, ['王力宏'])

  action = nextSimilarArtistAction(task, policy)
  task = applySimilarArtistOutcome(task, action!, { kind: 'kg_songs' }, 1700, policy)
  assert.equal(task.stage, 'done')
  assert.equal(nextSimilarArtistAction(task, policy), null)

  const completed = completeSimilarArtistTask(task, 1800)
  assert.deepEqual(completed.similar, [{ mbid: 'm1', name: '方大同' }, { mbid: 'm3', name: '王力宏' }])
  assert.equal(completed.source, 'musicbrainz+listenbrainz')
  assert.equal(completed.songsFetchedAt, 1800)
  assert.equal(completed.nextIndex, 0)
})

test('LB 没返回相似歌手时链路直接完成，不留下空转任务', () => {
  let task = createSimilarArtistTask('周杰伦', 1000)
  task = applySimilarArtistOutcome(task, { kind: 'mb_search', seedArtist: '周杰伦', query: '周杰伦' },
    { kind: 'mb_search', artist: mbArtist('周杰倫', 'seed') }, 1100, policy)
  task = applySimilarArtistOutcome(task, { kind: 'lb_similar', seedArtist: '周杰伦', mbid: 'seed' },
    { kind: 'lb_similar', entries: [] }, 1200, policy)
  assert.equal(task.stage, 'done')
  const completed = completeSimilarArtistTask(task, 1300)
  assert.deepEqual(completed.similar, [])
  assert.equal(completed.source, 'empty')
})

test('搜歌失败也把该名字移出待办，避免一个名字卡死整条链路', () => {
  const task = {
    ...createSimilarArtistTask('周杰伦', 1000),
    stage: 'songs' as const,
    pending: ['方大同', '王力宏'],
  }
  const next = applySimilarArtistOutcome(task, { kind: 'kg_songs', seedArtist: '周杰伦', artist: '方大同' },
    { kind: 'kg_songs' }, 1200, policy)
  assert.deepEqual(next.pending, ['王力宏'])
  assert.equal(next.stage, 'songs')
})

test('缓存整理：byArtist 按 TTL 过期与容量淘汰，pending 不受 TTL 管', () => {
  const now = 100 * DAY
  const loaded = {
    byArtist: {
      fresh: { ...record({ fetchedAt: now - DAY }) },
      old: { ...record({ fetchedAt: now - policy.cacheTtlMs - 1 }) },
      junk: '不是记录',
    },
    pending: {
      keep: {
        seedArtist: 'keep', stage: 'songs', seedMbid: 'seed', similar: [], aliasCursor: 0,
        resolved: [], pending: ['x'], createdAt: 1, updatedAt: 1,
      },
      junk: { seedArtist: 'junk', stage: 'wat' },
    },
  }
  const cache = normalizeSimilarArtistCache(loaded, now, { cacheTtlMs: policy.cacheTtlMs, cacheLimit: 10 })
  assert.deepEqual(Object.keys(cache.byArtist), ['fresh'])
  assert.deepEqual(Object.keys(cache.pending), ['keep'])
  assert.deepEqual(normalizeSimilarArtistCache(null, now, { cacheTtlMs: policy.cacheTtlMs, cacheLimit: 10 }), emptyCache())
  assert.deepEqual(normalizeSimilarArtistCache([1, 2], now, { cacheTtlMs: policy.cacheTtlMs, cacheLimit: 10 }), emptyCache())
})

test('缓存容量按 fetchedAt 保留最新的记录', () => {
  const now = 100 * DAY
  const loaded = {
    byArtist: {
      old: record({ fetchedAt: now - 3 * DAY }),
      newest: record({ fetchedAt: now - DAY }),
      middle: record({ fetchedAt: now - 2 * DAY }),
    },
    pending: {},
  }
  const cache = normalizeSimilarArtistCache(loaded, now, { cacheTtlMs: policy.cacheTtlMs, cacheLimit: 2 })
  assert.deepEqual(Object.keys(cache.byArtist), ['newest', 'middle'])
})

test('起新种子时跳过已缓存与在途歌手，并推进游标', () => {
  const cache = emptyCache()
  cache.byArtist.a = record()
  cache.pending.b = createSimilarArtistTask('b', 1)
  assert.deepEqual(pickSimilarArtistSeed(['a', 'b', 'c', 'd'], cache, 0), { seedArtist: 'c', nextCursor: 3 })
  assert.deepEqual(pickSimilarArtistSeed(['a', 'b', 'c', 'd'], cache, 2), { seedArtist: 'c', nextCursor: 3 })
  assert.equal(pickSimilarArtistSeed(['a', 'b'], cache, 0), null)
  assert.equal(pickSimilarArtistSeed([], cache, 0), null)
})

test('已缓存的相似歌手按 nextIndex 轮换取歌，取完一圈回绕', () => {
  assert.deepEqual(planCachedSongFetches(record({ nextIndex: 2 }), 3), {
    names: ['c', 'd', 'a'],
    nextIndex: 1,
  })
  assert.deepEqual(planCachedSongFetches(record({ nextIndex: 0 }), 10), {
    names: ['a', 'b', 'c', 'd'],
    nextIndex: 0,
  })
  assert.deepEqual(planCachedSongFetches(record({ similar: [], nextIndex: 0 }), 3), { names: [], nextIndex: 0 })
})

test('挑缓存取歌的记录时跳过冷却期内与空记录，优先最久没取过的', () => {
  const now = 100 * HOUR
  const cache = emptyCache()
  cache.byArtist.fresh = record({ songsFetchedAt: now - HOUR })
  cache.byArtist.old = record({ songsFetchedAt: now - 7 * HOUR })
  cache.byArtist.older = record({ songsFetchedAt: now - 20 * HOUR })
  cache.byArtist.empty = record({ similar: [], songsFetchedAt: 0 })
  assert.equal(pickCachedSimilarArtistRecord(cache, now, policy.cacheReuseCooldownMs), 'older')
  delete cache.byArtist.older
  assert.equal(pickCachedSimilarArtistRecord(cache, now, policy.cacheReuseCooldownMs), 'old')
  delete cache.byArtist.old
  assert.equal(pickCachedSimilarArtistRecord(cache, now, policy.cacheReuseCooldownMs), null)
})

type FakeTrack = { id: string }

const createFakeIo = () => {
  const calls: string[] = []
  const io: SimilarArtistIo<FakeTrack> = {
    async mbSearch(name) {
      calls.push(`mb:${name}`)
      return mbArtist('周杰倫', 'seed-mbid', ['mandarin'])
    },
    async lbSimilar(mbid) {
      calls.push(`lb:${mbid}`)
      return [
        { mbid: 'm1', name: '方大同', score: 90 },
        { mbid: 'm2', name: '陶喆', score: 80 },
        { mbid: 'm3', name: '王力宏', score: 70 },
      ]
    },
    async mbLookup(mbid) {
      calls.push(`lookup:${mbid}`)
      return mbArtist(`歌手${mbid}`, mbid)
    },
    async kgSongs(name) {
      calls.push(`kg:${name}`)
      return [{ id: name }]
    },
  }
  return { io, calls }
}

test('预算跨刷新续跑：单轮只花给定的请求数，完成后才落到缓存', async() => {
  const { io, calls } = createFakeIo()
  let cache = emptyCache()

  const first = await runSimilarArtistRefresh({
    cache, seedArtists: ['周杰伦'], seedCursor: 0, startNewSeed: true, budget: 2, now: 1000, policy,
  }, io)
  assert.equal(first.requests, 2)
  assert.deepEqual(calls, ['mb:周杰伦', 'lb:seed-mbid'])
  assert.equal(first.cache.pending['周杰伦'].stage, 'aliases')
  assert.deepEqual(first.songs, [])
  cache = first.cache

  const second = await runSimilarArtistRefresh({
    cache, seedArtists: ['周杰伦'], seedCursor: first.nextSeedCursor, startNewSeed: false, budget: 4, now: 2000, policy,
  }, io)
  assert.equal(second.requests, 4)
  assert.deepEqual(calls.slice(2), ['lookup:m1', 'lookup:m2', 'lookup:m3', 'kg:歌手m1'])
  assert.equal(second.cache.pending['周杰伦'].stage, 'songs')
  assert.deepEqual(second.cache.pending['周杰伦'].pending, ['歌手m2', '歌手m3'])
  assert.equal(second.songs.length, 1)
  cache = second.cache

  const third = await runSimilarArtistRefresh({
    cache, seedArtists: ['周杰伦'], seedCursor: second.nextSeedCursor, startNewSeed: false, budget: 4, now: 3000, policy,
  }, io)
  assert.equal(third.requests, 2)
  assert.deepEqual(calls.slice(6), ['kg:歌手m2', 'kg:歌手m3'])
  assert.equal(third.cache.pending['周杰伦'], undefined)
  assert.equal(third.cache.byArtist['周杰伦'].similar.length, 3)
  assert.equal(third.cache.byArtist['周杰伦'].songsFetchedAt, 3000)
  cache = third.cache

  // 同一条记录刚取过歌：冷却期内不再重复发 kg 请求
  const cooling = await runSimilarArtistRefresh({
    cache, seedArtists: ['周杰伦'], seedCursor: third.nextSeedCursor, startNewSeed: false, budget: 3, now: 3000 + HOUR, policy,
  }, io)
  assert.equal(cooling.requests, 0)
  assert.deepEqual(cooling.songs, [])

  const reused = await runSimilarArtistRefresh({
    cache, seedArtists: ['周杰伦'], seedCursor: third.nextSeedCursor, startNewSeed: false,
    budget: 3, now: 3000 + 7 * HOUR, policy,
  }, io)
  assert.equal(reused.requests, 3)
  assert.deepEqual(reused.songs.map(item => item.artistName), ['歌手m1', '歌手m2', '歌手m3'])
})

test('有待续跑任务时不再起新种子，请求预算先给在途链路', async() => {
  const { io, calls } = createFakeIo()
  const first = await runSimilarArtistRefresh({
    cache: emptyCache(), seedArtists: ['周杰伦', '林俊杰'], seedCursor: 0, startNewSeed: true, budget: 1, now: 1000, policy,
  }, io)
  assert.deepEqual(calls, ['mb:周杰伦'])
  const second = await runSimilarArtistRefresh({
    cache: first.cache, seedArtists: ['周杰伦', '林俊杰'], seedCursor: first.nextSeedCursor,
    startNewSeed: true, budget: 1, now: 2000, policy,
  }, io)
  assert.deepEqual(calls, ['mb:周杰伦', 'lb:seed-mbid'])
  assert.deepEqual(Object.keys(second.cache.pending), ['周杰伦'])
})

test('搜索请求失败保留任务进度，本轮不再继续', async() => {
  const io: SimilarArtistIo<FakeTrack> = {
    async mbSearch() { throw new Error('server busy') },
    async lbSimilar() { throw new Error('unused') },
    async mbLookup() { throw new Error('unused') },
    async kgSongs() { throw new Error('unused') },
  }
  const result = await runSimilarArtistRefresh({
    cache: emptyCache(), seedArtists: ['周杰伦'], seedCursor: 0, startNewSeed: true, budget: 4, now: 1000, policy,
  }, io)
  assert.equal(result.requests, 1)
  assert.equal(result.cache.pending['周杰伦'].stage, 'search')
  assert.ok(result.reasons.includes('similar_artist_mb_search_failed'))
})

test('搜歌请求失败时移出该名字并完成链路，不把失败当成功歌单', async() => {
  const cache = emptyCache()
  cache.pending['周杰伦'] = {
    seedArtist: '周杰伦', stage: 'songs', seedMbid: 'seed',
    similar: [], aliasCursor: 0,
    resolved: [{ mbid: 'm1', name: '方大同' }],
    pending: ['方大同'], createdAt: 1, updatedAt: 1,
  }
  const io: SimilarArtistIo<FakeTrack> = {
    async mbSearch() { throw new Error('unused') },
    async lbSimilar() { throw new Error('unused') },
    async mbLookup() { throw new Error('unused') },
    async kgSongs() { throw new Error('timeout') },
  }
  const result = await runSimilarArtistRefresh({
    cache, seedArtists: [], seedCursor: 0, startNewSeed: false, budget: 2, now: 2000, policy,
  }, io)
  assert.equal(result.requests, 1)
  assert.equal(result.cache.pending['周杰伦'], undefined)
  assert.deepEqual(result.cache.byArtist['周杰伦'].similar, [{ mbid: 'm1', name: '方大同' }])
  assert.deepEqual(result.songs, [])
  assert.ok(result.reasons.includes('similar_artist_kg_songs_failed'))
})

test('MB 关系链以最高强度写歌手语言表，压过歌词与接口语种字段', () => {
  const table: ArtistLangTable = {}
  const artists = ['周杰倫', '周杰伦']
  updateArtistLangTable(table, artists, 'zh', 'lyric', 500, 1)
  updateArtistLangTable(table, artists, 'en', 'field', 500, 2)
  assert.equal(table['周杰伦'].bucket, 'en')
  updateArtistLangTable(table, artists, 'zh', 'relation', 500, 3)
  assert.equal(table['周杰伦'].bucket, 'zh')
  assert.equal(table['周杰伦'].strength, 3)
  // 更低强度的后续观察不能把关系链结论改回去
  updateArtistLangTable(table, artists, 'en', 'field', 500, 4)
  assert.equal(table['周杰伦'].bucket, 'zh')
  assert.deepEqual(resolveLang({ artistKeys: ['周杰伦'], name: '', singer: '' }, table), { bucket: 'zh', level: 3 })
})
