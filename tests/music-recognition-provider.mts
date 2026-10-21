import test from 'node:test'
import assert from 'node:assert/strict'
import { recognizeWithEngines } from '../src/core/musicRecognition/provider.ts'
import type { Guard, RecognizeEngine, RecognizedSong } from '../src/core/musicRecognition/types.ts'

const song = (name: string): RecognizedSong => ({ name, singer: 'x', albumName: '', neteaseSongId: '', startTimeMs: 0 })

type Gate = 'allow' | 'cooldown'

const makeGuard = (gate: Gate = 'allow') => {
  const calls: string[] = []
  const guard: Guard = {
    check: async() => { calls.push('check'); return gate },
    onSuccess: async() => { calls.push('success') },
    onFailure: async() => { calls.push('failure') },
  }
  return { calls, guard }
}

const fakeEngine = (id: string, behaviour: { result?: RecognizedSong | null, error?: string, delayMs?: number }): RecognizeEngine => ({
  id,
  recognize: async() => {
    if (behaviour.delayMs) await new Promise(resolve => { setTimeout(resolve, behaviour.delayMs) })
    if (behaviour.error) throw new Error(behaviour.error)
    return behaviour.result ?? null
  },
})

// 一次点按 = 一轮 = 同一份音频喂给所有在跑的引擎，两区的结果都要留。
// 下面这套契约是整个改动的心脏，逐条钉住。

test('一轮把同一份音频喂给每个引擎，两个都命中就都收下', async() => {
  const touched: string[] = []
  const engines: RecognizeEngine[] = [
    { id: 'ncm', recognize: async() => { touched.push('ncm'); return song('A') } },
    { id: 'shazam', recognize: async() => { touched.push('shazam'); return song('B') } },
  ]
  const round = await recognizeWithEngines(engines, new Int16Array(8), 48000, makeGuard().guard)
  assert.deepEqual(touched, ['ncm', 'shazam'], '前一个命中不许短路后一个')
  assert.deepEqual(round.hits.map(h => h.engineId), ['ncm', 'shazam'])
  assert.deepEqual(round.hits.map(h => h.song.name), ['A', 'B'])
  assert.equal(round.failure, null)
})

test('hits 按引擎数组顺序给，不管谁先跑完', async() => {
  const engines = [
    fakeEngine('ncm', { result: song('A'), delayMs: 30 }),
    fakeEngine('shazam', { result: song('B') }),
  ]
  const round = await recognizeWithEngines(engines, new Int16Array(8), 48000, makeGuard().guard)
  assert.deepEqual(round.hits.map(h => h.engineId), ['ncm', 'shazam'],
    '结果分区按固定顺序渲染，慢的那个不能排到后面去')
})

test('两个引擎并发跑，不是排队', async() => {
  let active = 0
  let maxActive = 0
  const slow: RecognizeEngine = {
    id: 'ncm',
    recognize: async() => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => { setTimeout(resolve, 30) })
      active -= 1
      return null
    },
  }
  const slower: RecognizeEngine = {
    id: 'shazam',
    recognize: async() => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => { setTimeout(resolve, 30) })
      active -= 1
      return null
    },
  }
  const startedAt = Date.now()
  await recognizeWithEngines([slow, slower], new Int16Array(8), 48000, makeGuard().guard)
  assert.equal(maxActive, 2, '两轮各等 30ms 的引擎必须同时在跑')
  assert.ok(Date.now() - startedAt < 55, '并行的一轮耗时应约等于最慢的那个引擎，而不是两个之和')
})

test('有命中就算这一轮成功：清零退避，哪怕另一个引擎抛了异常', async() => {
  const { calls, guard } = makeGuard()
  const engines = [fakeEngine('ncm', { error: 'boom' }), fakeEngine('shazam', { result: song('B') })]
  const round = await recognizeWithEngines(engines, new Int16Array(8), 48000, guard)
  assert.equal(round.hits.length, 1)
  assert.equal(round.hits[0].engineId, 'shazam')
  assert.equal(round.failure, null, '一个引擎挂了不该把另一引擎已经听到的歌抹掉')
  assert.deepEqual(calls, ['check', 'success'])
})

test('全部没命中且有引擎抛异常：failed，整轮只累计一次退避', async() => {
  const { calls, guard } = makeGuard()
  const engines = [fakeEngine('ncm', { error: 'boom' }), fakeEngine('shazam', { error: 'boom' })]
  const round = await recognizeWithEngines(engines, new Int16Array(8), 48000, guard)
  assert.deepEqual(round.hits, [])
  assert.equal(round.failure, 'failed')
  assert.deepEqual(calls, ['check', 'failure'],
    '两个引擎同时挂只算一次故障；各记一次会让用户被双倍惩罚')
})

