/**
 * 「验证加载」的结果该怎么处理。
 *
 * 更新流程换上新脚本后会自己加载一次（verify=true），确认新脚本能不能起来。
 * 这次加载顶掉的可能是正在初始化的当前源，所以它的结果不能和普通加载一样对待：
 * 失败时后面还有一步回滚，若把它结算成应用级「源已就绪 = false」，
 * 回滚回来的好脚本也救不回来 —— 整个源会在之后每个请求上报 source init failed。
 *
 * 放在这里是为了能单独测：这条规则错一次就是「自动更新失败后整个源不可用」。
 */
export interface UserApiInitEvent {
  /** 是不是更新流程的验证加载 */
  verify: boolean
  /** 这次加载报上来的初始化结果 */
  status: boolean
  hasErrorMessage: boolean
  /** 应用级 init 结果是否已经结算过 */
  settled: boolean
}

export interface UserApiInitPlan {
  /** 是否把这次结果结算进应用级「源已就绪」 */
  settle: boolean
  /** 是否弹「音源初始化失败」给用户 */
  alert: boolean
}

export const planUserApiInit = ({ verify, status, hasErrorMessage, settled }: UserApiInitEvent): UserApiInitPlan => ({
  // 验证成功说明新脚本已经能接管当前源，可以结算；
  // 验证失败要等回滚后的那次正常加载给出真实结果
  settle: !settled && (!verify || status),
  // 验证失败是内部流程的事，回滚会自己报「已退回更新前的版本」，不该吓用户
  alert: !verify && !status && hasErrorMessage,
})
