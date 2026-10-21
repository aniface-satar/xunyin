import { artistPriorFactor, type ArtistStatsMap } from './artistPrior.ts'
import { hasTrackLangField, QUOTA_LANG_BUCKETS } from './language.ts'
import type { LangBucket } from './language.ts'
import type { LangTargets } from './languageQuota.ts'
import { themeNetWeight } from './feedback.ts'
import type { DislikeRules } from './filter.ts'
import { normalizePlaylistKey } from './playlistIndex.ts'
import { nameTokenFactor, type TokenWeightMap } from './tokenFeedback.ts'
import { getArtistKeys, normalizeText } from './trackKey.ts'
import type { ChartSummary, SortSummary, TagSummary } from './sdkCatalog.ts'
import type { ThemePreference } from './types.ts'

/**
 * 推荐 tab 两个新区块（新歌速递 / 推荐歌单）的纯逻辑：只做"选哪张榜、怎么按画像排序"，
 * 不发请求、不碰电台队列，因此可以与引擎其余部分一样在 node 下直接测。
 */

const NEW_SONG_PATTERN = /新歌|新曲|新品|new/i
const RISING_PATTERN = /飙升|上升|热升|rise/i
const HOT_SORT_PATTERN = /最热|热歌|热门|popular|hot/i

/** 同组命中里取名字最短的一张：限定词越少越通用（新歌榜 > ACG新歌榜）。 */
const pickGeneral = (candidates: ChartSummary[]): ChartSummary | null => {
  let best: ChartSummary | null = null
  for (const board of candidates) {
    if (!best || board.name.length < best.name.length) best = board
  }
  return best
}

/** 榜单/分类定向化共用的关键词命中计数：名字里命中的画像词越多分越高。 */
const keywordHits = (keywords: readonly string[], name: string | null | undefined): number => {
  const normalized = normalizeText(name)
  if (!normalized) return 0
  let hits = 0
  for (const keyword of keywords) {
    if (keyword && normalized.includes(keyword)) hits += 1
  }
  return hits
}

/**
 * 挑一张真正代表"新歌"的榜单：新歌榜优先，其次飙升榜；
 * 都没有时返回 null，让调用方换源，而不是拿热歌榜冒充新歌。
 * 定向化与电台 D 通道同一配方：命中学到关键词最多的榜单优先，并列按轮次轮换；
 * 一个都没命中时保持"名字最短越通用"的规则，冷启动不飘到小众限定榜。
 */
export const pickNewSongBoard = (
  boards: readonly ChartSummary[],
  keywords: readonly string[] = [],
  rotation = 0,
): ChartSummary | null => {
  const fresh = boards.filter(board => NEW_SONG_PATTERN.test(board.name))
  const pool = fresh.length ? fresh : boards.filter(board => RISING_PATTERN.test(board.name))
  if (!pool.length) return null
  const scored = pool.map(board => ({ board, hits: keywordHits(keywords, board.name) }))
  const best = Math.max(...scored.map(item => item.hits))
  if (best > 0) {
    const hits = scored.filter(item => item.hits == best).map(item => item.board)
    return hits[Math.abs(rotation) % hits.length]
  }
  return pickGeneral(pool)
}

export interface ProfileFactorState {
  artistStats?: ArtistStatsMap
  tokenWeights?: TokenWeightMap
}

/** 歌手先验 × 歌名词面学习；都没有学过时恒为 1。 */
export const profileTrackFactor = (
  musicInfo: { name?: string | null, singer?: string | null },
  state: ProfileFactorState,
  now = Date.now(),
): number => {
  return artistPriorFactor(state.artistStats, getArtistKeys(musicInfo.singer), now) *
    nameTokenFactor(state.tokenWeights, musicInfo.name ?? undefined, now)
}

/**
 * 按画像因子给一批候选歌降序；因子相同的保持输入次序（榜单原名次），
 * 所以冷启动等于不过问，学出画像后才逐渐压过榜单惯性。
 */
export const rankTracksByProfile = <T extends { name?: string | null, singer?: string | null }>(
  tracks: readonly T[],
  state: ProfileFactorState,
  now = Date.now(),
): T[] => {
  const scored = tracks.map((item, index) => ({
    item,
    index,
    factor: profileTrackFactor(item, state, now),
  }))
  scored.sort((a, b) => b.factor - a.factor || a.index - b.index)
  return scored.map(entry => entry.item)
}

