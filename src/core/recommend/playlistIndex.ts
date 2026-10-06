import { recommendationConfig } from './config.ts'
import { normalizeText } from './trackKey.ts'
import type { ObservedPlaylist } from './types.ts'

export interface PlaylistObservationInput {
  id: string
  source: LX.OnlineSource
  name?: string
  author?: string
  desc?: string
  category?: string
  playCount?: number | null
  totalTracks?: number
  tracks: readonly string[]
  pagesFetched?: number
  seedTrackKeys?: readonly string[]
  seedOverlap?: number
  weakThemeScore?: number
  fetchedAt?: number
}

export const computePlayCountNumber = (playCount: string | number | null | undefined): number | null => {
  if (playCount == null || playCount == '') return null
  const text = String(playCount).trim()
  const match = text.match(/^([\d.]+)\s*(万|亿)?/)
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value)) return null
  if (match[2] == '万') return Math.round(value * 10000)
  if (match[2] == '亿') return Math.round(value * 100000000)
  return Math.round(value)
}

export const computeWeakThemeScore = (
  meta: { name?: string, author?: string, desc?: string, category?: string },
  keywords: readonly string[],
) => {
  const text = normalizeText([meta.name, meta.author, meta.desc, meta.category].filter(Boolean).join(' '))
  if (!text || !keywords.length) return 0
  let hits = 0
  for (const keyword of keywords) {
    const normalized = normalizeText(keyword)
    if (normalized && text.includes(normalized)) hits += 1
  }
  return Math.min(1, hits / Math.max(1, Math.min(keywords.length, 4)))
}

export const upsertObservedPlaylist = (
  exist: ObservedPlaylist | undefined,
  input: PlaylistObservationInput,
  now = Date.now(),
): ObservedPlaylist => {
  const fetchedTracks = [...new Set(input.tracks)]
  const totalTracks = input.totalTracks ?? exist?.totalTracks
  const coverage = totalTracks && totalTracks > 0
    ? Math.max(0, Math.min(1, fetchedTracks.length / totalTracks))
    : 1
  const pagesFetched = input.pagesFetched ?? exist?.pagesFetched ?? (fetchedTracks.length ? 1 : 0)
  const confidence = coverage * (pagesFetched > 0 ? 1 : 0.2)
  const seedTrackKeys = [...new Set([...(input.seedTrackKeys ?? exist?.seedTrackKeys ?? [])])]
  const seedOverlap = input.seedOverlap ?? exist?.seedOverlap ?? seedTrackKeys.length
  return {
    id: input.id,
    source: input.source,
    name: input.name ?? exist?.name,
    author: input.author ?? exist?.author,
    desc: input.desc ?? exist?.desc,
    category: input.category ?? exist?.category,
    playCount: input.playCount ?? exist?.playCount ?? null,
    totalTracks,
    fetchedTracks: [...new Set([...(exist?.fetchedTracks ?? []), ...fetchedTracks])],
    pagesFetched,
    seedOverlap,
    seedTrackKeys,
    coverage,
    confidence,
    groupId: exist?.groupId,
    weakThemeScore: Math.max(input.weakThemeScore ?? 0, exist?.weakThemeScore ?? 0),
    firstSeenAt: exist?.firstSeenAt ?? now,
    lastFetchedAt: input.fetchedAt ?? now,
    confirmed: seedTrackKeys.length > 0 || (exist?.confirmed ?? false),
  }
}

/** 保留最近/最相关/确认含种子的歌单，控制在本地观察上限内。 */
export const selectPlaylistEvictions = (
  observed: readonly ObservedPlaylist[],
  limit = recommendationConfig.storage.playlistObservationLimit,
): string[] => {
  if (observed.length <= limit) return []
  const sorted = [...observed].sort((a, b) => {
    const scoreA = (a.confirmed ? 2 : 0) + a.seedOverlap + a.weakThemeScore + a.confidence
    const scoreB = (b.confirmed ? 2 : 0) + b.seedOverlap + b.weakThemeScore + b.confidence
    if (scoreA != scoreB) return scoreB - scoreA
    return (b.lastFetchedAt ?? 0) - (a.lastFetchedAt ?? 0)
  })
  return sorted.slice(limit).map(playlist => playlist.id)
}

export const normalizePlaylistKey = (source: LX.OnlineSource, id: string | number) => `${source}::${id}`

export const scoreObservedPlaylistLocally = (playlist: ObservedPlaylist) => {
  const playCountFactor = playlist.playCount == null
    ? 0.5
    : 1 / (1 + Math.log(1 + playlist.playCount / 100000))
  return playlist.seedOverlap * 2 + playlist.weakThemeScore + playlist.confidence * 0.5 + playCountFactor * 0.2
}
