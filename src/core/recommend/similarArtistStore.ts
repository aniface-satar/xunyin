/* eslint-disable require-atomic-updates */
import { getData, saveData, removeData } from '@/plugins/storage'
import { httpFetch } from '@/utils/request'
import { recommendationConfig } from './config.ts'
import { isLikelyNetworkError, runWithRetry, type RequestPolicy } from './requestPolicy.ts'
import { searchMusic } from './sdkCatalog.ts'
import {
  normalizeSimilarArtistCache,
  parseListenBrainzSimilar,
  parseMusicBrainzArtistLookup,
  parseMusicBrainzArtistSearch,
} from './similarArtist.ts'
import type { SimilarArtistCache, SimilarArtistIo } from './similarArtist.ts'

const SIMILAR_ARTIST_KEY = 'xunyin_recommend_artistsim_v1'

const MB_API = 'https://musicbrainz.org/ws/2'
const LB_SIMILAR_API = 'https://labs.api.listenbrainz.org/similar-artists/json'
/** 实测缺省 algorithm 直接 400；这个参数是 ListenBrainz Labs 当前的会话共现算法。 */
const LB_ALGORITHM = 'session_based_days_7500_session_300_contribution_3_threshold_10_limit_100_filter_True_skip_30'
/** MB 要求可识别的 UA，用仓库地址而不是伪装浏览器。 */
const MB_USER_AGENT = 'XunYin/1.1.0 (https://github.com/aniface-satar/xunyin)'

const metaBrainzPolicy: RequestPolicy = {
  timeoutMs: recommendationConfig.similarArtist.requestTimeoutMs,
  retryCount: recommendationConfig.request.retryCount,
  backoffBaseMs: recommendationConfig.request.backoffBaseMs,
  backoffMaxMs: recommendationConfig.request.backoffMaxMs,
}

class MetaBrainzHttpError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`metabrainz_http_${status}`)
    this.name = 'MetaBrainzHttpError'
    this.status = status
  }
}

/**
 * MB 与 LB 共用一条串行队列、请求起始间隔 ≥ 1s：实测超限直接 503 busy。
 * kg 搜索走国内快队列，不受这里约束，所以两条队列彼此独立。
 */
let slowQueue: Promise<void> = Promise.resolve()
let lastSlowStartAt = 0

