import test from 'node:test'
import assert from 'node:assert/strict'

import { HISTORY_LIMIT, SESSION_GAP_MS, createHistory, groupByDay, groupBySession, sanitizeHistory, type HistoryItem } from '../src/core/musicRecognition/history.ts'
import type { RecognizedSong } from '../src/core/musicRecognition/types.ts'

// 历史识曲的全部判断都压在这个纯模块里（存储与广播在外面接），所以这里能离线跑完。
// 钉的是四件事：同一首只占一行、行数封顶、按天怎么切开、盘上的脏数据不许把界面带崩。

const song = (over: Partial<RecognizedSong> = {}): RecognizedSong => ({
  name: 'A', singer: 'x', albumName: '', neteaseSongId: '1', startTimeMs: 0, ...over,
})

const musicInfo = (id: string) => ({ id, name: 'A', singer: 'x' }) as never

const createStorage = (initial: unknown = []) => {
  const writes: HistoryItem[][] = []
  return {
    writes,
    get: async() => initial as never,
    set: async(list: HistoryItem[]) => { writes.push(list) },
  }
}

const setup = (opts: { initial?: unknown, now?: () => number, limit?: number } = {}) => {
  const getNow = opts.now ?? (() => 1_000)
  const storage = createStorage(opts.initial ?? [])
  const events: HistoryItem[][] = []
  const history = createHistory({
    storage,
    now: () => getNow(),
    limit: opts.limit,
    onUpdated: list => { events.push(list) },
  })
  return { history, storage, events }
}

const item = (over: Partial<HistoryItem> = {}): HistoryItem => ({
  key: '1|A|x',
  engineId: 'ncm',
  song: song(),
  recognizedAt: 1_000,
  musicInfo: null,
  ...over,
})

// --- 记一笔 ---

test('第一次听到就记一行，时间取记入历史那一刻', async() => {
  const { history, storage } = setup({ now: () => 5_000 })
  await history.add('ncm', song())
  const list = storage.writes.at(-1)!
  assert.equal(list.length, 1)
  assert.equal(list[0].recognizedAt, 5_000)
  assert.equal(list[0].engineId, 'ncm')
})

test('同一首再听到只占一行：顶到最前、时间刷新', async() => {
  const { history, storage } = setup()
  await history.add('ncm', song({ name: ' older' }))
  await history.add('ncm', song())
  await history.add('ncm', song({ name: 'other', neteaseSongId: '2' }))
  await history.add('ncm', song())
  const list = storage.writes.at(-1)!
  assert.equal(list.length, 3)
  assert.equal(list[0].song.name, 'A', '最近听到的那首要排在最前')
  assert.equal(list.filter(i => i.song.name == 'A').length, 1, '同一首不该出现两行')
})

test('重复命中时保住已经查到的歌条，不让它退回"点一下去找"', async() => {
  const { history, storage } = setup()
  await history.add('ncm', song())
  await history.attach('1|A|x', musicInfo('1'))
  await history.add('ncm', song())
  const list = storage.writes.at(-1)!
  assert.equal(list[0].musicInfo?.id, '1')
})

test('行数封顶在最旧的那一头截掉', async() => {
  const { history, storage } = setup({ limit: 3 })
  for (const name of ['a', 'b', 'c', 'd']) {
    await history.add('ncm', song({ name, neteaseSongId: name }))
  }
  const list = storage.writes.at(-1)!
  assert.deepEqual(list.map(i => i.song.name), ['d', 'c', 'b'])
})

test('默认上限是 200 条', () => {
  assert.equal(HISTORY_LIMIT, 200)
})

// --- 补歌条 ---

test('补到已经一样的歌条就不写盘', async() => {
  const { history, storage } = setup()
  await history.add('ncm', song())
  const before = storage.writes.length
  await history.attach('1|A|x', musicInfo('1'))
  assert.ok(storage.writes.length > before, '第一次补该写盘')
  const mid = storage.writes.length
  await history.attach('1|A|x', musicInfo('1'))
  assert.equal(storage.writes.length, mid, '同一首歌条重复补不该再写')
})

