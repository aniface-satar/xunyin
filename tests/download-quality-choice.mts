import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { assignQualities, getSharedQualities, isQualitySupported, pickQuality } from '../src/core/download/quality.ts'

const size = (value: string) => ({ size: value })

const song = (qualitys: LX.Music._MusicQualityType) => ({
  source: 'wy' as LX.Source,
  meta: { _qualitys: qualitys },
})

const WY_ALL: LX.Quality[] = ['128k', '320k', 'flac', 'flac24bit']

test('highest picks the top quality both the source and the song offer', () => {
  const info = song({ '128k': size('3 MiB'), '320k': size('8 MiB'), flac: size('30 MiB') })
  assert.equal(pickQuality(info, WY_ALL, 'highest'), 'flac')
})

test('lowest picks the bottom quality', () => {
  const info = song({ '128k': size('3 MiB'), '320k': size('8 MiB'), flac: size('30 MiB') })
  assert.equal(pickQuality(info, WY_ALL, 'lowest'), '128k')
})

test('a quality the source does not list is never picked', () => {
  const info = song({ '128k': size('3 MiB'), flac: size('30 MiB') })
  assert.equal(pickQuality(info, ['128k', '320k'], 'highest'), '128k')
  assert.equal(isQualitySupported(info, ['128k', '320k'], 'flac'), false)
})

test('a quality the song metadata lacks is skipped', () => {
  const info = song({ '128k': size('3 MiB'), flac: size('30 MiB') })
  assert.equal(pickQuality(info, WY_ALL, 'highest'), 'flac')
  assert.equal(pickQuality(info, WY_ALL, 'lowest'), '128k')
})

test('a quality entry without a size is still downloadable', () => {
  const info = song({ '320k': { size: null } })
  assert.equal(pickQuality(info, WY_ALL, 'highest'), '320k')
})

test('nothing supported gives no quality', () => {
  assert.equal(pickQuality(song({ '128k': size('3 MiB') }), [], 'highest'), null)
  assert.equal(pickQuality(song({}), WY_ALL, 'lowest'), null)
})

test('qualities outside the panel order never surface', () => {
  const info = song({ ape: size('40 MiB'), '128k': size('3 MiB') })
  assert.equal(pickQuality(info, ['128k', 'ape', 'wav'], 'highest'), '128k')
})

test('the batch panel only offers qualities every song supports, best first', () => {
  const a = song({ '128k': size('3 MiB'), '320k': size('8 MiB'), flac: size('30 MiB') })
  const b = song({ '128k': size('3 MiB'), '320k': size('8 MiB') })
  assert.deepEqual(getSharedQualities([a, b], () => WY_ALL), ['320k', '128k'])
})

test('one song with no supported quality empties the shared list', () => {
  const a = song({ '128k': size('3 MiB') })
  const b = song({})
  assert.deepEqual(getSharedQualities([a, b], () => WY_ALL), [])
})

test('a fixed quality skips the songs that do not offer it', () => {
  const a = song({ '128k': size('3 MiB'), flac: size('30 MiB') })
  const b = song({ '128k': size('3 MiB') })
  const { assigned, skipped } = assignQualities([a, b], 'flac', () => WY_ALL)
  assert.deepEqual(assigned, [{ musicInfo: a, quality: 'flac' }])
  assert.deepEqual(skipped, [b])
})

test('highest resolves each song on its own', () => {
  const a = song({ '128k': size('3 MiB'), flac: size('30 MiB') })
  const b = song({ '128k': size('3 MiB') })
  assert.deepEqual(assignQualities([a, b], 'highest', () => WY_ALL), {
    assigned: [{ musicInfo: a, quality: 'flac' }, { musicInfo: b, quality: '128k' }],
    skipped: [],
  })
})

test('a batch where no song gets a quality assigns nothing', () => {
  const { assigned, skipped } = assignQualities([song({})], 'lowest', () => WY_ALL)
  assert.deepEqual(assigned, [])
  assert.equal(skipped.length, 1)
})

// 下面几条钉的是接线：面板把选择原样交给队列，队列逐首分档。
// RN 组件没有测试渲染器，只能读源码确认这两根线没断。
const sheetSource = readFileSync(path.join(import.meta.dirname, '../src/components/DownloadQualitySheet/index.tsx'), 'utf8')
const schedulerSource = readFileSync(path.join(import.meta.dirname, '../src/core/download/scheduler.ts'), 'utf8')

test('the batch sheet offers a per-song highest and lowest choice', () => {
  assert.match(sheetSource, /'download_quality_all_highest'/)
  assert.match(sheetSource, /'download_quality_all_lowest'/)
  assert.match(sheetSource, /enqueueDownloads\(musicInfos, choice\)/)
})

// 单首下载传进来的就是长度为 1 的数组，面板自己按长度收这两行，不用调用方挨个传开关
test('the per-song highest and lowest rows only show up for a batch download', () => {
  assert.match(sheetSource, /setShowModeChoices\(musicInfos\.length > 1\)/)
  assert.match(sheetSource, /showModeChoices\s*\?\s*MODE_CHOICES\.map/)
})

test('the queue assigns a quality per song instead of one for the batch', () => {
  assert.match(schedulerSource, /choice: QualityChoice/)
  assert.match(schedulerSource, /assignQualities\(musicInfos, choice, /)
})
