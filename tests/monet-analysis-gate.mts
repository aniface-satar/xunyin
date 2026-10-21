import test from 'node:test'
import assert from 'node:assert/strict'

import { ANALYSIS_IDLE_FALLBACK_MS, createIdleRunner } from '../src/utils/monet/analysisGate.ts'

/** 假的 InteractionManager：只记录回调，由用例决定它什么时候"空出来"。
 *  真 RN 的 runAfterInteractions 不会同步回调，所以这里同步回调那一支单独测（防 TDZ）。 */
const fakeIdle = () => {
  const queued: Array<{ cb: () => void }> = []
  const cancelled: string[] = []
  return {
    queued,
    cancelled,
    runAfterInteractions: (cb: () => void) => {
      queued.push({ cb })
      return { cancel: () => { cancelled.push('idle') } }
    },
    /** 模拟"所有交互句柄都清了" */
    settle: () => { const entry = queued.shift(); entry?.cb() },
  }
}

const fakeTimer = () => {
  const armed: Array<{ ms: number, cb: () => void }> = []
  const cleared: number[] = []
  let handle = 0
  return {
    armed,
    cleared,
    setTimeoutFn: (cb: () => void, ms: number) => {
      armed.push({ ms, cb })
      return handle++
    },
    clearTimeoutFn: (h: unknown) => { cleared.push(h as number) },
    /** 模拟时钟走到兜底期限 */
    fire: (index = 0) => { const task = armed[index]; task?.cb() },
  }
}

test('空闲一直不来时仍会跑，而且跑的这一趟按兜底期限定时（漏挂定时器=取色永不落地）', async() => {
  const idle = fakeIdle()
  const timer = fakeTimer()
  const run = createIdleRunner({
    runAfterInteractions: idle.runAfterInteractions,
    setTimeoutFn: timer.setTimeoutFn,
    clearTimeoutFn: timer.clearTimeoutFn,
  })
  let calls = 0
  const settled = run(() => { calls += 1 })

  // 交互占着、期限还没到：一次都不许跑（跑了就是老行为，卡顿照旧）
  await Promise.resolve()
  assert.equal(calls, 0)
  assert.equal(timer.armed.length, 1, '没挂兜底定时器：拖动一直不停就永远不取色')
  assert.equal(timer.armed[0].ms, ANALYSIS_IDLE_FALLBACK_MS)

  timer.fire()
  await settled
  assert.equal(calls, 1)
})

test('交互先空出来：立刻跑，并把兜底定时器取消掉（不取消=白留一个定时器在场）', async() => {
  const idle = fakeIdle()
  const timer = fakeTimer()
  const run = createIdleRunner({
    runAfterInteractions: idle.runAfterInteractions,
    setTimeoutFn: timer.setTimeoutFn,
    clearTimeoutFn: timer.clearTimeoutFn,
  })
  let calls = 0
  const settled = run(() => { calls += 1; return 'surface' })

  idle.settle()
  assert.equal(await settled, 'surface')
  assert.equal(calls, 1)
  assert.deepEqual(timer.cleared, timer.armed.map((_, i) => i), 'idle 赢了却没清定时器')
})

test('两条路都到也只跑一次：先兜底后空闲不重跑，事后也要 cancel 掉那条排队', async() => {
  const idle = fakeIdle()
  const timer = fakeTimer()
  const run = createIdleRunner({
    runAfterInteractions: idle.runAfterInteractions,
    setTimeoutFn: timer.setTimeoutFn,
    clearTimeoutFn: timer.clearTimeoutFn,
  })
  let calls = 0
  const settled = run(() => { calls += 1 })

  timer.fire()
  await settled
  idle.settle()
  await Promise.resolve()
  assert.equal(calls, 1, `量化跑了两遍：JS 线程白挨一次 100ms+`)
  assert.deepEqual(idle.cancelled, ['idle'])
})

test('任务抛错时 promise 必须 reject（挂住不清会把整条取色链卡死）', async() => {
  const idle = fakeIdle()
  const timer = fakeTimer()
  const run = createIdleRunner({
    runAfterInteractions: idle.runAfterInteractions,
    setTimeoutFn: timer.setTimeoutFn,
    clearTimeoutFn: timer.clearTimeoutFn,
  })
  let calls = 0
  const settled = run(() => { calls += 1; throw new Error('量化炸了') })
  idle.settle()
  await assert.rejects(settled, /量化炸了/)
  assert.equal(calls, 1)
})

test('调度器同步回调（假 idle 立刻放行）也不能踩到未初始化的定时器', async() => {
  const timer = fakeTimer()
  const run = createIdleRunner({
    // 真 InteractionManager 不同步回调，但注入点必须对"同步就放行"免疫：
    // 早先写法在这里读正在初始化的 idle/timer 会踩 TDZ，promise 永不 settle
    runAfterInteractions: (cb: () => void) => { cb(); return { cancel: () => {} } },
    setTimeoutFn: timer.setTimeoutFn,
    clearTimeoutFn: timer.clearTimeoutFn,
  })
  let calls = 0
  assert.equal(await run(() => { calls += 1; return 42 }), 42)
  assert.equal(calls, 1)
})
