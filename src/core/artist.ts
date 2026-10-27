import { deduplicationList, toNewMusicInfo } from '@/utils'
import musicSdk from '@/utils/musicSdk'
import { createAlbumListId, type AlbumSearchItem } from '@/utils/musicSdk/albumNormalizers'
import {
  mergeArtistDetail,
  type ArtistDetail,
  type ArtistSearchItem,
  type ArtistSongSort,
  type ArtistSource,
} from '@/utils/musicSdk/artistNormalizers'

export interface ArtistSongsPage {
  list: LX.Music.MusicInfoOnline[]
  total: number
  hasMore: boolean
}

export interface ArtistAlbumsPage {
  list: AlbumSearchItem[]
  total: number
  hasMore: boolean
}

export const getArtistDetail = async(source: ArtistSource, item: ArtistSearchItem): Promise<ArtistDetail> => {
  const detail = await musicSdk[source].artist.getDetail(item.id) as ArtistDetail
  return mergeArtistDetail(item, detail)
}

export const getArtistSongs = async(source: ArtistSource, id: string, page = 1, limit = 30, sort: ArtistSongSort = 'hot'): Promise<ArtistSongsPage> => {
  const result = await musicSdk[source].artist.getSongs(id, page, limit, sort) as ArtistSongsPage
  return {
    ...result,
    list: deduplicationList(result.list.map(item => toNewMusicInfo(item))) as LX.Music.MusicInfoOnline[],
  }
}

export const getArtistAlbums = async(source: ArtistSource, id: string, page = 1, limit = 30): Promise<ArtistAlbumsPage> => {
  const result = await musicSdk[source].artist.getAlbums(id, page, limit) as ArtistAlbumsPage
  return {
    ...result,
    list: result.list.map(item => ({ ...item, id: createAlbumListId(item.id) })),
  }
}
