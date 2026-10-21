import test from 'node:test'
import assert from 'node:assert/strict'

import { mergeLoadedList } from '../src/store/download/merge.ts'

const task = (id: string, status: LX.Download.DownloadTaskStatus, fileName = `${id}.mp3`): LX.Download.ListItem => ({
  id,
  isComplate: false,
  status,
  statusText: '',
  downloaded: 0,
  total: 0,
  progress: 0,
  speed: '',
  metadata: {
    musicInfo: { id, name: id } as unknown as LX.Music.MusicInfoOnline,
    url: null,
    quality: '320k',
    ext: 'mp3',
    fileName,
    filePath: '',
  },
})

test('读盘慢时刚点的下载不会被盘上的旧名单冲掉', () => {
  const inMemory = [task('clicked', 'waiting')]
  const stored = [task('old_1', 'completed'), task('old_2', 'error')]

  const merged = mergeLoadedList(inMemory, stored)
  assert.deepEqual(merged.map(item => item.id), ['clicked', 'old_1', 'old_2'])
  assert.equal(merged[0], inMemory[0], '内存里那份才是本次会话的真话，必须原样留着')
})

test('两边的同一首歌只留内存里那份：状态可能已经在下载了', () => {
  const inMemory = [task('same', 'run')]
  const stored = [task('same', 'waiting')]

  const merged = mergeLoadedList(inMemory, stored)
  assert.equal(merged.length, 1)
  assert.equal(merged[0].status, 'run')
})

test('盘上那些没有 id / metadata 的残项读不出来就丢掉，别让它进列表', () => {
  const broken = [
    { id: '', metadata: {} },
    { id: 'no_meta' },
    null,
  ] as unknown as LX.Download.ListItem[]

  assert.deepEqual(mergeLoadedList([], broken), [])
})
