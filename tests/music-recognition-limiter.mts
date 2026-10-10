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

test('没有记录时直接放行', async() => {
  const guard = createGuard({ maxPerDay: 30, storage: makeStorage(), now: () => day1 })
  assert.equal(await guard.check(), 'allow')
})

test('到达每日上限后返回 daily，且不再累加计数', async() => {
  const storage = makeStorage()
  const guard = createGuard({ maxPerDay: 3, storage, now: () => day1 })
  for (let i = 0; i < 3; i++) {
    assert.equal(await guard.check(), 'allow')
    await guard.onAttempt()
  }
  assert.equal(await guard.check(), 'daily')
  await guard.onAttempt()
  assert.equal(JSON.parse(storage.peek()!).count, 3)
})

test('跨自然日重置计数', async() => {
  let now = day1
  const guard = createGuard({ maxPerDay: 1, storage: makeStorage(), now: () => now })
  await guard.onAttempt()
  assert.equal(await guard.check(), 'daily')
  now += DAY_MS
  assert.equal(await guard.check(), 'allow')
})

test('连续失败按 1s / 5s / 30s 退避，之后保持 30s', async() => {
  let now = day1
  const guard = createGuard({ maxPerDay: 30, storage: makeStorage(), now: () => now })
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
  const guard = createGuard({ maxPerDay: 30, storage, now: () => day1 })
  await guard.onFailure()
  await guard.onFailure()
  assert.equal(await guard.check(), 'cooldown')
  await guard.onSuccess()
  assert.equal(await guard.check(), 'allow')
  assert.equal(JSON.parse(storage.peek()!).fails, 0)
  assert.equal(JSON.parse(storage.peek()!).blockedUntil, 0)
})

test('存储里是脏数据 / 读取抛异常时退回空状态，不炸', async() => {
  assert.equal(await createGuard({ maxPerDay: 30, storage: makeStorage('{"count":'), now: () => day1 }).check(), 'allow')
  const broken: GuardStorage = { get: async() => { throw new Error('storage down') }, set: async() => {} }
  assert.equal(await createGuard({ maxPerDay: 30, storage: broken, now: () => day1 }).check(), 'allow')
})
