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
