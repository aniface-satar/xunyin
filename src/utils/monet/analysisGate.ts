// 取色里的"分析"那一步是一段**同步的重活**：实测 128×86 的封面（原生默认就回这么多像素），
// QuantizerCelebi.quantize + Score 在桌面 V8 上单独要 75~124ms，整次 analyzeArgbPixels 110~143ms，
// 真机 Hermes 还要慢几倍。而播放页展开/收起的 morph 是 useNativeDriver:false —— 帧帧都靠 JS 线程，
// 于是"色到手的那一刻"正好把动画饿死：真机报的"拖动中加载出背景色就卡顿一下""点开放大卡 0.8 秒"
// 就是这 800ms 补间（TRANSITION_DURATION_MS）里夹了这么一趟。
//
// 所以这里只回答一个问题：**这段活什么时候允许跑**。跑法（InteractionManager、定时器）由 deps 注入，
// 本文件不许 import react-native —— 这样 `node --test` 能拿着假的 InteractionManager 把两条路的竞态跑完。
// 见 tests/monet-analysis-gate.mts。

/** 兜底期限：交互一直不断（用户按住不放、别处在长滚动）时，最迟这一刻照样跑一次。
 *  没有它，"取色"会饿死到那次交互结束 —— 而 InteractionManager 的 setDeadline 是全局的，
 *  会连累仓库里另一处 runAfterInteractions 用法（ListMusicSort），所以期限只能自己挂。 */
export const ANALYSIS_IDLE_FALLBACK_MS = 1500

export interface IdleSchedulerDeps {
  /** RN 的 InteractionManager.runAfterInteractions：返回带 cancel 的句柄 */
  runAfterInteractions: (cb: () => void) => { cancel: () => void }
  setTimeoutFn: (cb: () => void, ms: number) => unknown
  clearTimeoutFn: (handle: unknown) => void
}

/** 把一段同步计算推到交互空档；签名与"立刻跑"的替身兼容，方便注入 */
export type IdleSchedule = <T>(task: () => T) => Promise<T>

/**
 * idle 与兜底期限赛跑，**只许赢一次**：两边都到了不重跑（重跑等于让 JS 线程白挨两趟 100ms+），
 * 谁先跑谁负责撤掉另一边。task 抛错时 promise 必须 reject —— 挂住不清会把整条取色链卡死，
 * 而那条链上游（coverBackdropStore）只认 settle 才销账。
 */
// async 只为过 @typescript-eslint/promise-function-async（和 coverPalette 里 fetchOnce 同一套）；
// 赛跑逻辑仍在那条 new Promise 里，这层壳不会多排队一次。
export const createIdleRunner = (deps: IdleSchedulerDeps): IdleSchedule =>
  async <T>(task: () => T): Promise<T> => new Promise<T>((resolve, reject) => {
    let done = false
    let idle: { cancel: () => void } | null = null
    let timer: unknown = null
    const run = () => {
      if (done) return
      done = true
      if (timer != null) deps.clearTimeoutFn(timer)
      if (idle != null) idle.cancel()
      try {
        resolve(task())
      } catch (error) {
        reject(error)
      }
    }
    // 先挂兜底、再登记 idle：注入的调度器若同步就放行（真 InteractionManager 不会，测试会），
    // 这一刻 run 读到的 timer 已经赋好值，不会踩到正在初始化的变量
    timer = deps.setTimeoutFn(run, ANALYSIS_IDLE_FALLBACK_MS)
    idle = deps.runAfterInteractions(run)
  })
