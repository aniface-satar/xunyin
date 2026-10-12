import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SHAZAM_HEADERS,
  buildMatchBody,
  buildTagUrl,
  createTagId,
  parseMatchResponse,
  unwrapMatchBody,
} from '../src/core/musicRecognition/shazamApi.ts'

// 形状取自本机实测响应（tests 里跑的 d0 样本 = Daft Punk「Get Lucky」），
// 只留下解析路径会用到的字段与几个刻意设置的诱饵字段。
const hitResponse = {
  matches: [
    { id: '300777123', offset: 48.998050780999996, timeskew: -0.00033265352, frequencyskew: 0.0123 },
    { id: '300777124', offset: 12.5, timeskew: 0.0001, frequencyskew: 0.02 },
  ],
  location: { accuracy: 0.01 },
  timestamp: 1791697356903,
  timezone: 'Asia/Shanghai',
  track: {
    layout: '5',
    type: 'MUSIC',
    key: '105842472',
    title: 'Get Lucky',
    subtitle: 'Daft Punk, Pharrell Williams & NILE RODGERS',
    url: 'https://www.shazam.com/track/105842472/get-lucky',
    albumadamid: '617154241',
    isrc: 'USQX1300108',
    genres: { primary: 'Pop' },
    sections: [
      { type: 'RELATED', url: 'https://data.shazam.com/related/105842472', tabname: 'Related Songs' },
      {
        type: 'SONG',
        tabname: 'Song',
        metapages: [],
        metadata: [
          { title: '专辑', text: 'Random Access Memories' },
          { title: '唱片公司', text: 'Columbia' },
          { title: '发行时间', text: '2013' },
        ],
      },
    ],
  },
  tagid: '7E2257B2-CC8A-4303-8F60-5CA7B284E6E0',
}

// 实测的「没听到歌」：静音签名拿到的就是这个，没有 track 字段
const noMatchResponse = {
  matches: [],
  location: { accuracy: 0.01 },
  timestamp: 1791697356903,
  timezone: 'Asia/Shanghai',
  tagid: 'F3F450C0-6A45-4280-9E25-76C01D7637A2',
}

test('URL 是免密钥的 tag 端点，两个 tagId 与全部开关参数都在', () => {
  const url = buildTagUrl('AAAAAAAA-BBBB-4CCC-ADDD-EEEEEEEEEEEE', '11111111-2222-4333-A444-555555555555')
  assert.ok(url.startsWith('https://amp.shazam.com/discovery/v5/zh/CN/android/-/tag/'))
  assert.ok(url.includes('/AAAAAAAA-BBBB-4CCC-ADDD-EEEEEEEEEEEE/11111111-2222-4333-A444-555555555555?'))
  for (const key of [ 'sync=true', 'webv3=true', 'sampling=true', 'connected=', 'shazamapiversion=v3',
    'sharehub=true', 'hubv5minorversion=v5.1', 'hidelb=true', 'video=v3' ]) {
    assert.ok(url.includes(key), '缺开关 ' + key)
  }
  // 这个端点没有任何 key/token 参数——「永久免费、无自建后端」的前提
  assert.ok(!/key=|token=|apikey=/i.test(url))
})

test('路径写 android、头写 IPHONE 的错位是实测发法，不许被「改一致」', () => {
  assert.equal(SHAZAM_HEADERS['X-Shazam-Platform'], 'IPHONE')
  assert.equal(SHAZAM_HEADERS['X-Shazam-AppVersion'], '14.1.0')
  assert.equal(SHAZAM_HEADERS['Content-Type'], 'application/json')
  assert.ok(buildTagUrl('A', 'B').includes('/android/'))
})

test('tagId 是大写 uuid4 形状，随机源可注入且默认每次不同', () => {
  const fixed = () => 0.5
  const id = createTagId(fixed)
  assert.equal(id, '88888888-8888-4888-A888-888888888888')
  assert.match(createTagId(), /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[0-9A-F]{4}-[0-9A-F]{12}$/)
  assert.notEqual(createTagId(), createTagId())
})

test('请求体固定六个字段，signature 里只带 uri 与 samplems', () => {
  const body = buildMatchBody('data:audio/vnd.shazam.sig;base64,AAAA', 6000, 1791697356903)
  assert.deepEqual(Object.keys(body).sort(), ['context', 'geolocation', 'signature', 'timestamp', 'timezone'])
  assert.deepEqual(body.signature, { uri: 'data:audio/vnd.shazam.sig;base64,AAAA', samplems: 6000 })
  assert.equal(body.timezone, 'Asia/Shanghai')
  assert.equal(body.timestamp, 1791697356903)
  assert.deepEqual(body.context, {})
  assert.deepEqual(body.geolocation, {})
})

test('命中时给出歌名、歌手、专辑与匹配偏移的毫秒数', () => {
  const song = parseMatchResponse(hitResponse)
  assert.ok(song)
  assert.equal(song.name, 'Get Lucky')
  assert.equal(song.singer, 'Daft Punk, Pharrell Williams & NILE RODGERS')
  assert.equal(song.albumName, 'Random Access Memories')
  assert.equal(song.startTimeMs, 48998)
})

