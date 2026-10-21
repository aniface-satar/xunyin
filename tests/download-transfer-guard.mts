import test from 'node:test'
import assert from 'node:assert/strict'

import {
  TRANSFER_STALL_MS,
  TransferStalledError,
  withTransferWatchdog,
} from '../src/core/download/transferGuard.ts'
import type { TimerDriver } from '../src/core/download/stageGuard.ts'

const tick = () => new Promise(resolve => { setTimeout(resolve, 0) })

/** 假时钟：到期时间自己控制，能精确验证「推后」而不是靠真等 60 秒 */
const createFakeClock = () => {
  let now = 0
  let nextId = 0
  const timers = new Map<number, { at: number, callback: () => void }>()
  const timer: TimerDriver = {
    set: (callback, ms) => {
      const id = ++nextId
      timers.set(id, { at: now + ms, callback })
      return id
    },
    clear: (handle) => {
      timers.delete(handle as number)
    },
  }
  const advance = (ms: number) => {
    now += ms
    for (const [id, entry] of [...timers]) {
      if (entry.at > now) continue
      timers.delete(id)
      entry.callback()
    }
  }
  return { timer, advance, pending: () => timers.size }
}

const neverSettles = () => new Promise<string>(() => {})

test('整段传输的静默上限比原生自己的连接 + 读超时更宽，慢但会成功的下载不会被误杀', () => {
  // RNFS 在安卓侧带的是 connectionTimeout 15s + readTimeout 30s
  assert.ok(TRANSFER_STALL_MS > 45_000, `stall window ${TRANSFER_STALL_MS}ms would fire before the native timeouts can`)
})

test('一直没有字节在动：到点判死，并让调度器停掉原生任务', async() => {
  const { timer, advance } = createFakeClock()
  const stalls: number[] = []
  const watchdog = withTransferWatchdog(neverSettles(), {
    timer,
    onStall: () => { stalls.push(1) },
  })

  advance(TRANSFER_STALL_MS - 1)
  assert.equal(stalls.length, 0, '没到点就放弃会把慢网上的正常下载杀掉')

  advance(1)
  await assert.rejects(watchdog.promise, TransferStalledError)
  assert.equal(stalls.length, 1)
})

test('每个进度事件都把放弃时间往后推：只要字节还在动就不算卡', async() => {
  const { timer, advance, pending } = createFakeClock()
  const watchdog = withTransferWatchdog(neverSettles(), { timer, onStall: () => {} })

  advance(30_000)
  watchdog.bump()
  advance(40_000)
  assert.equal(pending(), 1, 'bump 之后旧的计时器必须换掉，否则还是会在原定时间判死')

  // bump 发生在 t=30s，所以新的死线是 t=90s
  advance(19_999)
  assert.equal(pending(), 1, '还没到新的死线就判死等于没把 bump 算数')
  advance(1)
  await assert.rejects(watchdog.promise, TransferStalledError)
})

test('传输正常结束：结果照常返回，计时器收干净', async() => {
  const { timer, advance, pending } = createFakeClock()
  const watchdog = withTransferWatchdog(Promise.resolve('done'), { timer, onStall: () => {} })
  await tick()

  assert.equal(await watchdog.promise, 'done')
  assert.equal(pending(), 0)
  advance(TRANSFER_STALL_MS * 2)
  await tick()
  assert.equal(pending(), 0, '落定之后不许再挂新的计时器')
})

test('传输自己失败：原错误原样抛出去，不伪装成卡死', async() => {
  const { timer, pending } = createFakeClock()
  let stalls = 0
  const watchdog = withTransferWatchdog(Promise.reject(new Error('disk full')), {
    timer,
    onStall: () => { stalls++ },
  })

  await assert.rejects(watchdog.promise, /disk full/)
  assert.equal(stalls, 0)
  assert.equal(pending(), 0)
})

test('息屏 / 后台冻结不算卡死：mayAbort 说不该放弃时只把计时重挂', async() => {
  const { timer, advance, pending } = createFakeClock()
  let frozen = true
  let stalls = 0
  const watchdog = withTransferWatchdog(neverSettles(), {
    timer,
    onStall: () => { stalls++ },
    mayAbort: () => !frozen,
  })

  advance(TRANSFER_STALL_MS)
  assert.equal(stalls, 0, '冻住的是系统，不是这条连接')
  assert.equal(pending(), 1, '重新挂上计时，等回到前台再说')

  frozen = false
  advance(TRANSFER_STALL_MS)
  await assert.rejects(watchdog.promise, TransferStalledError)
  assert.equal(stalls, 1)
})

test('停原生任务时自己抛了也要判死：看门狗绝不能把 await 留在永远等不到的状态', async() => {
  const { timer, advance } = createFakeClock()
  const watchdog = withTransferWatchdog(neverSettles(), {
    timer,
    onStall: () => { throw new Error('native module is gone') },
  })

  advance(TRANSFER_STALL_MS)
  await assert.rejects(watchdog.promise, TransferStalledError)
})

test('判死之后原任务才回来落定：不再改判，也不留下计时器', async() => {
  const { timer, advance, pending } = createFakeClock()
  let resolveRun!: (value: string) => void
  const run = new Promise<string>((resolve) => { resolveRun = resolve })
  const watchdog = withTransferWatchdog(run, { timer, onStall: () => {} })

  advance(TRANSFER_STALL_MS)
  watchdog.bump()
  assert.equal(pending(), 0, 'settled 之后 bump 不该再挂计时器')

  resolveRun('late')
  await assert.rejects(watchdog.promise, TransferStalledError)
  await tick()
  assert.equal(pending(), 0)
})
