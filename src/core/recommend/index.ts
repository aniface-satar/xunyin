/* eslint-disable require-atomic-updates */
import { AppState } from 'react-native'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import { getPlayHistory } from '@/utils/data'

import { getUserLists, userLists } from '@/utils/listManage'
import { getDislikeInfo } from '@/utils/dislikeManage'
import { buildTrackKey, getAlbumName, getArtistKeys, getPrimaryArtist } from './trackKey.ts'
import { recommendationConfig as cfg } from './config.ts'
import { loadState, getState, saveState, resetState, trimState, flushState } from './storage.ts'
import { loadCandidateCache, setCandidateCache, saveCandidateCache, clearCandidateCache } from './candidateStore.ts'
import { ensureLibraryIndex, getLibraryTrackOrigins, refreshLibraryIndex } from './library.ts'
import { buildTrackPlaylistIndex, buildSessionCoOccurrence } from './similarity.ts'
import { selectPlaylistEvictions } from './playlistIndex.ts'
import { buildRadioProfile } from './profile.ts'
import { createRadioQueue } from './queue.ts'
import { createSession } from './session.ts'
import { planChannelQuotas } from './channels.ts'
import { selectFinalQueue, type FinalQueueItem } from './diversity.ts'
import { buildFinalQueueItems, filterPoolCandidates, mergePoolCandidates, poolStats } from './candidatePool.ts'
import { computePlaylistAudioAffinity, enqueueAudioAnalysis } from './audioFeature.ts'
import { refreshExternalCandidates, type CatalogRefreshParams, type KnownExternalPlaylist } from './candidate.ts'
import { applyExplicitFeedback, beginRadioPlay, creditImportedOrigins, finishRadioPlay, getPlayRecord, getRecentRadioTrackKeys, isSourceCoolingDown, removeTrackFromCandidates, setSourceCooldown } from './behavior.ts'
import { buildSessionPenalties, computeSessionHealth, type SessionHealth } from './sessionHealth.ts'
import { selectDeferredTrackKeys } from './queueDeferral.ts'
import { startRadioPlaybackTracking, finishRadioPlaybackTracking, cancelRadioPlaybackTracking } from './playbackTracker.ts'
import type { DislikeRules, ExclusionContext } from './filter.ts'
import type { ChannelId, RadioMode, RecommendQueueItem } from './types.ts'
import { recallLog } from './log.ts'
import { computeTimeSlotAffinity } from './timeSlot.ts'

interface CachedDislike {
  rules: DislikeRules
  fetchedAt: number
}

let cachedDislike: CachedDislike | null = null
let randomGenerator: () => number = Math.random

class RecommendationEngine {
  private readonly queue = createRadioQueue()
  private readonly served = new Map<string, RecommendQueueItem>()
  private currentItem: RecommendQueueItem | null = null
  private currentPlayId: string | null = null
  private currentTrackKey: string | null = null
  private batchId = 0
  private initialized = false
  private refreshPromise: Promise<void> | null = null
  private lastRefreshAt = 0
  private lastRefreshReasons: string[] = []
  private radioMode: RadioMode = 'radio'
  private stateReady = false
  private lastSafeModeAt = 0
  private lastIdleCrawlAt = 0
  private pendingProvider: (() => readonly RecommendQueueItem[]) | null = null
  private lastDeferredView = { engineQueue: 0, handedOff: 0 }
  private readonly trackRemovalListeners: Array<(trackKey: string) => void> = []
  private readonly recentPlayed: Array<{ musicInfo: LX.Music.MusicInfo, channel?: ChannelId, playlistId?: string, seedKey?: string, groupId?: string, chartId?: string }> = []

  async initialize() {
    if (this.initialized) return
    this.initialized = true
    await loadState()
    this.stateReady = true
    const cachedCandidates = await loadCandidateCache()
    if (cachedCandidates.length) {
      setCandidateCache(cachedCandidates)
      getState().candidateCache = cachedCandidates
    } else if (getState().candidateCache.length) {
      // 持久化 state 中已有候选时作为兜底，同步回内存缓存
      setCandidateCache(getState().candidateCache)
    }
    global.app_event.on('musicToggled', () => {
      void this.handleMusicToggled()
    })
    global.app_event.on('stop', () => {
      if (this.currentPlayId) void this.finishCurrent('app_destroy')
      void flushState()
    })
    AppState.addEventListener('change', status => {
      if (status !== 'active') {
        void flushState()
        return
      }
      // 回到前台时若池子偏薄且间隔足够，补一次深度巡捞
      if (this.stateReady) {
        this.maybeIdleCrawl()
      }
    })
  }

  setRandomGenerator(generator: () => number) {
    randomGenerator = generator
  }

  private async getDislikeRules(): Promise<DislikeRules> {
    if (cachedDislike && Date.now() - cachedDislike.fetchedAt < 5 * 60 * 1000) return cachedDislike.rules
    try {
      const info = await getDislikeInfo()
      cachedDislike = {
        rules: {
          names: info.names,
          musicNames: info.musicNames,
          singerNames: info.singerNames,
        },
        fetchedAt: Date.now(),
      }
    } catch {
      cachedDislike = {
        rules: { names: new Set(), musicNames: new Set(), singerNames: new Set() },
        fetchedAt: Date.now(),
      }
    }
    return cachedDislike.rules
  }

