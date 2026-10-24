package cn.toside.music.core.userapi

/**
 * 「验证加载」的结果该怎么处理 —— RN `src/core/userApiUpdate/verifyLoad.ts` 的移植。
 *
 * 更新流程换上新脚本后会自己加载一次（verify=true），确认新脚本能不能起来。
 * 失败时后面还有回滚，不能把它结算成应用级「源已就绪 = false」，
 * 否则回滚回来的好脚本也救不回来。独立成纯表是为了能单测。
 */
data class UserApiInitEvent(
    val verify: Boolean,
    val status: Boolean,
    val hasErrorMessage: Boolean,
    val settled: Boolean,
)

data class UserApiInitPlan(
    val settle: Boolean,
    val alert: Boolean,
)

object UserApiInitPlanner {
    fun plan(event: UserApiInitEvent): UserApiInitPlan =
        UserApiInitPlan(
            // 验证成功说明新脚本已经能接管当前源，可以结算；验证失败要等回滚后的正常加载
            settle = !event.settled && (!event.verify || event.status),
            // 验证失败是内部流程的事，回滚会自己报「已退回更新前的版本」
            alert = !event.verify && !event.status && event.hasErrorMessage,
        )
}
