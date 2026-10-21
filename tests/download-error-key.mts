import test from 'node:test'
import assert from 'node:assert/strict'

import { transferErrorKey } from '../src/core/download/errorKey.ts'
import { TransferStalledError } from '../src/core/download/transferGuard.ts'

/** 看门狗判死的：文案要教用户点「重新下载」，不是重启 App */
test('a stalled transfer keeps its own message', () => {
  assert.equal(transferErrorKey(new TransferStalledError(60_000)), 'download_transfer_stalled')
})

/** 直链本身被服务器拒绝（过期、防盗链）：换源或过会儿再试，与手机存储无关 */
test('a rejected link is not reported as a local file problem', () => {
  assert.equal(transferErrorKey(new Error('HTTP 403')), 'download_url_rejected')
  assert.equal(transferErrorKey(new Error('HTTP 404')), 'download_url_rejected')
  assert.equal(transferErrorKey(new Error('empty response')), 'download_url_rejected')
})

/** 真机踩过的一次：音源给的域名已经解析不了，屏幕上却写着「存不了临时文件」 */
test('native network failures read as network failures', () => {
  assert.equal(transferErrorKey(new Error('Unable to resolve host "music-dl.sayqz.com": No address associated with hostname')), 'download_network_failed')
  assert.equal(transferErrorKey(new Error('failed to connect to /10.0.0.1 (port 443) from /192.168.1.2 (port 51234) after 15000ms')), 'download_network_failed')
  assert.equal(transferErrorKey(new Error('Connection reset')), 'download_network_failed')
  assert.equal(transferErrorKey(new Error('connect timed out')), 'download_network_failed')
})

/** 剩下那些才是本机写文件的问题：没空间、目录被回收 */
test('only genuine local write failures fall back to the temp file message', () => {
  assert.equal(transferErrorKey(new Error('ENOSPC: no space left on device, write')), 'download_temp_failed')
  assert.equal(transferErrorKey(new Error("ENOENT: no such file or directory, open '/data/user/0/x/cache/download_a.tmp'")), 'download_temp_failed')
  assert.equal(transferErrorKey(undefined), 'download_temp_failed')
})