  private getQueuedTrackKeys(): Set<string> {
    const keys = new Set<string>()
    if (this.currentTrackKey) keys.add(this.currentTrackKey)
    for (const item of this.queue.snapshot().items) keys.add(buildTrackKey(item.musicInfo))
    for (const item of playerState.tempPlayList) {
      const musicInfo = item.musicInfo
      if (!musicInfo || 'progress' in musicInfo) continue
      keys.add(buildTrackKey(musicInfo))
    }
    return keys
  }

  private async buildExclusionContext(): Promise<ExclusionContext> {
    const library = await ensureLibraryIndex()
    const blocked = await this.getDislikeRules()
    const sessionKeys = new Set(getState().session.recentTracks.map(track => track.trackKey))
    return {
      libraryKeys: library.keys,
      dislikedTrackKeys: new Set(Object.keys(getState().dislikedTracks)),
      queuedTrackKeys: this.getQueuedTrackKeys(),
      sessionTrackKeys: sessionKeys,
      recentRadioTrackKeys: getRecentRadioTrackKeys(),
      blocked,
    }
  }

  private async buildCurrentProfile() {
    const library = await ensureLibraryIndex()
    const love: LX.Music.MusicInfo[] = []
    const playlistsById: Record<string, LX.Music.MusicInfo[]> = {}
    for (const entry of library.entries.values()) {
      if (entry.isLove) love.push(entry.musicInfo)
      for (const listId of entry.listIds) {
        if (listId == 'love') continue
        if (!playlistsById[listId]) playlistsById[listId] = []
        playlistsById[listId].push(entry.musicInfo)
      }
    }
    const playlists = Object.entries(playlistsById).map(([id, tracks]) => ({
      id,
      name: userLists.find(list => list.id == id)?.name,
      tracks,
    }))
    let history: Array<{ musicInfo: LX.Music.MusicInfo, playTime: number }> = []
    try {
      const rawHistory = await getPlayHistory()
      history = rawHistory
        .filter(item => item.musicInfo && 'source' in item.musicInfo)
        .map(item => ({ musicInfo: item.musicInfo as LX.Music.MusicInfo, playTime: item.playTime }))
    } catch { /* history unavailable */ }
    return buildRadioProfile({
      loveTracks: love,
      playlists,
      trackPrefs: getState().tracks,
      history,
      session: getState().session,
      now: Date.now(),
    })
  }

  private async getKnownExternalPlaylists(): Promise<KnownExternalPlaylist[]> {
    await getUserLists()
    return userLists
      .filter(list => !!list.source && !!list.sourceListId)
      .map(list => ({
        id: list.id,
        source: list.source!,
        sourceListId: list.sourceListId!,
        name: list.name,
      }))
  }

  /** 参与随机轮换的在线音源；每轮抓取随机挑一个，避免单一平台的内容同质化。 */
  private static readonly SOURCES: LX.OnlineSource[] = ['kw', 'kg', 'tx', 'wy', 'mg']

