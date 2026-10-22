/**
 * 音源更新地址 → 音源脚本。
 *
 * lx 官方规范里 updateAlert 的 updateUrl 只是「给人打开看的地址」，
 * 作者会填成脚本直链、版本接口、GitHub 页等等任意一种，所以这里不假设它是什么：
 * 取回内容后按「是不是音源脚本」判断，不是就从内容里能找到的链接继续找，
 * 找不到就明确报失败 —— 宁可退回人工打开，也不把 HTML 当成脚本写回源里。
 */

import { compareVersions } from './version.ts'

export type FetchImpl = (url: string) => Promise<{ ok: boolean, status: number, text: () => Promise<string> }>

export interface ScriptHeaderInfo {
  name: string
  version: string
  description: string
  author: string
  homepage: string
  updateUrl: string
  /**
   * 头部注释里能认出的构建时间（毫秒时间戳），认不出为 0。
   * 不少源一天生成很多次但 @version 只写日期，同版本的多次构建只能靠它比新旧，
   * 否则会把 CDN 上的旧缓存当成「同版本新内容」写回去。
   */
  buildTime: number
}

/** 更新页里只给了版本号、没给能下载的脚本时，拿它和本地版本比一比 */
export interface VersionDescriptor {
  version: string
  url: string
}

export type ResolveResult = {
  ok: true
  script: string
  fromUrl: string
  requests: number
} | {
  ok: false
  reason: 'invalid_url' | 'fetch_failed' | 'no_script_link' | 'no_update' | 'budget_exceeded'
  message: string
  descriptor?: VersionDescriptor
}

interface ResolveOptions {
  fetch: FetchImpl
  hint?: string
  maxRequests?: number
  /** 本地脚本版本：版本接口明确说不比它新时，不用再顺着作者的更新页爬 */
  currentVersion?: string
}

const DEFAULT_MAX_REQUESTS = 8

// 官方 matchInfo 从第 0 位严格匹配 /*，带 BOM 或前导空行的脚本会被误判成「不是脚本」，这里放宽。
// 只放宽到 BOM 与空白：再宽就会把 HTML 里随便一段注释当成人家脚本的头部。
const HEADER_RXP = /^\s*\/\*[\S\s]+?\*\//
const INFO_LINE_RXP = /^\s?\*\s?@(\w+)\s(.+)$/

// BOM 用 charCode 判断：正则字面量里放一个不可见字符，迟早被谁顺手删掉
export const matchHeaderComment = (content: string): string | null => {
  const body = content.charCodeAt(0) == 0xFEFF ? content.substring(1) : content
  const matched = HEADER_RXP.exec(body)
  // 放宽只为了认得带 BOM / 前导空行的脚本，交出去的仍然是从 /* 开头的那段注释
  return matched ? matched[0].replace(/^\s+/, '') : null
}

// 只认带时分秒的完整时间：作者常用的 @lastUpdate 2026-08-18 这种日期不是构建时间
const BUILD_TIME_RXP = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})\b/
const parseBuildTime = (comment: string): number => {
  const matched = BUILD_TIME_RXP.exec(comment)
  if (!matched) return 0
  const time = Date.UTC(
    Number(matched[1]),
    Number(matched[2]) - 1,
    Number(matched[3]),
    Number(matched[4]),
    Number(matched[5]),
    Number(matched[6]),
  )
  return Number.isFinite(time) ? time : 0
}

export const parseScriptHeader = (content: string): ScriptHeaderInfo | null => {
  const comment = matchHeaderComment(content)
  if (comment == null) return null
  const infos: Record<string, string> = {}
  for (const line of comment.split(/\r?\n/)) {
    const result = INFO_LINE_RXP.exec(line)
    if (!result) continue
    // 作者们写 @updateUrl、@update_url、@UpdateUrl 的都有；归一化后精确匹配 updateurl，
    // 这样 @update（更新说明）不会被当成更新地址去请求
    const key = result[1].replace(/_/g, '').toLowerCase()
    infos[key] ||= result[2].trim()
  }
  return {
    name: infos.name ?? '',
    version: infos.version ?? '',
    description: infos.description ?? '',
    author: infos.author ?? '',
    homepage: infos.homepage ?? '',
    updateUrl: infos.updateurl ?? '',
    buildTime: parseBuildTime(comment),
  }
}

const isScript = (content: string) => {
  const header = parseScriptHeader(content)
  // 只是「以块注释开头」不算：网页引用的 zepto 这类库也有块注释，但没有任何 lx 头部字段
  return header != null && header.name != '' && header.version != ''
}

const isHttpUrl = (url: string) => /^https?:\/\/\S+$/i.test(url)

// AbortController 中断时各运行时给的 message 就是英文的 Aborted，直接摆给用户看不懂
const describeFetchFailure = (status: string): string => {
  if (status == 'Aborted') return '请求超时'
  return status || '网络错误'
}

