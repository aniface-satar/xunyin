import test from 'node:test'
import assert from 'node:assert/strict'
import { createResolver, rowAction } from '../src/core/musicRecognition/resolve.ts'
import type { RecognizedSong, ResolveDeps } from '../src/core/musicRecognition/resolve.ts'

const tick = () => new Promise(resolve => { setTimeout(resolve, 0) })

const song = (name: string, singer = 'x', neteaseSongId = ''): RecognizedSong =>
  ({ name, singer, albumName: '', neteaseSongId, startTimeMs: 0 })

// 假的旧格式搜索行：真实数据来自 wy.musicSearch / findMusic，字段名保持原样，
// 因为挑哪一条的逻辑就是围着 songmid/name/singer 转的。
const row = (songmid: string, name: string, singer = 'x', extra: Record<string, any> = {}) =>
  ({ source: 'wy', songmid, name, singer, albumName: 'al', img: `pic/${songmid}`, interval: '04:00', types: [], _types: {}, ...extra })

// 转换函数在页面上是真·toNewMusicInfo；测试里换成一个会留记号的浅包装，
// 这样既能确认歌条确实是「转换过」的，又不用把整条 utils 依赖链拖进 node 测试。
const toMusicInfo = (info: any) => ({ ...info, converted: true })

type DepOverrides = {
  searchNcm?: (query: string) => Promise<any[]>
  searchAllSources?: (song: RecognizedSong) => Promise<any[]>
}

// 记号笔式的依赖：calls 数的是「真发出去几笔搜索请求」，这是本模块唯一必须钉住的外部行为，
// 所以记账放在包装器里，测试覆盖返回内容时不会把它一起换掉。
const makeDeps = (overrides: DepOverrides = {}) => {
  const calls: string[] = []
  const deps: ResolveDeps = {
    searchNcm: async(query) => { calls.push('ncm'); return overrides.searchNcm ? await overrides.searchNcm(query) : [] },
    searchAllSources: async(s) => { calls.push('all'); return overrides.searchAllSources ? await overrides.searchAllSources(s) : [] },
    toMusicInfo,
  }
  return { calls, deps }
}

// 歌条在类型上是 MusicInfoOnline，而这几条断言要看的是假行自己带的字段
// （songmid / converted / img）。用 infoOf 收口一次转换，别把 `as any` 撒到每条断言上。
const infoOf = (entry: any) => entry.musicInfo as any

const flush = async(resolver: ReturnType<typeof createResolver>) => {
  for (let i = 0; i < 20; i++) {
    await tick()
    if (!resolver.hasPending()) break
  }
}

test('ncm 命中：按识别到的网易云 id 精确挑回那一行，转成歌条', async() => {
  const { deps } = makeDeps({ searchNcm: async() => [row('999', '别的歌'), row('123456', 'A') ] })
  const resolver = createResolver(deps)
  resolver.request('ncm', song('A', 'x', '123456'))
  await flush(resolver)
  const entry = resolver.get('123456|A|x')!
  assert.equal(entry.status, 'ready')
  assert.equal(infoOf(entry).songmid, '123456', '挑错行就等于把另一首歌的封面时长挂到结果上')
  assert.equal(infoOf(entry).converted, true)
})

test('ncm 命中：搜索里没有那个 id 时退到歌名歌手相等的第一条', async() => {
  const { deps } = makeDeps({ searchNcm: async() => [row('1', '另一首'), row('7', 'A', '张三')] })
  const resolver = createResolver(deps)
  resolver.request('ncm', song('A', '张三', '999999'))
  await flush(resolver)
  const entry = resolver.get('999999|A|张三')!
  assert.equal(entry.status, 'ready')
  assert.equal(infoOf(entry).songmid, '7')
})

test('ncm 命中：一条都对不上就用识别字段合成一行——它有真的网易云 id，所以还是能播', async() => {
  const { deps } = makeDeps({ searchNcm: async() => [row('1', '另一首', '别人')] })
  const resolver = createResolver(deps)
  resolver.request('ncm', song('A', '张三', '555'))
  await flush(resolver)
  const entry = resolver.get('555|A|张三')!
  assert.equal(entry.status, 'ready')
  assert.equal(infoOf(entry).source, 'wy')
  assert.equal(infoOf(entry).songmid, '555')
  assert.equal(infoOf(entry).name, 'A')
  assert.equal(infoOf(entry).interval, '', '合成行没有时长，宁可空着也不能编一个')
  assert.equal(infoOf(entry).img, '', '同理没有封面')
})

