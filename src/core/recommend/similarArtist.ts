import type { LangBucket } from './language.ts'

/**
 * 相似歌手通道 E 的纯逻辑：MB/LB 响应解析、跨刷新任务状态机、缓存整理与预算调度。
 * 这里不发请求、不碰存储，运行时依赖（httpFetch / searchMusic）由 index.ts 注入，
 * 因此可以在 node --test 下直接测整条链路。
 */

export interface MusicBrainzArtistSummary {
  mbid: string
  name: string
  aliases: string[]
  tags: string[]
}

export interface SimilarArtistEntry {
  mbid: string
  name: string
  score: number
}

export type SimilarArtistStage = 'search' | 'similar' | 'aliases' | 'songs' | 'done'

/** 跨刷新续跑的链路任务：已完成/已成功的阶段不会重发请求。 */
export interface SimilarArtistTask {
  seedArtist: string
  stage: SimilarArtistStage
  seedMbid?: string
  similar: SimilarArtistEntry[]
  /** 已尝试过 MB 规范名反查的相似歌手数（失败也推进，避免卡在同一位置）。 */
  aliasCursor: number
  resolved: Array<{ mbid: string, name: string }>
  /** 还没搜过歌的规范歌手名；失败时也移出，不让一个名字卡死整条链路。 */
  pending: string[]
  createdAt: number
  updatedAt: number
}

export interface SimilarArtistRecord {
  similar: Array<{ mbid: string, name: string }>
  source: 'musicbrainz+listenbrainz' | 'empty'
  fetchedAt: number
  /** 缓存命中后搜歌的轮换位，避免每次都重复同一批相似歌手。 */
  nextIndex: number
  /** 上次搜歌时间；冷却期内不重复花 kg 请求。 */
  songsFetchedAt: number
}

export interface SimilarArtistCache {
  byArtist: Record<string, SimilarArtistRecord>
  /** 不受 TTL 管：链路中途态被清掉就永远铺不完。 */
  pending: Record<string, SimilarArtistTask>
}

export interface SimilarArtistPolicy {
  aliasLookups: number
  songFetchesPerRun: number
  cacheTtlMs: number
  cacheLimit: number
  cacheReuseCooldownMs: number
}

export type SimilarArtistAction =
  | { kind: 'mb_search', seedArtist: string, query: string }
  | { kind: 'lb_similar', seedArtist: string, mbid: string }
  | { kind: 'mb_alias', seedArtist: string, mbid: string }
  | { kind: 'kg_songs', seedArtist: string, artist: string }

export type SimilarArtistOutcome =
  | { kind: 'mb_search', artist: MusicBrainzArtistSummary | null }
  | { kind: 'lb_similar', entries: SimilarArtistEntry[] }
  | { kind: 'mb_alias', artist: { mbid: string, name: string } | null }
  | { kind: 'kg_songs' }

export interface SimilarArtistIo<T> {
  mbSearch: (name: string) => Promise<MusicBrainzArtistSummary | null>
  lbSimilar: (mbid: string) => Promise<SimilarArtistEntry[]>
  mbLookup: (mbid: string) => Promise<MusicBrainzArtistSummary | null>
  kgSongs: (name: string) => Promise<T[]>
}

export interface SimilarArtistRefreshInput {
  cache: SimilarArtistCache
  /** 候选种子歌手，按画像权重降序；调用方已剔除屏蔽歌手。 */
  seedArtists: readonly string[]
  seedCursor: number
  /** 本轮是否轮到起一位新种子（每 3 次刷新一次）；有在途任务时仍续跑在途。 */
  startNewSeed: boolean
  budget: number
  now: number
  policy: SimilarArtistPolicy
  /** MB 返回的艺人事实，供 L3 歌手语言表借鉴（可选）。 */
  onArtistFacts?: (facts: MusicBrainzArtistSummary) => void
}

export interface SimilarArtistSongFetch<T> {
  seedArtist: string
  artistName: string
  tracks: T[]
}

