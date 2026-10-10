// 识曲结果的统一形状。引擎数组（Task 5）与各引擎实现都产出这个结构，
// 页面层只认它，不认网易/Shazam 的原始响应。
export interface RecognizedSong {
  name: string
  singer: string
  albumName: string
  neteaseSongId: string
  startTimeMs: number
}

// 识曲失败的五种原因，UI 按它选文案：
// no_match 是「没听出来」，failed 是「服务故障」（后者才该触发退避保险丝）。
export type RecognizeReason = 'no_match' | 'failed' | 'daily' | 'cooldown' | 'unsupported'

export type RecognizeOutcome =
  { ok: true, song: RecognizedSong, engineId: string }
  | { ok: false, reason: RecognizeReason }

/**
 * 识曲引擎。recognize 收到的 pcm 是 8kHz 单声道 Int16 识别窗口，不是原始 48k 采集。
 * 窗口长度由 WINDOW_LEN_SECONDS = 6 决定（48000 个样本）；抽窗与重采样在录音侧完成，
 * 引擎只消费这一份窗口，调度层原样透传同一引用。
 */
export interface RecognizeEngine {
  id: string
  recognize: (pcm: Int16Array) => Promise<RecognizedSong | null>
}

// 每日限流 + 连续失败退避的闸门（limiter.ts 的 createGuard 即其实现）。
// check 决定这一轮能不能跑；onAttempt 只在真的要发请求前占用一次每日额度；
// onSuccess 清零退避，onFailure 只在「有引擎抛异常且全都没命中」时累计一次。
export interface Guard {
  check: () => Promise<'allow' | 'daily' | 'cooldown'>
  onAttempt: () => Promise<void>
  onSuccess: () => Promise<void>
  onFailure: () => Promise<void>
}
