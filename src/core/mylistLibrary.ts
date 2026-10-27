import { createAlbumListId } from '../utils/musicSdk/albumNormalizers.ts'
import { splitArtistNames } from './musicLinks.ts'

// 纯函数：不得引入 request/config/store，测试会直接 import 本模块

export interface LikedAlbumGroup {
  key: string
  id: string
  name: string
  author: string
  source: LX.OnlineSource
  cover: string
  count: number
}

export interface LikedArtistGroup {
  key: string
  name: string
  count: number
  sources: LX.OnlineSource[]
}

const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0

const hasAlbumId = (albumId: unknown): boolean => {
  return albumId != null && albumId !== '' && String(albumId) != '0'
}

export const groupLikedAlbums = (list: readonly LX.Music.MusicInfo[]): LikedAlbumGroup[] => {
  const groups = new Map<string, LikedAlbumGroup>()
  for (const music of list) {
    if (music.source == 'local') continue
    const rawAlbumId = music.meta.albumId
    if (!hasAlbumId(rawAlbumId)) continue
    const albumId = String(rawAlbumId)
    const key = `${music.source}__${albumId}`
    const current = groups.get(key)
    if (current) {
      current.count++
      if (!current.cover && music.meta.picUrl) current.cover = music.meta.picUrl
      continue
    }
    groups.set(key, {
      key,
      id: createAlbumListId(albumId),
      name: music.meta.albumName || '',
      author: music.singer,
      source: music.source,
      cover: music.meta.picUrl ?? '',
      count: 1,
    })
  }
  return Array.from(groups.values()).sort((a, b) => b.count - a.count || compareText(a.key, b.key))
}

export const groupLikedArtists = (list: readonly LX.Music.MusicInfo[]): LikedArtistGroup[] => {
  const groups = new Map<string, { name: string, count: number, sourceCounts: Map<string, number> }>()
  for (const music of list) {
    if (music.source == 'local') continue
    const names = new Set(splitArtistNames(music.singer))
    for (const name of names) {
      let group = groups.get(name)
      if (!group) {
        group = { name, count: 0, sourceCounts: new Map() }
        groups.set(name, group)
      }
      group.count++
      group.sourceCounts.set(music.source, (group.sourceCounts.get(music.source) ?? 0) + 1)
    }
  }
  return Array.from(groups.values()).map(group => ({
    key: group.name,
    name: group.name,
    count: group.count,
    sources: Array.from(group.sourceCounts.entries())
      .sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))
      .map(([source]) => source as LX.OnlineSource),
  })).sort((a, b) => b.count - a.count || compareText(a.key, b.key))
}
