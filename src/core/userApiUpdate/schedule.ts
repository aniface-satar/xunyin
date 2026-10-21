export type UserApiUpdateCheckMode = 'off' | 'startup' | 'daily' | 'weekly'

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
export const pickCheckTargets = <T extends { lastCheckAt: number, updateUrl?: string, scriptUpdateUrl?: string }>(
  list: T[],
  mode: UserApiUpdateCheckMode,
  now: number,
  autoUpdate = true,
): T[] => {
  if (mode == 'off' || !autoUpdate) return []
  return list.filter(api => pickUpdateUrls(api).length > 0 && shouldCheck(mode, api.lastCheckAt, now))
}

const isHttpUrl = (url: unknown): url is string => typeof url == 'string' && /^https?:\/\/\S+$/i.test(url)

// jsDelivr 同一路径挂在不同 CDN 上，各边缘节点的缓存进度不一样：一个节点可能还停在旧版，
// 也可能正好缓存到作者发布途中的半截脚本（语法检查会拒掉）。只给一个域名时，
// 手机换不到能用的节点就只能一直报「新版脚本语法不完整」。
const JSDELIVR_HOSTS = ['fastly.jsdelivr.net', 'gcore.jsdelivr.net', 'cdn.jsdelivr.net']
const expandJsdelivrMirrors = (url: string): string[] => {
  const matched = /^(https?:\/\/)([^/]+)(\/.*)$/.exec(url)
  if (!matched || !JSDELIVR_HOSTS.includes(matched[2])) return [url]
  return [matched[2], ...JSDELIVR_HOSTS.filter(host => host != matched[2])]
    .map(host => `${matched[1]}${host}${matched[3]}`)
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