  private static shuffledSources(): LX.OnlineSource[] {
    const order = [...RecommendationEngine.SOURCES]
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const swap = order[i]
      order[i] = order[j]
      order[j] = swap
    }
    return order
  }

  /** 随机音源优先，失败立即降级到下一个可用音乐源（spec §11 第 1 步）。 */
  private async refreshPool(reason: string, budget = cfg.request.maxRequestsPerRefresh) {
    const order = RecommendationEngine.shuffledSources().filter(item => !isSourceCoolingDown(item))
    if (!order.length) {
      recallLog('refreshSkip', { reason: 'all_sources_cooldown', sources: RecommendationEngine.SOURCES })
      return
    }
    for (const source of order.slice(0, 2)) {
      try {
        if (await this.refreshPoolWithSource(source, reason, budget)) return
        // 接口没抛错但一个候选都没抓到，等同于该音源不可用
        setSourceCooldown(source)
        recallLog('refreshEmpty', { reason, source })
      } catch (error) {
        setSourceCooldown(source)
        const message = error instanceof Error ? error.message : String(error)
        recallLog('refreshSourceFail', { reason, source, message })
      }
    }
  }

  private async refreshPoolWithSource(source: LX.OnlineSource, reason: string, budget: number): Promise<boolean> {
    const state = getState()
    const token = this.queue.getVersion()
    try {
      const [profile, library, blocked, knownExternalPlaylists] = await Promise.all([
        this.buildCurrentProfile(),
        ensureLibraryIndex(),
        this.getDislikeRules(),
        this.getKnownExternalPlaylists(),
      ])
      const exclusion = await this.buildExclusionContext()
      const params: CatalogRefreshParams = {
        source,
        profile,
        state,
        libraryKeys: library.keys,
        blocked,
        queuedTrackKeys: exclusion.queuedTrackKeys,
        sessionTrackKeys: exclusion.sessionTrackKeys,
        recentRadioTrackKeys: exclusion.recentRadioTrackKeys,
        dislikedTrackKeys: exclusion.dislikedTrackKeys,
        knownExternalPlaylists,
        now: Date.now(),
        budget,
        rotation: Math.floor(Date.now() / (5 * 60 * 1000)),
      }
      const result = await refreshExternalCandidates(params)
      if (token != this.queue.getVersion()) {
        recallLog('refreshDiscard', { reason: 'stale_version', requestedBy: reason })
        return true
      }
      // 合并本次抓取到的已观察歌单，并回收超容量的旧观察
      const observed = { ...state.observedPlaylists }
      for (const playlist of result.observedPlaylists) observed[playlist.id] = playlist
      const evictions = selectPlaylistEvictions(Object.values(observed))
      for (const id of evictions) delete observed[id]
      state.observedPlaylists = observed
      state.trackPlaylistIndex = buildTrackPlaylistIndex(Object.values(observed))
      state.candidateCache = mergePoolCandidates(state.candidateCache, result.candidates, cfg.candidatePool.maxSize)
      // 用最新排除集重新过滤候选，避免抓取期间新增收藏或屏蔽的内容残留
      state.candidateCache = filterPoolCandidates(state.candidateCache, exclusion)
      state.candidateCacheFetchedAt = Date.now()
      setCandidateCache(state.candidateCache)
      saveCandidateCache(state.candidateCache)
      this.lastRefreshAt = Date.now()
      this.lastRefreshReasons = result.reasons
      trimState()
      saveState()
      recallLog('refresh', {
        reason,
        requests: result.requests,
        pool: poolStats(state.candidateCache),
        reasons: result.reasons.slice(-5),
      })
      return result.candidates.length > 0 || state.candidateCache.length >= cfg.candidatePool.minCacheForInstantStart
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      recallLog('refreshError', { reason, source, message })
      throw error
    }
  }

  private async ensurePoolAvailable() {
    const state = getState()
    if (state.candidateCache.length) {
      if (Date.now() - state.candidateCacheFetchedAt > cfg.candidatePool.candidateTtlMs) {
        void this.refreshPool('ttl')
      }
      return
    }
    await this.refreshPool('initial')
    if (!getState().candidateCache.length) throw new Error('no_candidates')
  }

  /**
   * 闲置深度巡捞：池子低于目标且距上次抓取/巡捞都超过间隔时，用加倍预算补池。
   * 触发点：回到前台、以及每次生成队列之后；与常规 refresh 共用单飞锁。
   */
  private maybeIdleCrawl() {
    if (!this.stateReady) return
    const state = getState()
    if (state.candidateCache.length >= cfg.candidatePool.targetSize) return
    const now = Date.now()
    if (now - this.lastRefreshAt < cfg.idleCrawl.minIntervalMs) return
    if (now - this.lastIdleCrawlAt < cfg.idleCrawl.minIntervalMs) return
    this.lastIdleCrawlAt = now
    const budget = Math.round(cfg.request.maxRequestsPerRefresh * cfg.idleCrawl.budgetMultiplier)
    recallLog('idleCrawl', { pool: state.candidateCache.length, budget })
    void this.triggerRefresh('idle_crawl', budget).catch(() => {})
  }

  private async triggerRefresh(reason: string, budget = cfg.request.maxRequestsPerRefresh) {
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = this.refreshPool(reason, budget).finally(() => {
      this.refreshPromise = null
    })
    return this.refreshPromise
  }

  private buildRecentSelectionItems(limit = 30): FinalQueueItem[] {
    const state = getState()
    const items: FinalQueueItem[] = []
    const pushMusicInfo = (musicInfo: LX.Music.MusicInfo, channel?: ChannelId, playlistId?: string, seedKey?: string, groupId?: string, chartId?: string) => {
      items.push({
        key: buildTrackKey(musicInfo),
        channels: channel ? [channel] : [],
        primaryArtist: getPrimaryArtist(musicInfo),
        artistKeys: getArtistKeys(musicInfo.singer),
        albumKey: getAlbumName(musicInfo),
        sourcePlaylistId: playlistId,
        sourceSeedTrackKey: seedKey,
        sourceClusterId: groupId,
        sourceChartId: chartId,
        groupIds: groupId ? [groupId] : [],
        exposureCount: 0,
        weight: 1,
      })
    }
    const recentPlayedKeys = new Set(this.recentPlayed.map(item => buildTrackKey(item.musicInfo)))
    for (const track of state.session.recentTracks) {
      if (recentPlayedKeys.has(track.trackKey)) continue
      const item = this.served.get(track.trackKey) ?? this.queue.snapshot().items.find(queueItem => buildTrackKey(queueItem.musicInfo) == track.trackKey)
      if (item) pushMusicInfo(item.musicInfo, track.channel ?? item.channel, track.sourcePlaylistId ?? item.sourcePlaylistId, track.sourceSeedTrackKey, track.sourceClusterId, track.sourceChartId)
    }
    for (const item of this.queue.snapshot().items) {
      pushMusicInfo(item.musicInfo, item.channel, item.sourcePlaylistId, item.sourceSeedTrackKey, item.sourceClusterId, item.sourceChartId != null ? String(item.sourceChartId) : undefined)
    }
    for (const item of this.recentPlayed) {
      pushMusicInfo(item.musicInfo, item.channel, item.playlistId, item.seedKey, item.groupId, item.chartId)
    }
    for (const item of playerState.tempPlayList) {
      const musicInfo = item.musicInfo
      if (!musicInfo || 'progress' in musicInfo) continue
      pushMusicInfo(musicInfo, undefined)
    }
    if (this.currentItem) pushMusicInfo(this.currentItem.musicInfo, this.currentItem.channel, this.currentItem.sourcePlaylistId, this.currentItem.sourceSeedTrackKey, this.currentItem.sourceClusterId, this.currentItem.sourceChartId != null ? String(this.currentItem.sourceChartId) : undefined)
    return items.slice(-Math.max(1, limit))
  }

  private toQueueItem(
    candidate: ReturnType<typeof mergePoolCandidates>[number],
    channel: ChannelId,
    batchId: number,
  ): RecommendQueueItem {
    const source = channel == 'D' ? 'chart' : channel == 'C' ? 'chart' : 'related'
    return {
      musicInfo: candidate.musicInfo,
      source,
      channel,
      sourcePlaylistId: candidate.playlistIds[0],
      sourceSeedTrackKey: candidate.seedTrackKeys[0],
      sourceClusterId: candidate.groupIds[0],
      sourceChartId: candidate.chartId ? Number(candidate.chartId) || undefined : undefined,
      batchId,
    }
  }

  /** 画像证据不足时先推热榜/低曝光；代表歌曲或强歌手任一达标后自动升级为画像推荐。 */
  private isColdStart(profile: { seeds: readonly unknown[], topArtists: ReadonlyArray<{ weight: number }> }) {
    const min = cfg.profile.coldStart
    if (profile.seeds.length >= min.minProfileSeeds) return false
    const topWeight = profile.topArtists[0]?.weight ?? 0
    const strongArtists = profile.topArtists.filter(item => item.weight >= topWeight * min.strongArtistWeightRatio).length
    return strongArtists < min.minStrongArtists
  }

  private async generateQueue(count: number) {
    const token = this.queue.getVersion()
    const state = getState()
    await this.ensurePoolAvailable()
    const exclusion = await this.buildExclusionContext()
    state.candidateCache = filterPoolCandidates(state.candidateCache, exclusion)
    const target = Math.max(1, Math.min(count, cfg.queue.targetSize))
    if (state.candidateCache.length < cfg.candidatePool.targetSize && Date.now() - this.lastRefreshAt > 30_000) {
      void this.triggerRefresh('pool_below_target').catch(() => {})
    }
    const profile = await this.buildCurrentProfile()
    // 会话健康度：连续不合胃口时收缩探索额度、给负反馈来源降分、降低随机温度
    const dislikedTrackKeys = new Set(Object.keys(state.dislikedTracks))
    const health = computeSessionHealth(state.session, dislikedTrackKeys)
    const sessionPenalties = buildSessionPenalties(state.session, dislikedTrackKeys)
    // SAR 会话共现：用户播放序列里与种子歌同场被积极听过的候选加权
    const sessionCoOccurrence = buildSessionCoOccurrence(state.radioHistory, profile.seedKeys)
    // 音频品味传导：已分析歌曲的质心给候选来源歌单打分（无分析数据时为空）；
    // 质心剔除负反馈歌曲，避免被切过的歌把品味质心拉向反方向
    const audioExcludeKeys = new Set([
      ...Object.keys(state.dislikedTracks),
      ...Object.entries(state.tracks).filter(([, pref]) => pref.score < 0).map(([trackKey]) => trackKey),
    ])
    const playlistAudioAffinity = computePlaylistAudioAffinity(state.audioEmbeddings, state.observedPlaylists, cfg.audioFeature.playlistMinCoverage, audioExcludeKeys)
    const finalItems = buildFinalQueueItems(state.candidateCache, {
      playlistPreferences: state.playlists,
      observedPlaylists: state.observedPlaylists,
      exposureCounts: state.exposureCounts,
      seedCount: profile.seeds.length,
      now: Date.now(),
      mode: this.radioMode,
      sessionPenalties,
      sessionCoOccurrence,
      playlistAudioAffinity,
      tokenWeights: state.tokenWeights,
      artistStats: state.artistStats,
      timeSlotFactor: computeTimeSlotAffinity(state.radioHistory, Date.now()).factorFor,
    })
    if (!finalItems.length) return false
    const availability: Record<ChannelId, number> = { A: 0, B: 0, C: 0, D: 0 }
    for (const item of finalItems) {
      for (const channel of item.channels) availability[channel] = (availability[channel] ?? 0) + 1
    }
    const recentChannels = [
      ...state.session.recentChannels,
      ...this.queue.snapshot().items.map(item => item.channel),
    ]
    const coldStart = this.isColdStart(profile)
    // 用户探索偏好（三档）在 radio 模式下调制健康度输出；explore 模式本身主打撞新不干预
    let explorationFactor = health.explorationFactor
    let explorationGap = this.radioMode == 'explore' ? 0 : cfg.antiRepeat.explorationGap
    if (this.radioMode == 'radio') {
      const bias = settingState.setting['recommend.exploreBias']
      if (bias == 'familiar') {
        explorationFactor = Math.min(explorationFactor, cfg.exploreBias.familiarFactorCap)
        explorationGap = Math.max(explorationGap, cfg.exploreBias.familiarGap)
      } else if (bias == 'explore') {
        explorationFactor = Math.max(explorationFactor, cfg.exploreBias.exploreFactorFloor)
        explorationGap = cfg.exploreBias.exploreGap
      }
    }
    const plan = planChannelQuotas(target, recentChannels, availability, {
      coldStart,
      mode: this.radioMode,
      explorationFactor,
      bandit: state.channelBandit,
      rng: randomGenerator,
      now: Date.now(),
    })
    const selection = selectFinalQueue(finalItems, {
      target,
      recent: this.buildRecentSelectionItems(),
      channelPlan: plan,
      rng: randomGenerator,
      temperature: health.safeMode ? cfg.softmax.safeModeTemperature : cfg.softmax.temperature,
      explorationGap,
    })
    if (!selection.items.length) return false
    const byKey = new Map(state.candidateCache.map(candidate => [candidate.trackKey, candidate]))
    this.batchId += 1
    // 入选线索：优先歌手直采 > 歌单来源 > 榜单，filtered 类是排除记录不对外
    const pickReason = (reasons: readonly string[]) =>
      reasons.find(reason => reason.startsWith('artist_hits:')) ??
      reasons.find(reason => reason.startsWith('playlist:')) ??
      reasons.find(reason => reason.startsWith('chart')) ??
      reasons.find(reason => !reason.startsWith('filtered:'))
    const queueItems = selection.items
      .map(selected => {
        const candidate = byKey.get(selected.item.key)
        if (!candidate) return null
        const item = this.toQueueItem(candidate, selected.channel, this.batchId)
        const reason = pickReason(candidate.reasons)
        if (reason) item.reason = reason
        return item
      })
      .filter((item): item is RecommendQueueItem => item != null)
    if (token != this.queue.getVersion()) return false
    const accepted = this.queue.enqueue(queueItems, token)
    if (accepted) {
      this.maybeIdleCrawl()
    }
    recallLog('generate', {
      requested: target,
      selected: queueItems.length,
      accepted,
      pickedByChannel: selection.pickedByChannel,
      plan: plan.quotas,
      coldStart,
      profileSeeds: profile.seeds.length,
      directions: profile.directions.length,
      relaxLevel: selection.maxRelaxLevel,
      reasons: selection.reasons,
      health: {
        streak: health.negativeStreak,
        rate: health.negativeRate,
        explorationRate: health.explorationNegativeRate,
        explorationFactor: health.explorationFactor,
        safeMode: health.safeMode,
      },
      pool: poolStats(state.candidateCache),
    })
    return accepted
  }

  async warmUp(target = cfg.queue.targetSize) {
    await this.initialize()
    if (this.queue.size() < target) await this.generateQueue(target)
    if (!this.queue.size()) throw new Error('no_candidates')
    return this.queue.size()
  }

  async getRecommendations(count: number): Promise<RecommendQueueItem[]> {
    await this.initialize()
    if (this.queue.size() < count) {
      await this.generateQueue(Math.max(count, cfg.queue.targetSize))
    }
    let token = this.queue.getVersion()
    let items = this.queue.shift(count, token)
    if (!items.length) {
      try {
        await this.triggerRefresh('empty_queue', 4)
      } catch { /* cache may still be empty */ }
      await this.generateQueue(Math.max(count, cfg.queue.targetSize))
      token = this.queue.getVersion()
      items = this.queue.shift(count, token)
    }
    for (const item of items) this.rememberServed(item)
    return items
  }

  async getNextTrack(): Promise<RecommendQueueItem | null> {
    await this.initialize()
    if (!this.queue.size()) {
      // 队列暂空：异步触发补货并返回 null，由调用方稍后重试
      void this.triggerRefresh('next_empty', 4).then(async() => this.generateQueue(cfg.queue.targetSize)).catch(() => {})
      return null
    }
    const token = this.queue.getVersion()
    const [item] = this.queue.shift(1, token)
    if (!item) return null
    this.rememberServed(item)
    return item
  }

  private rememberServed(item: RecommendQueueItem) {
    const key = buildTrackKey(item.musicInfo)
    this.served.set(key, item)
    if (this.served.size > 300) {
      const oldest = this.served.keys().next().value
      if (oldest != null) this.served.delete(oldest)
    }
  }

  peekQueue(count = 5) {
    return this.queue.peek(count)
  }

  getRadioMode(): RadioMode {
    return this.radioMode
  }

  getRadioSummary() {
    if (!this.stateReady) {
      const idleHealth: SessionHealth = { negativeStreak: 0, positiveStreak: 0, negativeRate: 0, explorationNegativeRate: null, explorationFactor: 1, safeMode: false, sampleSize: 0 }
      return { mode: this.radioMode, queueSize: 0, poolSize: 0, channels: { A: 0, B: 0, C: 0, D: 0 }, channelShare: { A: 0, B: 0, C: 0, D: 0 }, recentArtistCounts: {}, sessionTracks: 0, sessionHealth: idleHealth, lastRefreshAt: 0, reasons: [] }
    }
    const state = getState()
    const snapshot = this.queue.snapshot()
    const channels: Record<ChannelId, number> = { A: 0, B: 0, C: 0, D: 0 }
    for (const item of snapshot.items) channels[item.channel] = (channels[item.channel] ?? 0) + 1
    const channelShare: Record<ChannelId, number> = { A: 0, B: 0, C: 0, D: 0 }
    for (const channel of (Object.keys(channels) as ChannelId[])) {
      channelShare[channel] = snapshot.size ? Math.round(channels[channel] / snapshot.size * 100) / 100 : 0
    }
    const recentArtistCounts: Record<string, number> = {}
    for (const item of [...snapshot.items, ...this.recentPlayed.slice(0, 20)]) {
      const artist = getPrimaryArtist(item.musicInfo)
      recentArtistCounts[artist] = (recentArtistCounts[artist] ?? 0) + 1
    }
    return {
      mode: this.radioMode,
      queueSize: snapshot.size,
      poolSize: state.candidateCache.length,
      channels,
      channelShare,
      recentArtistCounts,
      sessionTracks: state.session.recentTracks.length,
      sessionHealth: computeSessionHealth(state.session, new Set(Object.keys(state.dislikedTracks))),
      lastRefreshAt: this.lastRefreshAt,
      reasons: this.lastRefreshReasons.slice(-8),
    }
  }

  /** 真机诊断用：画像摘要。TODO 定位后删除 */
  async getProfileDigest() {
    await this.initialize()
    const profile = await this.buildCurrentProfile()
    const state = getState()
    return {
      coldStart: this.isColdStart(profile),
      seeds: profile.seeds.length,
      directions: profile.directions
        .slice()
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 8)
        .map(d => ({ k: d.kind, n: d.name ?? d.directionId, w: Math.round(d.weight * 100) / 100, t: d.tracks.length })),
      topArtists: profile.topArtists.slice(0, 8).map(a => ({ a: a.artist, w: Math.round(a.weight * 100) / 100 })),
      pool: poolStats(state.candidateCache),
      recentChannels: state.session.recentChannels.slice(-20),
    }
  }

  explainQueue(count = 5) {
    return this.queue.peek(count).map(item => ({
      track: `${item.musicInfo.name} - ${item.musicInfo.singer}`,
      trackKey: buildTrackKey(item.musicInfo),
      channel: item.channel,
      source: item.source,
      sourcePlaylistId: item.sourcePlaylistId,
      sourceChartId: item.sourceChartId,
      batchId: item.batchId,
    }))
  }

  /** 查询某首已出队/在队曲目的入选线索（含歌单名解析），UI 显示推荐理由用。 */
  explainTrack(trackKey: string): { kind: 'artist' | 'playlist' | 'chart' | 'search' | 'radio', param?: string } | null {
    const item = this.queue.snapshot().items.find(queueItem => buildTrackKey(queueItem.musicInfo) == trackKey) ??
      this.served.get(trackKey)
    if (!item) return null
    const reason = item.reason
    if (reason?.startsWith('artist_hits:')) {
      return { kind: 'artist', param: reason.slice('artist_hits:'.length).split(',')[0] }
    }
    if (reason?.startsWith('playlist:')) {
      const playlistId = reason.slice('playlist:'.length).split(',')[0]
      const observed = getState().observedPlaylists[playlistId]
      if (observed?.name) return { kind: 'playlist', param: observed.name }
      return { kind: 'playlist' }
    }
    if (reason?.startsWith('music_search:')) {
      return { kind: 'search', param: reason.slice('music_search:'.length).split(',')[0] }
    }
    if (item.sourceChartId != null || item.channel == 'D') return { kind: 'chart' }
    if (item.sourcePlaylistId) {
      const observed = getState().observedPlaylists[item.sourcePlaylistId]
      if (observed?.name) return { kind: 'playlist', param: observed.name }
      return { kind: 'playlist' }
    }
    return { kind: 'radio' }
  }

  private async handleMusicToggled() {
    await this.initialize()
    const raw = playerState.playMusicInfo.musicInfo
    if (!raw || 'progress' in raw) {
      if (this.currentPlayId) await this.finishCurrent('radio_switch')
      return
    }
    const musicInfo = raw
    const trackKey = buildTrackKey(musicInfo)
    if (this.currentPlayId && this.currentTrackKey == trackKey) return
    if (this.currentPlayId) await this.finishCurrent('radio_switch')

    const servedItem = this.served.get(trackKey) ?? null
    const playId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    this.currentItem = servedItem
    this.currentTrackKey = trackKey
    this.currentPlayId = playId
    startRadioPlaybackTracking({
      playId,
      trackKey,
      musicInfo,
      channel: servedItem?.channel,
      sourcePlaylistId: servedItem?.sourcePlaylistId,
      sourceSeedTrackKey: servedItem?.sourceSeedTrackKey,
      sourceClusterId: servedItem?.sourceClusterId,
      sourceChartId: servedItem?.sourceChartId != null ? String(servedItem.sourceChartId) : undefined,
      platform: musicInfo.source,
    })
    beginRadioPlay({
      playId,
      trackKey,
      musicInfo,
      channel: servedItem?.channel,
      sourcePlaylistId: servedItem?.sourcePlaylistId,
      sourceSeedTrackKey: servedItem?.sourceSeedTrackKey,
      sourceClusterId: servedItem?.sourceClusterId,
      sourceChartId: servedItem?.sourceChartId != null ? String(servedItem.sourceChartId) : undefined,
      platform: musicInfo.source,
    })
    this.recentPlayed.unshift({
      musicInfo,
      channel: servedItem?.channel,
      playlistId: servedItem?.sourcePlaylistId,
      seedKey: servedItem?.sourceSeedTrackKey,
      groupId: servedItem?.sourceClusterId,
      chartId: servedItem?.sourceChartId != null ? String(servedItem.sourceChartId) : undefined,
    })
    if (this.recentPlayed.length > 60) this.recentPlayed.length = 60
    recallLog('playStart', { trackKey, channel: servedItem?.channel, playlistId: servedItem?.sourcePlaylistId })
  }

  private async finishCurrent(reason: Parameters<typeof finishRadioPlay>[1]) {
    const playId = this.currentPlayId
    if (!playId) {
      this.currentItem = null
      this.currentTrackKey = null
      return
    }
    // 供音频分析使用：置空 currentItem 之前先留下这首歌的信息
    const finishedMusicInfo = this.currentItem?.musicInfo ?? null
    this.currentPlayId = null
    this.currentTrackKey = null
    this.currentItem = null
    const record = await finishRadioPlaybackTracking(reason)
    if (record) {
      finishRadioPlay(record, reason)
      // 自然播完的曲目进入后台音频分析队列（best-effort，为音频品味质心积累样本）
      if (reason == 'natural_end' && finishedMusicInfo) {
        enqueueAudioAnalysis(record.trackKey, finishedMusicInfo)
      }
    }
    // 结算后评估会话健康度：连续负反馈时立即撤下队列中的高风险曲目
    this.maybeEnterSafeMode(record?.trackKey)
  }

  /**
   * 安全模式熔断：连续多首不合胃口时，把引擎队列与已移交给播放器的待播曲目里
   * 命中近期负反馈歌手/歌单的那些撤下来（只撤曲目不删候选池），让补位走画像优先的新批次。
   */
  private maybeEnterSafeMode(excludedTrackKey?: string) {
    if (!this.stateReady) return
    const state = getState()
    const health = computeSessionHealth(state.session, new Set(Object.keys(state.dislikedTracks)))
    if (!health.safeMode) return
    const now = Date.now()
    if (now - this.lastSafeModeAt < cfg.sessionHealth.safeModeCooldownMs) return
    const penalties = buildSessionPenalties(state.session, new Set(Object.keys(state.dislikedTracks)))
    const token = this.queue.getVersion()
    const queued = this.queue.snapshot().items
    const handedOff = this.pendingProvider?.() ?? []
    this.lastDeferredView = { engineQueue: queued.length, handedOff: handedOff.length }
    const deferred = selectDeferredTrackKeys([...queued, ...handedOff], penalties, {
      maxDeferrals: cfg.sessionHealth.maxDeferralsPerTrigger,
      excludeTrackKey,
    })
    if (deferred.length) {
      const deferredKeys = new Set(deferred)
      this.queue.removeMany(deferredKeys, token)
      for (const trackKey of deferredKeys) this.served.delete(trackKey)
      this.lastSafeModeAt = now
      for (const trackKey of deferred) {
        for (const listener of this.trackRemovalListeners) {
          try { listener(trackKey) } catch { /** 忽略单个监听器抛出的异常 */ }
        }
      }
    }
    recallLog('safeMode', {
      streak: health.negativeStreak,
      rate: health.negativeRate,
      explorationFactor: health.explorationFactor,
      deferred: deferred.length,
      view: this.lastDeferredView,
    })
    void this.triggerRefresh('safe_mode_supplement', 4).catch(() => {})
  }

  onManualSkip() {
    if (!this.stateReady) return
    if (!this.currentPlayId) return
    void this.finishCurrent('user_next')
  }

  onTrackEnded() {
    if (!this.stateReady) return
    if (!this.currentPlayId) return
    void this.finishCurrent('natural_end')
  }

  onPlayError(reason: 'play_error' | 'load_error' = 'play_error') {
    if (!this.stateReady) return
    if (!this.currentPlayId) return
    void this.finishCurrent(reason)
  }

  private findPoolMeta(trackKey: string) {
    return getState().candidateCache.find(candidate => candidate.trackKey == trackKey)
  }

  /** 导入归因：本地库中这首歌若来自某个网络歌单，给来源歌单记一次打折正反馈。 */
  private async creditImportedSources(trackKey: string, kind: 'like' | 'add_to_playlist', excludedPlaylistId?: string) {
    try {
      await refreshLibraryIndex()
      creditImportedOrigins(getLibraryTrackOrigins(trackKey), kind, excludedPlaylistId)
    } catch (error) {
      recallLog('creditImportedSourcesError', { message: error instanceof Error ? error.message : String(error) })
    }
  }

  private removeTrackEverywhere(trackKey: string) {
    this.queue.removeTrackKey(trackKey)
    this.served.delete(trackKey)
    removeTrackFromCandidates(trackKey)
    for (const listener of this.trackRemovalListeners) {
      try { listener(trackKey) } catch { /** 忽略单个监听器抛出的异常 */ }
    }
  }

  async onDislikedInfo(name: string, singer: string) {
    await this.initialize()
    try {
      const trackKey = buildTrackKey({ name, singer } as unknown as LX.Music.MusicInfo)
      const playId = this.currentTrackKey == trackKey ? this.currentPlayId ?? undefined : undefined
      applyExplicitFeedback({ type: 'dislike', trackKey, playId, name, singer })
      this.removeTrackEverywhere(trackKey)
      // 显式不喜欢是强负反馈，立即评估是否熔断清队
      this.maybeEnterSafeMode(trackKey)
    } catch (error) {
      recallLog('onDislikedInfoError', { message: error instanceof Error ? error.message : String(error) })
    }
  }

  async onLiked(musicInfo: LX.Music.MusicInfo) {
    await this.initialize()
    try {
      const trackKey = buildTrackKey(musicInfo)
      const playId = this.currentTrackKey == trackKey ? this.currentPlayId ?? undefined : undefined
      const item = this.currentTrackKey == trackKey ? this.currentItem : null
      const poolMeta = this.findPoolMeta(trackKey)
      const sourcePlaylistId = item?.sourcePlaylistId ?? poolMeta?.playlistIds[0] ?? (playId ? getPlayRecord(playId)?.sourcePlaylistId : undefined)
      applyExplicitFeedback({
        type: 'like',
        trackKey,
        playId,
        musicInfo,
        channel: item?.channel ?? poolMeta?.channels[0],
        sourcePlaylistId,
      })
      void this.creditImportedSources(trackKey, 'like', sourcePlaylistId)
      // 喜欢后收藏索引即会排除该曲，异步补充少量不同歌手的新候选
      void this.triggerRefresh('liked_supplement', 4)
      this.removeTrackEverywhere(trackKey)
    } catch (error) {
      recallLog('onLikedError', { message: error instanceof Error ? error.message : String(error) })
    }
  }

  async onUnliked(musicInfo: LX.Music.MusicInfo) {
    await this.initialize()
    try {
      const trackKey = buildTrackKey(musicInfo)
      applyExplicitFeedback({ type: 'unlike', trackKey, playId: this.currentTrackKey == trackKey ? this.currentPlayId ?? undefined : undefined })
      // 取消喜欢只撤回正向信号，不视为不感兴趣
    } catch (error) {
      recallLog('onUnlikedError', { message: error instanceof Error ? error.message : String(error) })
    }
  }

  async onAddedToPlaylist(musicInfo: LX.Music.MusicInfo, listId: string) {
    await this.initialize()
    try {
      const trackKey = buildTrackKey(musicInfo)
      const playId = this.currentTrackKey == trackKey ? this.currentPlayId ?? undefined : undefined
      const item = this.currentTrackKey == trackKey ? this.currentItem : null
      const poolMeta = this.findPoolMeta(trackKey)
      const sourcePlaylistId = item?.sourcePlaylistId ?? poolMeta?.playlistIds[0] ?? (playId ? getPlayRecord(playId)?.sourcePlaylistId : undefined)
      applyExplicitFeedback({
        type: 'add_to_playlist',
        trackKey,
        playId,
        channel: item?.channel ?? poolMeta?.channels[0],
        sourcePlaylistId,
        listId,
      })
      void this.creditImportedSources(trackKey, 'add_to_playlist', sourcePlaylistId)
      this.removeTrackEverywhere(trackKey)
    } catch (error) {
      recallLog('onAddedToPlaylistError', { message: error instanceof Error ? error.message : String(error) })
    }
  }

  onTrackRemoved(listener: (trackKey: string) => void) {
    this.trackRemovalListeners.push(listener)
  }

  /** radio.ts 注册后，安全模式可以看到已移交给播放器的待播曲目。 */
  registerPendingProvider(provider: (() => readonly RecommendQueueItem[]) | null) {
    this.pendingProvider = provider
  }

  getDeferredView() {
    return { ...this.lastDeferredView }
  }

  invalidateDislikeCache() {
    cachedDislike = null
  }

  async startSession(mode: RadioMode = 'radio') {
    this.queue.invalidate()
    this.served.clear()
    this.lastSafeModeAt = 0
    this.lastDeferredView = { engineQueue: 0, handedOff: 0 }
    // 切换模式要清空上一模式的通道窗口，否则旧配额会挤压新窗口
    if (this.radioMode != mode && this.stateReady) {
      getState().session = createSession()
      saveState()
    }
    this.radioMode = mode
  }

  endSession() {
    this.queue.invalidate()
    this.served.clear()
  }

  getPoolSize() {
    return getState().candidateCache.length
  }

  async resetProfile() {
    await resetState()
    await clearCandidateCache()
    this.queue.invalidate()
    this.served.clear()
    this.currentItem = null
    this.currentPlayId = null
    this.currentTrackKey = null
    this.lastRefreshAt = 0
    this.lastRefreshReasons = []
    this.lastSafeModeAt = 0
    this.lastIdleCrawlAt = 0
    cachedDislike = null
    cancelRadioPlaybackTracking()
  }
}

export const recommendationEngine = new RecommendationEngine()
export { getPrimaryArtist }
