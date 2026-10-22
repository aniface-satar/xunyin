/**
 * 音源更新的编排层。
 *
 * 分工：什么时候查见 schedule，往哪儿取脚本见 resolveScript，能不能写见 applyUpdate。
 * 这里只做两件纯逻辑管不了的事：真发一次网络请求，以及把新脚本换上去之后验一遍
 * —— 加载不起来就用更新前留的那份备份换回去，不能让用户的音源停在一个听不懂歌的脚本上。
 */
import BackgroundTimer from 'react-native-background-timer'
import { state as userApiState } from '@/store/userApi'
import { getLoadScriptInfo } from '@/utils/nativeModules/userApi'
import {
  getUserApiBackupScript,
  getUserApiList,
  getUserApiScript,
  saveUserApiBackupScript,
  saveUserApiScript,
  setUserApiLastCheckAt,
  setUserApiUpdateUrlRejected,
  setUserApiVerifyPending,
  updateUserApi,
} from '@/utils/data'
import { log, setUserApi, setUserApiList } from '@/core/userApi'
import settingState from '@/store/setting/state'
import { toast } from '@/utils/tools'
import { parseScriptHeader, resolveScriptFromUrl, type ScriptHeaderInfo, type FetchImpl } from './resolveScript.ts'
import { applyUpdateScript, rollbackScript, type ScriptStore } from './applyUpdate.ts'
import { pickBestPreview, previewDescriptor, previewUpdate, type UserApiUpdatePreview } from './preview.ts'
import { pickCheckTargets, planUpdateUrls, type UserApiUpdateCheckMode } from './schedule.ts'


// 作者把更新地址当成「给人用浏览器打开的页面」，有些站点对不像浏览器的请求直接回 403
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36'
const FETCH_TIMEOUT = 15_000
// 脚本要在 QuickJS 里解析并跑完初始化，大脚本这一步可能好几秒；等不到结果就当它起不来
const INIT_RESULT_TIMEOUT = 30_000

const fetchText: FetchImpl = async(url) => {
  const controller = new AbortController()
  let timer: number | null = BackgroundTimer.setTimeout(() => {
    timer = null
    controller.abort()
  }, FETCH_TIMEOUT)
  try {
    const resp = await global.fetch(url, {
      method: 'get',
      cache: 'no-store', // 不能拿到缓存里的旧版本：那会让「已更新」变成假话
      credentials: 'omit',
      signal: controller.signal,
      headers: { 'User-Agent': BROWSER_USER_AGENT },
    })
    const text = await resp.text()
    return { ok: resp.ok, status: resp.status, text: async() => text }
  } finally {
    if (timer != null) BackgroundTimer.clearTimeout(timer)
  }
}

const scriptStore: ScriptStore = {
  readScript: getUserApiScript,
  readBackup: getUserApiBackupScript,
  writeBackup: saveUserApiBackupScript,
  writeScript: async(id: string, script: string, header: ScriptHeaderInfo | null) => {
    // header 为 null 只有回滚会走到：那份备份连头部注释都没有，就不指望它刷新列表信息了
    if (header == null) {
      await saveUserApiScript(id, script)
      return
    }
    const list = await updateUserApi(id, script)
    if (list) setUserApiList(list)
  },
}

const waitForScriptInit = async(id: string): Promise<boolean> => new Promise(resolve => {
  let settled = false
  let timer: number = 0
  const finish = (ok: boolean) => {
    if (settled) return
    settled = true
    global.state_event.off('userApiInitResult', handleInitResult)
    BackgroundTimer.clearTimeout(timer)
    resolve(ok)
  }
  const handleInitResult = (info: { id: string, status: boolean }) => {
    if (info.id != id) return
    finish(info.status)
  }
  timer = BackgroundTimer.setTimeout(() => { finish(false) }, INIT_RESULT_TIMEOUT)
  global.state_event.on('userApiInitResult', handleInitResult)
})