export interface SimilarArtistRunResult<T> {
  cache: SimilarArtistCache
  songs: Array<SimilarArtistSongFetch<T>>
  requests: number
  reasons: string[]
  nextSeedCursor: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value == 'object' && value != null && !Array.isArray(value)
}

const readNameList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  const names: string[] = []
  for (const item of value) {
    const name = typeof item == 'string'
      ? item.trim()
      : isRecord(item) && typeof item.name == 'string' ? item.name.trim() : ''
    if (name && !names.includes(name)) names.push(name)
  }
  return names
}

const parseMbArtist = (raw: unknown): MusicBrainzArtistSummary | null => {
  if (!isRecord(raw)) return null
  const mbid = typeof raw.id == 'string' ? raw.id.trim() : ''
  const name = typeof raw.name == 'string' ? raw.name.trim() : ''
  if (!mbid || !name) return null
  return { mbid, name, aliases: readNameList(raw.aliases), tags: readNameList(raw.tags) }
}

/** MB 搜索响应里 artists[0] 就是最相关结果；没有结果返回 null，由调用方决定缓存"查无此人"。 */
export const parseMusicBrainzArtistSearch = (body: unknown): MusicBrainzArtistSummary | null => {
  if (!isRecord(body) || !Array.isArray(body.artists) || !body.artists.length) return null
  return parseMbArtist(body.artists[0])
}

/** MB 单艺人反查（inc=aliases+tags），响应就是艺人本体。 */
export const parseMusicBrainzArtistLookup = (body: unknown): MusicBrainzArtistSummary | null => {
  return parseMbArtist(body)
}

/**
 * LB 相似歌手：接口返回 100 条左右，按 score 降序、按 mbid 去重。
 * 只采信 mbid，名字要到 MB 反查拿规范名（实测 LB 的 name 繁简/拉丁混排）。
 */
export const parseListenBrainzSimilar = (body: unknown): SimilarArtistEntry[] => {
  if (!Array.isArray(body)) return []
  const byMbid = new Map<string, SimilarArtistEntry>()
  for (const raw of body) {
    if (!isRecord(raw)) continue
    const mbid = typeof raw.artist_mbid == 'string' ? raw.artist_mbid.trim() : ''
    const name = typeof raw.name == 'string' ? raw.name.trim() : ''
    if (!mbid || !name) continue
    const score = Number(raw.score)
    const entry = { mbid, name, score: Number.isFinite(score) ? score : 0 }
    const prev = byMbid.get(mbid)
    if (!prev || entry.score > prev.score) byMbid.set(mbid, entry)
  }
  return [...byMbid.values()].sort((a, b) => b.score - a.score)
}

/** 只认显式语种标签；多语种并列时不硬判——错写进 L3 会比不写更糟。 */
const MB_TAG_LANG: Record<string, LangBucket> = {
  mandarin: 'zh',
  mandopop: 'zh',
  'mandarin pop': 'zh',
  chinese: 'zh',
  'chinese pop': 'zh',
  cantopop: 'yue',
  'canto-pop': 'yue',
  cantonese: 'yue',
  'cantonese pop': 'yue',
  'j-pop': 'ja',
  japanese: 'ja',
  'japanese pop': 'ja',
  'k-pop': 'ko',
  korean: 'ko',
  'korean pop': 'ko',
  english: 'en',
  'english pop': 'en',
}

export const inferArtistLangFromTags = (tags: readonly string[]): LangBucket | null => {
  const buckets: LangBucket[] = []
  for (const raw of tags) {
    const bucket = MB_TAG_LANG[raw.trim().toLowerCase()]
    if (bucket && !buckets.includes(bucket)) buckets.push(bucket)
  }
  return buckets.length == 1 ? buckets[0] : null
}

