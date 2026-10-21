import { parseScriptHeader, type ScriptHeaderInfo } from './resolveScript.ts'
import { checkScriptSyntax } from './syntaxCheck.ts'
import { compareVersions } from './version.ts'

export type { ScriptHeaderInfo }

/**
 * 把取回的新脚本落到指定源上。
 *
 * 这里只管「能不能写、怎么写」，不管脚本从哪来：取址见 resolveScript，
 * 真机上「新脚本加载失败就还原」由 core/init/userApi 那边负责。
 */

export interface UpdatePlan {
  action: 'write' | 'unchanged' | 'reject'
  reason?: 'invalid_script' | 'name_mismatch' | 'too_large' | 'syntax_error' | 'older'
  header?: ScriptHeaderInfo
  fromVersion?: string
  toVersion?: string
  /** 版本号相同时，靠构建时间判断这次到底是升级还是 CDN 旧缓存回退 */
  comparison?: 'newer' | 'same' | 'unknown'
  message?: string
}

export interface ScriptStore {
  readScript: (id: string) => Promise<string>
  writeScript: (id: string, script: string, header: ScriptHeaderInfo | null) => Promise<void>
  writeBackup: (id: string, script: string) => Promise<void>
  readBackup: (id: string) => Promise<string | null>
}

export type ApplyResult = {
  status: 'updated'
  header: ScriptHeaderInfo
  fromVersion: string
  toVersion: string
} | {
  status: 'unchanged'
} | {
  status: 'older'
  fromVersion: string
  toVersion: string
  message: string
} | {
  status: 'invalid_script' | 'name_mismatch' | 'too_large' | 'syntax_error'
  message: string
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() == b.trim().toLowerCase()

// 解析器会跟着网页里的链接到处取内容，网盘和下载页随手就能返回几百兆的东西，
// 不挡住就会把一大坨写进存储；9MB 这条线是音源脚本实际大小往上留的余量
const MAX_SCRIPT_LENGTH = 9_000_000

const formatBuildTime = (time: number) => {
  const date = new Date(time)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
}

export const planUpdate = (params: {
  currentName: string
  storedScript: string
  newScript: string
  /** 只有用户在降级提示里明确点了继续才为 true；自动更新永远拿不到这个口子 */
  allowDowngrade?: boolean
}): UpdatePlan => {
  const { currentName, storedScript, newScript, allowDowngrade } = params
  if (newScript === storedScript) return { action: 'unchanged' }
  if (newScript.length > MAX_SCRIPT_LENGTH) {
    return { action: 'reject', reason: 'too_large', message: '更新地址取回的内容太大，不像音源脚本' }
  }
  const header = parseScriptHeader(newScript)
  if (!header) {
    return { action: 'reject', reason: 'invalid_script', message: '更新地址里的内容不是音源脚本' }
  }
  // 作者没写 @name 时不拦；写了就必须是同一个源，否则等于用别人的音源覆盖你正在用的这个
  if (header.name && currentName && !sameName(header.name, currentName)) {
    return {
      action: 'reject',
      reason: 'name_mismatch',
      message: `更新脚本的名字与当前源不一致（${currentName} / ${header.name}）`,
    }
  }
  // 编译最贵，放在其它检查之后：头部注释齐全、名字也对得上的半截文件只能靠这一步认出来
  const syntax = checkScriptSyntax(newScript)
  if (!syntax.ok) {
    return {
      action: 'reject',
      reason: 'syntax_error',
      message: `新版脚本语法不完整，不能覆盖当前这份（${syntax.message}）`,
    }
  }
  const fromHeader = parseScriptHeader(storedScript)
  const fromVersion = fromHeader?.version ?? ''
  const fromBuildTime = fromHeader?.buildTime ?? 0
  const toVersion = header.version
  const toBuildTime = header.buildTime
  const versionCompared = compareVersions(toVersion, fromVersion)
  // 某个固定提交的地址会一直返回同一版旧脚本；按它自动更新会让源越更越旧，
  // 所以认得出的旧版本一律不写。认不出（作者没用数字版本）时不拦，不能凭空猜。
  if (allowDowngrade !== true && versionCompared == -1) {
    return {
      action: 'reject',
      reason: 'older',
      header,
      fromVersion,
      toVersion,
      comparison: 'same',
      message: `更新地址里是旧版本（${toVersion}），当前已经是 ${fromVersion}，不能越更越旧`,
    }
  }
  // 一天发好几版的源常把 @version 只写到日期，同版本号的新旧只能看构建时间。
  // 没这条的话，多个 CDN 镜像缓存进度不同时，旧节点会被当成「同版本新内容」写回去。
  if (allowDowngrade !== true && versionCompared == 0 && fromBuildTime > 0 && toBuildTime > 0 && toBuildTime < fromBuildTime) {
    return {
      action: 'reject',
      reason: 'older',
      header,
      fromVersion,
      toVersion,
      comparison: 'same',
      message: `更新地址里是同一版本的旧构建（${formatBuildTime(toBuildTime)}），当前已经是 ${formatBuildTime(fromBuildTime)} 的构建，不能越更越旧`,
    }
  }
  return {
    action: 'write',
    header,
    fromVersion,
    toVersion,
    comparison: versionCompared == null
      ? 'unknown'
      : versionCompared > 0 || (versionCompared == 0 && toBuildTime > 0 && fromBuildTime > 0 && toBuildTime > fromBuildTime)
        ? 'newer'
        : 'same',
  }
}

export const applyUpdateScript = async(store: ScriptStore, params: {
  id: string
  name: string
  script: string
  /**
   * 盘上那份脚本自己还没被验证过（起不起得来都不知道）时为 true：
   * 它没资格当「已知能用」的版本，备份要留住更早那份，否则回滚等于退回一个坏脚本。
   */
  keepBackup?: boolean
}, options?: { allowDowngrade?: boolean }): Promise<ApplyResult> => {
  const stored = await store.readScript(params.id)
  const plan = planUpdate({
    currentName: params.name,
    storedScript: stored,
    newScript: params.script,
    allowDowngrade: options?.allowDowngrade,
  })
  if (plan.action == 'unchanged') return { status: 'unchanged' }
  if (plan.action == 'reject') {
    if (plan.reason == 'older') {
      return {
        status: 'older',
        fromVersion: plan.fromVersion ?? '',
        toVersion: plan.toVersion ?? '',
        message: plan.message ?? '不能更新到更旧的版本',
      }
    }
    return { status: plan.reason ?? 'invalid_script', message: plan.message ?? '无法更新' }
  }

  // 先备份再覆盖：万一新脚本在 QuickJS 里加载不起来，还有东西可以还原
  if (params.keepBackup !== true) await store.writeBackup(params.id, stored)
  await store.writeScript(params.id, params.script, plan.header!)
  return {
    status: 'updated',
    header: plan.header!,
    fromVersion: plan.fromVersion ?? '',
    toVersion: plan.toVersion ?? '',
  }
}

export const rollbackScript = async(store: ScriptStore, id: string): Promise<boolean> => {
  const backup = await store.readBackup(id)
  if (backup == null) return false
  // 备份是「上一个还能听的脚本」，还原时不再拿头部注释格式卡它
  await store.writeScript(id, backup, parseScriptHeader(backup))
  return true
}