/**
 * 换上新脚本后重新加载；加载不起来就把更新前留的备份换回去。
 *
 * 验证这一次必须标记成 verify：它顶掉的可能是正在初始化的当前源，
 * 失败若按普通初始化结算，整个源会被判成起不来（回滚也救不回来）。
 * 回滚之后的那次加载是正常加载，应用级状态由它结算。
 *
 * @returns ok=新脚本能用；rolledBack=已经退回旧脚本
 */
const reloadAndVerify = async(api: LX.UserApi.UserApiInfo): Promise<{ ok: boolean, rolledBack: boolean }> => {
  // 先订阅再触发加载：init 事件可能在 setUserApi 返回前后就到
  const waiting = waitForScriptInit(api.id)
  try {
    await setUserApi(api.id, { verify: true })
  } catch (err: any) {
    log.r_error(`user api reload error: ${api.name} ${err.message as string}`)
  }
  if (await waiting) return { ok: true, rolledBack: false }

  log.r_error(`user api reload failed: ${api.name}`)
  let rolledBack = false
  try {
    rolledBack = await rollbackScript(scriptStore, api.id)
  } catch (err: any) {
    // 回滚写盘失败也要往下走：后面那次正常加载会把真实失败交给应用层，
    // 不能让这个异常把 apiInitPromise 永远悬在半空
    log.r_error(`user api rollback error: ${api.name} ${err.message as string}`)
  }
  if (rolledBack) log.r_info(`user api rolled back to the previous script: ${api.name}`)
  // 没有备份可回滚时盘上留的仍是坏脚本，更要按正常加载再报一次真实失败，
  // 否则 apiInitPromise 永远悬着，取链接全部卡住
  setUserApi(api.id).catch(err => {
    log.r_error(`user api ${rolledBack ? 'rollback' : 'failed verify'} reload error: ${api.name} ${err.message as string}`)
  })
  return { ok: false, rolledBack }
}

export type { UserApiUpdatePreview } from './preview.ts'
export type { UserApiUpdateComparison } from './preview.ts'

export type UserApiUpdateOutcome = {
  status: 'updated'
  name: string
  fromVersion: string
  toVersion: string
} | {
  status: 'unchanged'
  name: string
} | {
  /** 地址里是比当前更旧的版本，没有写盘 */
  status: 'older'
  name: string
  fromVersion: string
  toVersion: string
} | {
  status: 'failed'
  reason: 'not_found' | 'no_url' | 'resolve_failed' | 'rejected' | 'reload_failed'
  /** rejected 时具体是哪条闸门拦下的 */
  rejectReason?: 'invalid_script' | 'name_mismatch' | 'too_large' | 'syntax_error'
  message: string
  /** 取不到脚本时给人退回原来那一步：把这个地址打开自己下载 */
  openUrl?: string
  /** 只有 reload_failed 会带：新版换上去起不来，有没有真的退回旧脚本 */
  rolledBack?: boolean
}

const findApi = (id: string): LX.UserApi.UserApiInfo | null => {
  return userApiState.list.find(api => api.id == id) ?? getLoadScriptInfo()
}

/**
 * 只取地址、算结论，不碰存储。
 *
 * 一个源可能同时列出多个地址：先按用户填的/脚本报的/头部存的顺序试，
 * 第一个地址已经确认能升到更高版本就停；否则继续试，最后挑最好的那个结论。
 * 这样固定提交的旧地址不会把脚本自报的新地址挡住。
 *
 * 主地址全是失败（超时、被墙、半截脚本）时再走目录给的备用线路；
 * 已经拿到明确结论（最新 / 更旧 / 可更新）就不折腾，不替作者多花请求。
 *
 * @param options.overrideUrl 手动更新里用户这次填的地址：只试它，不拿存档地址顶替
 * @param options.scheduled 后台定时检查：本地内置源只试脚本自带的地址
 */