const NOT_SCRIPT_RXP = /\.(?:css|less|scss|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|mp[34]|zip|rar|7z|apk)(?:[?#]|$)/i

// 相对路径补全：RN 运行时没有可用的 URL 构造器，这里按更新地址自己拼
const resolveUrl = (base: string, href: string): string | null => {
  const link = href.trim()
  if (!link || link.startsWith('#') || /^(?:javascript|data|mailto|tel):/i.test(link)) return null
  if (/^https?:\/\//i.test(link)) return link
  if (link.startsWith('//')) return `${/^(\w+):/.exec(base)?.[1] ?? 'https'}:${link}`
  const baseRoot = /^(https?:\/\/[^/]+)/i.exec(base)?.[1]
  if (!baseRoot) return null
  if (link.startsWith('/')) return baseRoot + link
  const basePath = base.substring(baseRoot.length).split('?')[0].split('#')[0]
  const dir = basePath.substring(0, basePath.lastIndexOf('/') + 1)
  return `${baseRoot}${dir}${link}`
}

// GitHub 的 blob 页给人看，raw 才是脚本本体
const githubRawOf = (url: string): string | null => {
  const matched = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i.exec(url)
  if (!matched) return null
  return `https://raw.githubusercontent.com/${matched[1]}/${matched[2]}/${matched[3]}/${matched[4]}`
}

const collectCandidates = (url: string, content: string): string[] => {
  const links = new Set<string>()
  const add = (href: unknown) => {
    if (typeof href != 'string') return
    const resolved = resolveUrl(url, href)
    if (resolved == null || !isHttpUrl(resolved) || resolved == url) return
    links.add(resolved)
  }

  const alternates = githubRawOf(url)
  if (alternates) add(alternates)

  let body: unknown = null
  try {
    body = JSON.parse(content)
  } catch {}
  if (body != null && typeof body == 'object') {
    const walk = (value: unknown, key: string, depth: number) => {
      if (depth > 4) return
      if (Array.isArray(value)) {
        for (const item of value) walk(item, key, depth + 1)
        return
      }
      if (value != null && typeof value == 'object') {
        for (const [k, v] of Object.entries(value)) walk(v, k, depth + 1)
        return
      }
      if (typeof value == 'string' && /(?:url|link|download|src|file)/i.test(key)) add(value)
    }
    walk(body, '', 0)
    return [...links]
  }

  for (const matched of content.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/gi)) add(matched[1])
  return [...links].filter(link => !NOT_SCRIPT_RXP.test(link))
}

// 版本描述字段各家写法不同：念心/长青用 version，玉宁熙用 latest；下划线归一化后比较
const DESCRIPTOR_VERSION_KEYS = new Set(['version', 'latest', 'latestversion', 'newversion'])
const DESCRIPTOR_URL_KEYS = new Set(['updateurl', 'download', 'downloadurl', 'url', 'link', 'src', 'file'])
const normalizeKey = (key: string) => key.replace(/_/g, '').toLowerCase()

/**
 * 从 JSON 里找「版本 + 更新页」描述。
 *
 * 网页解析找不到脚本时，只有版本号还能用来判断用户是不是已经最新；
 * 描述可能出现一层（念心/长青）或嵌在 data 里（HYW），所以按对象树往下找。
 */
const parseVersionDescriptor = (content: string, baseUrl: string): VersionDescriptor | null => {
  let body: unknown
  try {
    body = JSON.parse(content)
  } catch {
    return null
  }
  const visit = (value: unknown, depth: number): VersionDescriptor | null => {
    if (depth > 4 || value == null || typeof value != 'object') return null
    if (!Array.isArray(value)) {
      let version = ''
      let url = ''
      for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
        const normalized = normalizeKey(key)
        if (!version && DESCRIPTOR_VERSION_KEYS.has(normalized) && (typeof field == 'string' || typeof field == 'number')) {
          const text = String(field).trim()
          if (text && text.length <= 64) version = text
        }
        if (!url && DESCRIPTOR_URL_KEYS.has(normalized) && typeof field == 'string') {
          const resolved = resolveUrl(baseUrl, field)
          if (resolved != null && isHttpUrl(resolved)) url = resolved
        }
      }
      if (version) return { version, url }
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      const found = visit(child, depth + 1)
      if (found) return found
    }
    return null
  }
  return visit(body, 0)
}

// 版本检查接口在“已是最新”时往往只回一句话、不给任何脚本地址（HYW 就是 code:0 + 已是最新版本）。
// 只认 JSON 且候选里没有可下载的脚本链接时才看这句提示，避免把普通页面里的宣传语当成“没更新”。
const NO_UPDATE_RXP = /已是最新|最新版本|没有新版本|无更新|no\s*update|up[-\s]?to[-\s]?date|already\s+(?:the\s+)?latest|latest\s+version/i
// 也有人家的提示语根本不让正则认（星海用 GBK 编码，UTF-8 解码后全是乱码），
// 但 JSON 里把更新地址字段显式回成 null —— 结构上就是「这次没有可推送的更新」。
// 只在整份 JSON 里没有任何版本信息时才算：带着版本号的接口不能靠这条吞掉。
const NULL_UPDATE_URL_KEYS = new Set(['updateurl', 'downloadurl', 'download', 'scripturl'])
const hasNullUpdateUrl = (value: unknown, depth: number): boolean => {
  if (depth > 4 || value == null || typeof value != 'object') return false
  if (Array.isArray(value)) return value.some(item => hasNullUpdateUrl(item, depth + 1))
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.some(([key, field]) => field === null && NULL_UPDATE_URL_KEYS.has(normalizeKey(key)))) return true
  return entries.some(([, field]) => hasNullUpdateUrl(field, depth + 1))
}
const isNoUpdateResponse = (content: string, body: unknown, hasDescriptor: boolean): boolean => {
  if (body == null || typeof body != 'object') return false
  // 也有人家的接口什么话都不说，只回 {"code":200,"data":null} 表示“没有可推送的更新”
  // （lx-animemusic 就是这样；有新版时 data 里会带 updateUrl）。
  const record = body as Record<string, unknown>
  if (Number(record.code) === 200 && record.data == null) return true
  if (!hasDescriptor && hasNullUpdateUrl(body, 0)) return true
  return NO_UPDATE_RXP.test(content)
}