test('网易派生 ID 留空：跨派系填它等于造假数据', () => {
  assert.equal(parseMatchResponse(hitResponse)!.neteaseSongId, '')
})

test('专辑名按 type=SONG 找段，不按 sections 下标；RELATED 排在前面也要取对', () => {
  const swapped = JSON.parse(JSON.stringify(hitResponse))
  swapped.track.sections.reverse()
  assert.equal(parseMatchResponse(swapped)!.albumName, 'Random Access Memories')
  // metadata 换序后专辑不再是第 0 条，此时按位置取就该拿到「唱片公司」——
  // 这条锁住「取 metadata[0]」这个契约本身，改成按 title 匹配会让它变红。
  const reordered = JSON.parse(JSON.stringify(hitResponse))
  reordered.track.sections[1].metadata = [{ title: '唱片公司', text: 'Columbia' }, { title: '专辑', text: 'Random Access Memories' }]
  assert.equal(parseMatchResponse(reordered)!.albumName, 'Columbia')
})

test('matches 取第 0 条的 offset，不用后面那条更早的偏移', () => {
  assert.equal(parseMatchResponse(hitResponse)!.startTimeMs, 48998)
})

test('实测的未命中响应返回 null 而不是抛', () => {
  assert.equal(parseMatchResponse(noMatchResponse), null)
})

test('有 matches 但没有 track 也返回 null（没元信息可展示）', () => {
  assert.equal(parseMatchResponse({ matches: hitResponse.matches, tagid: 'X' }), null)
})

test('畸形响应一律返回 null 而不是抛异常', () => {
  assert.equal(parseMatchResponse(null), null)
  assert.equal(parseMatchResponse('string'), null)
  assert.equal(parseMatchResponse([]), null)
  assert.equal(parseMatchResponse({ track: 'x' }), null)
  assert.equal(parseMatchResponse({ track: { title: '' } }), null)
  assert.equal(parseMatchResponse({ track: { title: '歌' } })!.singer, '')
  assert.equal(parseMatchResponse({ track: { title: '歌', subtitle: 12 } })!.singer, '12')
  assert.equal(parseMatchResponse({ track: { title: '歌', sections: 'x' } })!.albumName, '')
  assert.equal(parseMatchResponse({ track: { title: '歌', sections: [{ type: 'SONG' }] } })!.albumName, '')
  assert.equal(parseMatchResponse({ track: { title: '歌', sections: [{ type: 'SONG', metadata: [null] }] } })!.albumName, '')
  assert.equal(parseMatchResponse({ track: { title: '歌' }, matches: 'x' })!.startTimeMs, 0)
  assert.equal(parseMatchResponse({ track: { title: '歌' }, matches: [{ offset: 'abc' }] })!.startTimeMs, 0)
  assert.equal(parseMatchResponse({ track: { title: '歌' }, matches: [{}] })!.startTimeMs, 0)
})

test('非 2xx 一律抛出并带上状态码，不许当成未命中', () => {
  for (const status of [ 403, 429, 500, 502 ]) {
    assert.throws(() => unwrapMatchBody({ ok: false, status, body: {} }), (err: Error) => err.message == 'shazam http ' + status)
  }
})

test('body 还是字符串说明 JSON 没解析成功，抛而不是放行', () => {
  assert.throws(() => unwrapMatchBody({ ok: true, status: 200, body: '<html></html>' }), /not JSON/)
})

test('2xx 且 body 已解析成对象时原样透传', () => {
  assert.equal(unwrapMatchBody({ ok: true, status: 200, body: hitResponse }), hitResponse)
  assert.equal(unwrapMatchBody({ ok: true, status: 200, body: noMatchResponse }), noMatchResponse)
})

test('风控的 403 走完整链路是 failed，不是「没听到歌」', async() => {
  const { recognizeWithEngines } = await import('../src/core/musicRecognition/provider.ts')
  const engine = {
    id: 'shazam',
    recognize: async() => {
      return unwrapMatchBody({ ok: false, status: 403, body: {} }) as never
    },
  }
  const guard = { check: async() => 'allow' as const, onSuccess: async() => {}, onFailure: async() => {} }
  const outcome = await recognizeWithEngines([engine], new Int16Array(1), 48000, guard)
  assert.deepEqual(outcome, { hits: [], failure: 'failed' })
})

test('静音的 200 走完整链路是 no_match，不累计退避', async() => {
  const { recognizeWithEngines } = await import('../src/core/musicRecognition/provider.ts')
  let failures = 0
  const engine = {
    id: 'shazam',
    recognize: async() => {
      return parseMatchResponse(unwrapMatchBody({ ok: true, status: 200, body: noMatchResponse }))
    },
  }
  const guard = { check: async() => 'allow' as const, onSuccess: async() => {}, onFailure: async() => { failures++ } }
  const outcome = await recognizeWithEngines([engine], new Int16Array(1), 48000, guard)
  assert.deepEqual(outcome, { hits: [], failure: 'no_match' })
  assert.equal(failures, 0)
})