test('Shazam 命中：五源并发搜，取排好序的第一条', async() => {
  const queries: any[] = []
  const { deps } = makeDeps({
    searchAllSources: async(s) => { queries.push(s); return [row('8', 'B', '李四'), row('3', 'B', '李四')] },
  })
  const resolver = createResolver(deps)
  resolver.request('shazam', song('B', '李四'))
  await flush(resolver)
  const entry = resolver.get('|B|李四')!
  assert.equal(queries.length, 1)
  assert.equal(queries[0].name, 'B')
  assert.equal(queries[0].singer, '李四')
  assert.equal(entry.status, 'ready')
  assert.equal(infoOf(entry).songmid, '8', 'findMusic 已经按匹配度排好序，这里不许再自己排一遍')
})

test('Shazam 命中：五源都没有对应歌曲时报失败，绝不合成一行', async() => {
  const { deps } = makeDeps({ searchAllSources: async() => [] })
  const resolver = createResolver(deps)
  resolver.request('shazam', song('B', '李四'))
  await flush(resolver)
  const entry = resolver.get('|B|李四')!
  assert.equal(entry.status, 'failed')
  assert.equal(entry.musicInfo, null,
    'Shazam 那条没有任何可播 id，合成出来的行点了必崩；ncm 能合成是因为它有真的网易云 id')
})

test('同一首歌跨轮重复命中只查一次', async() => {
  const { calls, deps } = makeDeps({ searchNcm: async() => [row('123', 'A')] })
  const resolver = createResolver(deps)
  resolver.request('ncm', song('A', 'x', '123'))
  resolver.request('ncm', song('A', 'x', '123'))
  resolver.request('ncm', song('A', 'x', '123'))
  await flush(resolver)
  assert.deepEqual(calls, ['ncm'], '一分钟里同一首命中好几次很常见，不能每次都重新查五源')
})

test('解析串行：一首查完才查下一首，绝不并发五源轰出去', async() => {
  let active = 0
  let maxActive = 0
  const { deps } = makeDeps({
    searchAllSources: async() => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => { setTimeout(resolve, 10) })
      active -= 1
      return [row('1', 'x')]
    },
  })
  const resolver = createResolver(deps)
  resolver.request('shazam', song('A'))
  resolver.request('shazam', song('B'))
  resolver.request('shazam', song('C'))
  await flush(resolver)
  assert.equal(maxActive, 1, '每首歌要并发打五个音源，两首同时查就是十个请求同时在飞')
})

test('每会话最多解析 5 首，第 6 首挂起等用户点按', async() => {
  const { calls, deps } = makeDeps({ searchAllSources: async() => [row('1', 'x')] })
  const resolver = createResolver(deps)
  for (const name of ['A', 'B', 'C', 'D', 'E', 'F']) resolver.request('shazam', song(name))
  await flush(resolver)
  assert.equal(calls.length, 5, '一次按下最多听约 6 轮、每轮两个引擎，不设闸就是几十笔搜索请求')
  assert.equal(resolver.get('|F|x')!.status, 'waiting')
  assert.equal(resolver.get('|A|x')!.status, 'ready')
})

test('点按挂起的那首立刻入队，用户的手就是突破上限的唯一入口', async() => {
  const { calls, deps } = makeDeps({ searchAllSources: async() => [row('1', 'x')] })
  const resolver = createResolver(deps)
  for (const name of ['A', 'B', 'C', 'D', 'E', 'F']) resolver.request('shazam', song(name))
  await flush(resolver)
  resolver.tap('|F|x')
  await flush(resolver)
  assert.equal(calls.length, 6)
  assert.equal(resolver.get('|F|x')!.status, 'ready')
})

test('新一轮会话把上限计数复位，但已解析好的歌条留着不重查', async() => {
  const { calls, deps } = makeDeps({ searchAllSources: async() => [row('1', 'x')] })
  const resolver = createResolver(deps)
  for (const name of ['A', 'B', 'C', 'D', 'E']) resolver.request('shazam', song(name))
  await flush(resolver)
  assert.equal(calls.length, 5)
  resolver.beginSession()
  const before = calls.length
  resolver.request('shazam', song('A'))
  resolver.request('shazam', song('F'))
  await flush(resolver)
  assert.equal(calls.length - before, 1, '新一轮只该多一笔：A 已经在缓存里，重复命中不许再打五源')
  assert.equal(resolver.get('|F|x')!.status, 'ready', '上限复位了，新一轮的第 6 首该照查')
})

test('搜索抛异常算失败，不自动重试；点按那行可以重试', async() => {
  let fail = true
  const { calls, deps } = makeDeps({
    searchAllSources: async() => {
      if (fail) throw new Error('network down')
      return [row('1', 'B')]
    },
  })
  const resolver = createResolver(deps)
  resolver.request('shazam', song('A'))
  await flush(resolver)
  assert.equal(resolver.get('|A|x')!.status, 'failed')
  assert.equal(calls.length, 1, '失败自己再捅一次网络是雪上加霜，重试必须由用户发起')

  fail = false
  resolver.tap('|A|x')
  await flush(resolver)
  assert.equal(resolver.get('|A|x')!.status, 'ready')
  assert.equal(calls.length, 2)
})

