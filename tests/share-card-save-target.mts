import test from 'node:test'
import assert from 'node:assert/strict'

import { childProbePath, childRealPath, isDirGranted, parseSaveDir } from '../src/utils/shareCard/saveTarget.ts'

const MUSIC_TREE = 'content://com.android.externalstorage.documents/tree/primary%3AMusic'
const LX_SUB = `${MUSIC_TREE}/document/primary%3AMusic%2FLxMusic`

test('a plain app directory needs no SAF grant', () => {
  assert.equal(isDirGranted([], '/data/user/0/cn.toside.music.mobile/files'), true)
})

test('the same tree covers itself', () => {
  assert.equal(isDirGranted([MUSIC_TREE], MUSIC_TREE), true)
})

test('a parent grant covers a subdirectory', () => {
  assert.equal(isDirGranted([MUSIC_TREE], LX_SUB), true)
})

test('a child grant does NOT cover the parent', () => {
  // 拿着 Music/LxMusic 的授权去写 Music，系统会拒；这条判反了就是"选了文件夹还是保存失败"
  assert.equal(isDirGranted([LX_SUB], MUSIC_TREE), false)
})

test('a grant from another authority does not count', () => {
  const other = 'content://com.android.providers.downloads.documents/tree/primary%3AMusic'
  assert.equal(isDirGranted([other], MUSIC_TREE), false)
})

test('tree uri without a document segment uses the tree docId', () => {
  assert.equal(parseSaveDir(MUSIC_TREE).kind, 'tree')
  assert.equal((parseSaveDir(MUSIC_TREE) as { parentDocId: string }).parentDocId, 'primary:Music')
})

test('existence probe must be a full document uri', () => {
  assert.equal(childProbePath(MUSIC_TREE, 'poster.png'),
    `${MUSIC_TREE}/document/primary%3AMusic%2Fposter.png`)
})

test('existence probe on a plain directory is a filesystem path', () => {
  assert.equal(childProbePath('/storage/emulated/0/Music', 'poster.png'), '/storage/emulated/0/Music/poster.png')
})

test('primary volume maps back to /storage/emulated/0 for the media scan', () => {
  assert.equal(childRealPath(LX_SUB, 'poster.png'), '/storage/emulated/0/Music/LxMusic/poster.png')
})

test('removable volume maps to /storage/<volume>', () => {
  const usb = 'content://com.android.externalstorage.documents/tree/1234-ABCD%3AMusic'
  assert.equal(childRealPath(usb, 'poster.png'), '/storage/1234-ABCD/Music/poster.png')
})

test('a private app path cannot be restored, so the media scan is skipped', () => {
  assert.equal(childRealPath('/data/user/0/cn.toside.music.mobile/files', 'poster.png'), null)
})