test('补歌条不改变行的先后：它是回填，不是又听到一次', async() => {
  const { history, storage } = setup()
  await history.add('ncm', song({ name: 'first', neteaseSongId: '9' }))
  await history.add('ncm', song())
  const before = storage.writes.at(-1)!.map(i => i.song.name)
  assert.deepEqual(before, ['A', 'first'], '新听到的排在最前')
  await history.attach('1|A|x', musicInfo('1'))
  const list = storage.writes.at(-1)!
  assert.deepEqual(list.map(i => i.song.name), before)
})

test('给不存在的 key 补歌条什么都不动', async() => {
  const { history, storage } = setup()
  await history.add('ncm', song())
  const before = storage.writes.length
  await history.attach('nope', musicInfo('1'))
  assert.equal(storage.writes.length, before)
})

// --- 清空与广播 ---

test('清空把列表倒掉并广播出去', async() => {
  const { history, storage, events } = setup()
  await history.add('ncm', song())
  await history.clear()
  assert.deepEqual(storage.writes.at(-1), [])
  assert.deepEqual(events.at(-1), [])
})

test('每次写入都广播一次，历史页才能实时长行', async() => {
  const { history, events } = setup()
  await history.add('ncm', song())
  await history.add('ncm', song({ name: 'other', neteaseSongId: '2' }))
  assert.equal(events.length, 2)
  assert.equal(events.at(-1)!.length, 2)
})

// --- 坏数据 ---

test('盘上读不出来就当空表，不让识曲跟着崩', async() => {
  const storage = { get: async() => { throw new Error('storage down') }, set: async() => {} }
  const history = createHistory({ storage, now: () => 1 })
  await history.add('ncm', song())
  assert.equal((await history.list()).length, 1)
})

test('写盘失败只丢这一笔记录，不打断识别循环', async() => {
  let fail = false
  const storage = {
    get: async() => null,
    set: async() => { if (fail) throw new Error('disk full') },
  }
  const history = createHistory({ storage, now: () => 1 })
  fail = true
  await history.add('ncm', song())
  assert.equal((await history.list()).length, 1, '内存里还是记上了，界面照常长行')
})

test('脏数据逐条丢掉，合法的留下', async() => {
  const dirty = [
    null,
    'not an object',
    { key: 'k', engineId: 'ncm', recognizedAt: 1 }, // 没有 song
    { key: 'k', engineId: 'ncm', recognizedAt: 1, song: { name: '', singer: 'x' } }, // 歌名空
    { key: 'k', recognizedAt: 1, song: { name: 'A', singer: 'x' } }, // 没有引擎，后台没法查
    { key: 'k', engineId: 'ncm', song: { name: 'A', singer: 'x' } }, // 没有时间，没法分组
    item(),
  ]
  const list = sanitizeHistory(dirty)
  assert.equal(list.length, 1)
  assert.equal(list[0].song.name, 'A')
})

test('存储整体不是数组时退回空表而不是崩', () => {
  for (const raw of [undefined, null, 'str', 42, { a: 1 }]) {
    assert.deepEqual(sanitizeHistory(raw), [])
  }
})

test('行上残缺的歌条按没查到处理', async() => {
  const broken = [
    { ...item(), musicInfo: 'oops' },
    { ...item(), key: '2|B|y', song: song({ name: 'B', neteaseSongId: '2' }), musicInfo: { name: '没有 id' } },
    item({ key: '3|C|z', song: song({ name: 'C', neteaseSongId: '3' }), musicInfo: musicInfo('3') as never }),
  ]
  const list = sanitizeHistory(broken)
  assert.equal(list[0].musicInfo, null)
  assert.equal(list[1].musicInfo, null)
  assert.equal(list[2].musicInfo?.id, '3')
})

// --- 按天分组 ---

const DAY = 24 * 60 * 60 * 1000

test('同一天归一组，跨天切开且保持新→旧', () => {
  const base = new Date(2026, 9, 12, 13, 1, 0).getTime() // 本地时间，分组只认本地日界
  const items = [
    item({ key: 'a', recognizedAt: base }),
    item({ key: 'b', recognizedAt: base + 60_000 }),
    item({ key: 'c', recognizedAt: base - DAY }),
  ]
  const groups = groupByDay(items)
  assert.equal(groups.length, 2)
  assert.equal(groups[0].items.length, 2, '12 日那一组两首')
  assert.deepEqual(groups[0].items.map(i => i.key), ['a', 'b'], '组内顺序照输入')
  assert.deepEqual(groups[1].items.map(i => i.key), ['c'])
  assert.equal(groups[0].at, base + 60_000, '组标题用这一组里最晚的那条')
})

