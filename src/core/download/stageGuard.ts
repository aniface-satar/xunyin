/**
 * 这几步都可能卡死：取链要过音源脚本的多源接力（脚本单笔请求 20s 超时，接力起来没有统一上限），
 * 写标签、查同名、SAF 复制都是原生调用，既没有断点续传也不自带超时。
 * 队列一次只跑一首，所以一个不返回的 await 会让整张列表停在「排队中」。
 */
export type GuardStage = 'url' | 'head' | 'rename' | 'tags' | 'save_dir' | 'publish' | 'cleanup'

const STAGE_TIMEOUTS: Record<GuardStage, number> = {
  // 覆盖「首选音源失败（≤20s）+ 找替代源（≤12s）+ 替代源再试一次（≤20s）」这条正常降档链，
  // 再往上就该判失败让队列往下走，而不是把整张列表钉在这里
  url: 45_000,
  head: 10_000,
  rename: 15_000,
  tags: 45_000,
  save_dir: 15_000,
  publish: 60_000,
  cleanup: 10_000,
}

export const guardStages = () => Object.keys(STAGE_TIMEOUTS) as GuardStage[]

export const stageTimeout = (stage: GuardStage) => STAGE_TIMEOUTS[stage]

/** 计时器由调用方给，调度器在真机上用 BackgroundTimer，测试里用假时钟 */
export interface TimerDriver {
  set: (callback: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
}

/**
 * 到点就放弃这一轮，让队列往下走。
 * 卡住的那个原生调用还会在后台跑完，但它已经不再决定这首歌的成败。
 */
export const withStageTimeout = async<T>(run: Promise<T>, stage: GuardStage, timer: TimerDriver): Promise<T> => {
  return new Promise((resolve, reject) => {
    const handle = timer.set(() => {
      reject(new Error(`download stage timeout: ${stage}`))
    }, stageTimeout(stage))
    run.then(
      value => {
        timer.clear(handle)
        resolve(value)
      },
      err => {
        timer.clear(handle)
        reject(err)
      },
    )
  })
}
