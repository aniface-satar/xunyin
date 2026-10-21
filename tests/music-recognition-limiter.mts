import test from 'node:test'
import assert from 'node:assert/strict'
import { BACKOFF_MS, createGuard, type GuardStorage } from '../src/core/musicRecognition/limiter.ts'

const makeStorage = (initial: string | null = null) => {
  let value: string | null = initial
  const storage: GuardStorage & { peek(): string | null } = {
    peek: () => value,
    get: async() => value,
    set: async(next: string) => { value = next },
  }
  return storage
}

const DAY_MS = 86_400_000
const day1 = new Date(2026, 9, 10, 4, 0, 0).getTime()
// 离午夜只剩 20 秒的时刻：用来验证「冷却是时间型的，跨日翻页不该把它抹掉」
const nearMidnight = new Date(2026, 9, 10, 23, 59, 40).getTime()

const readStored = (raw: string | null) => raw == null ? null : JSON.parse(raw) as Record<string, unknown>

const make = (storage: GuardStorage, now: () => number) => createGuard({ storage, now })

test('没有记录时直接放行', async() => {
  assert.equal(await make(makeStorage(), () => day1).check(), 'allow')
})

// 面板在录音前问一次、provider 在引擎前再问一次，同一轮里 check() 至少被调两遍。
// 前提必须是它只读不写：否则光是「提前告诉用户现在还在冷却」就会把状态搅乱。
test('check() 只读不写，连问多次一个字节都不落盘', async() => {
  const storage = makeStorage()
  const guard = make(storage, () => day1)
  for (let i = 0; i < 5; i++) assert.equal(await guard.check(), 'allow')
  assert.equal(storage.peek(), null)
})

// 钉住 2026-10-11 那条裁定：每日次数上限取消，闸门只认时间型的冷却。
// 修复前的形态是 maxPerDay 一到就回 'daily'，这里 200 轮必须一路放行。
test('没有每日次数上限：连点 200 轮全部放行', async() => {
  const guard = make(makeStorage(), () => day1)
  for (let i = 0; i < 200; i++) assert.equal(await guard.check(), 'allow', `第 ${i} 轮被拦`)
})

test('连续失败按 1s / 5s / 30s 退避，之后保持 30s', async() => {
  let now = day1
  const guard = make(makeStorage(), () => now)
  for (const wait of [1000, 5000, 30000, 30000]) {
    assert.equal(await guard.check(), 'allow')
    await guard.onFailure()
    assert.equal(await guard.check(), 'cooldown')
    now += wait - 1
    assert.equal(await guard.check(), 'cooldown')
    now += 1
    assert.equal(await guard.check(), 'allow')
  }
  assert.deepEqual(BACKOFF_MS, [1000, 5000, 30000])
})

test('一次成功清零失败计数与冷却', async() => {
  const storage = makeStorage()
  const guard = make(storage, () => day1)
  await guard.onFailure()
  await guard.onFailure()
  assert.equal(await guard.check(), 'cooldown')
  await guard.onSuccess()
  assert.equal(await guard.check(), 'allow')
  assert.equal(readStored(storage.peek())!.fails, 0)
  assert.equal(readStored(storage.peek())!.blockedUntil, 0)
})

test('冷却窗口跨日翻页仍然生效（闸门里已经没有 day 这个维度）', async() => {
  let now = nearMidnight // 2026-10-10 23:59:40
  const guard = make(makeStorage(), () => now)
  await guard.onFailure() // 1s
  await guard.onFailure() // 5s
  await guard.onFailure() // 30s -> 窗口尾巴落在 2026-10-11 00:00:10
  assert.equal(await guard.check(), 'cooldown')
  now += 25_000
  assert.equal(new Date(now).getDate(), 11)
  assert.equal(await guard.check(), 'cooldown')
  now += 5_000
  assert.equal(await guard.check(), 'allow')
})

test('跨日不再改变任何判定：昨天失败过、今天照样能录', async() => {
  let now = day1
  const guard = make(makeStorage(), () => now)
  await guard.onFailure()
  assert.equal(await guard.check(), 'cooldown')
  now += 1000
  assert.equal(await guard.check(), 'allow')
  now += DAY_MS * 3
  assert.equal(await guard.check(), 'allow')
})

// 取消上限之前写下的记录还躺在老用户设备上（{"day","count",...}）。
// 读侧必须把它们当脏数据忽略：既不能因为 count=999 就拒绝，也不能因为缺 day 就崩。
test('旧版本残留的 day/count 字段被忽略，不影响放行', async() => {
  for (const raw of ['{"day":"2026-10-10","count":999}', '{"count":"999"}', '{"day":1}', '{"count":null}']) {
    assert.equal(await make(makeStorage(raw), () => day1).check(), 'allow', raw)
  }
})

test('存储里是脏数据 / 读取抛异常时退回空状态，不炸', async() => {
  assert.equal(await make(makeStorage('{"blockedUntil":'), () => day1).check(), 'allow')
  const broken: GuardStorage = { get: async() => { throw new Error('storage down') }, set: async() => {} }
  assert.equal(await make(broken, () => day1).check(), 'allow')
})

test('存储里是合法 JSON 但不是对象时退回空状态，三个方法都不抛', async() => {
  for (const raw of ['null', '123', '"abc"', '[]', 'true']) {
    const storage = makeStorage(raw)
    const guard = make(storage, () => day1)
    assert.equal(await guard.check(), 'allow', raw)
    await guard.onSuccess()
    await guard.onFailure()
    assert.equal(readStored(storage.peek())!.fails, 1, raw)
  }
})

test('存储写入抛异常时三个方法都不 reject，也不影响本轮判定', async() => {
  let calls = 0
  const storage: GuardStorage = {
    get: async() => '{"fails":0,"blockedUntil":0}',
    set: async() => { calls += 1; throw new Error('disk full') },
  }
  const guard = make(storage, () => day1)
  assert.equal(await guard.check(), 'allow')
  await guard.onSuccess()
  await guard.onFailure()
  assert.equal(calls, 2)
})

// 写不进去 = 退避记不上账。这是「存储坏掉时宁可放行也不卡死识曲」的有意降级，
// 但它必须只影响记账，不能让 check() 反过来抛出去。
test('写失败后 check() 仍按盘上旧状态判定，不抛', async() => {
  const storage: GuardStorage = { get: async() => '{"fails":2,"blockedUntil":9e15}', set: async() => { throw new Error('disk full') } }
  const guard = make(storage, () => day1)
  assert.equal(await guard.check(), 'cooldown')
  await guard.onSuccess()
  assert.equal(await guard.check(), 'cooldown')
})
