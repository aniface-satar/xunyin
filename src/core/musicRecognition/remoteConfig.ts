import { MATCH_ENDPOINT } from './ncmApi.ts'
import { TAG_URL_PREFIX } from './shazamApi.ts'

// 热更新只是从自家仓库的 CDN 拉一个静态 JSON，不是后端。
// 正因为这个文件一改就全量生效，端点必须过域名白名单：
// 白名单只放识别服务自己的官方域，谁把这个文件改了也指不到别处去。
export interface EngineConfig {
  id: string
  enabled: boolean
  endpoint: string
}

export interface RecognitionConfig {
  version: number
  engines: EngineConfig[]
}

export type FetchImpl = (url: string) => Promise<{ ok: boolean, status: number, text: () => Promise<string> }>

export const KNOWN_ENGINE_IDS = ['ncm', 'shazam']

// 只允许 https + 识别服务的官方域（含其子域），其余一律丢
const ALLOWED_HOSTS = ['interface.music.163.com', 'music.163.com', 'amp.shazam.com']

// 兜底 = 客户端出厂能用的引擎全开。shazam 那条的 endpoint 只是白名单与「有没有这一条」的载体，
// 真实 URL 由 shazamApi 自己拼（带两个随机 tagId），运营改这个值改不动请求去向。
export const DEFAULT_CONFIG: RecognitionConfig = {
  version: 1,
  engines: [
    { id: 'ncm', enabled: true, endpoint: MATCH_ENDPOINT },
    { id: 'shazam', enabled: true, endpoint: TAG_URL_PREFIX },
  ],
}

const repository = 'aniface-satar/xunyin'
const giteeRepository = 'not-a-chanci/xunyin'

// 与 src/utils/version.js 取版本号用的是同一组镜像地址，只是换成配置文件
export const CONFIG_URLS: string[] = [
  'https://aniface-satar.github.io/xunyin/recognition-config.json',
  `https://gitee.com/${giteeRepository}/raw/main/publish/recognition-config.json`,
  `https://cdn.jsdmirror.cn/gh/${repository}@main/publish/recognition-config.json`,
  `https://cdn.jsdelivr.net/gh/${repository}@main/publish/recognition-config.json`,
  `https://raw.githubusercontent.com/${repository}/main/publish/recognition-config.json`,
]

const httpsHost = (endpoint: unknown): string | null => {
  if (typeof endpoint != 'string') return null
  const matched = /^https:\/\/([^/?#:]+)(?::\d+)?(?:[/?#]|$)/.exec(endpoint)
  if (!matched) return null
  const host = matched[1].toLowerCase()
  // 正则会把 @、\ 这类字符一起吞进 host，而真实 URL 解析器不会（https://evil.net\@music.163.com
  // 实际打到 evil.net，但后缀比对看起来像 music.163.com 的子域）。主机名字符集收紧，伪装一律进不来。
  if (!/^[a-z0-9.-]+$/.test(host)) return null
  for (const allowed of ALLOWED_HOSTS) {
    if (host == allowed || host.endsWith(`.${allowed}`)) return host
  }
  return null
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  return typeof value == 'object' && value != null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

const sanitizeEngine = (value: unknown): EngineConfig | null => {
  const engine = asRecord(value)
  if (!engine) return null
  const id = engine.id
  if (typeof id != 'string' || !KNOWN_ENGINE_IDS.includes(id)) return null
  if (httpsHost(engine.endpoint) == null) return null
  return { id, enabled: engine.enabled !== false, endpoint: String(engine.endpoint) }
}

// 两种失败方向相反，不能混：
// - 读不出结构（不是对象、engines 不是数组）→ 退回 DEFAULT_CONFIG。配置是尽力而为的旁路，
//   镜像全挂也不该让识曲功能瘫痪。
// - 读得出结构（engines 是数组）→ 尊重运营方发出来的东西：哪怕每条都被白名单丢掉、
//   哪怕每条都 enabled:false，空数组就是「全部关闭」。这是紧急关停的唯一通道，
//   拿 DEFAULT_CONFIG 顶掉它等于把关停拨回 ON。
export const sanitizeConfig = (raw: unknown): RecognitionConfig => {
  const config = asRecord(raw)
  if (!config || !Array.isArray(config.engines)) return DEFAULT_CONFIG
  const engines: EngineConfig[] = []
  const sanitized = config.engines.map(sanitizeEngine).filter((item): item is EngineConfig => item != null)
  for (const engine of sanitized) {
    // 按 id 收敛，每个 id 只留第一条：远端塞 200 条 ncm 就是 200 倍打到网易，
    // 而本期唯一的防打靶手段是每日限流，不该被配置文件本身绕开。
    if (engines.some(kept => kept.id == engine.id)) continue
    engines.push(engine)
  }
  return {
    version: typeof config.version == 'number' ? config.version : DEFAULT_CONFIG.version,
    engines,
  }
}

// 传输层全失败（每个镜像都取不到、或响应体不是 JSON）才落到这里的 DEFAULT_CONFIG；
// 只要有任何一个镜像给出读得出结构的内容，就按 sanitizeConfig 的结果返回（含关停）。
export const fetchRemoteConfig = async(fetchImpl: FetchImpl, urls: string[] = CONFIG_URLS): Promise<RecognitionConfig> => {
  for (const url of urls) {
    try {
      const response = await fetchImpl(url)
      if (!response.ok) continue
      return sanitizeConfig(JSON.parse(await response.text()) as unknown)
    } catch {
      continue
    }
  }
  return DEFAULT_CONFIG
}
