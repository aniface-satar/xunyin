import { getMusicUrl, getPicPath, getLyricInfo } from '@/core/music'
import { getNextPlayMusicInfo, resetRandomNextMusicInfo } from '@/core/player/player'
import { checkUrl } from '@/utils/request'
import settingState from '@/store/setting/state'
import { isCached, cacheTrack, cancelCacheTrack } from '@/plugins/player/utils'
import { getCoverSurface } from '@/utils/monet'
import { ON_COVER_FONT_CSS } from '@/utils/monet/surface'
import { buildPreloadPlan, audioMaxBytes, AUDIO_HEAD_BYTES, type PreloadStep } from '@/core/player/preloadPlan'
import { prefetchCoverImage } from '@/utils/nativeModules/palette'
import { defaultHeaders } from '@/components/common/Image'
// 与播放路径同一个 UA（playList.ts:14 那条常量就是给 TrackPlayer 填 userAgent 用的那个值）：
// 原生侧 remove("User-Agent") 之后重新塞，UA 一换就等于换了请求，更糟的是换了缓存 key。
import { defaultUserAgent } from '@/plugins/player/playList'

// 完成标记用类型标注而不是 `as Record<...>`：本仓库的 eslint（standard-with-typescript）
// 把 object 字面量上的类型断言判红（objectLiteralTypeAssertions: 'never'）。
const initialDone: Record<PreloadStep, boolean> = { pic: false, lyric: false, palette: false, coverBytes: false, audio: false }

// 判据在 src/core/player/preloadPlan.ts（纯表，node --test 跑得动）。
// 这里只做四件事：订阅进度、按代数作废在途、发起步骤、把结果写回 state。
// 目标恒为一个（下一首），不预焐下两首：coverPalette 的像素层 LRU 只有 20 条，
// 焐两首会把当前这首歌挤出去，反而制造新的取色迟到。
const state = {
  // 在途代数：手动切歌、播放模式变化、预热相关设置翻动都 ++，
  // 每步写回前比对，晚到的旧结果据此丢弃
  generation: 0,
  /** 本曲是否已经问过"下一首是谁"。问过就不再问，返回 null（列表播完）也不再问 */
  resolveTried: false,
  target: null as LX.Player.PlayMusicInfo | null,
  /** 本地/下载曲为假：省掉 coverBytes 与音频字节两步 */
  targetIsOnline: false,
  picUrl: null as string | null,
  /** 目标解析完成的时刻（ms）：音频字节延后 3s 的判据 */
  resolvedAt: 0,
  done: { ...initialDone },
  isResolving: false,
  /** 在途的字节预热任务标识，切歌时据此让原生那条读循环收摊 */
  audioToken: null as string | null,
}

const reset = () => {
  state.resolveTried = false
  state.target = null
  state.targetIsOnline = false
  state.picUrl = null
  state.resolvedAt = 0
  state.isResolving = false
  state.audioToken = null
  for (const key of Object.keys(state.done) as PreloadStep[]) state.done[key] = false
}

// 顺序承重：先 cancelCacheTrack 再 reset()。reset() 会把 token 清成 null，
// 而 cancelCacheTrack 对 null 直接 return —— 反过来写就是在途那条原生读循环没人收摊。
const bump = () => {
  state.generation++
  cancelCacheTrack(state.audioToken)
  reset()
}

const flags = () => ({
  preloadNextMusic: settingState.setting['player.preloadNextMusic'],
  dynamicBg: settingState.setting['theme.dynamicBg'],
  audioTier: settingState.setting['player.preloadNextMusicAudio'],
  // 单位是 MB：默认 '1024'（src/config/defaultSetting.ts:23），core/player/player.ts:248 按 MB parseInt，
  // 原生（MusicManager.java:131 再乘 1024）最后拿到的正是 MB * 1024 * 1024 字节，所以这里换成字节喂给纯表。
  // 判据不再是"大于 0"：`<= 0` 时 LocalPlayback 不建 SimpleCache（cache == null）字节没处写，
  // 装不下 8MB 前缀时 LRU 会把正在播那首的片段挤掉 —— 预热反过来拖垮播放。`|| '0'` 保住空串算 0 的旧行为。
  cacheBytes: parseInt(settingState.setting['player.cacheSize'] || '0') * 1024 * 1024,
})

const resolveTarget = async() => {
  if (state.isResolving) return
  state.isResolving = true
  state.resolveTried = true
  const generation = state.generation
  const info = await getNextPlayMusicInfo().catch(() => null)
  // 代数不匹配就整块不写回，而且绝不能碰 isResolving：作废时 reset() 已经把它清回 false 了，
  // 这一轮再清一次等于把*新*那轮在途解析的门卫也清掉，两场解析就会同时跑、互相覆盖 target。
  if (generation !== state.generation) return
  state.isResolving = false
  state.target = info
  state.resolvedAt = Date.now()
  // 无条件赋值：info 为 null（列表播完/没有下一首）时也要把上一轮留下的 true 落下来，
  // 否则脏的 targetIsOnline 会让 coverBytes 与音频字节两步继续对一个不存在的目标发。
  const musicInfo = info?.musicInfo
  // 下载曲带 progress 字段，本地曲 source === 'local'；这两类没有"再下一趟网络"可省
  state.targetIsOnline = musicInfo != null && !('progress' in musicInfo) && musicInfo.source !== 'local'
}

