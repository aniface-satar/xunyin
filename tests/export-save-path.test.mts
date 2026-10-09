import test from 'node:test'
import assert from 'node:assert/strict'

import { joinSavePath } from '../src/utils/savePath.ts'

// 导出目标目录有两种形态：App 内浏览器给出的裸路径，和 SAF 文件夹选择器给出的 tree URI。
// SAF URI 里的 %3A / %2F 是路径分隔符本身，一旦被解码或重复拼接，原生层 DocumentsContract 就找不到父目录。
const TREE_URI = 'content://com.android.externalstorage.documents/tree/primary%3A%E5%AF%BB%E9%9F%B3%E5%A4%87%E4%BB%BD'

test('plain directory path joins the file name with a single slash', () => {
  assert.equal(joinSavePath('/storage/emulated/0', 'lx_list.lxmc'), '/storage/emulated/0/lx_list.lxmc')
})

test('trailing slash on the directory does not produce a double slash', () => {
  assert.equal(joinSavePath('/storage/emulated/0/', 'lx_list.lxmc'), '/storage/emulated/0/lx_list.lxmc')
})

test('SAF tree uri keeps its percent-encoded segment untouched', () => {
  const joined = joinSavePath(TREE_URI, 'lx_list.lxmc')
  assert.equal(joined, TREE_URI + '/lx_list.lxmc')
  assert.ok(joined.includes('primary%3A'), 'encoded colon must survive the join')
})

test('SAF document uri of a sub folder joins like a plain directory', () => {
  const docUri = TREE_URI + '/document/primary%3A%E5%AF%BB%E9%9F%B3%E5%A4%87%E4%BB%BD%2F2026'
  assert.equal(joinSavePath(docUri, 'lx_list_part_测试.lxmc'), docUri + '/lx_list_part_测试.lxmc')
})

test('a file name containing a slash is not silently normalized away', () => {
  assert.equal(joinSavePath(TREE_URI, 'a/b.json'), TREE_URI + '/a/b.json')
})