test('跨月跨年要分成两组（日界按本地时区）', () => {
  const newYearEve = new Date(2025, 11, 31, 23, 59).getTime()
  const newYear = new Date(2026, 0, 1, 0, 1).getTime()
  const groups = groupByDay([
    item({ key: 'n', recognizedAt: newYear }),
    item({ key: 'e', recognizedAt: newYearEve }),
  ])
  assert.equal(groups.length, 2)
  assert.equal(groups[0].dayKey, '2026-01-01')
  assert.equal(groups[1].dayKey, '2025-12-31')
})

test('空列表分不出组', () => {
  assert.deepEqual(groupByDay([]), [])
})

// --- 一天内切成「次」 ---
// 历史页的标题要写「这一次是哪会儿听的」，切开的依据只能是相邻两条的间隔：
// 按下一次只听一分钟，同一次内部的几条不会差太远。

const MIN = 60 * 1000

test('同一天里间隔在阈值内的算一次，超阈值另起一次（新→旧）', () => {
  const base = new Date(2026, 9, 12, 13, 42, 0).getTime()
  const sessions = groupBySession([
    item({ key: 'a', recognizedAt: base }),
    item({ key: 'b', recognizedAt: base - 8 * MIN }),
    item({ key: 'c', recognizedAt: base - 25 * MIN }),
  ])
  assert.equal(sessions.length, 2)
  assert.deepEqual(sessions[0].items.map(i => i.key), ['a', 'b'], '组内顺序照输入')
  assert.deepEqual(sessions[1].items.map(i => i.key), ['c'])
  assert.equal(sessions[0].at, base, '标题用这一次里最晚的那条')
  assert.equal(sessions[1].at, base - 25 * MIN)
})

test('同一天切出来的两次 dayKey 相同，页面靠它只印一次年月日', () => {
  const base = new Date(2026, 9, 12, 20, 0, 0).getTime()
  const sessions = groupBySession([
    item({ key: 'a', recognizedAt: base }),
    item({ key: 'b', recognizedAt: base - 2 * SESSION_GAP_MS }),
  ])
  assert.equal(sessions.length, 2)
  assert.equal(sessions[0].dayKey, '2026-10-12')
  assert.equal(sessions[1].dayKey, '2026-10-12')
})

test('跨天即使挨得很近也切开', () => {
  const before = new Date(2026, 9, 12, 23, 58, 0).getTime()
  const after = new Date(2026, 9, 13, 0, 2, 0).getTime()
  const sessions = groupBySession([
    item({ key: 'a', recognizedAt: after }),
    item({ key: 'b', recognizedAt: before }),
  ])
  assert.equal(sessions.length, 2, '只差 4 分钟，但不是同一天')
  assert.equal(sessions[0].dayKey, '2026-10-13')
  assert.equal(sessions[1].dayKey, '2026-10-12')
})

test('间隔正好等于阈值算同一次，多一毫秒就另起', () => {
  const base = new Date(2026, 9, 12, 9, 0, 0).getTime()
  assert.equal(groupBySession([
    item({ key: 'a', recognizedAt: base }),
    item({ key: 'b', recognizedAt: base - SESSION_GAP_MS }),
  ]).length, 1)
  assert.equal(groupBySession([
    item({ key: 'a', recognizedAt: base }),
    item({ key: 'b', recognizedAt: base - SESSION_GAP_MS - 1 }),
  ]).length, 2)
})

test('间隔按绝对值算，列表顺序颠倒也不会多切一次', () => {
  const base = new Date(2026, 9, 12, 9, 0, 0).getTime()
  const sessions = groupBySession([
    item({ key: 'b', recognizedAt: base - 3 * MIN }),
    item({ key: 'a', recognizedAt: base }),
  ])
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].at, base)
})

test('空列表切不出次', () => {
  assert.deepEqual(groupBySession([]), [])
})
