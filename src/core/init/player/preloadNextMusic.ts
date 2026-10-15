import { getMusicUrl, getPicPath, getLyricInfo } from '@/core/music'
import { getNextPlayMusicInfo, resetRandomNextMusicInfo } from '@/core/player/player'
import { checkUrl } from '@/utils/request'
import settingState from '@/store/setting/state'
import { isCached } from '@/plugins/player/utils'
import { getCoverSurface } from '@/utils/monet'
import { ON_COVER_FONT_CSS } from '@/utils/monet/surface'
import { buildPreloadPlan, type PreloadStep } from '@/core/player/preloadPlan'

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
}

const reset = () => {
  state.resolveTried = false
  state.target = null
  state.targetIsOnline = false
  state.picUrl = null
  state.resolvedAt = 0
  state.isResolving = false
  for (const key of Object.keys(state.done) as PreloadStep[]) state.done[key] = false
}

const bump = () => {
  state.generation++
  reset()
}

const flags = () => ({
  preloadNextMusic: settingState.setting['player.preloadNextMusic'],
  dynamicBg: settingState.setting['theme.dynamicBg'],
  audioTier: settingState.setting['player.preloadNextMusicAudio'],
  // 与 core/player/player.ts:248 同式：那个设置项是字符串，空串也会算成 0，
  // 而 maxCacheSize <= 0 时 LocalPlayback 根本不建 SimpleCache（cache == null），
  // 字节下下去没地方写，只能整条禁用音频字节这步。
  cacheEnabled: parseInt(settingState.setting['player.cacheSize'] || '0') > 0,
})

const resolveTarget = async() => {
  if (state.isResolving) return
  state.isResolving = true
  state.resolveTried = true
  const generation = state.generation
  const info = await getNextPlayMusicInfo().catch(() => null)
  if (generation !== state.generation) {
    state.isResolving = false
    return
  }
  state.isResolving = false
  state.target = info
  state.resolvedAt = Date.now()
  if (info) {
    const musicInfo = info.musicInfo
    // 下载曲带 progress 字段，本地曲 source === 'local'；这两类没有"再下一趟网络"可省
    state.targetIsOnline = !('progress' in musicInfo) && musicInfo.source !== 'local'
  }
}

/** 沿用现状那条链：先拿直链，再用 isCached + HEAD 探活，两者都不成才 isRefresh 重取一次 */
const warmAudio = async(target: LX.Player.PlayMusicInfo) => {
  const generation = state.generation
  const url = await getMusicUrl({ musicInfo: target.musicInfo }).catch(() => '')
  if (!url || generation !== state.generation) return
  const [cached, available] = await Promise.all([
    isCached(url),
    checkUrl(url).then(() => true).catch(() => false),
  ])
  if (cached || available) return
  await getMusicUrl({ musicInfo: target.musicInfo, isRefresh: true }).catch(() => '')
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
        break
      case 'audio':
        await warmAudio(target)
        break
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
    if (keys.includes('player.preloadNextMusic') ||
      keys.includes('player.preloadNextMusicAudio') ||
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
