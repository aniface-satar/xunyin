import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { cardFileName } from '../src/utils/shareCard/cardFileName.ts'

test('joins name and singer with a separator', () => {
  assert.equal(cardFileName('平凡之路', '朴树'), '平凡之路 - 朴树')
})

test('drops characters the filesystem refuses', () => {
  // 非法字符直接去掉（不是替换成下划线），剩下的字不动
  assert.equal(cardFileName('A/B:C*D?E"F<G>H|I', '朴树'), 'ABCDEFGHI - 朴树')
})

test('falls back to the title alone when the singer is empty', () => {
  assert.equal(cardFileName('平凡之路', ''), '平凡之路')
  assert.equal(cardFileName('平凡之路', '   '), '平凡之路')
})

test('truncates very long titles so the path stays writable', () => {
  const long = '字'.repeat(400)
  assert.ok(cardFileName(long, '歌手').length <= 80)
})

test('collapses the whitespace left behind by stripped characters', () => {
  assert.equal(cardFileName('歌 名', 'A  B'), '歌 名 - A B')
})

// 文件名前缀不只是好看：view-shot 清缓存的唯一判据就是 startsWith(TEMP_FILE_PREFIX)
// （RNViewShotModule.java:151，且不看修改时间），库把 fileName 当 createTempFile 的前缀用（:191-192）。
// 对不上就没人扫，按歌名命名的 PNG 永远堆在 cache 目录里。
// 这里读两边的源码，所以「库改了常量」和「有人把我们的前缀拼丢了」都会先在这里红。
const VIEW_SHOT_JAVA = path.join(import.meta.dirname,
  '../node_modules/react-native-view-shot/android/src/main/java/fr/greweb/reactnativeviewshot/RNViewShotModule.java')
const EXPORT_CARD_TS = path.join(import.meta.dirname, '../src/utils/shareCard/exportCard.ts')

const group = (re: RegExp, src: string, what: string) => {
  const found = re.exec(src)
  assert.ok(found, `${what}：源码里读不到这条判据，测试或那处实现该一起改了`)
  return found[1]
}

test('the captured file name carries view-shot\'s own sweep prefix', () => {
  const libPrefix = group(/TEMP_FILE_PREFIX\s*=\s*"([^"]+)"/, readFileSync(VIEW_SHOT_JAVA, 'utf8'),
    'react-native-view-shot 的 TEMP_FILE_PREFIX')
  const ourPrefix = group(/SWEEP_PREFIX\s*=\s*'([^']+)'/, readFileSync(EXPORT_CARD_TS, 'utf8'),
    'exportCard.ts 的 SWEEP_PREFIX')
  assert.equal(ourPrefix, libPrefix)
  const src = readFileSync(EXPORT_CARD_TS, 'utf8')
  // result 换成别的（base64 / zip 之类）就根本没有临时文件，前缀也就没意义了
  assert.match(src, /result:\s*'tmpfile'/)
  // 前缀必须真的拼进 safeFileName 的返回值，而不是只活在自己的 const 里
  assert.match(src, /const safeFileName[\s\S]*?return `\$\{SWEEP_PREFIX\}_/)
})

test('the ≥3-character rule survives the prefix', () => {
  // 库的 fileName 走 File.createTempFile(prefix, …)，前缀本身不足 3 字符会 IOException；
  // 短歌名那条 `lx_` 补位是原实现的行为，拼上 sweep 前缀后不能把它弄丢。
  const src = readFileSync(EXPORT_CARD_TS, 'utf8')
  assert.match(src, /cleaned\.length >= 3 \? cleaned : `lx_\$\{cleaned\}`/)
})