const isScriptLink = (link: string) => /\.js(?:[?#]|$)/i.test(link)

const rankCandidates = (candidates: string[], hint?: string) => {
  const key = hint?.trim().toLowerCase() ?? ''
  // 更新页里既有脚本又有说明页/图片时，先拿脚本；名字像当前源的再往前排。
  // 同一档内保持页面里的文档顺序（作者通常把最新版放最前面）。
  const score = (link: string) => {
    const normalized = link.toLowerCase()
    return (isScriptLink(normalized) ? 0 : 2) + (key && normalized.includes(key) ? -1 : 0)
  }
  return candidates.map((link, index) => ({ link, index })).sort((a, b) => {
    const diff = score(a.link) - score(b.link)
    return diff != 0 ? diff : a.index - b.index
  }).map(item => item.link)
}

export const resolveScriptFromUrl = async(url: string, options: ResolveOptions): Promise<ResolveResult> => {
  const { fetch, hint, maxRequests = DEFAULT_MAX_REQUESTS, currentVersion } = options
  if (!isHttpUrl(url)) return { ok: false, reason: 'invalid_url', message: '更新地址不是 http(s) 链接' }

  const queue: string[] = [url]
  const visited = new Set<string>()
  let requests = 0
  let fetchedAny = false
  let failedStatus = ''
  let descriptor: VersionDescriptor | null = null
  const fail = (reason: 'fetch_failed' | 'no_script_link' | 'budget_exceeded' | 'no_update', message: string): ResolveResult => ({
    ok: false,
    reason,
    message,
    ...(descriptor ? { descriptor } : {}),
  })

  while (queue.length) {
    if (requests >= maxRequests) {
      return fail('budget_exceeded', `试过 ${requests} 个地址，仍没找到音源脚本`)
    }
    const target = queue.shift()!
    if (visited.has(target)) continue
    visited.add(target)
    requests++

    let content: string
    try {
      const resp = await fetch(target)
      if (!resp.ok) {
        if (!fetchedAny) failedStatus = `${resp.status}`
        continue
      }
      fetchedAny = true
      content = await resp.text()
    } catch (err: any) {
      if (!fetchedAny) failedStatus = err?.message ?? 'unknown'
      continue
    }

    if (isScript(content)) return { ok: true, script: content, fromUrl: target, requests }
    const pageDescriptor = parseVersionDescriptor(content, target)
    descriptor ??= pageDescriptor
    const candidates = collectCandidates(target, content)
    let jsonBody: unknown = null
    try {
      jsonBody = JSON.parse(content)
    } catch {}
    // 候选里还有能下载的脚本链接时继续爬：接口一边说「已最新」一边给得出脚本的，以脚本为准
    if (isNoUpdateResponse(content, jsonBody, pageDescriptor != null) && !candidates.some(isScriptLink)) {
      return fail('no_update', '更新地址显示已经是最新版本')
    }
    // 长青/念心/聚合 API 这类地址本身就带着版本号，更新页只是给人看的文档。
    // 版本不比本地新、页面上又没有脚本可下载时，到这里就可以说「已是最新」，
    // 不必再取一遍网盘/文档页（有的还会超时或要求登录）。
    if (currentVersion && pageDescriptor?.version) {
      const compared = compareVersions(pageDescriptor.version, currentVersion)
      if (compared != null && compared <= 0 && !candidates.some(isScriptLink)) {
        return fail('no_update', '更新地址显示已经是最新版本')
      }
    }
    queue.push(...rankCandidates(candidates, hint).filter(link => !visited.has(link)))
  }

  if (!fetchedAny) return fail('fetch_failed', `更新地址取不到（${describeFetchFailure(failedStatus)}）`)
  return fail('no_script_link', '更新地址里没有可用的音源脚本链接')
}
