import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MATCH_ENDPOINT,
  buildMatchForm,
  createSessionId,
  parseMatchResponse,
} from '../src/core/musicRecognition/ncmApi.ts'

// 2026-10-10 本机实测响应（浆果 - TINY7），字段形状按原样保留、无关字段删掉
const hitResponse = {
  code: 200,
  data: {
    result: [
      {
        startTime: 20020,
        song: {
          id: 2015896805,
          name: '浆果',
          artists: [{ name: 'TINY7', id: 0 }],
          album: { name: '浆果', id: 148317673, picUrl: 'https://p1.music.126.net/x.jpg' },
        },
      },
    ],
  },
}

const noMatchResponse = { code: 200, data: { result: null, noMatchReason: 'no result' } }

test('接口地址是免密钥的 match 端点', () => {
  assert.equal(MATCH_ENDPOINT, 'https://interface.music.163.com/api/music/audio/match')
})

test('表单体固定六个字段，duration 跟随窗口秒数', () => {
  assert.deepEqual(buildMatchForm('RAW==', 6, 'sid-1'), {
    sessionId: 'sid-1',
    algorithmCode: 'shazam_v2',
    duration: '6',
    rawdata: 'RAW==',
    times: '2',
    decrypt: '1',
  })
})

test('sessionId 是 uuid v4 形状，随机源可注入且默认每次不同', () => {
  assert.match(createSessionId(() => 0.5), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(new Set([createSessionId(), createSessionId()]).size, 2)
})

test('命中时取第一条结果并给出门派歌曲 ID', () => {
  const song = parseMatchResponse(hitResponse)
  assert.notEqual(song, null)
  assert.equal(song!.name, '浆果')
  assert.equal(song!.singer, 'TINY7')
  assert.equal(song!.albumName, '浆果')
  assert.equal(song!.neteaseSongId, '2015896805')
  assert.equal(song!.startTimeMs, 20020)
})

test('多歌手用 / 连接，缺字段不抛异常', () => {
  const song = parseMatchResponse({
    data: { result: [{ song: { name: 'X', artists: [{ name: 'A' }, { name: 'B' }, {}], album: {} } }] },
  })
  assert.equal(song!.name, 'X')
  assert.equal(song!.singer, 'A/B')
  assert.equal(song!.albumName, '')
  assert.equal(song!.neteaseSongId, '')
  assert.equal(song!.startTimeMs, 0)
})

test('未命中（result 为 null）返回 null', () => {
  assert.equal(parseMatchResponse(noMatchResponse), null)
})

test('畸形响应一律返回 null 而不是抛异常', () => {
  assert.equal(parseMatchResponse(undefined), null)
  assert.equal(parseMatchResponse(null), null)
  assert.equal(parseMatchResponse('not json'), null)
  assert.equal(parseMatchResponse({ data: { result: [] } }), null)
  assert.equal(parseMatchResponse({ data: { result: [{}] } }), null)
  assert.equal(parseMatchResponse({ data: { result: [{ song: { name: '' } }] } }), null)
  assert.equal(parseMatchResponse({ data: { result: 'oops' } }), null)
})
