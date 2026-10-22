import { parseScriptHeader } from '../../core/userApiUpdate/resolveScript.ts'
import { BUILTIN_SOURCE_SCRIPTS, type RawBuiltinSource } from './scripts.ts'

/**
 * 沿用社区对音源的说法：
 * - online：在线音源，通过更新地址拉取脚本导入
 * - local：本地音源，以 .js 文件形式导入
 *
 * 内置源都是打包进应用的 .js 脚本，按来源分成这两类只是沿用社区叫法。
 * 两类源都可以检查更新：作者在脚本头部写了 @updateUrl / @update_url 时，
 * 本地音源也能走同一套检查/更新流程；没有地址的源仍然只随应用更新。
 */
export type BuiltinSourceKind = 'online' | 'local'

export interface BuiltinSourceDefinition {
  id: string
  key: string
  kind: BuiltinSourceKind
  name: string
  version: string
  description: string
  author: string
  homepage: string
  script: string
  /** 目录里补的更新地址，写入用户可编辑的 updateUrl 初值 */
  updateUrl: string
  /** 上一版随包写入的更新地址：只在用户没改过时跟着目录迁移 */
  legacyUpdateUrls: string[]
  /** 主地址都取不到时才试的备用线路 */
  fallbackUpdateUrls: string[]
  /** 脚本头部自带的更新地址 */
  scriptUpdateUrl: string
  autoUpdate: boolean
  /** 脚本头部没写地址时，目录代本地源补的检查地址；{version} 会换成当前脚本版本 */
  checkUpdateUrls: string[]
  /** 是否跟其它源一起参加后台自动检查；手动检查不受它限制 */
  autoCheck: boolean
}

const parseDefinition = (raw: RawBuiltinSource): BuiltinSourceDefinition => {
  const header = parseScriptHeader(raw.script)
  if (!header?.name || !header.version) {
    throw new Error(`builtin source ${raw.key} has no valid script header`)
  }
  const online = raw.kind == 'online'
  const updateUrl = online ? raw.updateUrl ?? '' : ''
  const checkUpdateUrls = online ? [] : raw.checkUpdateUrls ?? []
  return {
    id: `builtin_${raw.key}`,
    key: raw.key,
    kind: raw.kind,
    name: header.name,
    version: header.version,
    description: header.description,
    author: header.author,
    homepage: header.homepage,
    script: raw.script,
    updateUrl,
    legacyUpdateUrls: online ? raw.legacyUpdateUrls ?? [] : [],
    fallbackUpdateUrls: online ? raw.fallbackUpdateUrls ?? [] : [],
    // 不论在线还是本地，脚本头部自己声明的更新地址都留着：
    // 检查更新时会把它当成脚本自己报的地址来用
    scriptUpdateUrl: header.updateUrl,
    autoUpdate: raw.autoUpdate ?? (!!updateUrl || !!header.updateUrl || checkUpdateUrls.length > 0),
    checkUpdateUrls,
    autoCheck: raw.autoCheck ?? (!!updateUrl || !!header.updateUrl || checkUpdateUrls.length > 0),
  }
}

export const BUILTIN_SOURCES = BUILTIN_SOURCE_SCRIPTS.map(parseDefinition)

export const BUILTIN_SOURCE_IDS = BUILTIN_SOURCES.map(source => source.id)

export const findBuiltinSource = (id: string): BuiltinSourceDefinition | null => {
  return BUILTIN_SOURCES.find(source => source.id == id) ?? null
}

export interface RemovedBuiltinSource {
  id: string
  name: string
}

/**
 * 已经从内置目录下架的源。
 *
 * 这几个本地源还能放歌，但它们自己的更新接口已经失效（或根本没人调用）：
 * 留在目录里，用户点「检查更新」永远只能得到「没有可用的更新地址」。
 * 下架时记下名字：老安装里随包播种的那份要在启动时清掉，如果它正好是当前音源，
 * 还要告诉用户换成了哪个源。
 *
 * 注意：不要只从这里删记录 —— 老安装的清理和当前源回退都靠这份名单。
 */
export const REMOVED_BUILTIN_SOURCES: readonly RemovedBuiltinSource[] = [
  { id: 'builtin_xigua', name: '西瓜聚合源' },
  { id: 'builtin_yuxi', name: '屿溪-终章' },
  { id: 'builtin_yuningxi', name: 'lx-玉宁熙-Pro' },
  { id: 'builtin_juhe_cf', name: '聚合API接口 (CF)' },
]

export const findRemovedBuiltinSource = (id: string): RemovedBuiltinSource | null => {
  return REMOVED_BUILTIN_SOURCES.find(source => source.id == id) ?? null
}

/**
 * 这个地址是不是某个在线内置源由目录写入的更新地址。
 *
 * 用来认出「A 源的地址被存到了 B 源上」这种明显错配：旧版手动更新先落址再预览，
 * 可能把别的源的地址写进来。自动检查不该拿它反复试 —— 它注定会取回另一个音源的脚本。
 */
export const findBuiltinSourceByUpdateUrl = (url: string | undefined): BuiltinSourceDefinition | null => {
  if (!url) return null
  return BUILTIN_SOURCES.find(source => source.kind == 'online' &&
    (source.updateUrl == url || source.legacyUpdateUrls.includes(url))) ?? null
}

/**
 * 目录给的备用线路只在「地址还是目录写的」时才用。
 *
 * 用户在设置里自己填的地址属于用户，不能拿它去猜目录的备用线路；
 * 上一版随包写的旧地址也算目录写的，迁移前还会用到。
 */
export const getBuiltinFallbackUpdateUrls = (id: string, updateUrl: string | undefined): string[] => {
  if (!updateUrl) return []
  const definition = findBuiltinSource(id)
  if (!definition || definition.kind != 'online') return []
  return updateUrl == definition.updateUrl || definition.legacyUpdateUrls.includes(updateUrl)
    ? definition.fallbackUpdateUrls
    : []
}

/**
 * 本地内置源在脚本头部之外、目录替作者记下的检查地址。
 *
 * 星海、animemusic 这类作者把版本接口写在脚本逻辑里、没写进头部注释，
 * 用户点检查更新时只能报「没有地址」。目录这里补上作者公开的版本接口；
 * {version} 是脚本自己的版本号，接口靠它判断有没有新版。
 */
export const getBuiltinLocalUpdateUrls = (id: string, version?: string): string[] => {
  const definition = findBuiltinSource(id)
  if (!definition || definition.kind != 'local') return []
  return definition.checkUpdateUrls.map(url => {
    if (!url.includes('{version}')) return url
    return url.replace(/\{version\}/g, encodeURIComponent(version ?? ''))
  })
}

/** 这个内置源有没有任何可以检查的地址（脚本头部或目录补的） */
export const hasBuiltinUpdateSource = (id: string): boolean => {
  const definition = findBuiltinSource(id)
  return !!definition && (!!definition.scriptUpdateUrl || definition.checkUpdateUrls.length > 0)
}

/** 这个内置源能不能参加后台自动检查 */
export const isBuiltinAutoCheck = (id: string): boolean => {
  return findBuiltinSource(id)?.autoCheck ?? false
}
