package cn.toside.music.core.userapi

/**
 * 「脚本报告有新版本」之后该给用户看到什么 —— RN `src/core/userApiUpdate/updateAlert.ts`
 * 的逐条移植。
 *
 * 两个开关各管一件事：自动更新负责悄悄换脚本，允许弹窗负责要不要用窗口打断用户。
 * 独立成纯表是为了能单测：这条规则错一次，关掉弹窗的人就会时不时被窗口打断。
 */
enum class UpdateFailureReason { NOT_FOUND, NO_URL, RESOLVE_FAILED, REJECTED, RELOAD_FAILED }

sealed interface UpdateOutcome {
    data class Updated(
        val name: String,
    ) : UpdateOutcome

    data object Unchanged : UpdateOutcome

    data object Older : UpdateOutcome

    data class Failed(
        val reason: UpdateFailureReason,
        val openUrl: String? = null,
    ) : UpdateOutcome
}

sealed interface UpdateAlertPlan {
    data object Silent : UpdateAlertPlan

    data class Toast(
        val kind: ToastKind,
    ) : UpdateAlertPlan

    data class Confirm(
        val url: String,
    ) : UpdateAlertPlan

    data object Tip : UpdateAlertPlan
}

enum class ToastKind { UPDATED, FAILED }

data class UpdateAlertSettings(
    val autoUpdate: Boolean,
    val allowShowUpdateAlert: Boolean,
)

object UpdateAlerts {
    /**
     * @param outcome null 表示没开自动更新，没去拉脚本
     * @param eventUrl 脚本自己报的更新地址
     */
    fun plan(
        settings: UpdateAlertSettings,
        outcome: UpdateOutcome?,
        eventUrl: String? = null,
    ): UpdateAlertPlan {
        var manualUrl = eventUrl.orEmpty()
        if (outcome != null) {
            when (outcome) {
                is UpdateOutcome.Updated -> return UpdateAlertPlan.Toast(ToastKind.UPDATED)
                // 脚本说“有新版本”但地址里是旧版本：地址/缓存的问题，既不硬装回去也不打扰用户
                UpdateOutcome.Unchanged, UpdateOutcome.Older -> return UpdateAlertPlan.Silent
                is UpdateOutcome.Failed -> {
                    if (outcome.reason != UpdateFailureReason.RESOLVE_FAILED) {
                        return if (settings.allowShowUpdateAlert) {
                            UpdateAlertPlan.Silent
                        } else {
                            UpdateAlertPlan.Toast(ToastKind.FAILED)
                        }
                    }
                    manualUrl = outcome.openUrl ?: manualUrl
                }
            }
        }
        // 弹窗开关是最后一道闸：不管自动更新成没成功，关着就不弹窗口
        if (!settings.allowShowUpdateAlert) {
            return if (outcome != null) UpdateAlertPlan.Toast(ToastKind.FAILED) else UpdateAlertPlan.Silent
        }
        return if (manualUrl.isNotEmpty()) UpdateAlertPlan.Confirm(manualUrl) else UpdateAlertPlan.Tip
    }
}