const parseSimilarEntries = (value: unknown): SimilarArtistEntry[] => {
  if (!Array.isArray(value)) return []
  const byMbid = new Map<string, SimilarArtistEntry>()
  for (const raw of value) {
    if (!isRecord(raw)) continue
    const mbid = typeof raw.mbid == 'string' ? raw.mbid.trim() : ''
    const name = typeof raw.name == 'string' ? raw.name.trim() : ''
    if (!mbid || !name) continue
    const score = Number(raw.score)
    if (!byMbid.has(mbid)) byMbid.set(mbid, { mbid, name, score: Number.isFinite(score) ? score : 0 })
  }
  return [...byMbid.values()]
}

const parseSimilarNames = (value: unknown): Array<{ mbid: string, name: string }> => {
  return parseSimilarEntries(value).map(entry => ({ mbid: entry.mbid, name: entry.name }))
}

const readTime = (value: unknown, fallback = 0) => {
  const num = Number(value)
  return Number.isFinite(num) && num >= 0 ? num : fallback
}

const normalizeRecord = (value: unknown): SimilarArtistRecord | null => {
  if (!isRecord(value)) return null
  const fetchedAt = readTime(value.fetchedAt)
  if (!fetchedAt) return null
  return {
    similar: parseSimilarNames(value.similar),
    source: value.source == 'empty' ? 'empty' : 'musicbrainz+listenbrainz',
    fetchedAt,
    nextIndex: Math.max(0, Math.floor(readTime(value.nextIndex))),
    songsFetchedAt: readTime(value.songsFetchedAt),
  }
}

const STAGES: readonly SimilarArtistStage[] = ['search', 'similar', 'aliases', 'songs', 'done']

const normalizeTask = (value: unknown): SimilarArtistTask | null => {
  if (!isRecord(value)) return null
  const seedArtist = typeof value.seedArtist == 'string' ? value.seedArtist.trim() : ''
  const stage = typeof value.stage == 'string' && STAGES.includes(value.stage as SimilarArtistStage)
    ? value.stage as SimilarArtistStage
    : null
  if (!seedArtist || !stage || stage == 'done') return null
  const pending = Array.isArray(value.pending)
    ? [...new Set(value.pending.filter((name): name is string => typeof name == 'string' && !!name.trim()).map(name => name.trim()))]
    : []
  if (stage == 'songs' && !pending.length) return null
  return {
    seedArtist,
    stage,
    seedMbid: typeof value.seedMbid == 'string' && value.seedMbid.trim() ? value.seedMbid.trim() : undefined,
    similar: parseSimilarEntries(value.similar),
    aliasCursor: Math.max(0, Math.floor(readTime(value.aliasCursor))),
    resolved: parseSimilarNames(value.resolved),
    pending,
    createdAt: readTime(value.createdAt),
    updatedAt: readTime(value.updatedAt),
  }
}

const PENDING_LIMIT = 20

/**
 * 存储形状不认识就当作无缓存重来（独立键没有版本戳，不能靠 STATE_VERSION 迁移）。
 * byArtist 受 TTL 管、超容量按 fetchedAt 留最新；pending 不受 TTL 管，只在链路完成时删除。
 */
export const normalizeSimilarArtistCache = (
  loaded: unknown,
  now: number,
  options: { cacheTtlMs: number, cacheLimit: number },
): SimilarArtistCache => {
  const cache: SimilarArtistCache = { byArtist: {}, pending: {} }
  if (!isRecord(loaded)) return cache
  const rawByArtist = isRecord(loaded.byArtist) ? loaded.byArtist : {}
  for (const [seedArtist, value] of Object.entries(rawByArtist)) {
    const record = normalizeRecord(value)
    if (!record) continue
    if (now - record.fetchedAt > options.cacheTtlMs) continue
    cache.byArtist[seedArtist] = record
  }
  const recordKeys = Object.keys(cache.byArtist)
  if (recordKeys.length > options.cacheLimit) {
    recordKeys.sort((a, b) => cache.byArtist[b].fetchedAt - cache.byArtist[a].fetchedAt)
    for (const key of recordKeys.slice(options.cacheLimit)) delete cache.byArtist[key]
  }
  const rawPending = isRecord(loaded.pending) ? loaded.pending : {}
  for (const [seedArtist, value] of Object.entries(rawPending)) {
    const task = normalizeTask(value)
    if (!task || task.seedArtist != seedArtist) continue
    cache.pending[seedArtist] = task
  }
  const taskKeys = Object.keys(cache.pending)
  if (taskKeys.length > PENDING_LIMIT) {
    taskKeys.sort((a, b) => cache.pending[b].updatedAt - cache.pending[a].updatedAt)
    for (const key of taskKeys.slice(PENDING_LIMIT)) delete cache.pending[key]
  }
  return cache
}

