import { fromByteArray } from 'react-native-quick-base64'
import { httpFetch } from '@/utils/request'
import { buildMatchForm, createSessionId, parseMatchResponse, unwrapMatchBody } from './ncmApi.ts'
import { toLittleEndianBytes, WINDOW_LEN_SECONDS } from './pcmSplitter.ts'
import { fingerprintFromWasm } from './wasmBridge.ts'
import { getNcmEndpoint } from './configStore.ts'
import type { RecognizeEngine, RecognizedSong } from './types.ts'

// 超时交给 httpFetch 自己处理（request.js:72、169-178 用 BackgroundTimer 真的会 abort 底层请求）。
// 在外面再包一层 Promise.race 只会「让 await 提前失败」，请求本体照样在途，白泄漏一条连接。
const REQUEST_TIMEOUT_MS = 9000

// 入参 pcm 是 8kHz 识别窗口（见 types.ts 的契约），不要再降采样
export const recognizeNcm = async(pcm: Int16Array): Promise<RecognizedSong | null> => {
  const endpoint = await getNcmEndpoint()
  // 空 endpoint 只有一个来源：ncm 这条被 sanitizeConfig 筛掉了（关停或非法域名），
  // 那是配置状态不是「没听到歌」，必须抛，让它落到 failed 而不是 no_match。
  if (!endpoint) throw new Error('ncm engine not configured')

  const rawdata = await fingerprintFromWasm(fromByteArray(toLittleEndianBytes(pcm)))
  if (__DEV__) console.log('[recognition] fingerprint:', (rawdata.length / 1024).toFixed(1) + 'KB')

  const form = buildMatchForm(rawdata, WINDOW_LEN_SECONDS, createSessionId())
  const resp = await httpFetch(endpoint, { method: 'post', form, timeout: REQUEST_TIMEOUT_MS }).promise
  // 非 2xx / 没解析成 JSON 的响应必须抛出去，不许降级成 null：
  // 那会把「服务挡了我们」一路说成「没听到歌」，退避保险丝永远不跳。
  return parseMatchResponse(unwrapMatchBody({ ok: resp.ok, status: resp.statusCode, body: resp.body }))
}

export const createNcmEngine = (): RecognizeEngine => ({
  id: 'ncm',
  recognize: recognizeNcm,
})
