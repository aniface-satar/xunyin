import { toast } from '@/utils/tools'
import {
  applyUserApiUpdate,
  previewUserApiUpdate,
  type UserApiUpdateOutcome,
  type UserApiUpdatePreview,
} from '@/core/userApiUpdate'

export const runUpdatePreview = async(id: string, overrideUrl?: string): Promise<UserApiUpdatePreview> => {
  try {
    return await previewUserApiUpdate(id, undefined, overrideUrl == null ? undefined : { overrideUrl })
  } catch (err: any) {
    return { status: 'failed', reason: 'resolve_failed', message: err.message as string }
  }
}

/**
 * 手动更新里刚填的地址值不值得存下来。
 *
 * 真取到了脚本（能更新 / 已最新 / 更旧），或者地址给的是版本页，说明这个地址是通的；
 * 超时、403、名字对不上、语法坏则说明地址本身就错了 —— 存下来只会让以后每次启动
 * 都去试一遍这个坏地址，还在日志里刷失败。
 */
export const shouldSaveUpdateUrl = (preview: UserApiUpdatePreview): boolean => {
  if (preview.status != 'failed') return true
  return preview.reason == 'resolve_failed' && preview.versionPage === true
}

export const runUpdateApply = async(
  id: string,
  preview: UserApiUpdatePreview,
  options?: { allowDowngrade?: boolean },
): Promise<UserApiUpdateOutcome> => {
  try {
    return await applyUserApiUpdate(id, preview, options)
  } catch (err: any) {
    return { status: 'failed', reason: 'resolve_failed', message: err.message as string }
  }
}

export const versionLabel = (version: string) => {
  if (!version) return ''
  return /^\d/.test(version) ? `v${version}` : version
}

export const buildPreviewConfirmMessage = (preview: Extract<UserApiUpdatePreview, { status: 'available' }>): string => {
  const to = versionLabel(preview.toVersion)
  const from = versionLabel(preview.fromVersion)
  // 同一天多次构建时版本号不变、构建时间变新：说「同版本的新内容」比说「发现新版本 v1（当前 v1）」清楚
  if (preview.comparison == 'same' || (to && from && to == from)) {
    return to
      ? global.i18n.t('user_api_update_same_version_tip', { version: to })
      : global.i18n.t('user_api_update_unknown_version_tip')
  }
  if (preview.comparison == 'unknown' || !to) return global.i18n.t('user_api_update_unknown_version_tip')
  return from
    ? global.i18n.t('user_api_update_available_tip', { version: to, current: from })
    : global.i18n.t('user_api_update_available_no_current_tip', { version: to })
}

export const buildDowngradeConfirmMessage = (preview: Extract<UserApiUpdatePreview, { status: 'older' }>): string => {
  return global.i18n.t('user_api_manual_update_older_confirm', {
    version: versionLabel(preview.toVersion),
    current: versionLabel(preview.fromVersion),
  })
}

/**
 * 预览结果里不需要用户再确认的部分，直接给一句话。
 *
 * @returns 手动更新弹窗还要不要留着：只有「换个地址也许能修好」的失败才留
 */
export const toastPreview = (
  name: string,
  preview: UserApiUpdatePreview,
  options?: { builtin?: boolean },
): boolean => {
  if (preview.status == 'up_to_date') {
    toast(global.i18n.t('user_api_update_check_unchanged_tip', { name }), 'long')
    return false
  }
  if (preview.status == 'older') {
    toast(global.i18n.t('user_api_update_older_tip', {
      version: versionLabel(preview.toVersion),
      current: versionLabel(preview.fromVersion),
    }), 'long')
    return true
  }
  if (preview.status == 'available') {
    // 调用方应当先弹确认框；万一漏了，宁可把弹窗留着让用户自己决定
    return true
  }
  if (preview.reason == 'no_url') {
    toast(global.i18n.t(options?.builtin
      ? 'builtin_source_no_update_address_tip'
      : 'user_api_update_check_no_url_tip', { name }), 'long')
    return true
  }
  toast(global.i18n.t('user_api_update_check_failed_tip', { name, message: preview.message }), 'long')
  return true
}

export const toastUpdateOutcome = (
  name: string,
  outcome: UserApiUpdateOutcome,
  options?: { builtin?: boolean },
): boolean => {
  if (outcome.status == 'updated') {
    toast(global.i18n.t('user_api_update_check_updated_tip', { name: outcome.name, version: versionLabel(outcome.toVersion) }), 'long')
    return false
  }
  if (outcome.status == 'unchanged') {
    toast(global.i18n.t('user_api_update_check_unchanged_tip', { name: outcome.name }), 'long')
    return false
  }
  if (outcome.status == 'older') {
    toast(global.i18n.t('user_api_update_older_tip', {
      version: versionLabel(outcome.toVersion),
      current: versionLabel(outcome.fromVersion),
    }), 'long')
    return false
  }
  if (outcome.reason == 'reload_failed') {
    toast(outcome.rolledBack
      ? global.i18n.t('user_api_update_check_rolled_back_tip')
      : global.i18n.t('user_api_update_check_failed_tip', { name, message: outcome.message }), 'long')
    return false
  }
  if (outcome.reason == 'no_url') {
    toast(global.i18n.t(options?.builtin
      ? 'builtin_source_no_update_address_tip'
      : 'user_api_update_check_no_url_tip', { name }), 'long')
    return true
  }
  toast(global.i18n.t('user_api_update_check_failed_tip', { name, message: outcome.message }), 'long')
  return true
}