const previewUserApiUpdateOnce = async(
  id: string,
  eventUrl?: string,
  options?: { overrideUrl?: string, scheduled?: boolean },
): Promise<UserApiUpdatePreview> => {
  const api = findApi(id)
  if (!api) return { status: 'failed', reason: 'not_found', message: '音源不在了' }

  const plan = planUpdateUrls(api, eventUrl, options)
  if (!plan.primary.length && !plan.fallback.length) {
    return { status: 'failed', reason: 'no_url', message: '这个源没有可用的更新地址' }
  }

  const storedScript = await getUserApiScript(api.id)
  const currentVersion = parseScriptHeader(storedScript)?.version ?? ''
  const previews: UserApiUpdatePreview[] = []
  const tryUrls = async(urls: string[]): Promise<boolean> => {
    for (const url of urls) {
      const resolved = await resolveScriptFromUrl(url, { fetch: fetchText, hint: api.name, currentVersion })
      if (!resolved.ok) {
        // 版本接口查过当前版本说「已是最新」：这是检查成功，不是地址坏了
        if (resolved.reason == 'no_update') {
          previews.push({ status: 'up_to_date', name: api.name })
          continue
        }
        // 只给了版本号、网页里没有脚本：版本相同也是「已最新」，只有确实更新才报手动更新
        const byDescriptor = resolved.descriptor
          ? previewDescriptor({ name: api.name, storedScript, descriptor: resolved.descriptor, url })
          : null
        previews.push(byDescriptor ??
          { status: 'failed', reason: 'resolve_failed', message: resolved.message, openUrl: url })
        continue
      }
      const preview = previewUpdate({ name: api.name, storedScript, script: resolved.script, url })
      previews.push(preview)
      // 正常情况只有一个候选；已经确认能升级就不用再花请求试备用的
      if (preview.status == 'available' && preview.comparison == 'newer') return true
    }
    return false
  }

  if (await tryUrls(plan.primary)) return previews[previews.length - 1]
  if (plan.fallback.length && previews.every(preview => preview.status == 'failed')) {
    if (await tryUrls(plan.fallback)) return previews[previews.length - 1]
  }
  return pickBestPreview(previews) ?? { status: 'failed', reason: 'resolve_failed', message: '更新地址没有返回可用结果' }
}

const applyPreview = async(api: LX.UserApi.UserApiInfo, preview: UserApiUpdatePreview, options?: { allowDowngrade?: boolean }): Promise<UserApiUpdateOutcome> => {
  if (preview.status != 'available' && preview.status != 'older') {
    return { status: 'failed', reason: 'rejected', message: '这份更新结果不能应用' }
  }
  // 上一版还没被验证过（是不是好脚本都还不知道）就不能拿它当备份，留住更早那份已知能用的
  const list = await getUserApiList()
  const keepBackup = list.find(item => item.id == api.id)?.verifyPending === true
  const applied = await applyUpdateScript(scriptStore, { id: api.id, name: api.name, script: preview.script, keepBackup }, options)
  if (applied.status == 'unchanged') return { status: 'unchanged', name: api.name }
  if (applied.status == 'older') {
    return { status: 'older', name: api.name, fromVersion: applied.fromVersion, toVersion: applied.toVersion }
  }
  if (applied.status != 'updated') return { status: 'failed', reason: 'rejected', message: applied.message }

  const name = applied.header.name || api.name
  // 不是正在用的源就不必重新加载：换过去的时候自然会用到新脚本
  if (settingState.setting['common.apiSource'] != api.id) {
    // 但这份脚本还没被任何一次加载验证过，先记上：它起不来时得能退回备份
    await setUserApiVerifyPending(api.id, true)
    return {
      status: 'updated',
      name,
      fromVersion: applied.fromVersion,
      toVersion: applied.toVersion,
    }
  }
  const verified = await reloadAndVerify(api)
  if (!verified.ok) {
    return {
      status: 'failed',
      reason: 'reload_failed',
      rolledBack: verified.rolledBack,
      message: verified.rolledBack ? '新脚本加载不起来，已退回更新前的版本' : '新脚本加载不起来，而且没有可退回的备份',
    }
  }
  return {
    status: 'updated',
    name,
    fromVersion: applied.fromVersion,
    toVersion: applied.toVersion,
  }
}

