import type { TimerDriver } from './stageGuard'

/**
 * 传输阶段的看门狗和「整段不许超过 N 秒」的 stageGuard 不一样：
 * 一首无损在慢网上下十分钟是正常的，卡住指的是**没有任何字节在动**的那段死时间。
 * 所以这里只在「静默」时计时，进度事件一到就把放弃时间往后推。
 *
 * 为什么必须有它：RNFS 的下载 promise 完全靠原生线程回调承兑，
 * 连接被重定向到一条卡住的后端（redirect 之后那条连接没带 readTimeout）、
 * 或者线程被系统冻住不再回来，promise 就永远不落定。
 * 队列一次只跑一首，那一个不落定的 await 会让整张列表停在「排队中」直到用户重启 App。
 */
export const TRANSFER_STALL_MS = 60_000

/** 到点判死的错误：调度器靠它区分「卡住」和「普通的传输失败」，给用户不同的文案 */
export class TransferStalledError extends Error {
  constructor(stallMs: number) {
    super(`no download progress for ${stallMs}ms`)
    this.name = 'TransferStalledError'
  }
}

export interface TransferWatchdogOptions {
  timer: TimerDriver
  /** 判定真的卡住了：调度器在这里停掉原生任务，免得它在后台继续拖着 */
  onStall: () => void
  /**
   * 到点了也未必真卡住：息屏 / 后台被系统冻住时，原生线程和这个计时器一起停摆，
   * 解冻那一刻计时器先醒，进度还没恢复。返回 false 就只是把计时重新挂上，不当成下载失败。
   */
  mayAbort?: () => boolean
  stallMs?: number
}

export interface TransferWatchdog<T> {
  promise: Promise<T>
  /** 每个进度事件都要调一次：字节还在动，就不算卡 */
  bump: () => void
}

export const withTransferWatchdog = <T>(run: Promise<T>, options: TransferWatchdogOptions): TransferWatchdog<T> => {
  const { timer, onStall, mayAbort = () => true } = options
  const stallMs = options.stallMs ?? TRANSFER_STALL_MS
  let arm: () => void = () => {}

  const promise = new Promise<T>((resolve, reject) => {
    let handle: unknown = null
    let settled = false

    const disarm = () => {
      if (handle == null) return
      timer.clear(handle)
      handle = null
    }

    arm = () => {
      if (settled) return
      disarm()
      handle = timer.set(() => {
        handle = null
        if (settled) return
        if (!mayAbort()) {
          arm()
          return
        }
        settled = true
        // 停原生任务是尽力而为：它自己抛了也得让这一轮落定，
        // 「绝不把一个 await 留在永远等不到结果的状态」才是这个看门狗存在的全部理由
        try {
          onStall()
        } catch {
          // 停不掉的原生线程会自己把临时文件写完，那个文件名这一轮不会再被用到
        }
        reject(new TransferStalledError(stallMs))
      }, stallMs)
    }

    arm()
    // run 迟到一步的落定照样要接住：settled 之后不再改判，也不留下没清掉的计时器
    run.then(
      (value) => {
        if (settled) return
        settled = true
        disarm()
        resolve(value)
      },
      (err) => {
        if (settled) return
        settled = true
        disarm()
        reject(err)
      },
    )
  })

  return { promise, bump: () => { arm() } }
}