/** 沿用现状那条链：先拿直链，再用 isCached + HEAD 探活，两者都不成才 isRefresh 重取一次。
 * 返回可直接下字节的 url，拿不到（含被作废）就返回 ''，由调用方决定不发。 */
const warmAudio = async(target: LX.Player.PlayMusicInfo): Promise<string> => {
  const generation = state.generation
  // 取直链的次序照抄 core/player/player.ts:107-119：手动换过源（meta.toggleMusicInfo 有值）时先按那条源取、
  // 且不许再自动换源，取不到才回落到本曲。缓存 key 就是 url 字符串，预热与播放拿到不同的 url 就是不同的 key，
  // 焐下去的字节白下，换源照样卡。
  const fetchUrl = async(isRefresh: boolean): Promise<string> => {
    const musicInfo = target.musicInfo
    const toggleMusicInfo = ('progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo).meta.toggleMusicInfo
    if (toggleMusicInfo) {
      const toggled = await getMusicUrl({
        musicInfo: toggleMusicInfo,
        isRefresh,
        allowToggleSource: false,
      }).catch(() => '')
      if (toggled) return toggled
    }
    return getMusicUrl({ musicInfo, isRefresh }).catch(() => '')
  }
  let url = await fetchUrl(false)
  if (!url || generation !== state.generation) return ''
  const [cached, available] = await Promise.all([
    isCached(url),
    checkUrl(url).then(() => true).catch(() => false),
  ])
  if (!cached && !available) {
    const fresh = await fetchUrl(true)
    if (generation !== state.generation) return ''
    if (fresh) url = fresh
  }
  return url
}

const runStep = async(step: PreloadStep) => {
  const target = state.target
  if (target == null) return
  // 发起即记账：一次失败不在这一首里重试，下一首自然还会再问（spec §5）
  state.done[step] = true
  const generation = state.generation
  try {
    switch (step) {
      case 'pic': {
        const url = await getPicPath({ musicInfo: target.musicInfo, listId: target.listId })
        if (generation !== state.generation) return
        state.picUrl = url
        break
      }
      case 'lyric':
        await getLyricInfo({ musicInfo: target.musicInfo })
        break
      case 'palette':
        // 承重：只焐 coverPalette 的缓存，绝不碰 coverBackdropStore 的 attempts 账本与 generation。
        // 那张账管的是"这张封面该不该再问原生、什么时候自愈重试"，去动它就是把
        // 「时有时无」那个缺陷重写一遍。两边按 url 合并 promise，切歌时页面读到同一条在途。
        await getCoverSurface(state.picUrl, ON_COVER_FONT_CSS)
        break
      case 'coverBytes':
        await prefetchCoverImage(state.picUrl, defaultHeaders)
        break
      case 'audio': {
        const url = await warmAudio(target)
        if (!url || generation !== state.generation) return
        // 档位翻动走的是 bump()，上面那道代数比对就拦下了，这次重读管不着它；
        // 真正靠这一次的是 player.cacheSize —— 它不在 bump 名单里，只有这一刻重读才知道缓存是不是被清成 0、
        // 或者被改小到装不下那道 8MB 前缀（判据与纯表同一个，见 preloadPlan.ts 的 cacheBytes）。
        const currentFlags = flags()
        if (currentFlags.audioTier === 'off' || currentFlags.cacheBytes < AUDIO_HEAD_BYTES) return
        state.audioToken = `${target.musicInfo.id}|${generation}`
        await cacheTrack(url, { 'User-Agent': defaultUserAgent }, audioMaxBytes(currentFlags.audioTier), state.audioToken)
        break
      }
    }
  } catch (e) {
    if (__DEV__) console.log('[preload]', step, 'failed', e)
  }
}

export default () => {
  const handleMusicToggled = () => {
    // 切歌就是新的一轮：在途全部作废，目标重问
    bump()
  }

  const handleConfigUpdated: typeof global.state_event.configUpdated = (keys) => {
    if (keys.includes('player.togglePlayMethod')) {
      if (state.target && !state.target.isTempPlay) resetRandomNextMusicInfo()
      bump()
    }
    // 预加载相关设置翻了也要重来：关掉要作废在途，打开（含「动态背景」）才能补发没发过的那几步
    // 音质也要算：直链是按音质取的（online.ts:55 在调用这一刻才读 player.playQuality），
    // 窗口内改音质会让在途那条 warm 落在旧音质的 url 上，作废重来才不会白下。
    if (keys.includes('player.preloadNextMusic') ||
      keys.includes('player.preloadNextMusicAudio') ||
      keys.includes('player.playQuality') ||
      keys.includes('theme.dynamicBg')) bump()
  }

  const handlePlayProgressChanged: typeof global.state_event.playProgressChanged = (progress) => {
    const plan = buildPreloadPlan({
      progress: { nowPlayTime: progress.nowPlayTime, maxPlayTime: progress.maxPlayTime },
      flags: flags(),
      resolveTried: state.resolveTried,
      hasTarget: state.target != null,
      targetIsOnline: state.targetIsOnline,
      hasPicUrl: state.picUrl != null,
      resolvedAge: (Date.now() - state.resolvedAt) / 1000,
      done: state.done,
    })
    if (plan.resolveTarget) void resolveTarget()
    for (const step of plan.steps) void runStep(step)
  }

  global.app_event.on('musicToggled', handleMusicToggled)
  global.state_event.on('configUpdated', handleConfigUpdated)
  global.state_event.on('playProgressChanged', handlePlayProgressChanged)
}
