import { httpFetch } from '@/utils/request'
import { fetchRemoteConfig, type EngineConfig, type FetchImpl, type RecognitionConfig } from './remoteConfig.ts'

const CACHE_MS = 60 * 60 * 1000

let cached: { config: RecognitionConfig, at: number } | null = null
// 一次识别会连着问 endpoint 和 enabled。只缓存「已结算的值」挡不住这两次调用
// 各自发一轮 HTTP（第一次还在途时第二次就进来了），所以必须在途 Promise 也复用。
let inflight: Promise<RecognitionConfig> | null = null

// httpFetch 的 promise 给的是 { statusCode, body }，适配成 remoteConfig 的 FetchImpl。
// 白名单校验留在 sanitizeConfig 里做，所以这里必须把原文交出去。
const fetchImpl: FetchImpl = async(url) => {
  const { statusCode, body } = await httpFetch(url).promise
  const raw: unknown = body
  return {
    ok: statusCode >= 200 && statusCode < 300,
    status: statusCode,
    text: async() => typeof raw == 'string' ? raw : JSON.stringify(raw ?? null),
  }
}

const loadConfig = async(): Promise<RecognitionConfig> => {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_MS) return cached.config
  if (inflight) return inflight
  const promise = (async() => {
    const config = await fetchRemoteConfig(fetchImpl)
    cached = { config, at: Date.now() }
    if (__DEV__) console.log('[recognition] engine config version:', config.version)
    return config
  })()
  inflight = promise
  const clear = () => { if (inflight === promise) inflight = null }
  void promise.then(clear, clear)
  return promise
}

// 启用与端点是两件事，必须分开问（Task 8 用它决定引擎数组）：
// 数组为空 -> provider 返回 unsupported（「识曲暂不可用」）；
// 数组非空但拿不到端点 -> 才是 no_match（「没听到歌」）。
// 混成一件事会让运营方的紧急关停在读用户眼里变成「你的耳机里没歌」。
const findNcmEngine = async(): Promise<EngineConfig | undefined> => {
  let config: RecognitionConfig
  try {
    config = await loadConfig()
  } catch {
    config = cached?.config ?? { version: 0, engines: [] }
  }
  return config.engines.find(item => item.id == 'ncm' && item.enabled)
}

export const getNcmEndpoint = async(): Promise<string> => {
  const engine = await findNcmEngine()
  return engine?.endpoint ?? ''
}

export const isNcmEngineEnabled = async(): Promise<boolean> => {
  return (await findNcmEngine()) != null
}
