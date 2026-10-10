import type { RecognizedSong } from './types'

export type { RecognizedSong }

// 网易识曲接口（逆向、非公开、无 SLA）。本文件刻意零依赖：
// 只管请求体的形状与响应的解析，网络与 UI 都不许进来。
export const MATCH_ENDPOINT = 'https://interface.music.163.com/api/music/audio/match'

export interface MatchForm {
  sessionId: string
  algorithmCode: string
  duration: string
  rawdata: string
  times: string
  decrypt: string
}

export const buildMatchForm = (rawdata: string, durationSeconds: number, sessionId: string): MatchForm => ({
  sessionId,
  algorithmCode: 'shazam_v2',
  duration: String(durationSeconds),
  rawdata,
  times: '2',
  decrypt: '1',
})

const hex = (length: number, random: () => number): string => {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += Math.floor(random() * 16).toString(16)
  }
  return out
}

// Hermes 没有 crypto.randomUUID，服务端也不校验这个值的形状，本地拼一个够用
export const createSessionId = (random: () => number = Math.random): string => {
  return `${hex(8, random)}-${hex(4, random)}-4${hex(3, random)}-a${hex(3, random)}-${hex(12, random)}`
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  return typeof value == 'object' && value != null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

const asList = (value: unknown): unknown[] => Array.isArray(value) ? value : []

const asText = (value: unknown): string => {
  if (typeof value == 'string') return value
  if (typeof value == 'number') return String(value)
  return ''
}

export const parseMatchResponse = (body: unknown): RecognizedSong | null => {
  const data = asRecord(asRecord(body)?.data)
  const results = asList(data?.result)
  if (!results.length) return null
  const first = asRecord(results[0])
  const song = asRecord(first?.song)
  const name = asText(song?.name)
  if (!name) return null
  const singer = asList(song?.artists)
    .map(item => asText(asRecord(item)?.name))
    .filter(text => text)
    .join('/')
  return {
    name,
    singer,
    albumName: asText(asRecord(song?.album)?.name),
    neteaseSongId: asText(song?.id),
    startTimeMs: Number(first?.startTime) || 0,
  }
}

// 传输层的两个「假装成功」必须在进入 parseMatchResponse 之前拦下（见 src/utils/request.js）：
// 1. 非 2xx 不 reject —— 403 / 429 会以 fulfilled 的 promise 回来；
// 2. JSON.parse 失败时空 catch（request.js:202-204），body 原样留成字符串。
// 两者都会被 parseMatchResponse 的 asRecord 吞成 null，于是「服务把我们挡在外面」
// 在 UI 上永远显示成「没听到歌」：不报错、不退避、看不出来。这是本功能最坏的失效方向，
// 所以这里一律抛，让调度层把它算成 failed 并累计退避保险丝。
// 只认 ok/status/body 三个字段，调用方负责把 httpFetch 的 statusCode 映射成 status。
// 第三种「假装成功」在传输层看不见：netease 在 HTTP 200 里带业务 code（成功响应就是 code:200，
// 见 tests/music-recognition-ncm-api.mts 的实测形状），风控/限流时它照样 200 回一个 code:-462。
// 用户量涨上去之后最先发生的就是这一种，而它和「耳机里没歌」在 UI 上长一模一样。
// 所以带数字且不是 200 的 code 一律抛；没有 code 或 code 不是数字仍按命中/未命中正常解析。
export const unwrapMatchBody = (resp: { ok: boolean, status: number, body: unknown }): unknown => {
  if (!resp.ok) throw new Error('match http ' + resp.status)
  if (typeof resp.body == 'string') throw new Error('match response is not JSON')
  const body = asRecord(resp.body)
  if (body && typeof body.code == 'number' && body.code != 200) throw new Error('match code ' + body.code)
  return resp.body
}
