import test from 'node:test'
import assert from 'node:assert/strict'

import { childProbePath, childRealPath, childWritePath, isDirGranted, parseSaveDir } from '../src/core/download/safPath.ts'

const TREE_URI = 'content://com.android.externalstorage.documents/tree/primary%3AMusic'
const DOC_URI = TREE_URI + '/document/primary%3AMusic%2FLxMusic'
const CN_TREE_URI = 'content://com.android.externalstorage.documents/tree/primary%3A%E5%AF%BB%E9%9F%B3'
const SD_TREE_URI = 'content://com.android.externalstorage.documents/tree/7475-0712%3AMusic'

test('plain directory keeps write and probe path identical', () => {
  assert.equal(childWritePath('/data/data/cn.xunyin.music/files/Downloads', 'a.mp3'), '/data/data/cn.xunyin.music/files/Downloads/a.mp3')
  assert.equal(childProbePath('/data/data/cn.xunyin.music/files/Downloads', 'a.mp3'), '/data/data/cn.xunyin.music/files/Downloads/a.mp3')
})

test('app private dir has no real path to scan', () => {
  assert.equal(childRealPath('/data/data/cn.xunyin.music/files/Downloads', 'a.mp3'), null)
})

test('tree uri write path is the joined form the native layer splits', () => {
  assert.equal(childWritePath(TREE_URI, '晴天 - 周杰伦.flac'), TREE_URI + '/晴天 - 周杰伦.flac')
})

test('tree uri probe path becomes a full document uri with the child name encoded', () => {
  assert.equal(
    childProbePath(TREE_URI, '晴天 - 周杰伦.mp3'),
    'content://com.android.externalstorage.documents/tree/primary%3AMusic/document/primary%3AMusic%2F%E6%99%B4%E5%A4%A9%20-%20%E5%91%A8%E6%9D%B0%E4%BC%A6.mp3',
  )
})

test('document uri of a sub folder probes under that sub folder', () => {
  assert.equal(
    childProbePath(DOC_URI, 'a.flac'),
    TREE_URI + '/document/primary%3AMusic%2FLxMusic%2Fa.flac',
  )
})

test('save dir is recognised by its own form', () => {
  assert.equal(parseSaveDir(TREE_URI).kind, 'tree')
  assert.equal(parseSaveDir(DOC_URI).kind, 'tree')
  assert.equal(parseSaveDir('/storage/emulated/0/Music').kind, 'plain')
})

test('tree uri real path is the filesystem path the media scanner needs', () => {
  assert.equal(childRealPath(TREE_URI, 'a.mp3'), '/storage/emulated/0/Music/a.mp3')
  assert.equal(childRealPath(DOC_URI, 'a.mp3'), '/storage/emulated/0/Music/LxMusic/a.mp3')
})

test('percent-encoded folder names are decoded once for the real path', () => {
  assert.equal(childRealPath(CN_TREE_URI, 'a.mp3'), '/storage/emulated/0/寻音/a.mp3')
})

test('removable volume doc id maps to its own mount point', () => {
  assert.equal(childRealPath(SD_TREE_URI, 'a.mp3'), '/storage/7475-0712/Music/a.mp3')
})

test('provider without a volume prefix cannot be scanned', () => {
  const uri = 'content://com.microsoft.skydrive.root/tree/root%2Fmusic'
  assert.equal(childRealPath(uri, 'a.mp3'), null)
})

test('a plain public path can still be scanned', () => {
  assert.equal(childRealPath('/storage/emulated/0/Music', 'a.mp3'), '/storage/emulated/0/Music/a.mp3')
})

test('grant covers the picked dir only when it is the same tree or an ancestor', () => {
  assert.ok(isDirGranted([TREE_URI], TREE_URI))
  assert.ok(isDirGranted([TREE_URI], DOC_URI))
  // 子目录的授权写不进父目录，不能当成覆盖
  assert.equal(isDirGranted([DOC_URI], TREE_URI), false)
})

test('a plain directory needs no SAF grant', () => {
  assert.ok(isDirGranted([], '/data/data/cn.xunyin.music/files/Downloads'))
})

test('grant of an ancestor folder covers the picked sub folder', () => {
  const ancestor = 'content://com.android.externalstorage.documents/tree/primary%3A'
  assert.ok(isDirGranted([ancestor], TREE_URI))
})

test('a grant of an unrelated folder does not pretend to be valid', () => {
  const other = 'content://com.android.externalstorage.documents/tree/primary%3ADownload'
  assert.equal(isDirGranted([other], TREE_URI), false)
  assert.equal(isDirGranted([], TREE_URI), false)
})

test('grant of a sibling whose name starts with the same prefix is not a match', () => {
  const sibling = 'content://com.android.externalstorage.documents/tree/primary%3AMusicBox'
  assert.equal(isDirGranted([sibling], TREE_URI), false)
})