const applyUserApiUpdateOnce = async(id: string, preview: UserApiUpdatePreview, options?: { allowDowngrade?: boolean }): Promise<UserApiUpdateOutcome> => {
  const api = findApi(id)
  if (!api) return { status: 'failed', reason: 'not_found', message: '音源不在了' }
  return applyPreview(api, preview, options)
}

const checkUserApiUpdateOnce = async(
  id: string,
  eventUrl?: string,
  options?: { overrideUrl?: string, scheduled?: boolean },
): Promise<UserApiUpdateOutcome> => {
  const preview = await previewUserApiUpdateOnce(id, eventUrl, options)
  if (preview.status == 'up_to_date') return { status: 'unchanged', name: preview.name }
  if (preview.status == 'older') {
    return { status: 'older', name: preview.name, fromVersion: preview.fromVersion, toVersion: preview.toVersion }
  }
  if (preview.status == 'failed') {
    return {
      status: 'failed',
      reason: preview.reason,
      ...(preview.rejectReason ? { rejectReason: preview.rejectReason } : {}),
      message: preview.message,
      // 带上实际试过的地址：日志里只看得到「取不到」，不知道取的是哪条线路
      openUrl: preview.openUrl ?? preview.url,
    }
  }
  const api = findApi(id)
  if (!api) return { status: 'failed', reason: 'not_found', message: '音源不在了' }
  return applyPreview(api, preview)
}

// 一轮只跑一个更新：两个更新撞在一起，第二个备份到的会是第一个刚换上去的脚本，
// 那份「最后一个能用的版本」就丢了
let chain: Promise<void> = Promise.resolve()
const runSerialized = async<T>(task: () => Promise<T>): Promise<T> => {
  const result = chain.then(task, task)
  chain = result.then(() => {}, () => {})
  return result
}
export const checkUserApiUpdate = async(
  id: string,
  eventUrl?: string,
  options?: { overrideUrl?: string, scheduled?: boolean },
): Promise<UserApiUpdateOutcome> => {
  return runSerialized(async() => checkUserApiUpdateOnce(id, eventUrl, options))
}
/**
 * 检查更新按钮用：只给结论，不写盘。用户确认后再把同一个预览交给 applyUserApiUpdate。
 *
 * overrideUrl 是手动更新里刚输入的地址：先测它，测通了调用方再落盘，
 * 测不通就不该把坏地址写进源里、让以后每次启动都去试一遍。
 */
export const previewUserApiUpdate = async(
  id: string,
  eventUrl?: string,
  options?: { overrideUrl?: string, scheduled?: boolean },
): Promise<UserApiUpdatePreview> => {
  return runSerialized(async() => previewUserApiUpdateOnce(id, eventUrl, options))
}
/**
 * 把预览里的脚本落盘。allowDowngrade 只给「手动更新 + 用户明确确认换回旧版」用。
 */
export const applyUserApiUpdate = async(id: string, preview: UserApiUpdatePreview, options?: { allowDowngrade?: boolean }): Promise<UserApiUpdateOutcome> => {
  return runSerialized(async() => applyUserApiUpdateOnce(id, preview, options))
}

/**
 * 按用户选的频率把到期的源过一遍。每个源查之前就先记下时间：
 * 失败也算查过，否则一个坏地址每天把后面所有源的请求都挤到它身上。
 */
