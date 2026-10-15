// "这张封面的取色问过没有" 这件事的账本。
//
// 为什么要有这个文件：老实现把它写成 coverBackdropStore 里的一个 `requested: string | null`，
// 语义是"问过就算问过（成功或失败都算）"。于是任何一次瞬时失败 —— 原生下载超时、返回的像素
// 几何不自洽、结果被在途代数丢弃 —— 都会让这首歌整场会话不再上色，用户唯一的出口是去设置里
// 翻"动态背景"开关（2026-10-15 真机就是这个现象：时有时无，翻开关才回来）。
//
// 现在改成两条时间轴：一次尝试结束后，同一张封面隔 ATTEMPT_COOLDOWN_MS 可以再问（失败会自己好）；
// 一条尝试在途太久（INFLIGHT_TIMEOUT_MS）也当它没在途，否则永不 settle 的 promise 就是另一把永久闩。
// 同时保留老实现真正要防的那件事 —— 不要在原生那条单线程队列里堆并发请求。
//
// 这个文件刻意不碰 react-native、不碰取色链路，纯数据结构：调度逻辑是本次缺陷的所在，
// 必须能用 node --test 直接跑（coverBackdropStore 带原生桥，加载不了，钉不住它）。
export const ATTEMPT_COOLDOWN_MS = 15_000
// 一条在途尝试的期限。为什么要有：原生侧是单线程 executor，而 HttpURLConnection 的 4s 是"每次 read"
// 的超时不是总时长 —— 一个慢慢滴的服务器能把这条线程占几十秒，JS 这边那条 promise 就一直不 settle。
// 没有期限的话 'in-flight' 就变成一把新的永久闩，而消灭永久闩正是这个文件存在的理由。
// 20s 明显大于单次最坏耗时（4s 连接 + 4s 读 + 解码 + 排队），不会把"慢但会成功"的取色判死；
// 到期后允许重问，而配色层按 url 合并 promise，重问只是读同一条在途缓存，不会往队列里压第二条。
export const INFLIGHT_TIMEOUT_MS = 20_000

export type AttemptVerdict = 'request' | 'in-flight' | 'cooldown'

export interface AttemptLedger {
  /** 现在能不能为这张封面发一次取色 */
  want: (url: string, now: number) => AttemptVerdict
  /** 真的发出去了才记账：判据只看"上一次什么时候开始问"，不看结果 */
  begin: (url: string, now: number) => void
  /** 一条尝试收尾（成功、失败、被丢弃都算）。幂等。 */
  end: (url: string) => void
  /** 还要等多久才允许再问；没有记录时为 0 */
  cooldownLeft: (url: string, now: number) => number
  /** 还要多久才到在途期限（'in-flight' 时用它挂唤醒定时器）；没有记录时为 0 */
  inflightLeft: (url: string, now: number) => number
  /** 翻开关 / 清缓存时一起清掉：这条手动出口必须立刻可请求 */
  reset: () => void
}

export const createAttemptLedger = (): AttemptLedger => {
  const startedAt = new Map<string, number>()
  const inFlight = new Set<string>()
  return {
    want: (url, now) => {
      const last = startedAt.get(url)
      if (inFlight.has(url)) {
        // 在途过期限就当没在途（见 INFLIGHT_TIMEOUT_MS）：判据同样是 >=，别让边界那一毫秒差一点
        if (last !== undefined && now - last >= INFLIGHT_TIMEOUT_MS) return 'request'
        return 'in-flight'
      }
      // 判据用 >= 而不是 >：正好到点就算能问，别让边界那一毫秒变成"永远差一点"
      if (last === undefined || now - last >= ATTEMPT_COOLDOWN_MS) return 'request'
      return 'cooldown'
    },
    begin: (url, now) => {
      inFlight.add(url)
      startedAt.set(url, now)
    },
    end: (url) => {
      inFlight.delete(url)
    },
    cooldownLeft: (url, now) => {
      const last = startedAt.get(url)
      if (last === undefined) return 0
      return Math.max(0, ATTEMPT_COOLDOWN_MS - (now - last))
    },
    inflightLeft: (url, now) => {
      const last = startedAt.get(url)
      if (last === undefined) return 0
      return Math.max(0, INFLIGHT_TIMEOUT_MS - (now - last))
    },
    reset: () => {
      inFlight.clear()
      startedAt.clear()
    },
  }
}