export const createSimilarArtistTask = (seedArtist: string, now: number): SimilarArtistTask => ({
  seedArtist,
  stage: 'search',
  similar: [],
  aliasCursor: 0,
  resolved: [],
  pending: [],
  createdAt: now,
  updatedAt: now,
})

export const nextSimilarArtistAction = (
  task: SimilarArtistTask,
  policy: Pick<SimilarArtistPolicy, 'aliasLookups'>,
): SimilarArtistAction | null => {
  switch (task.stage) {
    case 'search':
      return { kind: 'mb_search', seedArtist: task.seedArtist, query: task.seedArtist }
    case 'similar':
      return task.seedMbid ? { kind: 'lb_similar', seedArtist: task.seedArtist, mbid: task.seedMbid } : null
    case 'aliases': {
      const target = Math.min(Math.max(0, policy.aliasLookups), task.similar.length)
      return task.aliasCursor < target
        ? { kind: 'mb_alias', seedArtist: task.seedArtist, mbid: task.similar[task.aliasCursor].mbid }
        : null
    }
    case 'songs':
      return task.pending.length
        ? { kind: 'kg_songs', seedArtist: task.seedArtist, artist: task.pending[0] }
        : null
    default:
      return null
  }
}

const advanceAliases = (task: SimilarArtistTask, policy: Pick<SimilarArtistPolicy, 'aliasLookups'>) => {
  const target = Math.min(Math.max(0, policy.aliasLookups), task.similar.length)
  if (task.aliasCursor < target) return
  const names: string[] = []
  for (const resolved of task.resolved) {
    const name = resolved.name.trim()
    if (!name || name == task.seedArtist || names.includes(name)) continue
    names.push(name)
  }
  task.pending = names
  task.stage = names.length ? 'songs' : 'done'
}

export const applySimilarArtistOutcome = (
  task: SimilarArtistTask,
  action: SimilarArtistAction,
  outcome: SimilarArtistOutcome,
  now: number,
  policy: Pick<SimilarArtistPolicy, 'aliasLookups'>,
): SimilarArtistTask => {
  if (action.kind != outcome.kind) return task
  const next: SimilarArtistTask = {
    ...task,
    similar: task.similar.map(entry => ({ ...entry })),
    resolved: task.resolved.map(entry => ({ ...entry })),
    pending: [...task.pending],
    updatedAt: now,
  }
  if (action.kind == 'mb_search') {
    const artist = outcome.kind == 'mb_search' ? outcome.artist : null
    if (!artist) {
      next.stage = 'done'
      return next
    }
    next.seedMbid = artist.mbid
    next.stage = 'similar'
    return next
  }
  if (action.kind == 'lb_similar') {
    const entries = outcome.kind == 'lb_similar' ? outcome.entries : []
    next.similar = [...entries].sort((a, b) => b.score - a.score)
    next.aliasCursor = 0
    next.stage = next.similar.length ? 'aliases' : 'done'
    if (next.stage == 'done') return next
    advanceAliases(next, policy)
    return next
  }
  if (action.kind == 'mb_alias') {
    const artist = outcome.kind == 'mb_alias' ? outcome.artist : null
    if (artist?.name && !next.resolved.some(entry => entry.mbid == (artist.mbid || action.mbid))) {
      next.resolved.push({ mbid: artist.mbid || action.mbid, name: artist.name })
    }
    next.aliasCursor += 1
    advanceAliases(next, policy)
    return next
  }
  // 搜歌失败也推进：kg 搜索重试价值低，留下来只会让整条链路永远铺不完
  next.pending = next.pending.slice(1)
  if (!next.pending.length) next.stage = 'done'
  return next
}