/** 歌单归因到歌手时的最短匹配：单字艺人名容易误伤标题。 */
const MIN_ARTIST_MATCH_LEN = 2

/**
 * 歌单没有歌手字段，用创建者 + 标题里出现过的"已学过歌手名"当归因键，
 * 这样《陈奕迅·港乐黄金年代》会跟着用户对陈奕迅的喜好一起升降。
 */
const playlistArtistKeys = (
  playlist: { name?: string | null, author?: string | null },
  artistStats: ArtistStatsMap | undefined,
): string[] => {
  const keys = [...getArtistKeys(playlist.author)]
  const title = normalizeText(playlist.name)
  if (title && artistStats) {
    for (const artist of Object.keys(artistStats)) {
      if (artist.length < MIN_ARTIST_MATCH_LEN) continue
      if (title.includes(artist)) keys.push(artist)
    }
  }
  return keys
}

/** 标题就是被踩雷的曲目、或标题/创建者里出现被拉黑的歌手：这张歌单不再推。 */
export const isPlaylistBlocked = (
  playlist: { name?: string | null, author?: string | null },
  blocked: DislikeRules,
): boolean => {
  const title = normalizeText(playlist.name)
  if (!title) return false
  if (blocked.musicNames.has(title)) return true
  const author = normalizeText(playlist.author)
  for (const artist of Array.from(blocked.singerNames)) {
    if (artist.length < MIN_ARTIST_MATCH_LEN) continue
    if (title.includes(artist) || author.includes(artist)) return true
  }
  return false
}

export interface PlaylistRankState extends ProfileFactorState {
  blocked?: DislikeRules | null
  /** 被「不感兴趣」隐藏的歌单（normalizePlaylistKey → 隐藏时间戳），直接从推荐列表剔除。 */
  hidden?: Record<string, number> | null
}

/**
 * 推荐歌单列表的个性化排序：先剔除踩雷过和被「不感兴趣」隐藏的歌单，
 * 再按"歌名词面 × 歌手先验"降序；因子相同保持音源热度原序，
 * 所以没学过任何口味时等于不过问。
 */
export const rankPlaylistsByProfile = <T extends { name?: string | null, author?: string | null, source?: string, id?: string | number }>(
  playlists: readonly T[],
  state: PlaylistRankState,
  now = Date.now(),
): T[] => {
  const blocked = state.blocked
  const hidden = state.hidden
  let candidates = blocked ? playlists.filter(playlist => !isPlaylistBlocked(playlist, blocked)) : [...playlists]
  if (hidden) {
    candidates = candidates.filter(playlist => {
      if (playlist.source == null || playlist.id == null) return true
      return !hidden[normalizePlaylistKey(playlist.source as LX.OnlineSource, playlist.id)]
    })
  }
  const scored = candidates.map((item, index) => ({
    item,
    index,
    factor: nameTokenFactor(state.tokenWeights, item.name ?? undefined, now) *
      artistPriorFactor(state.artistStats, playlistArtistKeys(item, state.artistStats), now),
  }))
  scored.sort((a, b) => b.factor - a.factor || a.index - b.index)
  return scored.map(entry => entry.item)
}

/** 刷新取样只在画像靠前的这一带里换，不会跳到画像垫底的候选。 */
const REFRESH_POOL_SPAN = 12

/**
 * 卡片一屏要显示的歌单：从排序结果前段随机截一段，
 * 让"刷新"真的换出一批内容，而不是把同一屏热度榜再摆一次。
 */
export const pickCardPlaylists = <T>(
  ranked: readonly T[],
  count: number,
  rnd: () => number = Math.random,
): T[] => {
  if (ranked.length <= count) return [...ranked]
  const pool = ranked.slice(0, Math.min(ranked.length, Math.max(count, REFRESH_POOL_SPAN)))
  const start = Math.floor(rnd() * (pool.length - count + 1))
  return pool.slice(start, start + count)
}

/**
 * 歌单分类目录按学习到的口味排序：正反馈分类在前（权重高者优先，关键词命中做并列裁决），
 * 没学过的分类按画像关键词亲和度排中间，被"不感兴趣"拖累过的分类沉底。
 * 语种/场景/心情等普通分组一并参与，不再只认官方组。
 */
