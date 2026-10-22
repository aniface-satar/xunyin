import {
  getBuiltinFallbackUpdateUrls,
  getBuiltinLocalUpdateUrls,
  isBuiltinAutoCheck,
} from '../../config/builtinSources/catalog.ts'

export type UserApiUpdateCheckMode = 'off' | 'startup' | 'daily' | 'weekly'

export interface UpdateUrlSource {
  id: string
  builtin?: 'online' | 'local'
  updateUrl?: string
  scriptUpdateUrl?: string
  /** 当前脚本版本：目录补的检查地址里 {version} 会换成它 */
  version?: string
  /** 自动检查里已经被证明「取回的是别的音源脚本」的地址，见 planUpdateUrls */
  updateUrlRejected?: string
}

const DAY_MS = 24 * 60 * 60 * 1000

export const USER_API_UPDATE_CHECK_MODES: UserApiUpdateCheckMode[] = ['off', 'startup', 'daily', 'weekly']

const PERIOD_MS: Record<Exclude<UserApiUpdateCheckMode, 'off' | 'startup'>, number> = {
  daily: DAY_MS,
  weekly: 7 * DAY_MS,
}

/**
 * 到不该到这次检查的时候 —— 「每次启动」档不看时间，其余档按周期，
 * 时间戳为 0（从没查过）一律放行。
 *
 * 手机时间被往回调过（换机、改时区、时钟漂移）会让 lastCheckAt 落在未来，
 * 严格按差值算会永远等不到下一次检查，所以负差值当作「该查了」处理。
 */
export const shouldCheck = (mode: UserApiUpdateCheckMode, lastCheckAt: number, now: number): boolean => {
  if (mode == 'off') return false
  if (mode == 'startup') return true
  if (!lastCheckAt) return true
  const elapsed = now - lastCheckAt
  if (elapsed < 0) return true
  return elapsed >= PERIOD_MS[mode]
}

/**
 * 这一轮该查哪些源。
 *
 * 「自动更新源」是设置页里的总开关：关掉就一个都不查；打开后只挑真正有更新地址的源，
 * 没地址的源（比如刚随应用提供、作者也没写更新地址的本地源）不在后台空跑请求。
 * 频率档选「关闭」时同样一个都不挑 —— 不占用户流量，也不在后台一直请求。
 */
export const pickCheckTargets = <T extends UpdateUrlSource & { lastCheckAt: number }>(
  list: T[],
  mode: UserApiUpdateCheckMode,
  now: number,
  autoUpdate = true,
): T[] => {
  if (mode == 'off' || !autoUpdate) return []
  return list.filter(api => pickScheduledUpdateUrls(api).length > 0 && shouldCheck(mode, api.lastCheckAt, now))
}

const isHttpUrl = (url: unknown): url is string => typeof url == 'string' && /^https?:\/\/\S+$/i.test(url)

// jsDelivr 同一路径挂在不同 CDN 上，各边缘节点的缓存进度不一样：一个节点可能还停在旧版，
// 也可能正好缓存到作者发布途中的半截脚本（语法检查会拒掉）。只给一个域名时，
// 手机换不到能用的节点就只能一直报「新版脚本语法不完整」。
const JSDELIVR_HOSTS = ['fastly.jsdelivr.net', 'gcore.jsdelivr.net', 'cdn.jsdelivr.net']
// GitHub raw 在国内基本连不上，同一份内容 jsDelivr 上就有：头部把导入地址写成 raw 的源
// （落雪云）检查时补上镜像，不然后台每轮都只等到一次超时
const RAW_GITHUB_RXP = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i
const expandJsdelivrMirrors = (url: string): string[] => {
  const matched = /^(https?:\/\/)([^/]+)(\/.*)$/.exec(url)
  if (matched && JSDELIVR_HOSTS.includes(matched[2])) {
    return [matched[2], ...JSDELIVR_HOSTS.filter(host => host != matched[2])]
      .map(host => `${matched[1]}${host}${matched[3]}`)
  }
  const rawMatched = RAW_GITHUB_RXP.exec(url)
  if (rawMatched) {
    const [, owner, repo, ref, path] = rawMatched
    return [url, ...JSDELIVR_HOSTS.map(host => `https://${host}/gh/${owner}/${repo}@${ref}/${path}`)]
  }
  return [url]
}
/**
 * 这一次更新可以按什么顺序试哪些地址：用户在设置里填的最准，压过脚本自己报的；
 * 没填才轮得到脚本 —— 先这次上报的，再头部注释里存的。
 * 非 http(s) 的地址当没有，继续找下一个，不让一个坏地址挡住后面能用的。
 * jsDelivr 地址会补上其它官方镜像，避免一个边缘节点缓存了半截脚本就判死。
 */