const sleep = async(ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

const runSlow = async <T>(task: () => Promise<T>): Promise<T> => {
  const run = slowQueue.then(async() => {
    const wait = recommendationConfig.similarArtist.minRequestIntervalMs - (Date.now() - lastSlowStartAt)
    if (wait > 0) await sleep(wait)
    lastSlowStartAt = Date.now()
    return await task()
  })
  slowQueue = run.then(() => undefined, () => undefined)
  return run
}

const fetchMetaBrainzJson = async(url: string): Promise<unknown> => {
  const resp = await httpFetch(url, {
    headers: { 'User-Agent': MB_USER_AGENT },
    timeout: recommendationConfig.similarArtist.requestTimeoutMs,
  }).promise
  // httpFetch 对非 2xx 不抛错：这里必须自己造错，否则 503 会被当成"没有相似歌手"。
  if (!resp.ok) throw new MetaBrainzHttpError(resp.statusCode)
  return resp.body
}

const shouldRetryMetaBrainz = (error: unknown) =>
  isLikelyNetworkError(error) ||
  (error instanceof MetaBrainzHttpError && (error.status == 429 || error.status >= 500))

const metaBrainzRequest = async <T>(url: string, parse: (body: unknown) => T): Promise<T> => {
  return runWithRetry(
    async() => runSlow(async() => parse(await fetchMetaBrainzJson(url))),
    {
      policy: metaBrainzPolicy,
      // 超时已由 httpFetch 的 AbortController 管，别再包一层 12s 的 Promise.race。
      timeoutMs: 0,
      shouldRetry: shouldRetryMetaBrainz,
    },
  )
}

const escapeMbQuery = (name: string) => name.replace(/["\\]/g, ' ').trim()

export const buildMusicBrainzSearchUrl = (name: string) =>
  `${MB_API}/artist/?query=${encodeURIComponent(`artist:"${escapeMbQuery(name)}"`)}&fmt=json&limit=1`

export const buildMusicBrainzLookupUrl = (mbid: string) =>
  `${MB_API}/artist/${encodeURIComponent(mbid)}?inc=aliases+tags&fmt=json`

export const buildListenBrainzSimilarUrl = (mbid: string) =>
  `${LB_SIMILAR_API}?artist_mbids=${encodeURIComponent(mbid)}&algorithm=${LB_ALGORITHM}`

/** 运行时 I/O：MB 检索 / LB 相似歌手 / MB 规范名反查走慢队列，kg 搜歌走国内源。 */
export const createSimilarArtistIo = (): SimilarArtistIo<LX.Music.MusicInfoOnline> => ({
  mbSearch: async name => metaBrainzRequest(buildMusicBrainzSearchUrl(name), parseMusicBrainzArtistSearch),
  lbSimilar: async mbid => metaBrainzRequest(buildListenBrainzSimilarUrl(mbid), parseListenBrainzSimilar),
  mbLookup: async mbid => metaBrainzRequest(buildMusicBrainzLookupUrl(mbid), parseMusicBrainzArtistLookup),
  kgSongs: async name => searchMusic('kg', name, 1, recommendationConfig.similarArtist.songsPerArtist),
})

let cache: SimilarArtistCache | null = null
let pendingLoad: Promise<SimilarArtistCache> | null = null
/**
 * 与歌手语言表同一条降级策略：读盘失败时内存从空表起步，但**不许落盘**，
 * 否则磁盘上那份积累了数周的缓存会被一张空表覆写。
 */
let persistAllowed = true

const readDisk = async(): Promise<SimilarArtistCache> => {
  let loaded: unknown = null
  try {
    loaded = await getData<unknown>(SIMILAR_ARTIST_KEY)
  } catch {
    persistAllowed = false
  }
  if (!cache) {
    cache = normalizeSimilarArtistCache(loaded, Date.now(), {
      cacheTtlMs: recommendationConfig.similarArtist.cacheTtlMs,
      cacheLimit: recommendationConfig.similarArtist.cacheLimit,
    })
  }
  return cache
}

export const loadSimilarArtistCache = async(): Promise<SimilarArtistCache> => {
  if (cache) return cache
  // 第一个 await 之前同步置位：并发的读盘调用共用同一个在途 promise。
  const load = pendingLoad ??= readDisk().finally(() => {
    pendingLoad = null
  })
  return await load
}

/** 未 load 完成时返回空缓存而不是抛错：刷新的 E 通道不该被存储时序卡住。 */
export const getSimilarArtistCache = (): SimilarArtistCache => cache ?? { byArtist: {}, pending: {} }

let saveTimer: ReturnType<typeof setTimeout> | null = null

const scheduleSave = () => {
  if (!cache || !persistAllowed || saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (!cache || !persistAllowed) return
    void saveData(SIMILAR_ARTIST_KEY, cache).catch(() => {})
  }, recommendationConfig.storage.saveDebounceMs)
}

/** 每次链路推进后整体替换缓存（runSimilarArtistRefresh 返回的是克隆对象，不会共享引用）。 */
export const setSimilarArtistCache = (next: SimilarArtistCache) => {
  cache = next
  scheduleSave()
}

export const saveSimilarArtistCacheNow = async() => {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!cache || !persistAllowed) return
  await saveData(SIMILAR_ARTIST_KEY, cache).catch(() => {})
}

export const clearSimilarArtistCache = async() => {
  // 先撤防抖写盘，避免 removeData 之后又把键建回来。
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  pendingLoad = null
  cache = { byArtist: {}, pending: {} }
  await removeData(SIMILAR_ARTIST_KEY).catch(() => {})
}

export const getSimilarArtistCacheKey = () => SIMILAR_ARTIST_KEY