export const rankPlaylistTags = (
  tags: readonly TagSummary[],
  themes: Record<string, ThemePreference>,
  keywords: readonly string[] = [],
  now = Date.now(),
): TagSummary[] => {
  const scored = tags.map((tag, index) => ({
    tag,
    index,
    net: themeNetWeight(themes, normalizeText(tag.name), now),
    affinity: keywordHits(keywords, tag.name),
  }))
  const liked = scored.filter(entry => entry.net > 0)
    .sort((a, b) => b.net - a.net || b.affinity - a.affinity || a.index - b.index)
  const unknown = scored.filter(entry => entry.net == 0)
    .sort((a, b) => b.affinity - a.affinity || a.index - b.index)
  const burned = scored.filter(entry => entry.net < 0)
    .sort((a, b) => b.net - a.net || a.index - b.index)
  return [...liked, ...unknown, ...burned].map(entry => entry.tag)
}

/**
 * 推荐歌单（tab 歌单区块）的分类挑选：4 轮里 3 轮在学习到正偏好的分类里轮换，
 * 1 轮放开到全目录轮换探索——语种/场景/心情等普通分组由此轮流登场，
 * 分类不再困在目录首位（官方组）里。冷启动没有正偏好分类时全程在全目录里按轮次游走。
 *
 * 注意：电台候选发现（candidate.ts 步骤 3）走的不是这条配方，它用 pickWeightedTag
 * 按学习权重抽样——那里要给语种硬配额补货，浏览位的等频轮转会过量抓华语分类。
 */
export const pickPlaylistTag = (
  tags: readonly TagSummary[],
  themes: Record<string, ThemePreference>,
  keywords: readonly string[] = [],
  rotation = 0,
  now = Date.now(),
): TagSummary | null => {
  if (!tags.length) return null
  const ranked = rankPlaylistTags(tags, themes, keywords, now)
  const preferred = ranked.filter(tag => themeNetWeight(themes, normalizeText(tag.name), now) > 0)
  const spin = Math.abs(rotation)
  return preferred.length && rotation % 4 != 3
    ? preferred[spin % preferred.length]
    : ranked[spin % ranked.length]
}

/** 歌单列表默认按最热取（封面齐全、质量稳），源没有最热档时退回目录首档。 */
export const pickPlaylistSort = (sorts: readonly SortSummary[]): SortSummary | null => {
  return sorts.find(sort => HOT_SORT_PATTERN.test(`${sort.name} ${sort.tid ?? ''}`)) ?? sorts[0] ?? null
}

/**
 * 语种桶 → 该源分类目录里的标签 id。
 * kg/tx 有逐曲语种字段（L1），桶召回抓回来的每首歌都带真语种，闭环最准；
 * kw/wy/mg 没有逐曲字段，但歌单按语种分类，候选能拿到 L2 的 langHint，同样能兑配额。
 * mg 的 `contentItemList[0]` 是空白占位模板，sdkCatalog 取列表时跳过它。
 */
export const LANG_BUCKET_TAGS: Partial<Record<LX.OnlineSource, Partial<Record<LangBucket, string>>>> = {
  kg: { zh: '84', yue: '19', en: '20', ja: '21', ko: '23', other: '24' },
  tx: { zh: '1', yue: '146', en: '3', ja: '5', ko: '4', other: '6' },
  kw: { zh: '37', yue: '13', en: '35', ja: '1091', ko: '1093', other: '12' },
  // wy 的 getList 直接拿分类名当 cat 参数，目录里 id 也是分类名
  wy: { zh: '华语', yue: '粤语', en: '欧美', ja: '日语', ko: '韩语' },
  mg: { zh: '1000001762', yue: '1000001763', en: '1000001766', ja: '1000001767', ko: '1000001599', other: '1003449724' },
}

/**
 * kw 的目录 tag id 形如 `37-10000`，getList 内部会拆成 id/type，
 * 但 getTagPlayList 的 `id` 参数只接受纯数字（带后缀报 param error）。
 * knownTagIds 比对与真正发请求都要用归一后的值。
 */
export const normalizeLangTagId = (source: LX.OnlineSource, tagId: string) => {
  return source == 'kw' ? tagId.split('-')[0] : tagId
}

/**
 * unknown 占比过高说明池里大量候选判不出语种，配额无法兑现。
 * 此时把有 L1 字段的源提到候选顺序最前（各自内部仍保持调用方的随机序，不总打同一个源），
 * 让桶召回抓回来的候选直接变成有标签的货。
 */