export const completeSimilarArtistTask = (task: SimilarArtistTask, now: number): SimilarArtistRecord => ({
  similar: task.resolved.map(entry => ({ ...entry })),
  source: task.resolved.length ? 'musicbrainz+listenbrainz' : 'empty',
  fetchedAt: now,
  nextIndex: 0,
  // songs 阶段刚按这批名字搜过歌；空记录没有可搜的，置 0 不参与冷却
  songsFetchedAt: task.resolved.length ? now : 0,
})

export const pickSimilarArtistSeed = (
  artists: readonly string[],
  cache: SimilarArtistCache,
  cursor: number,
): { seedArtist: string, nextCursor: number } | null => {
  if (!artists.length) return null
  const taken = new Set([...Object.keys(cache.byArtist), ...Object.keys(cache.pending)])
  const start = artists.length ? ((Math.max(0, Math.floor(cursor)) % artists.length) + artists.length) % artists.length : 0
  for (let offset = 0; offset < artists.length; offset++) {
    const index = (start + offset) % artists.length
    const seedArtist = artists[index]
    if (taken.has(seedArtist)) continue
    return { seedArtist, nextCursor: (index + 1) % artists.length }
  }
  return null
}

export const planCachedSongFetches = (
  record: SimilarArtistRecord,
  count: number,
): { names: string[], nextIndex: number } => {
  if (!record.similar.length || count <= 0) return { names: [], nextIndex: record.nextIndex % Math.max(1, record.similar.length) }
  const start = ((record.nextIndex % record.similar.length) + record.similar.length) % record.similar.length
  const take = Math.min(Math.floor(count), record.similar.length)
  const names: string[] = []
  for (let offset = 0; offset < take; offset++) {
    const name = record.similar[(start + offset) % record.similar.length].name
    if (!names.includes(name)) names.push(name)
  }
  return { names, nextIndex: (start + take) % record.similar.length }
}

export const pickCachedSimilarArtistRecord = (
  cache: SimilarArtistCache,
  now: number,
  cooldownMs: number,
): string | null => {
  let picked: string | null = null
  let oldest = Infinity
  for (const [seedArtist, record] of Object.entries(cache.byArtist)) {
    if (!record.similar.length) continue
    if (record.songsFetchedAt > 0 && now - record.songsFetchedAt < cooldownMs) continue
    if (record.songsFetchedAt >= oldest) continue
    oldest = record.songsFetchedAt
    picked = seedArtist
  }
  return picked
}

const cloneCache = (cache: SimilarArtistCache): SimilarArtistCache => ({
  byArtist: Object.fromEntries(Object.entries(cache.byArtist).map(([key, value]) => [
    key,
    { ...value, similar: value.similar.map(entry => ({ ...entry })) },
  ])),
  pending: Object.fromEntries(Object.entries(cache.pending).map(([key, value]) => [
    key,
    {
      ...value,
      similar: value.similar.map(entry => ({ ...entry })),
      resolved: value.resolved.map(entry => ({ ...entry })),
      pending: [...value.pending],
    },
  ])),
})

const trimCache = (cache: SimilarArtistCache, limit: number) => {
  const keys = Object.keys(cache.byArtist)
  if (keys.length <= limit) return
  keys.sort((a, b) => cache.byArtist[b].fetchedAt - cache.byArtist[a].fetchedAt)
  for (const key of keys.slice(limit)) delete cache.byArtist[key]
}

const finishTask = (cache: SimilarArtistCache, task: SimilarArtistTask, now: number, limit: number) => {
  delete cache.pending[task.seedArtist]
  cache.byArtist[task.seedArtist] = completeSimilarArtistTask(task, now)
  trimCache(cache, limit)
}

