import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { guardStages, stageTimeout, withStageTimeout, type TimerDriver } from '../src/core/download/stageGuard.ts'
import { ownsTask } from '../src/core/download/pausePlan.ts'

const schedulerSource = readFileSync(path.join(import.meta.dirname, '../src/core/download/scheduler.ts'), 'utf8')

const runTaskBody = () => schedulerSource.slice(
  schedulerSource.indexOf('const runTask ='),
  schedulerSource.indexOf('const runQueue ='),
)

/** 假时钟：不真的等 60 秒，只把"到点"这件事手动触发一次 */
const createFakeTimer = () => {
  const due: Array<() => void> = []
  const cleared: number[] = []
  const timer: TimerDriver = {
    set: (callback, ms) => {
      due.push(callback)
      return ms
    },
    clear: () => { cleared.push(1) },
  }
  return { timer, due, cleared }
}

test('no single stage can hold the queue for more than a minute', () => {
  const stages = guardStages()
  assert.ok(stages.length >= 6, 'every post-取链 stage should be registered in the table')
  for (const stage of stages) {
    const ms = stageTimeout(stage)
    assert.ok(Number.isFinite(ms) && ms > 0, `${stage} has no timeout`)
    assert.ok(ms <= 60_000, `${stage} can freeze the queue for ${ms}ms`)
  }
})

test('a stage that never settles is abandoned instead of freezing the queue', async() => {
  const { timer, due } = createFakeTimer()
  const result = withStageTimeout(new Promise(() => {}), 'publish', timer)
  due[0]()
  await assert.rejects(result, /timeout/)
})

test('a stage that finishes in time keeps its result and cancels the watchdog', async() => {
  const { timer, cleared } = createFakeTimer()
  assert.equal(await withStageTimeout(Promise.resolve('fLaC'), 'head', timer), 'fLaC')
  assert.equal(cleared.length, 1)
})

test('a failing stage still fails instead of being reported as a timeout', async() => {
  const { timer, cleared } = createFakeTimer()
  await assert.rejects(withStageTimeout(Promise.reject(new Error('disk full')), 'publish', timer), /disk full/)
  assert.equal(cleared.length, 1)
})

test('only the run that still owns the task may write it', () => {
  assert.equal(ownsTask('run'), true)
  assert.equal(ownsTask('waiting'), false)
  assert.equal(ownsTask('pause'), false)
  assert.equal(ownsTask('error'), false)
  assert.equal(ownsTask('completed'), false)
  assert.equal(ownsTask(undefined), false)
})

test('every stage the scheduler waits for is guarded', () => {
  for (const stage of guardStages()) {
    assert.ok(schedulerSource.includes(`guardStage('${stage}'`), `${stage} is awaited without a watchdog`)
  }
})

