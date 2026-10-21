/**
 * 「脚本报告有新版本」之后该给用户看到什么。
 *
 * 两个开关各管一件事：自动更新负责悄悄换脚本，允许弹窗负责要不要用窗口打断用户。
 * 自动更新失败时原先会直接落到手动下载窗口，绕过了弹窗开关 —— 关掉弹窗的人
 * 仍会在更新地址超时时被窗口打断（日志里「更新地址取不到（Aborted）」那条）。
 *
 * 放在这里是为了能单独测：这条规则错一次，关掉弹窗的人就会时不时被窗口打断。
 */

export type UpdateAlertOutcome =
  | { status: 'updated', name: string }
  | { status: 'unchanged' }
  | { status: 'older' }
  | {
    status: 'failed'
    reason: 'not_found' | 'no_url' | 'resolve_failed' | 'rejected' | 'reload_failed'
    openUrl?: string
  }

export type UpdateAlertPlan =
  | { type: 'silent' }
  | { type: 'toast', kind: 'updated' | 'failed' }
  | { type: 'confirm', url: string }
  | { type: 'tip' }

export interface UpdateAlertSettings {
  autoUpdate: boolean
  allowShowUpdateAlert: boolean
}

/**
 * @param outcome null 表示没开自动更新，没去拉脚本
 * @param eventUrl 脚本自己报的更新地址
 */
export const planUpdateAlert = (
  settings: UpdateAlertSettings,
  outcome: UpdateAlertOutcome | null,
  eventUrl?: string,
): UpdateAlertPlan => {
  let manualUrl = eventUrl ?? ''
  if (outcome) {
    if (outcome.status == 'updated') return { type: 'toast', kind: 'updated' }
    // 脚本说“有新版本”但它给的地址里是旧版本：这是地址/缓存的问题，
    // 既不该硬装回去，也不是用户需要处理的失败
    if (outcome.status == 'unchanged' || outcome.status == 'older') return { type: 'silent' }
    // 没走到「有地址可打开」的失败：关掉弹窗的人只留一句轻提示
    if (outcome.reason != 'resolve_failed') {
      return settings.allowShowUpdateAlert ? { type: 'silent' } : { type: 'toast', kind: 'failed' }
    }
    manualUrl = outcome.openUrl ?? manualUrl
  }
  // 弹窗开关是最后一道闸：不管自动更新成没成功，关着就不弹窗口
  if (!settings.allowShowUpdateAlert) {
    return outcome ? { type: 'toast', kind: 'failed' } : { type: 'silent' }
  }
  return manualUrl ? { type: 'confirm', url: manualUrl } : { type: 'tip' }
}