test('解析落定时通知订阅者，页面才有机会重渲染', async() => {
  const { deps } = makeDeps({ searchNcm: async() => [row('123', 'A')] })
  const resolver = createResolver(deps)
  const events: number[] = []
  const unsubscribe = resolver.subscribe(() => { events.push(resolver.get('123|A|x')!.status == 'ready' ? 1 : 0) })
  resolver.request('ncm', song('A', 'x', '123'))
  await flush(resolver)
  assert.ok(events.length >= 2, '入队时要通知（先画出「查找中」），落计时还要通知（换成歌条）')
  assert.equal(events[events.length - 1], 1)
  unsubscribe()
  const before = events.length
  resolver.request('ncm', song('A', 'x', '123'))
  assert.equal(events.length, before, '退订之后不该再被叫到')
})

// 历史页打开时一行都不许自己发请求：它是「翻旧账」，不是「我又听到了一首」。
test('历史行不自动开查：只是挂在那儿，一笔请求都不发', async() => {
  const { calls, deps } = makeDeps({ searchAllSources: async() => [row('1', 'x')] })
  const resolver = createResolver(deps)
  resolver.request('shazam', song('A'), { autoStart: false })
  resolver.request('shazam', song('B'), { autoStart: false })
  await flush(resolver)
  assert.deepEqual(calls, [])
  assert.equal(resolver.get('|A|x')!.status, 'waiting')
  assert.equal(resolver.get('|B|x')!.status, 'waiting')
  assert.equal(resolver.hasPending(), false, '翻一页历史不该让面板以为后台还在跑')
})

test('不自动开查的行不占每会话那 5 个名额', async() => {
  const { calls, deps } = makeDeps({ searchAllSources: async() => [row('1', 'x')] })
  const resolver = createResolver(deps)
  for (const name of ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7']) resolver.request('shazam', song(name), { autoStart: false })
  for (const name of ['A', 'B', 'C', 'D', 'E']) resolver.request('shazam', song(name))
  await flush(resolver)
  assert.equal(calls.length, 5, '刚认出来的 5 首该照查，历史里躺着的那 7 首不许把它们挤掉')
  for (const name of ['A', 'B', 'C', 'D', 'E']) assert.equal(resolver.get(`|${name}|x`)!.status, 'ready')
  for (const name of ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7']) assert.equal(resolver.get(`|${name}|x`)!.status, 'waiting')
})

test('历史行带着已经查到的歌条：直接可播，不再打一次搜索', async() => {
  const { calls, deps } = makeDeps({ searchAllSources: async() => [row('1', 'x')] })
  const resolver = createResolver(deps)
  const seeded = row('777', 'A')
  resolver.request('shazam', song('A'), { musicInfo: seeded as never })
  await flush(resolver)
  const entry = resolver.get('|A|x')!
  assert.deepEqual(calls, [])
  assert.equal(entry.status, 'ready')
  assert.equal(infoOf(entry).songmid, '777')
  assert.deepEqual(rowAction(entry), { kind: 'play', musicInfo: entry.musicInfo })
})

test('历史行点一下才去查', async() => {
  const { calls, deps } = makeDeps({ searchAllSources: async() => [row('1', 'x')] })
  const resolver = createResolver(deps)
  resolver.request('shazam', song('A'), { autoStart: false })
  await flush(resolver)
  assert.deepEqual(calls, [])
  resolver.tap('|A|x')
  await flush(resolver)
  assert.equal(calls.length, 1)
  assert.equal(resolver.get('|A|x')!.status, 'ready')
})

// 行的点按是结果页唯一会崩人的分支：对着还没解析出来的命中调 handlePlay 就是传 null 进去。
test('行点按：查好了播，没查着/查失败都再查一次，正在查时什么都不做', () => {
  const entry = (status: any, musicInfo: any = null) => ({ key: 'k', engineId: 'shazam', song: song('A'), status, musicInfo })
  const ready = entry('ready', row('1', 'A'))
  assert.deepEqual(rowAction(ready), { kind: 'play', musicInfo: ready.musicInfo })
  assert.deepEqual(rowAction(entry('waiting')), { kind: 'lookup' })
  assert.deepEqual(rowAction(entry('failed')), { kind: 'lookup' })
  assert.deepEqual(rowAction(entry('pending')), { kind: 'none' },
    '查询中再点一次等于同一首歌再打五源，点了不该有反应')
})