export const pickUpdateUrls = (api: { updateUrl?: string, scriptUpdateUrl?: string }, eventUrl?: string): string[] => {
  const urls: string[] = []
  for (const url of [api.updateUrl, eventUrl, api.scriptUpdateUrl]) {
    if (!isHttpUrl(url)) continue
    for (const candidate of expandJsdelivrMirrors(url)) {
      if (!urls.includes(candidate)) urls.push(candidate)
    }
  }
  return urls
}

export const pickUpdateUrl = (api: { updateUrl?: string, scriptUpdateUrl?: string }, eventUrl?: string): string => {
  return pickUpdateUrls(api, eventUrl)[0] ?? ''
}

/**
 * 同一条 jsDelivr 路径的镜像算同一组：地址是 fastly，实际报错可能来自 gcore，
 * 记下任何一条都应把整组挡掉，而不是换一个镜像接着撞。
 */
const isSameMirrorGroup = (a: string, b: string): boolean => {
  const group = expandJsdelivrMirrors(a)
  return expandJsdelivrMirrors(b).some(url => group.includes(url))
}

/**
 * 这一次更新分两档试哪些地址。
 *
 * 主地址沿用旧顺序（用户填的 > 脚本这次报的 > 头部存的，jsDelivr 自动补镜像）；
 * 内置在线源目录里的备用线路放第二档，只有主地址全军覆没才走 —— 网上换了条主线路时，
 * 老版本里还留着旧地址的设备不至于一直取不到，正常情况也不用替作者多花请求。
 *
 * 手动更新时用户填的地址最准：overrideUrl 只试这一个，不拿备用线路替它「兜底」，
 * 免得地址填错了却检查成功，让人以为填的是对的。
 * 后台检查本地内置源只用脚本自带的地址：用户手填的地址留给手动更新，不在启动时反复试。
 * 本地源的头部没写地址时，再加上目录替作者记的版本接口（星海、聚合 API 这类）；
 * 后台只给标注了 autoCheck 的源加，接口不稳定的作者不能拖慢整轮检查。
 * 后台检查还跳过 updateUrlRejected：那个地址取回过别的音源的脚本，再试结果不会变；
 * 手动检查不受这条限制。
 */
export const planUpdateUrls = (
  api: UpdateUrlSource,
  eventUrl?: string,
  options?: { overrideUrl?: string, scheduled?: boolean },
): { primary: string[], fallback: string[] } => {
  if (options?.overrideUrl != null) {
    return { primary: pickUpdateUrls({ updateUrl: options.overrideUrl, scriptUpdateUrl: '' }), fallback: [] }
  }
  let primary: string[]
  let fallback: string[] = []
  const scheduledLocal = options?.scheduled && api.builtin == 'local'
  if (scheduledLocal) {
    primary = pickUpdateUrls({ updateUrl: '', scriptUpdateUrl: api.scriptUpdateUrl })
  } else {
    primary = pickUpdateUrls(api, eventUrl)
    for (const url of getBuiltinFallbackUpdateUrls(api.id, api.updateUrl)) {
      for (const candidate of expandJsdelivrMirrors(url)) {
        if (!primary.includes(candidate) && !fallback.includes(candidate)) fallback.push(candidate)
      }
    }
  }
  if (api.builtin == 'local' && (!scheduledLocal || isBuiltinAutoCheck(api.id))) {
    for (const candidate of getBuiltinLocalUpdateUrls(api.id, api.version)) {
      if (!primary.includes(candidate) && !fallback.includes(candidate)) primary.push(candidate)
    }
  }
  const rejected = options?.scheduled ? api.updateUrlRejected : ''
  if (rejected) {
    primary = primary.filter(url => !isSameMirrorGroup(url, rejected))
    fallback = fallback.filter(url => !isSameMirrorGroup(url, rejected))
  }
  return { primary, fallback }
}

export const pickScheduledUpdateUrls = (api: UpdateUrlSource): string[] => {
  const plan = planUpdateUrls(api, undefined, { scheduled: true })
  return [...plan.primary, ...plan.fallback]
}