test('a run writes the task only through the guarded updater', () => {
  const body = runTaskBody()
  assert.equal([...body.matchAll(/updateItem\(/g)].length, 1, 'runTask must not write the task directly; the only updateItem call should be the guarded update() helper')
  assert.match(body, /const update = [\s\S]{0,120}!isCurrentRun\(\)/)
})

test('the queue itself is the one that claims a task as running', () => {
  const body = schedulerSource.slice(schedulerSource.indexOf('const runQueue ='))
  const claim = body.indexOf("updateItem(waitingItem.id, { status: 'run'")
  const run = body.indexOf('await runTask(')
  assert.ok(claim >= 0, 'runQueue never marks the task as running')
  assert.ok(claim < run, 'the task starts writing before it owns itself')
})

test('a song the user changed their mind about is dropped before it can be published', () => {
  const body = runTaskBody()
  const bail = body.search(/if \(!isCurrentRun\(\) \|\| !state\.list\.some/)
  assert.ok(bail >= 0, 'runTask never bails out after the transfer when the user changed their mind')
  const sniff = body.indexOf("guardStage('head'")
  assert.ok(bail < sniff, 'a superseded round still sniffs, tags and publishes a file it should have dropped')
  assert.match(body.slice(bail, bail + 200), /removeTempFile\(tempPath\)/)
})

test('a task that throws is failed, not left holding the queue', () => {
  const body = schedulerSource.slice(schedulerSource.indexOf('const runQueue ='))
  assert.match(body, /try \{\s*await runTask\(/)
  assert.match(schedulerSource, /'download_failed_unexpected'/)
})

test('取直链也要看门狗：脚本多源接力没有统一超时，它卡住整张列表就得陪着排队', () => {
  const body = runTaskBody()
  const guarded = body.indexOf("guardStage('url'")
  const fetchUrl = body.indexOf('getMusicUrl({')
  assert.ok(guarded >= 0, 'the url fetch is awaited without a watchdog')
  assert.ok(guarded < fetchUrl, 'the fetcher must be handed to the guard, not called outside it')
})

test('传输阶段挂在静默看门狗上，而不是直接把原生 promise 等到底', () => {
  const body = runTaskBody()
  assert.match(body, /withTransferWatchdog\(/, 'the raw native promise can never settle; it must be raced against a watchdog')
  assert.match(body, /const result = await transfer\.promise/, 'the watchdog is built but never awaited')
  assert.match(body, /transfer\?\.bump\(\)/, 'progress events must push the stall deadline back')
  assert.match(body, /onStall: \(\) => \{ stopJob\(id, startedJobId\) \}/, 'a stalled transfer must stop the native job instead of leaving it running')
  assert.match(body, /mayAbort: isActive/, 'a frozen app (screen off) must not be reported as a stalled transfer')
  assert.match(body, /err instanceof TransferStalledError \? 'download_transfer_stalled'/, 'a stall needs its own message: it is retryable, not a disk problem')
})

test('队列收尾时只要还有等着的任务就再拉一轮：错过一次唤醒也不再停在排队中', () => {
  const body = schedulerSource.slice(schedulerSource.indexOf('const finishQueueRun'))
  assert.match(body, /hasWaitingTask\(\)/, 'finishQueueRun never looks for tasks that arrived while the loop was exiting')
  assert.match(body, /if \(hasWaitingTask\(\)\) launchQueue\(\)/)
})

test('循环自己崩掉不会让队列永久停摆', () => {
  const crash = schedulerSource.slice(schedulerSource.indexOf('const handleQueueCrash'))
  assert.match(crash, /isQueueRunning = false/, 'the running flag must be released or no later start can ever run')
  assert.match(crash, /finishQueueRun\(epoch\)/, 'a crashed loop with waiting tasks must be started again')
  assert.match(crash, /lastQueueCrashAt/, 'back-to-back crashes must not spin the loop')
  assert.doesNotMatch(schedulerSource, /runQueue\(\)\.finally/, 'the crash path must not be swallowed by a bare finally')
})

test('队列自称在跑却没人被认领时自愈，且旧的一轮不许再认领任务', () => {
  const body = schedulerSource.slice(schedulerSource.indexOf('const startQueue'))
  assert.match(body, /queueLooksStuck\(\)/, 'a round parked on a dead await would leave the list waiting forever')
  assert.match(body, /queueEpoch \+= 1/, 'the stale round must be invalidated, otherwise two rounds could claim tasks')
  assert.match(schedulerSource, /if \(epoch !== queueEpoch\)/, 'the stale round must check its epoch before claiming the next task')
})

test('点击下载的队列踢动在 toast 之前：报告失败不许把下载一起带走', () => {
  const body = schedulerSource.slice(schedulerSource.indexOf('export const enqueueDownloads'))
  const kick = body.indexOf('startQueue()')
  const report = body.indexOf('reportEnqueue(added')
  assert.ok(kick >= 0 && report >= 0)
  assert.ok(kick < report, 'a throwing toast would otherwise leave the task parked at 排队中')
  assert.match(body, /catch \(err: any\) \{\s*dldbg|catch \(err: any\) \{\s*log\.error\('download enqueue failed/, 'the enqueue body must not let an unexpected error skip the queue kick')
})

test('被顶替的那一轮看门狗不许停掉用户刚点的新任务', () => {
  const stop = schedulerSource.slice(schedulerSource.indexOf('const stopJob ='), schedulerSource.indexOf('const runTask ='))
  assert.match(stop, /currentJobId !== jobId/, 'stopping by song id alone lets a stale watchdog kill the resumed download')
  assert.match(runTaskBody(), /onStall: \(\) => \{ stopJob\(id, startedJobId\) \}/, 'the watchdog must tell stopJob which job it owns')
  assert.match(runTaskBody(), /runningJobs\.get\(id\) === jobId\) runningJobs\.delete\(id\)/, 'the finally must not unregister a job that was already replaced by a newer run')
})

test('回到前台再拉一次队列：后台被系统冻过之后不留一张停在排队中的列表', () => {
  assert.match(schedulerSource, /AppState\.addEventListener\('change'/)
  const body = schedulerSource.slice(schedulerSource.indexOf("AppState.addEventListener('change'"))
  assert.match(body.slice(0, 200), /if \(status === 'active'\) startQueue\(\)/)
})
