import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CONFIG_URLS,
  DEFAULT_CONFIG,
  KNOWN_ENGINE_IDS,
  fetchRemoteConfig,
  sanitizeConfig,
  type FetchImpl,
} from '../src/core/musicRecognition/remoteConfig.ts'

const okFetch = (body: string, status = 200): FetchImpl => async() => ({ status, ok: status >= 200 && status < 300, text: async() => body })

test('配置源只有自家仓库的 CDN 地址，且没有可执行代码', () => {
  assert.ok(CONFIG_URLS.length >= 3)
  for (const url of CONFIG_URLS) {
    assert.match(url, /^https:\/\//)
    assert.match(url, /recognition-config\.json$/)
  }
})

test('合法配置原样采用', () => {
  const config = sanitizeConfig({
    version: 2,
    engines: [{ id: 'ncm', enabled: true, endpoint: 'https://interface.music.163.com/api/music/audio/match' }],
  })
  assert.equal(config.version, 2)
  assert.equal(config.engines.length, 1)
  assert.equal(config.engines[0].endpoint, 'https://interface.music.163.com/api/music/audio/match')
})

test('白名单外的域名一律丢弃 —— 这是把静态文件当配置源的前提', () => {
  const config = sanitizeConfig({
    version: 2,
    engines: [
      { id: 'ncm', enabled: true, endpoint: 'https://evil.example.com/match' },
      { id: 'ncm', enabled: true, endpoint: 'http://interface.music.163.com/match' },
      { id: 'ncm', enabled: true, endpoint: 'https://interface.music.163.com.evil.net/match' },
      { id: 'ncm', enabled: true, endpoint: 'https://interface.music.163.com@evil.net/match' },
      { id: 'ncm', enabled: true, endpoint: 'https://evil.net\\@interface.music.163.com/match' },
      { id: 'ncm', enabled: true, endpoint: 'https://evil.net/?x=https://music.163.com/' },
    ],
  })
  assert.deepEqual(config.engines, DEFAULT_CONFIG.engines)
})

test('未知引擎 id 与畸形条目被丢掉，合法条目保留（含 enabled=false）', () => {
  const config = sanitizeConfig({
    version: 3,
    engines: [
      { id: 'mine', enabled: true, endpoint: 'https://music.163.com/x' },
      'not an object',
      { id: 'ncm', endpoint: 'https://interface.music.163.com/api/music/audio/match' },
      { id: 'ncm', enabled: false, endpoint: 'https://music.163.com/api/music/audio/match' },
    ],
  })
  assert.ok(KNOWN_ENGINE_IDS.includes('ncm'))
  assert.equal(config.engines.length, 2)
  assert.equal(config.engines[0].enabled, true)
  assert.equal(config.engines[1].enabled, false)
})

test('非对象 / 空 engines / 类型错乱的输入一律退回内置默认值', () => {
  assert.deepEqual(sanitizeConfig(null), DEFAULT_CONFIG)
  assert.deepEqual(sanitizeConfig('[]'), DEFAULT_CONFIG)
  assert.deepEqual(sanitizeConfig({ version: 'two', engines: [] }), DEFAULT_CONFIG)
})

test('逐个地址尝试，第一个成功的胜出', async() => {
  let called = 0
  const good = JSON.stringify({ version: 9, engines: [{ id: 'ncm', enabled: true, endpoint: 'https://music.163.com/api/music/audio/match' }] })
  const config = await fetchRemoteConfig(async() => {
    called += 1
    if (called == 1) return { ok: false, status: 404, text: async() => '' }
    return { ok: true, status: 200, text: async() => good }
  })
  assert.equal(called, 2)
  assert.equal(config.version, 9)
})

test('全部地址失败、或响应不是 JSON 时退回默认配置，不抛异常', async() => {
  assert.deepEqual(await fetchRemoteConfig(async() => { throw new Error('offline') }), DEFAULT_CONFIG)
  assert.deepEqual(await fetchRemoteConfig(okFetch('<html>hit me</html>')), DEFAULT_CONFIG)
})

test('地址可由调用方覆盖（测试与降级用）', async() => {
  let hitUrl = ''
  await fetchRemoteConfig(async(url: string) => { hitUrl = url; return { ok: false, status: 500, text: async() => '' } }, ['https://example.org/custom.json'])
  assert.equal(hitUrl, 'https://example.org/custom.json')
})
