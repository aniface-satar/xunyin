import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MATCH_ENDPOINT,
  buildMatchForm,
  createSessionId,
  parseMatchResponse,
} from '../src/core/musicRecognition/ncmApi.ts'

// 形状取自本机实测响应，标量（startTime、album.id、artists[0].id、picUrl 等）已按测试意图改写，非实测原值
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

// 真接口一次会返回 3 个候选，且 score 非降序（本机实测 100 / 70 / 90）——
// 最优结果就是 index 0，不是 score 排序的结果。三个候选的歌名/歌曲 ID/startTime
// 全取互不相同的值，好让任何「换一条候选」的改动都必须让这条用例变红。
const multiCandidateResponse = {
  code: 200,
  data: {
    result: [
      {
        startTime: 21001,
        song: {
          id: 111001,
          name: '甲歌',
          artists: [{ name: '甲歌手', id: 121001 }],
          album: { name: '甲专辑', id: 131001 },
          score: 100,
        },
      },
      {
        startTime: 22002,
        song: {
          id: 222002,
          name: '乙歌',
          artists: [{ name: '乙歌手', id: 122002 }],
          album: { name: '乙专辑', id: 132002 },
          score: 70,
        },
      },
      {
        startTime: 23003,
        song: {
          id: 333003,
          name: '丙歌',
          artists: [{ name: '丙歌手', id: 123003 }],
          album: { name: '丙专辑', id: 133003 },
          score: 90,
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

test('多候选响应取 result[0]：位置优先于 score，不按分数挑', () => {
  const song = parseMatchResponse(multiCandidateResponse)
  assert.notEqual(song, null)
  assert.equal(song!.name, '甲歌')
  assert.equal(song!.singer, '甲歌手')
  assert.equal(song!.albumName, '甲专辑')
  assert.equal(song!.neteaseSongId, '111001')
  assert.equal(song!.startTimeMs, 21001)
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
