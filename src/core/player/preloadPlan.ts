// 「这一刻该为下一首发哪几步」的纯表。
// 与 backdropGate.ts / attemptLedger.ts 同一类：除会被 Node 擦掉的类型外零运行时依赖，
// 所以能拿 node --test 当单元测试跑（tests/preload-next-music-plan.mts）。
// 副作用一步都不在这里，判据也不读 playerState / settingState —— 全部从入参拿，
// 否则这张表就退化成又一个"只能真机上才能验"的代码。

export type PreloadAudioTier = 'off' | 'head' | 'full'

export type PreloadStep = 'pic' | 'lyric' | 'palette' | 'coverBytes' | 'audio'

export interface PreloadProgress {
  nowPlayTime: number
  maxPlayTime: number
}

export interface PreloadFlags {
  /** 总开关：关掉就是五步全不发，连"下一首是谁"都不问 */
  preloadNextMusic: boolean
  /** 取色那一步单独受它管，别把整条预热带过去 */
  dynamicBg: boolean
  audioTier: PreloadAudioTier
  /** 播放器那份 SimpleCache 的容量，字节（`player.cacheSize` 的单位是 MB，换算见 preloadNextMusic.ts）。
   *  两道都要过才发音频字节：`<= 0` 时 LocalPlayback 根本不建 cache（cache == null），下字节无处可写；
   *  `> 0` 但装不下 `AUDIO_HEAD_BYTES` 时更要命 —— LRU 淘汰会把*正在播的那首*的片段挤出去，
   *  预热反而拖垮播放，这是 spec 禁止的失效方向，所以判据是"装得下前缀"而不是"大于 0"。 */
  cacheBytes: number
}

export interface PreloadPlanInput {
  progress: PreloadProgress
  flags: PreloadFlags
  /** 本曲是否已经问过"下一首是谁"。返回 null（列表播完）也算问过，不再每秒重问 */
  resolveTried: boolean
  hasTarget: boolean
  /** 本地曲 / 下载曲为假：这两类没有"再下一趟网络"可省 */
  targetIsOnline: boolean
  hasPicUrl: boolean
  /** 目标解析完成后经过的秒数，音频字节那一步的延迟判据 */
  resolvedAge: number
  done: Record<PreloadStep, boolean>
}

export interface PreloadPlan {
  resolveTarget: boolean
  steps: PreloadStep[]
}

/** 剩多少秒开始准备下一首。10s 那条旧门限被它包含（进度事件约每 1s 一次），不再单独写分支 */
export const RESOLVE_AHEAD_SECONDS = 60
/** 时长下界：电台与未知长度的流式曲 maxPlayTime 为 0，此时"剩余 <=60"恒真，没有这个下界就会每秒问一次 */
export const MIN_DURATION_SECONDS = 10
/** 反悔窗口：给"连点下一首 / 拖到尾部"留出作废时间，过了这个点才动音频字节 */
export const AUDIO_DELAY_SECONDS = 3
export const AUDIO_HEAD_BYTES = 8 * 1024 * 1024

export const audioMaxBytes = (tier: PreloadAudioTier): number => tier === 'full' ? 0 : AUDIO_HEAD_BYTES

/** 缓存装不下一个 8MB 前缀时，下字节只会把正在播的那首挤出去 —— 宁可这步不发。
 *  表与执行器（发起那一刻的重读）共用这一句，别各写一遍：两边一旦分叉，保护就没了。 */
export const cacheFitsAudioWarm = (cacheBytes: number): boolean => cacheBytes >= AUDIO_HEAD_BYTES

export const buildPreloadPlan = (input: PreloadPlanInput): PreloadPlan => {
  if (!input.flags.preloadNextMusic) return { resolveTarget: false, steps: [] }

  const remaining = input.progress.maxPlayTime - input.progress.nowPlayTime
  const resolveTarget = !input.resolveTried &&
    input.progress.maxPlayTime > MIN_DURATION_SECONDS &&
    remaining <= RESOLVE_AHEAD_SECONDS

  if (!input.hasTarget) return { resolveTarget, steps: [] }

  const steps: PreloadStep[] = []
  if (!input.done.pic) steps.push('pic')
  if (!input.done.lyric) steps.push('lyric')
  // 取色要等 pic 的结果：配色层的缓存键是 `picUrl|fontArgb`，没有 url 就没有这一步
  if (input.flags.dynamicBg && input.hasPicUrl && !input.done.palette) steps.push('palette')
  if (input.targetIsOnline && input.hasPicUrl && !input.done.coverBytes) steps.push('coverBytes')
  // 容量这道门限 head 与 full 共用：连 8MB 前缀都装不下的缓存更装不下整首，
  // 而 full 档（maxBytes<=0 → LENGTH_UNSET）没有上限兜底，挤掉的只能是正在播的那首 —— 宁可这步不发。
  if (input.targetIsOnline &&
    input.flags.audioTier !== 'off' &&
    cacheFitsAudioWarm(input.flags.cacheBytes) &&
    input.resolvedAge >= AUDIO_DELAY_SECONDS &&
    !input.done.audio) steps.push('audio')

  return { resolveTarget, steps }
}