/**
 * 一轮 E 链路调度：先续跑在途任务（预算内逐个请求），完成后把任务落成缓存；
 * 预算还有剩且没有在途任务时，按冷却轮换给已缓存的相似歌手搜歌。
 * 返回新的缓存对象，不修改调用方传入的 cache。
 */
export const runSimilarArtistRefresh = async <T>(
  input: SimilarArtistRefreshInput,
  io: SimilarArtistIo<T>,
): Promise<SimilarArtistRunResult<T>> => {
  const policy = input.policy
  const cache = cloneCache(input.cache)
  const reasons: string[] = []
  const songs: Array<SimilarArtistSongFetch<T>> = []
  let requests = 0
  let remaining = Math.max(0, Math.floor(input.budget))
  let seedCursor = input.seedCursor

  let task: SimilarArtistTask | null = Object.values(cache.pending)
    .sort((a, b) => a.createdAt - b.createdAt)[0] ?? null

  if (!task && input.startNewSeed) {
    const picked = pickSimilarArtistSeed(input.seedArtists, cache, seedCursor)
    if (picked) {
      seedCursor = picked.nextCursor
      task = createSimilarArtistTask(picked.seedArtist, input.now)
      cache.pending[picked.seedArtist] = task
      reasons.push(`similar_artist_seed:${picked.seedArtist}`)
    }
  }

  while (task && remaining > 0) {
    const action = nextSimilarArtistAction(task, policy)
    if (!action) break
    remaining -= 1
    requests += 1
    try {
      if (action.kind == 'mb_search') {
        const artist = await io.mbSearch(action.query)
        if (artist) input.onArtistFacts?.(artist)
        task = applySimilarArtistOutcome(task, action, { kind: 'mb_search', artist }, input.now, policy)
      } else if (action.kind == 'lb_similar') {
        const entries = await io.lbSimilar(action.mbid)
        task = applySimilarArtistOutcome(task, action, { kind: 'lb_similar', entries }, input.now, policy)
      } else if (action.kind == 'mb_alias') {
        const artist = await io.mbLookup(action.mbid)
        if (artist) input.onArtistFacts?.(artist)
        task = applySimilarArtistOutcome(task, action, {
          kind: 'mb_alias',
          artist: artist ? { mbid: artist.mbid, name: artist.name } : null,
        }, input.now, policy)
      } else {
        const tracks = await io.kgSongs(action.artist)
        songs.push({ seedArtist: task.seedArtist, artistName: action.artist, tracks })
        task = applySimilarArtistOutcome(task, action, { kind: 'kg_songs' }, input.now, policy)
      }
      if (task.stage == 'done') {
        finishTask(cache, task, input.now, policy.cacheLimit)
        task = null
        break
      }
      cache.pending[task.seedArtist] = task
    } catch {
      reasons.push(`similar_artist_${action.kind}_failed`)
      if (!task) break
      if (action.kind == 'kg_songs') {
        task = applySimilarArtistOutcome(task, action, { kind: 'kg_songs' }, input.now, policy)
        if (task.stage == 'done') {
          finishTask(cache, task, input.now, policy.cacheLimit)
          task = null
        } else {
          cache.pending[task.seedArtist] = task
        }
      }
      break
    }
  }

  if (!task && remaining > 0 && policy.songFetchesPerRun > 0) {
    const seedArtist = pickCachedSimilarArtistRecord(cache, input.now, policy.cacheReuseCooldownMs)
    if (seedArtist) {
      const cached = cache.byArtist[seedArtist]
      const plan = planCachedSongFetches(cached, Math.min(policy.songFetchesPerRun, remaining))
      cached.nextIndex = plan.nextIndex
      cached.songsFetchedAt = input.now
      for (const artistName of plan.names) {
        if (remaining <= 0) break
        remaining -= 1
        requests += 1
        try {
          const tracks = await io.kgSongs(artistName)
          songs.push({ seedArtist, artistName, tracks })
        } catch {
          reasons.push('similar_artist_kg_songs_failed')
        }
      }
    }
  }

  return { cache, songs, requests, reasons, nextSeedCursor: seedCursor }
}
