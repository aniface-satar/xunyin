import { MATCH_ENDPOINT } from './ncmApi.ts'

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

export const KNOWN_ENGINE_IDS = ['ncm']

// 只允许 https + 识别服务的官方域（含其子域），其余一律丢
const ALLOWED_HOSTS = ['interface.music.163.com', 'music.163.com', 'amp.shazam.com']

export const DEFAULT_CONFIG: RecognitionConfig = {
  version: 1,
  engines: [{ id: 'ncm', enabled: true, endpoint: MATCH_ENDPOINT }],
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

export const sanitizeConfig = (raw: unknown): RecognitionConfig => {
  const config = asRecord(raw)
  if (!config || !Array.isArray(config.engines)) return DEFAULT_CONFIG
  const engines = config.engines.map(sanitizeEngine).filter((item): item is EngineConfig => item != null)
  if (!engines.length) return DEFAULT_CONFIG
  return {
    version: typeof config.version == 'number' ? config.version : DEFAULT_CONFIG.version,
    engines,
  }
}

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
