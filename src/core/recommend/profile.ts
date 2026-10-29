import { recommendationConfig } from './config.ts'
import { buildTrackKey, exactPairKey, getArtistKeys, getPrimaryArtist, normalizeArtistKey, normalizeText } from './trackKey.ts'
import { computeCoOccurrence, computePlaylistAffinity } from './similarity.ts'
import type { InterestDirection, LikedArtistSeed, ProfileSeedTrack, RadioProfile, SessionPreference, TrackPreference } from './types.ts'

export { computeCoOccurrence, computePlaylistAffinity }

export interface ProfilePlaylistInput {
  id: string
  name?: string
  tracks: readonly LX.Music.MusicInfo[]
}

export interface ProfileHistoryInput {
  musicInfo: LX.Music.MusicInfo
  playTime?: number
}

export interface BuildRadioProfileInput {
  loveTracks: readonly LX.Music.MusicInfo[]
  playlists: readonly ProfilePlaylistInput[]
  trackPrefs: Record<string, TrackPreference>
  history?: readonly ProfileHistoryInput[]
  session?: SessionPreference
  /** 歌手页显式收藏的歌手：只做相似歌手/专辑扩展的种子，不参与 topArtists。 */
  likedArtists?: readonly LikedArtistSeed[]
  now?: number
  maxSeeds?: number
  maxSeedsPerArtist?: number
  maxSeedsPerDirection?: number
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

/**
 * 方向级会话热度：会话内近期播放记录按 trackKey 归属到本方向。
 * 不能用 session.recentPlaylistScores —— 那里的 key 是外部网络歌单 id，与本地方向 id 不同源。
 */
const directionSessionScore = (
  tracks: readonly LX.Music.MusicInfo[],
  session?: SessionPreference,
): number => {
  if (!session?.recentTracks.length) return 0
  const keys = new Set(tracks.map(musicInfo => buildTrackKey(musicInfo)))
  let score = 0
  for (const item of session.recentTracks) {
    if (!keys.has(item.trackKey)) continue
    if (item.liked === true || (item.listenRatio ?? 0) >= 0.8) score += 1
    else if ((item.listenRatio ?? 1) < 0.15) score -= 1
  }
  return score
}

const recentFactor = (lastTime: number | undefined, now: number, halfLifeDays: number, floor = 0.25) => {
  if (!lastTime) return floor
  const days = Math.max(0, now - lastTime) / 86400000
  return Math.max(floor, Math.pow(0.5, days / halfLifeDays))
}

const scoreTrackLongTerm = (
  musicInfo: LX.Music.MusicInfo,
  trackKey: string,
  pref: TrackPreference | undefined,
  fromLove: boolean,
  fromUserPlaylist: boolean,
  now: number,
): { longTermScore: number, fromLike: boolean, fromAddToPlaylist: boolean, fromPassiveComplete: boolean } => {
  const weights = recommendationConfig.profile.weights
  const explicitLike = fromLove || (pref?.likeCount ?? 0) > 0
  const addToPlaylist = fromUserPlaylist || (pref?.addToPlaylistCount ?? 0) > 0
  const passiveComplete = (pref?.completeCount ?? 0) > 0 || ((pref?.averageListenRatio ?? 0) >= 0.8 && (pref?.playCount ?? 0) > 0)

  let score = 0
  if (explicitLike) score += weights.like
  else if (addToPlaylist) score += weights.addToPlaylist
  else if (passiveComplete) score += weights.complete
  else if ((pref?.playCount ?? 0) > 0) score += weights.passivePlay

  if ((pref?.repeatCount ?? 0) > 0) {
    score += weights.repeat * Math.min(pref!.repeatCount, 3) * recentFactor(pref?.lastPositiveTime, now, 120)
  }
  if ((pref?.earlySkipCount ?? 0) > 0) score -= Math.min(pref!.earlySkipCount, 4) * 0.3

  const decay = explicitLike
    ? recentFactor(pref?.lastPositiveTime, now, 365, 0.6)
    : recentFactor(pref?.lastPlayTime ?? pref?.lastPositiveTime, now, 90, 0.2)
  score *= decay

  return {
    longTermScore: clamp01(score / weights.like),
    fromLike: explicitLike,
    fromAddToPlaylist: addToPlaylist,
    fromPassiveComplete: passiveComplete,
  }
}

const scoreTrackSession = (
  trackKey: string,
  directionSessionScore: number,
  session?: SessionPreference,
) => {
  if (!session) return 0.5
  let direct = 0
  for (const item of session.recentTracks) {
    if (item.trackKey != trackKey) continue
    if (item.liked === true || (item.listenRatio ?? 0) >= 0.8) direct += 0.5
    else if ((item.listenRatio ?? 1) < 0.15) direct -= 0.3
    else direct += 0.05
  }
  const direction = Math.max(-1, Math.min(1, directionSessionScore / 3))
  return clamp01(0.5 + Math.max(-0.45, Math.min(0.45, direct * 0.25)) * 0.6 + direction * 0.4)
}

/** 只有"最近听过"方向随时间失效；我喜欢与自建歌单是长期选择，不因久未听而降权。 */
const directionRecency = (
  direction: InterestDirection,
  trackPrefs: Record<string, TrackPreference>,
  now: number,
): number => {
  if (direction.kind != 'track') return 1
  if (!direction.tracks.length) return 1
  const halfLife = recommendationConfig.profile.recentListenHalfLifeDays
  const total = direction.tracks.reduce((sum, track) => sum + recentFactor(trackPrefs[track.trackKey]?.lastPlayTime, now, halfLife), 0)
  return total / direction.tracks.length
}

interface DirectionTrack {
  trackKey: string
  musicInfo: LX.Music.MusicInfo
  longTermScore: number
  sessionScore: number
  score: number
  artistKeys: string[]
  primaryArtist: string
  fromLike: boolean
  fromAddToPlaylist: boolean
  fromPassiveComplete: boolean
}

const buildDirectionTracks = (
  tracks: readonly LX.Music.MusicInfo[],
  directionId: string,
  options: {
    fromLove: boolean
    fromUserPlaylist: boolean
    trackPrefs: Record<string, TrackPreference>
    session?: SessionPreference
    directionSessionScore: number
    now: number
  },
): DirectionTrack[] => {
  const seen = new Set<string>()
  const result: DirectionTrack[] = []
  for (const musicInfo of tracks) {
    const trackKey = buildTrackKey(musicInfo)
    if (seen.has(trackKey)) continue
    seen.add(trackKey)
    const pref = options.trackPrefs[trackKey]
    const long = scoreTrackLongTerm(
      musicInfo,
      trackKey,
      pref,
      options.fromLove || (pref?.likeCount ?? 0) > 0,
      options.fromUserPlaylist,
      options.now,
    )
    const sessionScore = scoreTrackSession(trackKey, options.directionSessionScore, options.session)
    const score = recommendationConfig.profile.longTermWeight * long.longTermScore +
      recommendationConfig.profile.sessionWeight * sessionScore
    result.push({
      trackKey,
      musicInfo,
      longTermScore: long.longTermScore,
      sessionScore,
      score: clamp01(score),
      artistKeys: getArtistKeys(musicInfo.singer),
      primaryArtist: getPrimaryArtist(musicInfo),
      fromLike: long.fromLike,
      fromAddToPlaylist: long.fromAddToPlaylist,
      fromPassiveComplete: long.fromPassiveComplete,
    })
  }
  return result
}

function toProfileSeeds(tracks: DirectionTrack[], directionId: string): ProfileSeedTrack[] {
  return tracks.map(track => ({
    trackKey: track.trackKey,
    musicInfo: track.musicInfo,
    artistKeys: track.artistKeys,
    primaryArtist: track.primaryArtist,
    longTermScore: track.longTermScore,
    sessionScore: track.sessionScore,
    score: track.score,
    directionId,
    fromLike: track.fromLike,
    fromAddToPlaylist: track.fromAddToPlaylist,
    fromPassiveComplete: track.fromPassiveComplete,
  }))
}

function collectArtistKeys(tracks: DirectionTrack[]): string[] {
  const set = new Set<string>()
  for (const track of tracks) {
    for (const artist of track.artistKeys) set.add(artist)
  }
  return [...set]
}

const buildDirections = (input: BuildRadioProfileInput, now: number): InterestDirection[] => {
  const directions: InterestDirection[] = []
  const session = input.session

  const loveTracks = buildDirectionTracks(input.loveTracks, 'love', {
    fromLove: true,
    fromUserPlaylist: false,
    trackPrefs: input.trackPrefs,
    session,
    directionSessionScore: directionSessionScore(input.loveTracks, session),
    now,
  })
  if (loveTracks.length) {
    directions.push({
      directionId: 'love',
      kind: 'love',
      name: 'love',
      tracks: toProfileSeeds(loveTracks, 'love'),
      weight: 0,
      artistKeys: collectArtistKeys(loveTracks),
    })
  }

  for (const playlist of input.playlists) {
    const directionId = `playlist:${playlist.id}`
    const tracks = buildDirectionTracks(playlist.tracks, directionId, {
      fromLove: false,
      fromUserPlaylist: true,
      trackPrefs: input.trackPrefs,
      session,
      directionSessionScore: directionSessionScore(playlist.tracks, session),
      now,
    })
    if (!tracks.length) continue
    directions.push({
      directionId,
      kind: 'playlist',
      name: playlist.name,
      playlistId: playlist.id,
      tracks: toProfileSeeds(tracks, directionId),
      weight: 0,
      artistKeys: collectArtistKeys(tracks),
    })
  }

  const knownKeys = new Set(directions.flatMap(direction => direction.tracks.map(track => track.trackKey)))
  for (const item of input.history ?? []) {
    const trackKey = buildTrackKey(item.musicInfo)
    if (knownKeys.has(trackKey)) continue
    const pref = input.trackPrefs[trackKey]
    if (!pref) continue
    const strong = pref.likeCount > 0 || pref.addToPlaylistCount > 0 || pref.completeCount > 0 || pref.repeatCount > 0
    if (!strong) continue
    const built = buildDirectionTracks([item.musicInfo], `track:${trackKey}`, {
      fromLove: (pref.likeCount ?? 0) > 0,
      fromUserPlaylist: false,
      trackPrefs: input.trackPrefs,
      session,
      directionSessionScore: 0,
      now,
    })
    if (!built.length) continue
    knownKeys.add(trackKey)
    directions.push({
      directionId: `track:${trackKey}`,
      kind: 'track',
      tracks: toProfileSeeds(built, `track:${trackKey}`),
      weight: 0,
      artistKeys: collectArtistKeys(built),
    })
  }

  const priors = recommendationConfig.profile.directionPrior
  for (const direction of directions) {
    const sum = direction.tracks.reduce((total, track) => total + track.score, 0)
    const average = direction.tracks.length ? sum / direction.tracks.length : 0
    direction.weight = Math.sqrt(Math.max(0.05, average)) * priors[direction.kind] * directionRecency(direction, input.trackPrefs, now)
  }
  const weightSum = directions.reduce((total, direction) => total + direction.weight, 0) || 1
  for (const direction of directions) direction.weight = direction.weight / weightSum
  return directions
}

const weightedSort = (tracks: ProfileSeedTrack[]) => {
  return [...tracks].sort((a, b) => {
    if (b.score != a.score) return b.score - a.score
    if (a.fromLike != b.fromLike) return a.fromLike ? -1 : 1
    if (a.fromAddToPlaylist != b.fromAddToPlaylist) return a.fromAddToPlaylist ? -1 : 1
    return a.trackKey.localeCompare(b.trackKey)
  })
}

/**
 * 分层抽取代表歌曲：按方向轮流取样，单歌手最多 3 首，避免大歌单/大歌手支配画像。
 */
export const selectProfileSeeds = (
  directions: InterestDirection[],
  maxSeeds = recommendationConfig.profile.maxSeeds,
  maxPerArtist = recommendationConfig.profile.maxSeedsPerArtist,
  maxPerDirection = recommendationConfig.profile.maxSeedsPerDirection,
): ProfileSeedTrack[] => {
  const seeds: ProfileSeedTrack[] = []
  const artistCounts: Record<string, number> = {}
  const directionCounts: Record<string, number> = {}
  const pools = directions
    .map(direction => ({ direction, queue: weightedSort(direction.tracks) }))
    .sort((a, b) => b.direction.weight - a.direction.weight)

  const canTake = (track: ProfileSeedTrack, directionId: string, includePassive: boolean) => {
    // 每方向严格限额：大歌单最多贡献 maxPerDirection 首，不得挤占其它方向的 seed 名额
    if (seeds.length >= maxSeeds) return false
    if ((directionCounts[directionId] ?? 0) >= maxPerDirection) return false
    const exceededArtist = track.artistKeys.some(artist => (artistCounts[artist] ?? 0) >= maxPerArtist)
    if (exceededArtist) return false
    if (!includePassive && !track.fromLike && !track.fromAddToPlaylist && track.longTermScore < 0.15) return false
    return true
  }

  const takeFromQueue = (entry: { direction: InterestDirection, queue: ProfileSeedTrack[] }, includePassive: boolean) => {
    for (let index = 0; index < entry.queue.length; index++) {
      const track = entry.queue[index]
      if (!canTake(track, entry.direction.directionId, includePassive)) continue
      entry.queue.splice(index, 1)
      seeds.push(track)
      directionCounts[entry.direction.directionId] = (directionCounts[entry.direction.directionId] ?? 0) + 1
      for (const artist of track.artistKeys) artistCounts[artist] = (artistCounts[artist] ?? 0) + 1
      return true
    }
    return false
  }

  let progressed = true
  while (seeds.length < maxSeeds && progressed) {
    progressed = false
    for (const entry of pools) {
      if (takeFromQueue(entry, false)) progressed = true
      if (seeds.length >= maxSeeds) break
    }
  }

  progressed = true
  while (seeds.length < maxSeeds && progressed) {
    progressed = false
    for (const entry of pools) {
      if ((directionCounts[entry.direction.directionId] ?? 0) >= maxPerDirection) continue
      if (takeFromQueue(entry, true)) progressed = true
      if (seeds.length >= maxSeeds) break
    }
  }

  return seeds
}

const buildTopArtists = (directions: InterestDirection[]): Array<{ artist: string, weight: number }> => {
  const weights: Record<string, number> = {}
  for (const direction of directions) {
    const perTrack = direction.weight / Math.max(direction.tracks.length, 1)
    for (const track of direction.tracks) {
      for (const artist of track.artistKeys) {
        weights[artist] = (weights[artist] ?? 0) + perTrack * (0.5 + track.score)
      }
    }
  }
  return Object.entries(weights)
    .map(([artist, weight]) => ({ artist, weight }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 20)
}

const normalizeLikedArtists = (list: readonly LikedArtistSeed[] | undefined): LikedArtistSeed[] => {
  if (!list?.length) return []
  const seen = new Set<string>()
  const result: LikedArtistSeed[] = []
  for (const item of list) {
    const name = String(item.name ?? '').trim()
    const key = normalizeText(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push({ name, source: item.source, id: item.id })
  }
  return result
}

export const buildRadioProfile = (input: BuildRadioProfileInput): RadioProfile => {
  const now = input.now ?? Date.now()
  const directions = buildDirections(input, now)
  const seeds = selectProfileSeeds(
    directions,
    input.maxSeeds ?? recommendationConfig.profile.maxSeeds,
    input.maxSeedsPerArtist ?? recommendationConfig.profile.maxSeedsPerArtist,
    input.maxSeedsPerDirection ?? recommendationConfig.profile.maxSeedsPerDirection,
  )
  return {
    directions,
    seeds,
    seedKeys: new Set(seeds.map(seed => seed.trackKey)),
    topArtists: buildTopArtists(directions),
    likedArtists: normalizeLikedArtists(input.likedArtists),
    updatedAt: now,
  }
}

/**
 * 相似歌手通道的种子：显式收藏的歌手优先（不依赖听歌历史），再用画像歌手按权重补齐。
 * 用归一化名字去重；屏蔽歌手在进入 MB 检索前就剔除。
 */
export const buildSimilarArtistSeeds = (
  profile: Pick<RadioProfile, 'likedArtists' | 'topArtists'>,
  blockedNames: ReadonlySet<string> = new Set(),
  limit = 50,
): string[] => {
  const seen = new Set<string>()
  const seeds: string[] = []
  const push = (name: string) => {
    const key = normalizeText(name)
    if (!key || seen.has(key) || blockedNames.has(key)) return
    seen.add(key)
    seeds.push(name)
  }
  for (const item of profile.likedArtists ?? []) push(item.name)
  for (const item of profile.topArtists) push(item.artist)
  return seeds.slice(0, limit)
}

/**
 * 歌手热门歌直采目标：与收藏歌手同名的画像歌手不在这里花请求——
 * 用户明确喜欢该歌手时，默认其作品大多已听过，请求应留给相似歌手/专辑。
 */
export const selectArtistHitTargets = (
  profile: RadioProfile,
  rotation: number,
  blockedNames: ReadonlySet<string>,
  count: number,
): Array<{ artist: string, weight: number }> => {
  if (count <= 0) return []
  const topWeight = profile.topArtists[0]?.weight ?? 0
  const likedKeys = new Set((profile.likedArtists ?? []).map(item => normalizeText(item.name)))
  const strong = profile.topArtists.filter(item =>
    item.weight >= topWeight * recommendationConfig.profile.coldStart.strongArtistWeightRatio &&
    item.weight > 0 &&
    !blockedNames.has(item.artist) &&
    !likedKeys.has(item.artist),
  )
  if (!strong.length) return []
  const start = Math.abs(rotation) % strong.length
  return Array.from({ length: Math.min(count, strong.length) },
    (_, index) => strong[(start + index) % strong.length])
}

/**
 * 发现关键词优先级：强歌手 > 按权重排序的自建歌单名 > 代表歌曲 > 学到的风格词。
 * 歌手名搜到的是歌手向歌单，最能体现画像；歌单名搜到的是同主题歌单；
 * 词面学习验证过的风格词（如常被听完的"爵士/国风"）排最后兜底，不挤占画像主关键词。
 */
export const buildPlaylistKeywords = (
  profile: RadioProfile,
  limit = 8,
  learnedTokens: readonly string[] = [],
  excludedArtists: readonly string[] = [],
): string[] => {
  const keywords: string[] = []
  const excluded = new Set(excludedArtists.map(artist => normalizeText(artist)).filter(Boolean))
  const add = (value: string | undefined) => {
    const normalized = normalizeText(value)
    if (!normalized || excluded.has(normalized)) return
    if (!keywords.includes(normalized)) keywords.push(normalized)
  }
  const topWeight = profile.topArtists[0]?.weight ?? 0
  for (const artist of profile.topArtists) {
    if (artist.weight < topWeight * recommendationConfig.profile.coldStart.strongArtistWeightRatio) break
    add(artist.artist)
  }
  for (const direction of [...profile.directions].sort((a, b) => b.weight - a.weight)) {
    if (direction.kind == 'playlist' && direction.name) add(direction.name)
  }
  for (const seed of profile.seeds) {
    if (keywords.length >= limit) break
    add(seed.primaryArtist)
    add(seed.musicInfo.name)
  }
  for (const token of learnedTokens) {
    if (keywords.length >= limit) break
    add(token)
  }
  return keywords.slice(0, limit)
}

export const normalizeForLog = (text: string) => normalizeText(text)
export const normalizeArtistForLog = (artist: string) => normalizeArtistKey(artist)

/**
 * 榜单定向化：按画像关键词（含词面学习验证过的风格词）给榜单打分，
 * 命中最多的榜单优先——D 通道的撞新撞在听得懂的领域里。
 * 无命中或并列时按 rotation 轮换，保留探索性。
 */
export const pickChartBoard = <T extends { name?: string }>(
  boards: readonly T[],
  keywords: readonly string[],
  rotation = 0,
): T | undefined => {
  if (!boards.length) return undefined
  const scored = boards.map((board, index) => {
    const name = normalizeText(board.name)
    let score = 0
    for (const keyword of keywords) {
      if (keyword && name.includes(keyword)) score += 1
    }
    return { board, index, score }
  })
  const best = Math.max(...scored.map(item => item.score))
  if (best > 0) {
    const hits = scored.filter(item => item.score == best)
    return hits[rotation % hits.length].board
  }
  return scored[rotation % scored.length].board
}

export interface SimilarAlbumPick {
  seedArtist: string
  artistName: string
  albumId: string
  albumName: string
}

interface SimilarAlbumTrack {
  name: string
  singer?: string | null
  source?: string | null
  id?: string | number | null
  meta?: { albumId?: string | number | null, albumName?: string | null } | null
}

/**
 * 相似歌手的歌搜回来自带专辑信息：挑一张还有未入库曲目的专辑，再补一次详情取整张。
 * 整张都已入库的专辑视为用户已听过/已收藏，不再重复推荐。
 */
export const pickSimilarAlbum = (
  groups: ReadonlyArray<{ seedArtist: string, artistName: string, tracks: readonly SimilarAlbumTrack[] }>,
  libraryKeys: ReadonlySet<string>,
): SimilarAlbumPick | null => {
  const picks: Array<{ pick: SimilarAlbumPick, unheard: number, order: number }> = []
  let order = 0
  for (const group of groups) {
    const buckets = new Map<string, { pick: SimilarAlbumPick, unheard: number, order: number }>()
    for (const track of group.tracks) {
      const rawId = track.meta?.albumId
      const albumId = rawId == null ? '' : String(rawId)
      if (!albumId || albumId == '0') continue
      const existing = buckets.get(albumId)
      // 库里可能是别的音源的同一首：trackKey 不同，只能与 isExcluded 一样再按"歌名+歌手"判重
      const heard = libraryKeys.has(buildTrackKey(track as unknown as LX.Music.MusicInfo)) ||
        libraryKeys.has(exactPairKey(track.name, track.singer))
      const unheard = heard ? 0 : 1
      if (existing) {
        existing.unheard += unheard
        continue
      }
      buckets.set(albumId, {
        pick: {
          seedArtist: group.seedArtist,
          artistName: group.artistName,
          albumId,
          albumName: String(track.meta?.albumName ?? '').trim(),
        },
        unheard,
        order: order++,
      })
    }
    for (const bucket of buckets.values()) {
      if (bucket.unheard > 0) picks.push(bucket)
    }
  }
  picks.sort((a, b) => b.unheard - a.unheard || a.order - b.order)
  return picks[0]?.pick ?? null
}
