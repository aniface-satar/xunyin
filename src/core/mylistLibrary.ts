import { isAlbumListId } from '../utils/musicSdk/albumNormalizers.ts'

// 纯函数：不得引入 request/config/store，测试会直接 import 本模块

export type LikedAlbumList = LX.List.UserListInfo & {
  isLove: true
  source: LX.OnlineSource
  sourceListId: string
}

export type LikedNetworkPlaylist = LX.List.UserListInfo & {
  isLove: true
  source: LX.OnlineSource
  sourceListId: string
}

export interface LikedAlbumMeta {
  count: number
  cover: string
  author: string
}

export interface LikedAlbumRow {
  key: string
  listId: string
  id: string
  name: string
  author: string
  source: LX.OnlineSource
  cover: string
  count: number
}

const hasSourceList = (list: LX.List.UserListInfo): list is LX.List.UserListInfo & {
  source: LX.OnlineSource
  sourceListId: string
} => {
  return !!list.isLove && !!list.source && !!list.sourceListId
}

export const isLikedAlbumList = (list: LX.List.UserListInfo): list is LikedAlbumList => {
  return hasSourceList(list) && isAlbumListId(list.sourceListId)
}

export const isLikedNetworkPlaylist = (list: LX.List.UserListInfo): list is LikedNetworkPlaylist => {
  return hasSourceList(list) && !isAlbumListId(list.sourceListId)
}

export const buildLikedAlbumRows = (
  lists: readonly LX.List.UserListInfo[],
  metas: Readonly<Record<string, LikedAlbumMeta>>,
): LikedAlbumRow[] => {
  const rows: LikedAlbumRow[] = []
  for (const list of lists) {
    if (!isLikedAlbumList(list)) continue
    const meta = metas[list.id]
    rows.push({
      key: list.id,
      listId: list.id,
      id: list.sourceListId,
      name: list.name,
      author: meta?.author ?? '',
      source: list.source,
      cover: meta?.cover ?? '',
      count: meta?.count ?? 0,
    })
  }
  return rows
}
