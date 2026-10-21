// 识曲结果的统一形状。引擎数组（Task 5）与各引擎实现都产出这个结构，
// 页面层只认它，不认网易/Shazam 的原始响应。
export interface RecognizedSong {
  name: string
  singer: string
  albumName: string
  neteaseSongId: string
  startTimeMs: number
}

// 识曲失败的四种原因，UI 按它选文案：
// no_match 是「没听出来」，failed 是「服务故障」（后者才该触发退避保险丝）。
export type RecognizeReason = 'no_match' | 'failed' | 'cooldown' | 'unsupported'

// 一轮里某个引擎听到的歌。engineId 决定它落到结果页的哪个分区。
export interface RecognizeHit {
  engineId: string
  song: RecognizedSong
}

/**
 * 一轮的结论：hits 是这一轮所有命中的引擎（可以两条都有），failure 是没听出来/出故障时的收尾原因，
 * 命中时恒为 null。注意 hits 非空与 failure != null 是互斥的。
 */
export interface RecognizeRound {
  hits: RecognizeHit[]
  failure: RecognizeReason | null
}

/**
 * 识曲引擎。recognize 收到的是原生采集的原始 PCM 与它的采样率（当前 48kHz），不是任何降采样窗口：
 * 网易要 8k、Shazam 要 16k，抽窗与降采样是引擎自己的事，调度层不替它们决定。
 * 窗口位置由 pcmSplitter 的 WINDOW_FROM_SECONDS / WINDOW_LEN_SECONDS 统一约束。
 */
export interface RecognizeEngine {
  id: string
  recognize: (pcm: Int16Array, sampleRate: number) => Promise<RecognizedSong | null>
}

// 连续失败退避的闸门（limiter.ts 的 createGuard 即其实现）。
// check 决定这一轮能不能跑；onSuccess 清零退避，
// onFailure 只在「有引擎抛异常且全都没命中」时累计一次。
export interface Guard {
  check: () => Promise<'allow' | 'cooldown'>
  onSuccess: () => Promise<void>
  onFailure: () => Promise<void>
}
