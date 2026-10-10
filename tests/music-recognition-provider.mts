import test from 'node:test'
import assert from 'node:assert/strict'
import { recognizeWithEngines } from '../src/core/musicRecognition/provider.ts'
import type { Guard, RecognizeEngine, RecognizedSong } from '../src/core/musicRecognition/types.ts'

const song = (name: string): RecognizedSong => ({ name, singer: 'x', albumName: '', neteaseSongId: '', startTimeMs: 0 })

type Gate = 'allow' | 'daily' | 'cooldown'

const makeGuard = (gate: Gate = 'allow') => {
  const calls: string[] = []
  const guard: Guard = {
    check: async() => { calls.push('check'); return gate },
    onAttempt: async() => { calls.push('attempt') },
    onSuccess: async() => { calls.push('success') },
    onFailure: async() => { calls.push('failure') },
  }
  return { calls, guard }
}

const fakeEngine = (id: string, behaviour: { result?: RecognizedSong | null, error?: string }): RecognizeEngine => ({
  id,
  recognize: async() => {
    if (behaviour.error) throw new Error(behaviour.error)
    return behaviour.result ?? null
  },
})

test('第一个引擎命中就返回，绝不问第二个', async() => {
  const touched: string[] = []
  const engines: RecognizeEngine[] = [
    { id: 'ncm', recognize: async() => { touched.push('ncm'); return song('A') } },
    { id: 'shazam', recognize: async() => { touched.push('shazam'); return song('B') } },
  ]
  const outcome = await recognizeWithEngines(engines, new Int16Array(8), makeGuard().guard)
  assert.deepEqual(touched, ['ncm'])
  assert.equal(outcome.ok, true)
  if (outcome.ok) {
    assert.equal(outcome.song.name, 'A')
    assert.equal(outcome.engineId, 'ncm')
  }
})

test('第一个引擎抛异常要降级到第二个', async() => {
  const engines = [fakeEngine('ncm', { error: 'boom' }), fakeEngine('shazam', { result: song('B') })]
  const outcome = await recognizeWithEngines(engines, new Int16Array(8), makeGuard().guard)
  assert.equal(outcome.ok, true)
  if (outcome.ok) assert.equal(outcome.engineId, 'shazam')
})

test('有引擎抛异常且全部没命中：reason 是 failed，并走退避', async() => {
  const { calls, guard } = makeGuard()
  const engines = [fakeEngine('ncm', { error: 'boom' }), fakeEngine('shazam', { result: null })]
  const outcome = await recognizeWithEngines(engines, new Int16Array(8), guard)
  assert.equal(outcome.ok, false)
  if (!outcome.ok) assert.equal(outcome.reason, 'failed')
  assert.deepEqual(calls, ['check', 'attempt', 'failure'])
})

test('全都安静地没命中：reason 是 no_match，既不退避也不清零', async() => {
  const { calls, guard } = makeGuard()
  const engines = [fakeEngine('ncm', { result: null }), fakeEngine('shazam', { result: null })]
  const outcome = await recognizeWithEngines(engines, new Int16Array(8), guard)
  assert.equal(outcome.ok, false)
  if (!outcome.ok) assert.equal(outcome.reason, 'no_match')
  assert.deepEqual(calls, ['check', 'attempt'])
})

test('闸门挡住时一个引擎都不发请求', async() => {
  for (const gate of ['daily', 'cooldown'] as const) {
    let touched = false
    const engines: RecognizeEngine[] = [{ id: 'ncm', recognize: async() => { touched = true; return song('A') } }]
    const outcome = await recognizeWithEngines(engines, new Int16Array(8), makeGuard(gate).guard)
    assert.equal(touched, false)
    assert.equal(outcome.ok, false)
    if (!outcome.ok) assert.equal(outcome.reason, gate)
  }
})

test('没有可用引擎（比如 iOS 或 Shazam 标签）时 reason 是 unsupported', async() => {
  const { calls, guard } = makeGuard()
  const outcome = await recognizeWithEngines([], new Int16Array(8), guard)
  assert.equal(outcome.ok, false)
  if (!outcome.ok) assert.equal(outcome.reason, 'unsupported')
  assert.deepEqual(calls, ['check'], '没有引擎时不该占用每日次数')
})

