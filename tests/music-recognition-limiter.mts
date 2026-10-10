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

const countAllows = async(guard: { check: () => Promise<string>, onAttempt: () => Promise<void> }, times: number) => {
  let allowed = 0
  for (let i = 0; i < times; i++) {
    if (await guard.check() == 'allow') allowed += 1
    await guard.onAttempt()
  }
  return allowed
}

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
  assert.equal(readStored(storage.peek())!.count, 3)
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
  assert.equal(readStored(storage.peek())!.fails, 0)
  assert.equal(readStored(storage.peek())!.blockedUntil, 0)
})

test('存储里是脏数据 / 读取抛异常时退回空状态，不炸', async() => {
  assert.equal(await createGuard({ maxPerDay: 30, storage: makeStorage('{"count":'), now: () => day1 }).check(), 'allow')
  const broken: GuardStorage = { get: async() => { throw new Error('storage down') }, set: async() => {} }
  assert.equal(await createGuard({ maxPerDay: 30, storage: broken, now: () => day1 }).check(), 'allow')
})

// --- C-1 回归：达上限时也要把 day 推进到当天，否则记录永远停在旧的一天 ---

test('打满后跨日：第二天重新拿到满额每日预算，不再永久失效', async() => {
  const storage = makeStorage()
  let now = day1
  const guard = createGuard({ maxPerDay: 2, storage, now: () => now })
  await guard.onAttempt()
  await guard.onAttempt()
  assert.equal(await guard.check(), 'daily')
  assert.equal(readStored(storage.peek())!.day, '2026-10-10')

  now += DAY_MS
  // 评审复现：修复前这里 100 次请求会拿到 100 次 allow（等于没有日限）
  assert.equal(await countAllows(guard, 100), 2)
  assert.equal(await guard.check(), 'daily')
  // day 必须推进到当天，而不是继续躺在昨天
  assert.equal(readStored(storage.peek())!.day, '2026-10-11')
  assert.equal(readStored(storage.peek())!.count, 2)

  now += DAY_MS
  assert.equal(await countAllows(guard, 100), 2)
  assert.equal(readStored(storage.peek())!.day, '2026-10-12')
})

test('打满后跨日：onSuccess/onFailure 写回当天 day，冷却判定不再被陈旧 day 跳过', async() => {
  const storage = makeStorage()
  let now = day1
  const guard = createGuard({ maxPerDay: 1, storage, now: () => now })
  await guard.onAttempt()
  assert.equal(await guard.check(), 'daily')
  now += DAY_MS
  await guard.onSuccess()
  assert.equal(readStored(storage.peek())!.day, '2026-10-11')
  await guard.onFailure()
  assert.equal(readStored(storage.peek())!.day, '2026-10-11')
  assert.equal(await guard.check(), 'cooldown')
})

// --- C-2 回归：跨日不再短路成 allow，时间型冷却始终判得到 ---

test('跨日后的第一次 onFailure 仍进入 cooldown', async() => {
  const storage = makeStorage()
  let now = day1
  const guard = createGuard({ maxPerDay: 30, storage, now: () => now })
  await guard.onAttempt()
  now += DAY_MS
  await guard.onFailure()
  assert.equal(await guard.check(), 'cooldown')
  assert.equal(readStored(storage.peek())!.day, '2026-10-11')
  await guard.onFailure()
  assert.equal(await guard.check(), 'cooldown')
})

test('打满后跨日再失败：每轮都会被 cooldown 二次拦住', async() => {
  let now = day1
  const guard = createGuard({ maxPerDay: 2, storage: makeStorage(), now: () => now })
  await guard.onAttempt()
  await guard.onAttempt()
  now += DAY_MS
  let passed = 0
  let blocked = 0
  for (let i = 0; i < 10; i++) {
    if (await guard.check() == 'allow') passed += 1
    await guard.onAttempt()
    await guard.onFailure()
    if (await guard.check() != 'allow') blocked += 1
  }
  // 钉两件事：放行次数不被每日预算突破，且每轮失败后的二次 check 都拦住
  // （修复前这里是「10 次全放行，二次拦截 0 次」——跨日短路把整根退避保险丝跳过了）。
  assert.ok(passed <= 2, `放行 ${passed} 次，超过每日预算 2`)
  assert.equal(blocked, 10)
})

test('冷却窗口跨日翻页仍然生效（跨日只清 count，不清时间）', async() => {
  let now = nearMidnight // 2026-10-10 23:59:40
  const guard = createGuard({ maxPerDay: 30, storage: makeStorage(), now: () => now })
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

// --- I-1：跨日清零计数，昨天不该偷走今天的预算 ---

test('跨日但没打满：第二天预算不被昨天的用量偷走', async() => {
  const storage = makeStorage()
  let now = day1
  const guard = createGuard({ maxPerDay: 3, storage, now: () => now })
  await guard.onAttempt()
  assert.equal(readStored(storage.peek())!.count, 1)
  now += DAY_MS
  assert.equal(await countAllows(guard, 4), 3)
  assert.equal(readStored(storage.peek())!.count, 3)
})

// --- I-2：合法 JSON 但不是对象 / 写入抛异常都不许外抛 ---

test('存储里是合法 JSON 但不是对象时退回空状态，四个方法都不抛', async() => {
  for (const raw of ['null', '123', '"abc"', '[]', 'true', '{"count":"999"}', '{"count":null}', '{"day":1}']) {
    const storage = makeStorage(raw)
    const guard = createGuard({ maxPerDay: 30, storage, now: () => day1 })
    assert.equal(await guard.check(), 'allow', raw)
    await guard.onAttempt()
    await guard.onSuccess()
    await guard.onFailure()
    assert.equal(readStored(storage.peek())!.day, '2026-10-10', raw)
  }
})

test('存储写入抛异常时四个方法都不 reject，也不影响本轮判定', async() => {
  let calls = 0
  const storage: GuardStorage = {
    get: async() => '{"day":"2026-10-10","count":1,"fails":0,"blockedUntil":0}',
    set: async() => { calls += 1; throw new Error('disk full') },
  }
  const guard = createGuard({ maxPerDay: 30, storage, now: () => day1 })
  assert.equal(await guard.check(), 'allow')
  await guard.onAttempt()
  await guard.onSuccess()
  await guard.onFailure()
  assert.equal(calls, 3)
})

test('脏计数：类型错乱按 0 起算，已超界的计数原样保留且持续判 daily', async() => {
  const storage = makeStorage('{"day":"2026-10-10","count":"999"}')
  const guard = createGuard({ maxPerDay: 1, storage, now: () => day1 })
  assert.equal(await guard.check(), 'allow')
  await guard.onAttempt()
  assert.equal(readStored(storage.peek())!.count, 1)
  assert.equal(await guard.check(), 'daily')

  const overshotStorage = makeStorage('{"day":"2026-10-10","count":99}')
  const overshot = createGuard({ maxPerDay: 1, storage: overshotStorage, now: () => day1 })
  assert.equal(await overshot.check(), 'daily')
  await overshot.onAttempt()
  assert.equal(readStored(overshotStorage.peek())!.count, 99)
})