export const prioritizeL1LangSources = (
  sources: readonly LX.OnlineSource[],
  unknownShare: number,
  threshold: number,
): LX.OnlineSource[] => {
  if (!(unknownShare > threshold)) return [...sources]
  return [
    ...sources.filter(source => hasTrackLangField(source)),
    ...sources.filter(source => !hasTrackLangField(source)),
  ]
}

/**
 * 缺口驱动召回的规划：把"20 首窗口里的目标首数"按池规模等比放大成池内应有候选数，
 * 再跟池内实际计数相减，只留真正缺货的桶、按缺口降序取前几个。
 * knownTagIds 传该源实时分类目录时，不在目录里的标签 id 直接跳过（源改版后不浪费请求）。
 */
export const planLangBucketFetch = (options: {
  source: LX.OnlineSource
  targets: LangTargets
  poolCounts: Partial<Record<LangBucket, number>>
  poolSize: number
  windowSize: number
  maxBuckets: number
  knownTagIds?: ReadonlySet<string>
}): Array<{ bucket: LangBucket, tagId: string, deficit: number }> => {
  if (!options.targets.enforced) return []
  const tagIds = LANG_BUCKET_TAGS[options.source]
  if (!tagIds) return []
  const window = Math.max(1, Math.floor(options.windowSize))
  const scale = Math.max(1, Math.floor(options.poolSize)) / window
  const planned: Array<{ bucket: LangBucket, tagId: string, deficit: number }> = []
  for (const bucket of QUOTA_LANG_BUCKETS) {
    const target = options.targets.targets[bucket]
    const tagId = tagIds[bucket]
    if (target === undefined || !tagId) continue
    if (options.knownTagIds && !options.knownTagIds.has(tagId)) continue
    const deficit = Math.ceil(target * scale) - (options.poolCounts[bucket] ?? 0)
    if (deficit > 0) planned.push({ bucket, tagId, deficit })
  }
  planned.sort((a, b) => b.deficit - a.deficit)
  return planned.slice(0, Math.max(0, Math.floor(options.maxBuckets)))
}

/**
 * 分类轮换的加权抽样：概率正比于 exp(分类净权 / 温度)，取代旧的"每 4 轮留 1 轮全目录游走"等频轮转。
 * 等频轮转会让华语这类高权重分类只占 1/N 的出场机会，是召回侧过量抓华语的根因之一。
 * 没有任何正偏好分类时（冷启动）退回按轮次游走，保证不空转。
 * 注意是有意的取舍：一旦学到了正偏好分类，净权为 0（没被学过）的分类就不在这条轮子里出现了，
 * 旧写法的"1/4 轮全目录探索"没有保留。分类维度的多样性现在由两处提供——语种桶召回（candidate.ts 步骤 4.5）
 * 按缺口补货，推荐 tab 的歌单区块（pickPlaylistTag）仍守 1/4 探索轮。别把它当 bug 改回去。
 */
export const pickWeightedTag = (
  tags: readonly TagSummary[],
  themes: Record<string, ThemePreference>,
  options: { rotation?: number, temperature?: number, now?: number, rng?: () => number } = {},
): TagSummary | null => {
  if (!tags.length) return null
  const now = options.now ?? Date.now()
  const temperature = Math.max(0.0001, options.temperature ?? 1)
  const preferred = tags
    .map(tag => ({ tag, net: themeNetWeight(themes, normalizeText(tag.name), now) }))
    .filter(entry => entry.net > 0)
    .sort((a, b) => b.net - a.net)
  if (!preferred.length) return tags[Math.abs(Math.floor(options.rotation ?? 0)) % tags.length]
  // 必须减去最大净权再取 exp：`themeNetWeight` 是累加量、没有上界，直接 exp(net/温度) 在重度用户的
  // 画像上会溢出成 Infinity，减法全变 NaN、永远走不到 `roll <= 0`，最后静默返回权重最低的分类。
  // 这与 diversity.ts 的 softmaxSample 同一写法，但这里不 import 它——tabSections 不该依赖选曲器。
  const maxNet = preferred[0].net
  const weights = preferred.map(entry => Math.exp((entry.net - maxNet) / temperature))
  const rng = options.rng ?? Math.random
  let roll = rng() * weights.reduce((acc, weight) => acc + weight, 0)
  for (let i = 0; i < preferred.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return preferred[i].tag
  }
  return preferred[preferred.length - 1].tag
}
