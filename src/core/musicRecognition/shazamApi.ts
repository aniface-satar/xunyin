import type { RecognizedSong } from './types'

export type { RecognizedSong }

// Shazam 官方 App 的识曲端点（逆向、非公开、无 SLA）。本文件与 ncmApi.ts 同分工：
// 只管 URL、请求体形状与响应解析，网络与 UI 都不许进来。
//
// zh/CN 只影响 sections 里字段标题的语种（"专辑" / "Album"）与中文唱片的译名写法，
// 解析按下标取第 0 条，不认这些标题，换语言不会把专辑名解析成空。
// 导出的用途：remoteConfig 的 DEFAULT_CONFIG 拿它当 shazam 那条的 endpoint，让白名单与
// 真实去向共用一个字符串。注意这个值不决定请求打到哪 —— Shazam 的 URL 由本文件拼，
// 配置里那条只承担「过白名单」与「这一条存不存在（= 开关）」两件事。
export const TAG_URL_PREFIX = 'https://amp.shazam.com/discovery/v5/zh/CN/android/-/tag/'

// 两个 tagId 与这串开关是实测跑通的形状（见 shazamSignature 对拍 + 本机 4/4 命中）。
// 参数只对响应「给多少元信息」有影响，删掉任何一项都可能拿到缺 track 的响应。
const TAG_URL_QUERY = '?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3' +
  '&sharehub=true&hubv5minorversion=v5.1&hidelb=true&video=v3'

export const buildTagUrl = (tagId1: string, tagId2: string): string => {
  return `${TAG_URL_PREFIX}${tagId1}/${tagId2}${TAG_URL_QUERY}`
}

// 路径写 android、头写 IPHONE 是官方 Python 客户端的发法，实测能认出歌；
// 把两者「改一致」等于换一个没验证过的请求形状，别顺手修。
export const SHAZAM_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Shazam-Platform': 'IPHONE',
  'X-Shazam-AppVersion': '14.1.0',
  Accept: '*/*',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36',
}

const hex = (length: number, random: () => number): string => {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += Math.floor(random() * 16).toString(16)
  }
  return out
}

// Hermes 没有 crypto.randomUUID，服务端也不校验这两个值的形状（实测空 uri、缺字段都照常回 200），
// 本地拼一个大写 uuid4 样子的串够用。
export const createTagId = (random: () => number = Math.random): string => {
  return `${hex(8, random)}-${hex(4, random)}-4${hex(3, random)}-a${hex(3, random)}-${hex(12, random)}`.toUpperCase()
}

export interface MatchBody {
  timezone: string
  signature: {
    uri: string
    samplems: number
  }
  timestamp: number
  context: Record<string, never>
  geolocation: Record<string, never>
}

// samplems 是这段音频的毫秒数（16k 下 = 样本数 / 16），由调用方算好传进来，
// 本文件不知道采样率也不碰签名编码。
export const buildMatchBody = (uri: string, sampleMs: number, timestamp: number): MatchBody => {
  return {
    timezone: 'Asia/Shanghai',
    signature: { uri, samplems: sampleMs },
    timestamp,
    context: {},
    geolocation: {},
  }
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

// 这个端点没有 ncm 那种业务 code 可查：本机实测「坏签名 / 空 uri / 整个 signature 缺失 /
// 空对象」四种畸形请求全部回 HTTP 200 + matches:[]，与静音的响应一模一样。
// 所以签名编码错了在这里看不出来，只能靠 tests 的字节级对拍兜住。
// 剩下的两种「假装成功」必须在解析前拦下（见 src/utils/request.js）：
// 1. 非 2xx 不 reject —— 风控的 403 / 429 会以 fulfilled 的 promise 回来；
// 2. JSON.parse 失败时空 catch（request.js:202-204），body 原样留成字符串。
// 两者都会被 parseMatchResponse 吞成 null，于是「服务挡了我们」在 UI 上永远显示成
// 「没听到歌」：不报错、不退避、看不出来。这里一律抛，让调度层算成 failed 并累计退避。
// 只认 ok/status/body 三个字段，调用方负责把 httpFetch 的 statusCode 映射成 status。
export const unwrapMatchBody = (resp: { ok: boolean, status: number, body: unknown }): unknown => {
  if (!resp.ok) throw new Error('shazam http ' + resp.status)
  if (typeof resp.body == 'string') throw new Error('shazam response is not JSON')
  return resp.body
}

// 命中形状取 track，未命中是 200 + matches:[]（没有 track 字段），返回 null 走 no_match。
// matches 非空但没有 track 也返回 null：那条 match 只有 id 和偏移，页面上无从展示。
export const parseMatchResponse = (body: unknown): RecognizedSong | null => {
  const root = asRecord(body)
  const track = asRecord(root?.track)
  const name = asText(track?.title)
  if (!track || !name) return null
  // 专辑名只存在于 sections 里 type=SONG 那一段的 metadata[0]，位置稳定、标题随语言变。
  const songSection = asList(track.sections)
    .map(item => asRecord(item))
    .find(section => section?.type == 'SONG')
  const firstMeta = asRecord(asList(songSection?.metadata)[0])
  const firstMatch = asRecord(asList(root?.matches)[0])
  return {
    name,
    singer: asText(track.subtitle),
    albumName: asText(firstMeta?.text),
    // 识曲结果页只认 name/singer/albumName，neteaseSongId 与 startTimeMs 当前无人消费：
    // 前者是网易派生 ID，跨派系填它等于造假数据；offset 是这首歌时间轴上的秒数，翻成毫秒留着对拍。
    neteaseSongId: '',
    startTimeMs: Math.round(Number(firstMatch?.offset) * 1000) || 0,
  }
}
