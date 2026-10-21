import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { inFlightProgress, isSaving, progressLabel, transferDone } from '../src/core/download/progress.ts'

const read = (rel: string) => readFileSync(path.join(import.meta.dirname, rel), 'utf8')
const schedulerSource = read('../src/core/download/scheduler.ts')
const listItemSource = read('../src/screens/Home/Views/Download/ListItem.tsx')

/** 传到一半：进度按比例，但永远不给 100% */
test('a download still in flight never reads 100%', () => {
  assert.equal(inFlightProgress(512, 1024), 0.5)
  assert.equal(inFlightProgress(1024, 1024), 0.99)
  assert.equal(inFlightProgress(2048, 1024), 0.99)
  assert.equal(progressLabel(inFlightProgress(1024, 1024)), '99%')
})

/** 边界：不知道总长就没有比例，负数不能把进度条拽反 */
test('unknown or bogus byte counts fall back to zero instead of NaN', () => {
  assert.equal(inFlightProgress(400, 0), 0)
  assert.equal(inFlightProgress(-10, 1024), 0)
  assert.equal(progressLabel(0), '0%')
})

/** 字节真的拿全了才算 100%，顺带把总长按实到手的大小补齐（有些直链不给 Content-Length） */
test('a finished transfer reports one full file', () => {
  assert.deepEqual(transferDone(900, 1024), { downloaded: 1024, total: 1024, progress: 1 })
  assert.deepEqual(transferDone(1024, 0), { downloaded: 1024, total: 1024, progress: 1 })
  assert.equal(progressLabel(1), '100%')
})

/** 「正在保存」这一格只在"歌已经到手、还在写标签和搬家"的时候出现 */
test('only a running task that has all its bytes counts as saving', () => {
  assert.equal(isSaving('run', 1), true)
  assert.equal(isSaving('run', 0.99), false)
  assert.equal(isSaving('waiting', 1), false)
  assert.equal(isSaving('completed', 1), false)
  assert.equal(isSaving('error', 1), false)
})

test('the row shows its percent from the progress value, not from the status text', () => {
  assert.match(listItemSource, /progressLabel\(item\.progress\)/)
  assert.match(listItemSource, /isSaving\(item\.status, item\.progress\)/)
  assert.match(listItemSource, /t\('download_status_saving'\)/)
  assert.equal([...listItemSource.matchAll(/item\.statusText/g)].length, 1, 'statusText is the error label only')
  assert.match(listItemSource, /'error' \? item\.statusText/)
})

test('the transfer-done write pushes the row to 100% and stops reporting speed', () => {
  // 传输结果现在挂在看门狗上（await transfer.promise），锚点跟着放宽一格
  const anchor = schedulerSource.search(/const result = await (?:transfer\.)?promise/)
  assert.ok(anchor >= 0, 'the scheduler no longer awaits the transfer result where this gate expects it')
  const done = schedulerSource.slice(anchor)
  const patch = done.slice(0, done.indexOf('} catch {'))
  assert.match(patch, /transferDone\(/)
  assert.match(patch, /progress: /)
  assert.match(patch, /speed: ''/, 'a finished transfer still showing 0.00 B/s is what makes the row look stuck')
})

test('progress samples stop pretending to own the status text', () => {
  assert.doesNotMatch(schedulerSource, /statusText:\s*`\$\{/, 'the scheduler must not write a percentage into statusText')
  assert.match(schedulerSource, /inFlightProgress\(/)
})

test('the saving label exists in every locale', () => {
  for (const locale of ['zh-cn', 'zh-tw', 'en-us']) {
    const lang = JSON.parse(read(`../src/lang/${locale}.json`))
    const text = lang.download_status_saving
    assert.ok(typeof text == 'string' && text.length > 0, `${locale} has no download_status_saving`)
    assert.ok(!text.includes('%'), `${locale} saving label must not look like a percentage`)
  }
})
