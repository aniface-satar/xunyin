import { httpFetch } from '@/utils/request'
import { DEFAULT_CONFIG, fetchRemoteConfig, type EngineConfig, type FetchImpl, type RecognitionConfig } from './remoteConfig.ts'

const CACHE_MS = 60 * 60 * 1000
// 每个镜像各给 4s：fetchRemoteConfig 是串行走 5 个镜像的，默认的 15s 会让冷缓存
// 最坏卡 75s，而 getNcmEndpoint 是识别路径上第一个 await，用户那时连「正在听」都还没看到。
const MIRROR_TIMEOUT_MS = 4000

let cached: { config: RecognitionConfig, at: number } | null = null
// 一次识别会连着问 endpoint 和 enabled。只缓存「已结算的值」挡不住这两次调用
// 各自发一轮 HTTP（第一次还在途时第二次就进来了），所以必须在途 Promise 也复用。
let inflight: Promise<RecognitionConfig> | null = null

// httpFetch 的 promise 给的是 { statusCode, body }，适配成 remoteConfig 的 FetchImpl。
// 白名单校验留在 sanitizeConfig 里做，所以这里必须把原文交出去。
const fetchImpl: FetchImpl = async(url) => {
  const { statusCode, body } = await httpFetch(url, { timeout: MIRROR_TIMEOUT_MS }).promise
  const raw: unknown = body
  return {
    ok: statusCode >= 200 && statusCode < 300,
    status: statusCode,
    text: async() => typeof raw == 'string' ? raw : JSON.stringify(raw ?? null),
  }
}

// 同步段就把 inflight 记好（body 里没有 await），两次连着问才不会各发一轮 HTTP。
const startFetch = async(): Promise<RecognitionConfig> => {
  const promise = fetchRemoteConfig(fetchImpl).then(config => {
    cached = { config, at: Date.now() }
    if (__DEV__) console.log('[recognition] engine config version:', config.version)
    return config
  })
  inflight = promise
  const clear = () => { if (inflight === promise) inflight = null }
  void promise.then(clear, clear)
  return promise
}

const loadConfig = async(): Promise<RecognitionConfig> => {
  if (cached) {
    // 陈旧也立刻回：热更新是旁路，网络不该出现在识别路径上。
    // 过期的配置在后台刷新，代价是关停最迟晚一次识别才生效；
    // 换来的是镜像全挂（captive portal、CDN 黑洞）时用户只慢第一次。
    if (Date.now() - cached.at >= CACHE_MS && !inflight) {
      void startFetch().catch(() => {
        // 后台刷新失败就继续用旧值：刷新是旁路，不该把它变成「拿不到配置」
        if (__DEV__) console.log('[recognition] background config refresh failed')
      })
    }
    return cached.config
  }
  if (inflight) return inflight
  return startFetch()
}

// 启用与端点是两件事，必须分开问（Task 8 用它决定引擎数组）：
// 数组为空 -> provider 返回 unsupported（面板用 music_recognition_failed 那句「暂时没响应」）；
// 数组非空但拿不到端点 -> 那是配置状态，ncmEngine 直接抛，让它落到 failed 而不是「没听到歌」。
// 混成一件事会让运营方的紧急关停在读用户眼里变成「你的耳机里没歌」。
const findNcmEngine = async(): Promise<EngineConfig | undefined> => {
  let config: RecognitionConfig
  try {
    config = await loadConfig()
  } catch (err) {
    // 保险丝：fetchRemoteConfig 设计上不会 reject（镜像全挂也回 DEFAULT_CONFIG），
    // 但兜底值必须是 DEFAULT_CONFIG，不能是 engines: [] —— 空数组在 sanitizeConfig
    // 的语义里是「运营方全部关停」，拿它兜底会把「拉不到配置」谎报成「识曲暂不可用」。
    config = DEFAULT_CONFIG
    if (__DEV__) console.log('[recognition] config load failed:', String(err))
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
