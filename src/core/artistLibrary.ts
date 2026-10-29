import type { ArtistSearchItem, ArtistSource } from '../utils/musicSdk/artistNormalizers.ts'

// 纯函数：不得引入 request/config/store，测试会直接 import 本模块

export interface LikedArtist {
  source: ArtistSource
  id: string
  name: string
  alias: string
  img: string
  likedAt: number
}

export type LikedArtistInput = Pick<LikedArtist, 'source' | 'id' | 'name'> & Partial<Pick<LikedArtist, 'alias' | 'img'>>

export const artistKey = (source: ArtistSource, id: string): string => `${source}__${id}`

export const isLikedArtist = (list: readonly LikedArtist[], source: ArtistSource, id: string): boolean => {
  return list.some(item => item.source == source && item.id == id)
}

export const addLikedArtist = (list: readonly LikedArtist[], input: LikedArtistInput, now = Date.now()): LikedArtist[] => {
  if (isLikedArtist(list, input.source, input.id)) return [...list]
  return [
    {
      source: input.source,
      id: input.id,
      name: input.name,
      alias: input.alias ?? '',
      img: input.img ?? '',
      likedAt: now,
    },
    ...list,
  ]
}

export const removeLikedArtist = (list: readonly LikedArtist[], source: ArtistSource, id: string): LikedArtist[] => {
  return list.filter(item => item.source != source || item.id != id)
}

export const toggleLikedArtist = (list: readonly LikedArtist[], input: LikedArtistInput, now = Date.now()): {
  list: LikedArtist[]
  liked: boolean
} => {
  if (isLikedArtist(list, input.source, input.id)) {
    return { list: removeLikedArtist(list, input.source, input.id), liked: false }
  }
  return { list: addLikedArtist(list, input, now), liked: true }
}

export const filterLikedArtists = (list: readonly LikedArtist[], keyword: string): LikedArtist[] => {
  const text = keyword.trim().toLowerCase()
  if (!text) return [...list]
  return list.filter(item => item.name.toLowerCase().includes(text) || item.alias.toLowerCase().includes(text))
}

export const toArtistSearchItem = (item: LikedArtist): ArtistSearchItem => ({
  id: item.id,
  name: item.name,
  alias: item.alias,
  img: item.img,
  songCount: '',
  albumCount: '',
  source: item.source,
})