export const runScheduledUserApiUpdateCheck = async(
  mode: UserApiUpdateCheckMode,
  onOutcome: (api: LX.UserApi.UserApiInfo, outcome: UserApiUpdateOutcome) => void,
) => {
  const now = Date.now()
  const list = await getUserApiList()
  const autoUpdate = settingState.setting['common.userApiAutoUpdate']
  for (const api of pickCheckTargets(list, mode, now, autoUpdate)) {
    await setUserApiLastCheckAt(api.id, now)
    let outcome: UserApiUpdateOutcome
    try {
      // 后台检查不碰用户手填的地址：本地内置源只试脚本自带的，填错了也不在启动时反复超时
      outcome = await checkUserApiUpdate(api.id, undefined, { scheduled: true })
    } catch (err: any) {
      outcome = { status: 'failed', reason: 'resolve_failed', message: err.message as string }
    }
    // 名字对不上不是网络抖动：用户填的地址给的是别家的脚本，下次自动检查别再拿它白跑一趟。
    // 只记用户填的 updateUrl —— 脚本头部和目录的地址属于源本身，作者换了内容就会恢复，
    // 把它们永久拉黑会让一个本来能用的版本接口再也查不了。手动检查也不受这条影响
    if (outcome.status == 'failed' && outcome.rejectReason == 'name_mismatch' &&
      outcome.openUrl && outcome.openUrl == api.updateUrl) {
      await setUserApiUpdateUrlRejected(api.id, outcome.openUrl)
    }
    onOutcome(api, outcome)
  }
}

/**
 * 保命一跳：盘上这份脚本是自动更新写进去的、还没被验证过，结果它第一次真正加载就起不来。
 * 退回更新前留的备份，由调用方重装（成功/失败都会重新结算应用级初始化）。
 *
 * 只做一次：标记先清掉，坏脚本不能靠反复重启一直重试。
 */
export const rollbackPendingUserApiUpdate = async(id: string): Promise<boolean> => {
  const list = await getUserApiList()
  const api = list.find(item => item.id == id)
  if (!api?.verifyPending) return false

  let rolledBack = false
  try {
    rolledBack = await rollbackScript(scriptStore, id)
  } catch (err: any) {
    log.r_error(`user api rollback error: ${api.name} ${err.message as string}`)
  }
  // 回滚写完再清标记：写盘顺序反过来，中途没电会留下「坏脚本 + 没有标记」，再也救不回来。
  // 清掉之后这个源只再给一次机会，坏脚本不能靠反复重启一直重试
  await setUserApiVerifyPending(id, false)
  if (rolledBack) log.r_info(`user api rolled back to the previous script: ${api.name}`)
  return rolledBack
}

// 正在用的音源可能还在初始化，等它报出结果再动手；等不到也要放行，
// 否则一个卡住的脚本会把其它源的更新检查一起挂死
const waitApiInit = async() => {
  await Promise.race([
    global.lx.apiInitPromise[0],
    new Promise<void>(resolve => { BackgroundTimer.setTimeout(() => { resolve() }, 30_000) }),
  ])
}

/**
 * 启动后的首次更新检查。
 *
 * 必须在 setApiSource 之后再调用：那之前 apiInitPromise[0] 还是占位 promise，
 * 等它等于没等，检查会在源还没初始化时就和首次加载抢着换脚本
 * （换掉的那次加载如果起不来，会把「源已就绪」判成失败，回滚也修不回来）。
 */
export const runUserApiUpdateCheckOnStartup = async() => {
  try {
    await waitApiInit()
    await runScheduledUserApiUpdateCheck(settingState.setting['common.userApiUpdateCheck'], (api, outcome) => {
      if (outcome.status == 'updated') {
        toast(global.i18n.t('user_api_auto_update_success_tip', { name: outcome.name }), 'long')
        return
      }
      if (outcome.status == 'failed') {
        log.r_error(`user api update check failed: ${api.name}, ${outcome.message}${outcome.openUrl ? ` <${outcome.openUrl}>` : ''}`)
        if (outcome.reason == 'reload_failed') {
          toast(outcome.rolledBack
            ? global.i18n.t('user_api_update_check_rolled_back_tip')
            : global.i18n.t('user_api_auto_update_failed_tip', { name: api.name }), 'long')
        }
      }
    })
  } catch (err: any) {
    log.r_error(`user api update check crashed: ${err.message as string}`)
  }
}