test('全都安静地没命中：no_match，既不退避也不清零', async() => {
  const { calls, guard } = makeGuard()
  const engines = [fakeEngine('ncm', { result: null }), fakeEngine('shazam', { result: null })]
  const round = await recognizeWithEngines(engines, new Int16Array(8), 48000, guard)
  assert.deepEqual(round.hits, [])
  assert.equal(round.failure, 'no_match')
  assert.deepEqual(calls, ['check'], '未命中一轮不该产生任何记账')
})

// 评审 Important-1：闸门这一半契约不只是「不发请求」，还有「不碰 onSuccess/onFailure」。
// 冷却期里每次点击若偷偷记一次账，用户就会被自己那些没发出去的请求越推越远。
test('闸门挡住时一个引擎都不发请求', async() => {
  let touched = false
  const engines: RecognizeEngine[] = [{ id: 'ncm', recognize: async() => { touched = true; return song('A') } }]
  const { calls, guard } = makeGuard('cooldown')
  const round = await recognizeWithEngines(engines, new Int16Array(8), 48000, guard)
  assert.equal(touched, false)
  assert.deepEqual(round.hits, [])
  assert.equal(round.failure, 'cooldown')
  assert.deepEqual(calls, ['check'], '被拦住的尝试不该改动退避记账')
})

// Ruling T4f：运营方把引擎全关（remoteConfig.sanitizeConfig 会给出 engines: []）时
// 调度层必须安静地返回 unsupported，不许抛、也不许假设数组里至少有 ncm 一条。
test('没有可用引擎（运营全关，或这台设备起不来 WebView）时不抛异常，只报 unsupported 且不改动退避记账', async() => {
  const { calls, guard } = makeGuard()
  const round = await recognizeWithEngines([], new Int16Array(8), 48000, guard)
  assert.deepEqual(round.hits, [])
  assert.equal(round.failure, 'unsupported')
  assert.deepEqual(calls, ['check'], '没有引擎时不该改动退避记账')
})

// Ruling T3b：null（安静未命中）与抛异常（服务故障）是两条不同的路，
// 只有后者才累计失败退避。把异常当未命中会让保险丝永远不生效。
test('引擎返回 null 不累计失败，抛异常恰好累计一次失败', async() => {
  let nullFailures = 0
  const nullGuard: Guard = {
    check: async() => 'allow',
    onSuccess: async() => {},
    onFailure: async() => { nullFailures += 1 },
  }
  const nullRound = await recognizeWithEngines([fakeEngine('ncm', { result: null })], new Int16Array(8), 48000, nullGuard)
  assert.equal(nullRound.failure, 'no_match')
  assert.equal(nullFailures, 0, 'null 是「没听出来」，不该进退避')

  let throwFailures = 0
  const throwGuard: Guard = {
    check: async() => 'allow',
    onSuccess: async() => {},
    onFailure: async() => { throwFailures += 1 },
  }
  const throwRound = await recognizeWithEngines([fakeEngine('ncm', { error: 'boom' })], new Int16Array(8), 48000, throwGuard)
  assert.equal(throwRound.failure, 'failed')
  assert.equal(throwFailures, 1)
})

// 原始 PCM 契约：调度层把同一份引用交给每个引擎，不拷贝、不降采样。
// 引用同一之外还得钉住内容——`pcm.set(...)` 式的就地加工（归一化/重采样）引用不变，
// 只比 assert.equal(seen, pcm) 抓不到。并行之后这条更要紧：两个引擎同时读同一块内存。
test('每个引擎拿到的都是调用方给的同一份原始 PCM 引用、同一采样率、未被就地加工', async() => {
  const seen: Int16Array[] = []
  const seenRates: number[] = []
  const seenContent: number[][] = []
  const engines: RecognizeEngine[] = [
    { id: 'ncm', recognize: async(pcm, sampleRate) => { seen.push(pcm); seenRates.push(sampleRate); seenContent.push(Array.from(pcm)); return null } },
    { id: 'shazam', recognize: async(pcm, sampleRate) => { seen.push(pcm); seenRates.push(sampleRate); seenContent.push(Array.from(pcm)); return song('B') } },
  ]
  const pcm = new Int16Array([1, 2, 3, 4])
  await recognizeWithEngines(engines, pcm, 48000, makeGuard().guard)
  assert.equal(seen.length, 2)
  assert.equal(seen[0], pcm)
  assert.equal(seen[1], pcm)
  assert.deepEqual(seenRates, [48000, 48000], '采样率是引擎算降采样步长的唯一依据，不许丢')
  assert.deepEqual(seenContent, [[1, 2, 3, 4], [1, 2, 3, 4]], '调度层不许就地加工/重采样识别窗口')
  assert.deepEqual(Array.from(pcm), [1, 2, 3, 4], '一轮调度之后窗口内容必须原封不动')
})
