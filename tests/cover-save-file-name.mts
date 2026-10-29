import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { coverBaseName, coverFileName, picFileExtension } from '../src/utils/shareCard/coverFile.ts'
import { cardFileName } from '../src/utils/shareCard/cardFileName.ts'

test('keeps the extension of a plain cover url', () => {
  assert.equal(picFileExtension('https://img.example.com/a.jpg'), 'jpg')
  assert.equal(picFileExtension('https://img.example.com/a.png'), 'png')
})

test('drops the query string and fragment before reading the extension', () => {
  assert.equal(picFileExtension('https://img.example.com/a.png?param=1&x=2'), 'png')
  assert.equal(picFileExtension('https://img.example.com/a.webp#frag'), 'webp')
})

test('lowercases the extension', () => {
  assert.equal(picFileExtension('/data/resource-service/file-down/20250425112023164897.JPEG'), 'jpeg')
})

test('falls back to jpg when the url carries no usable extension', () => {
  assert.equal(picFileExtension('https://img.example.com/noext'), 'jpg')
  assert.equal(picFileExtension('content://media/external/images/media/1234'), 'jpg')
  // 音频文件路径不是封面图后缀，不能原样带出去
  assert.equal(picFileExtension('file:///storage/emulated/0/Music/a.flac'), 'jpg')
})

test('the file name is the song name plus singer', () => {
  assert.equal(coverFileName('平凡之路', '朴树', 'https://x/a.png'), '平凡之路 - 朴树.png')
})

test('illegal characters are stripped by the shared file-name rule', () => {
  assert.equal(coverBaseName('A/B:C', '朴树'), 'ABC - 朴树')
})

test('an empty song name falls back to a stable base name instead of the lyric-poster one', () => {
  assert.equal(coverBaseName('', ''), 'cover')
  assert.equal(coverFileName('', '', 'https://x/a.jpg'), 'cover.jpg')
})

test('the base name keeps the same code path as the lyric poster name', () => {
  assert.equal(cardFileName('平凡之路', '朴树', 'cover'), cardFileName('平凡之路', '朴树'))
})

// 临时文件与最终文件名同源：下载落盘和写入选定目录不会出现两套命名规则
const SAVE_COVER = readFileSync(path.join(import.meta.dirname, '../src/utils/shareCard/saveCover.ts'), 'utf8')

test('saveCover builds the target name from the same helpers', () => {
  assert.match(SAVE_COVER, /coverBaseName/)
  assert.match(SAVE_COVER, /picFileExtension/)
})
