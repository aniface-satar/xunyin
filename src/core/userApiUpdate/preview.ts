/**
 * 更新前的预览：只判断「换上会怎样」，不写盘。
 *
 * 检查更新要先问用户，自动更新要先确认真的是升级 —— 两件事都得在动存储之前知道结果。
 * 预览把取回来的脚本一并留住，用户点确认后直接用它，不用再取一次（也可能取到另一份内容）。
 */
import { planUpdate, type ScriptHeaderInfo } from './applyUpdate.ts'
import { parseScriptHeader, type VersionDescriptor } from './resolveScript.ts'
import { compareVersions } from './version.ts'

export type UserApiUpdateComparison = 'newer' | 'same' | 'unknown'

export type UserApiUpdatePreview =
  | {
    status: 'available'
    name: string
    fromVersion: string
    toVersion: string
    comparison: UserApiUpdateComparison
    url: string
    script: string
    header: ScriptHeaderInfo
  }
  | { status: 'up_to_date', name: string }
  | {
    status: 'older'
    name: string
    fromVersion: string
    toVersion: string
    url: string
    script: string
    header: ScriptHeaderInfo
  }
  | {
    status: 'failed'
    reason: 'not_found' | 'no_url' | 'resolve_failed' | 'rejected'
    message: string
    url?: string
    openUrl?: string
  }

export const previewUpdate = (params: {
  name: string
  storedScript: string
  script: string
  url: string
}): UserApiUpdatePreview => {
  const { name, storedScript, script, url } = params
  const plan = planUpdate({ currentName: name, storedScript, newScript: script })
  if (plan.action == 'unchanged') return { status: 'up_to_date', name }
  if (plan.action == 'reject') {
    if (plan.reason == 'older' && plan.header) {
      return {
        status: 'older',
        name,
        fromVersion: plan.fromVersion ?? '',
        toVersion: plan.toVersion ?? '',
        url,
        script,
        header: plan.header,
      }
    }
    return { status: 'failed', reason: 'rejected', message: plan.message ?? '无法更新', url }
  }
  return {
    status: 'available',
    name,
    fromVersion: plan.fromVersion ?? '',
    toVersion: plan.toVersion ?? '',
    comparison: plan.comparison ?? 'unknown',
    url,
    script,
    header: plan.header!,
  }
}

/**
 * 更新地址只回了版本描述、没有可下载脚本时的结论。
 *
 * 念心、长青这类源把 updateUrl 指向网盘/文档页，网页里永远找不到脚本：
 * 同版或更旧说明用户已经是最新，不能报「地址里没有脚本」；确实更新时
 * 只能让用户自己打开作者给的页面，别假装能自动更新。
 *
 * @returns null 表示版本号格式认不出，调用方按普通失败处理
 */
export const previewDescriptor = (params: {
  name: string
  storedScript: string
  descriptor: VersionDescriptor
  url?: string
}): UserApiUpdatePreview | null => {
  const { name, storedScript, descriptor, url } = params
  const currentVersion = parseScriptHeader(storedScript)?.version ?? ''
  const compared = compareVersions(descriptor.version, currentVersion)
  if (compared == null) return null
  if (compared <= 0) return { status: 'up_to_date', name }
  const openUrl = descriptor.url || url
  return {
    status: 'failed',
    reason: 'resolve_failed',
    message: `发现新版本 ${descriptor.version}，但更新地址给的是网页，没法自动下载，请手动打开更新页面`,
    ...(openUrl ? { openUrl } : {}),
  }
}

/**
 * 一个源可能同时有用户填的、脚本这次报的、头部存的三个地址。
 * 可更新优先；都不行时也要挑一个最能说明问题的结论给用户。
 */
export const pickBestPreview = (previews: UserApiUpdatePreview[]): UserApiUpdatePreview | null => {
  if (!previews.length) return null
  const available = previews.filter((preview): preview is Extract<UserApiUpdatePreview, { status: 'available' }> => preview.status == 'available')
  if (available.length) {
    return available.reduce((best, current) => {
      const compared = compareVersions(current.toVersion, best.toVersion)
      if (compared != null && compared > 0) return current
      // 同版本号时构建时间更晚的那份才是新的：jsDelivr 不同镜像可能一个还停在旧构建
      if (compared == 0 && current.header.buildTime > 0 && best.header.buildTime > 0 &&
        current.header.buildTime > best.header.buildTime) return current
      return best
    })
  }
  return previews.find(preview => preview.status == 'up_to_date') ??
    previews.find(preview => preview.status == 'older') ??
    previews[0]
}
