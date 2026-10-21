import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { canPause, canResume, pausePatch, restartPatch } from '../src/core/download/pausePlan.ts'

const schedulerSource = readFileSync(path.join(import.meta.dirname, '../src/core/download/scheduler.ts'), 'utf8')
const downloadScreenSource = readFileSync(path.join(import.meta.dirname, '../src/screens/Home/Views/Download/index.tsx'), 'utf8')

const metadata = {
  musicInfo: { id: 'song_1', name: '晴天' },
  url: 'https://example.com/expired.mp3',
  quality: '320k' as LX.Quality,
  ext: 'mp3' as LX.Download.FileExt,
  fileName: '晴天 - 周杰伦.mp3',
  filePath: 'content://tree/晴天 - 周杰伦.mp3',
}

test('pausing clears the progress because resuming starts the file over', () => {
  const patch = pausePatch()
  assert.equal(patch.status, 'pause')
  assert.equal(patch.progress, 0)
  assert.equal(patch.downloaded, 0)
  assert.equal(patch.total, 0)
  assert.equal(patch.speed, '')
  assert.equal(patch.statusText, '')
})

test('resuming puts the task back in the queue without the stale address', () => {
  const patch = restartPatch(metadata as never)
  assert.equal(patch.status, 'waiting')
  assert.equal(patch.isComplate, false)
  assert.equal(patch.progress, 0)
  assert.equal(patch.metadata?.url, null)
})

test('resuming keeps which song and which quality it was', () => {
  const patch = restartPatch(metadata as never)
  assert.equal(patch.metadata?.musicInfo, metadata.musicInfo)
  assert.equal(patch.metadata?.quality, '320k')
  assert.equal(patch.metadata?.fileName, '晴天 - 周杰伦.mp3')
})

test('retrying from the panel can switch the quality while restarting', () => {
  const patch = restartPatch(metadata as never, { quality: '128k', ext: 'mp3' })
  assert.equal(patch.metadata?.quality, '128k')
  assert.equal(patch.metadata?.url, null)
})

test('only a queued or running task can be paused', () => {
  assert.equal(canPause('run'), true)
  assert.equal(canPause('waiting'), true)
  assert.equal(canPause('pause'), false)
  assert.equal(canPause('error'), false)
  assert.equal(canPause('completed'), false)
})

test('only a paused task can be resumed', () => {
  assert.equal(canResume('pause'), true)
  assert.equal(canResume('run'), false)
  assert.equal(canResume('waiting'), false)
  assert.equal(canResume('completed'), false)
})

test('pausing flips the status before killing the request', () => {
  const body = schedulerSource.slice(schedulerSource.indexOf('export const pauseTask'))
  const setStatus = body.indexOf('updateItem(id, pausePatch())')
  const stopRequest = body.indexOf('stopJob(id)')
  assert.ok(setStatus >= 0, 'pauseTask never writes the paused status')
  assert.ok(stopRequest >= 0, 'pauseTask never stops the running request')
  assert.ok(setStatus < stopRequest, 'stopping the request first makes the abort look like a download failure')
})

test('the download page wires the pause and resume actions', () => {
  assert.match(downloadScreenSource, /pauseAll,\s*pauseTask,\s*resumeAll,\s*resumeTask/)
  assert.match(downloadScreenSource, /onPress=\{pauseAll\}/)
  assert.match(downloadScreenSource, /onPress=\{resumeAll\}/)
  assert.match(downloadScreenSource, /pauseTask\(item\.id\)/)
  assert.match(downloadScreenSource, /resumeTask\(item\.id\)/)
})

test('a paused song re-added from the panel is reported as paused, not as downloading', () => {
  assert.match(schedulerSource, /exist\.status === 'pause'/)
  assert.match(schedulerSource, /'download_skipped_paused'/)
})
