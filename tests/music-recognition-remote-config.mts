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

// 默认方向：内置兜底配置必须是「能用」的，拉不到配置时识曲照常工作。
// 没有这条断言的话，把 DEFAULT 改成 enabled:false 也能全绿。
test('内置默认配置默认启用且指向自家识别接口', () => {
  assert.equal(DEFAULT_CONFIG.engines.length, 1)
  assert.equal(DEFAULT_CONFIG.engines[0].id, 'ncm')
  assert.equal(DEFAULT_CONFIG.engines[0].enabled, true)
  assert.equal(DEFAULT_CONFIG.engines[0].endpoint, 'https://interface.music.163.com/api/music/audio/match')
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
  assert.deepEqual(config.engines, [])
})

test('官方域的子域放行；收紧白名单时不该静默打死合法端点', () => {
  const keep = (endpoint: string) => sanitizeConfig({ version: 2, engines: [{ id: 'ncm', enabled: true, endpoint }] })
  assert.equal(keep('https://api.music.163.com/api/music/audio/match').engines[0].endpoint, 'https://api.music.163.com/api/music/audio/match')
  assert.equal(keep('https://a.b.music.163.com/x').engines.length, 1)
  assert.equal(keep('https://music.163.com/x').engines.length, 1)
  assert.equal(keep('https://amp.shazam.com/v1/match').engines.length, 1)
  // 恰好差一个点的前缀伪装仍然被丢
  assert.equal(keep('https://notmusic.163.com/x').engines.length, 0)
})

test('未知引擎 id 与畸形条目被丢掉，第一条合法条目保留且缺省 enabled 视为启用', () => {
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
  assert.equal(config.engines.length, 1)
  assert.equal(config.engines[0].enabled, true)
  assert.equal(config.engines[0].endpoint, 'https://interface.music.163.com/api/music/audio/match')
})

// 两个方向相反的失败：读不出结构 = 退回默认（别瘫痪）；读得出结构 = 尊重关停（别拨回 ON）。
test('读不出结构（非对象 / engines 不是数组）退回内置默认值', () => {
  assert.deepEqual(sanitizeConfig(null), DEFAULT_CONFIG)
  assert.deepEqual(sanitizeConfig(undefined), DEFAULT_CONFIG)
  assert.deepEqual(sanitizeConfig('[]'), DEFAULT_CONFIG)
  assert.deepEqual(sanitizeConfig('{"engines":"ncm"}'), DEFAULT_CONFIG)
  assert.deepEqual(sanitizeConfig({ version: 'two' }), DEFAULT_CONFIG)
  assert.deepEqual(sanitizeConfig({ engines: 'not-an-array' }), DEFAULT_CONFIG)
})

test('读得出结构就尊重它：空 engines / 全部 enabled=false 是关停，不是退回默认', () => {
  assert.deepEqual(sanitizeConfig({ version: 4, engines: [] }), { version: 4, engines: [] })
  assert.deepEqual(sanitizeConfig({ version: 'two', engines: [] }), { version: DEFAULT_CONFIG.version, engines: [] })
  const allOff = sanitizeConfig({
    version: 5,
    engines: [
      { id: 'ncm', enabled: false, endpoint: 'https://interface.music.163.com/api/music/audio/match' },
    ],
  })
  assert.equal(allOff.engines.length, 1)
  assert.equal(allOff.engines[0].enabled, false)
  assert.notDeepEqual(allOff, DEFAULT_CONFIG)
})

test('同一 id 重复出现只保留第一条 —— 配置文件不能把自己变成打靶放大器', () => {
  const flooded = sanitizeConfig({
    version: 6,
    engines: Array.from({ length: 200 }, (_unused, i) => ({
      id: 'ncm',
      enabled: true,
      endpoint: `https://interface.music.163.com/api/music/audio/match?n=${i}`,
    })),
  })
  assert.equal(flooded.engines.length, 1)
  assert.equal(flooded.engines[0].endpoint, 'https://interface.music.163.com/api/music/audio/match?n=0')
  // 同一 id 只留第一条：后面那条 enabled:false 不会叠加成第二个打到网易的口子
  const twoIds = sanitizeConfig({
    version: 6,
    engines: [
      { id: 'ncm', enabled: true, endpoint: 'https://music.163.com/a' },
      { id: 'ncm', enabled: false, endpoint: 'https://music.163.com/b' },
    ],
  })
  assert.equal(twoIds.engines.length, 1)
  assert.equal(twoIds.engines[0].enabled, true)
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
  assert.deepEqual(await fetchRemoteConfig(okFetch('null')), DEFAULT_CONFIG)
})

test('运营方的紧急关停不会被镜像失败拨回 ON', async() => {
  const shutdown = JSON.stringify({ version: 7, engines: [] })
  // 第一个镜像 502，第二个才是真正的关停指令：必须原样反映成「一个引擎都不启用」
  let called = 0
  const config = await fetchRemoteConfig(async() => {
    called += 1
    if (called == 1) return { ok: false, status: 502, text: async() => '' }
    return { ok: true, status: 200, text: async() => shutdown }
  })
  assert.equal(called, 2)
  assert.deepEqual(config, { version: 7, engines: [] })
  assert.notDeepEqual(config, DEFAULT_CONFIG)
})

test('地址可由调用方覆盖（测试与降级用）', async() => {
  let hitUrl = ''
  await fetchRemoteConfig(async(url: string) => { hitUrl = url; return { ok: false, status: 500, text: async() => '' } }, ['https://example.org/custom.json'])
  assert.equal(hitUrl, 'https://example.org/custom.json')
})