test('命中后 onSuccess 被调用一次', async() => {
  const { calls, guard } = makeGuard()
  await recognizeWithEngines([fakeEngine('ncm', { result: song('A') })], new Int16Array(8), guard)
  assert.deepEqual(calls, ['check', 'attempt', 'success'])
})

test('单个引擎的 recognize 收到的是调用方给的同一份 8k 窗口', async() => {
  let seen: Int16Array | null = null
  const engines: RecognizeEngine[] = [{ id: 'ncm', recognize: async(pcm) => { seen = pcm; return null } }]
  const pcm = new Int16Array([1, 2, 3])
  await recognizeWithEngines(engines, pcm, makeGuard().guard)
  assert.equal(seen, pcm)
})

// Ruling T4f：运营方把引擎全关（remoteConfig.sanitizeConfig 会给出 engines: []）时
// 调度层必须安静地返回 unsupported，不许抛、也不许假设数组里至少有 ncm 一条。
test('配置把引擎全关（engines 为空数组）时不抛异常，只报 unsupported 且不占额度', async() => {
  const { calls, guard } = makeGuard()
  const outcome = await recognizeWithEngines([], new Int16Array(8), guard)
  assert.equal(outcome.ok, false)
  if (!outcome.ok) assert.equal(outcome.reason, 'unsupported')
  assert.deepEqual(calls, ['check'], '空引擎数组不该触发 onAttempt/onSuccess/onFailure')
})

// Ruling T3b：null（安静未命中）与抛异常（服务故障）是两条不同的路，
// 只有后者才累计失败退避。把异常当未命中会让保险丝永远不生效。
test('引擎返回 null 不累计失败，抛异常恰好累计一次失败', async() => {
  let nullGuardFailures = 0
  const nullGuard: Guard = {
    check: async() => 'allow',
    onAttempt: async() => {},
    onSuccess: async() => {},
    onFailure: async() => { nullGuardFailures += 1 },
  }
  const nullOutcome = await recognizeWithEngines([fakeEngine('ncm', { result: null })], new Int16Array(8), nullGuard)
  assert.equal(nullOutcome.ok, false)
  if (!nullOutcome.ok) assert.equal(nullOutcome.reason, 'no_match')
  assert.equal(nullGuardFailures, 0, 'null 是「没听出来」，不该进退避')

  let throwGuardFailures = 0
  const throwGuard: Guard = {
    check: async() => 'allow',
    onAttempt: async() => {},
    onSuccess: async() => {},
    onFailure: async() => { throwGuardFailures += 1 },
  }
  const throwOutcome = await recognizeWithEngines([fakeEngine('ncm', { error: 'boom' })], new Int16Array(8), throwGuard)
  assert.equal(throwOutcome.ok, false)
  if (!throwOutcome.ok) assert.equal(throwOutcome.reason, 'failed')
  assert.equal(throwGuardFailures, 1, '一次故障只累计一次失败，整轮只记一次')

  // 命中就短路：前面引擎抛过异常也不该留下失败计数
  let hitFailures = 0
  let hitSuccesses = 0
  const hitGuard: Guard = {
    check: async() => 'allow',
    onAttempt: async() => {},
    onSuccess: async() => { hitSuccesses += 1 },
    onFailure: async() => { hitFailures += 1 },
  }
  const engines = [fakeEngine('ncm', { error: 'boom' }), fakeEngine('shazam', { result: song('B') })]
  const hitOutcome = await recognizeWithEngines(engines, new Int16Array(8), hitGuard)
  assert.equal(hitOutcome.ok, true)
  assert.equal(hitFailures, 0)
  assert.equal(hitSuccesses, 1)
})

// 8kHz 契约：调度层把同一份引用依次交给每个引擎，不拷贝、不重采样。
test('降级到后续引擎时拿到的还是同一份 8k 窗口引用，没有拷贝', async() => {
  const seen: Int16Array[] = []
  const engines: RecognizeEngine[] = [
    { id: 'ncm', recognize: async(pcm) => { seen.push(pcm); throw new Error('boom') } },
    { id: 'shazam', recognize: async(pcm) => { seen.push(pcm); return null } },
  ]
  const pcm = new Int16Array([1, 2, 3, 4])
  await recognizeWithEngines(engines, pcm, makeGuard().guard)
  assert.equal(seen.length, 2)
  assert.equal(seen[0], pcm)
  assert.equal(seen[1], pcm)
})
