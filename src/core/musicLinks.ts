import { createAlbumListId } from '../utils/musicSdk/albumNormalizers.ts'
import type { ListInfoItem } from '@/store/songlist/state'

// 纯函数：不得引入 request/config/store 运行时依赖，测试会直接 import 本模块

const ARTIST_SEPARATOR = /[、;；|／]|\s+\/\s+/

const splitAmpersand = (part: string): string[] => {
  // 只拆没有空格的 &（周杰伦&言承旭），保留 Simon & Garfunkel 这类组合名
  return /\s/.test(part) ? [part] : part.split('&')
}

export const splitArtistNames = (singer: string): string[] => {
  if (!singer) return []
  return singer
    .split(ARTIST_SEPARATOR)
    .flatMap(splitAmpersand)
    .map(name => name.trim())
    .filter(Boolean)
}

export const getArtistSearchName = (singer: string): string | null => {
  return splitArtistNames(singer)[0] ?? null
}

export const normalizeArtistName = (name: string): string => {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

export const pickExactArtistMatch = <T extends { name: string }>(
  list: readonly T[],
  name: string,
): T | null => {
  const target = normalizeArtistName(name)
  if (!target) return null
  return list.find(item => normalizeArtistName(item.name) == target) ?? null
}

export const getMusicAlbumListInfo = (music: LX.Music.MusicInfo): ListInfoItem | null => {
  if (music.source == 'local') return null
  const rawAlbumId = music.meta.albumId
  if (rawAlbumId == null || rawAlbumId === '' || String(rawAlbumId) == '0') return null
  return {
    id: createAlbumListId(rawAlbumId),
    name: music.meta.albumName || '',
    author: music.singer,
    img: music.meta.picUrl ?? '',
    source: music.source,
  }
}
