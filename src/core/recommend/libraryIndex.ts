import { buildTrackKey } from './trackKey.ts'
import { normalizePlaylistKey } from './playlistIndex.ts'

export interface LibraryPlaylistInput {
  id: string
  name?: string
  isLove?: boolean
  source?: LX.OnlineSource
  sourceListId?: string
  tracks: readonly LX.Music.MusicInfo[]
}

export interface LibraryEntry {
  trackKey: string
  musicInfo: LX.Music.MusicInfo
  listIds: string[]
  /** 包含本曲的自建歌单各自的网络来源歌单，用于"从网络歌单导入"的归因。 */
  origins: string[]
  isLove: boolean
}

/** 本地歌单指向的网络歌单键；非网络导入的自建歌单没有来源。 */
export const getPlaylistOriginKey = (playlist: Pick<LibraryPlaylistInput, 'source' | 'sourceListId'>): string | undefined => {
  if (!playlist.source || !playlist.sourceListId) return undefined
  return normalizePlaylistKey(playlist.source, playlist.sourceListId)
}

export interface LibraryIndexData {
  keys: Set<string>
  entries: Map<string, LibraryEntry>
  listSizes: Record<string, number>
  loveKeys: Set<string>
  totalTracks: number
  updatedAt: number
}

/**
 * 完整收藏 + 所有自建歌单歌曲索引。
 * 调用方必须先加载所有歌单（不能只传当前已加载的列表）。
 */
export const buildLibraryIndexData = (playlists: readonly LibraryPlaylistInput[]): LibraryIndexData => {
  const entries = new Map<string, LibraryEntry>()
  const keys = new Set<string>()
  const loveKeys = new Set<string>()
  const listSizes: Record<string, number> = {}

  for (const playlist of playlists) {
    listSizes[playlist.id] = playlist.tracks.length
    const origin = getPlaylistOriginKey(playlist)
    for (const musicInfo of playlist.tracks) {
      const trackKey = buildTrackKey(musicInfo)
      keys.add(trackKey)
      if (playlist.isLove) loveKeys.add(trackKey)
      const entry = entries.get(trackKey)
      if (entry) {
        if (!entry.listIds.includes(playlist.id)) entry.listIds.push(playlist.id)
        if (origin && !entry.origins.includes(origin)) entry.origins.push(origin)
        if (playlist.isLove) entry.isLove = true
      } else {
        entries.set(trackKey, {
          trackKey,
          musicInfo,
          listIds: [playlist.id],
          origins: origin ? [origin] : [],
          isLove: !!playlist.isLove,
        })
      }
    }
  }

  return { keys, entries, listSizes, loveKeys, totalTracks: entries.size, updatedAt: Date.now() }
}
