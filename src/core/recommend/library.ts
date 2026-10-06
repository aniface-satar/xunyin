import { LIST_IDS } from '@/config/constant'
import { getListMusics, getUserLists, userLists } from '@/utils/listManage'
import { buildLibraryIndexData, type LibraryIndexData, type LibraryPlaylistInput } from './libraryIndex.ts'
import { buildTrackKey } from './trackKey.ts'

const SPECIAL_LIST_IDS = new Set<string>([
  LIST_IDS.LOVE,
  LIST_IDS.DEFAULT,
  LIST_IDS.TEMP,
  LIST_IDS.DOWNLOAD,
])

let libraryIndex: LibraryIndexData | null = null
let loadingPromise: Promise<LibraryIndexData> | null = null
let listenerRegistered = false

const registerInvalidation = () => {
  if (listenerRegistered) return
  listenerRegistered = true
  global.app_event.on('myListMusicUpdate', () => {
    libraryIndex = null
  })
  global.app_event.on('mylistUpdated', () => {
    libraryIndex = null
  })
}

export const getUserPlaylistIds = (): string[] => {
  return userLists
    .map(list => list.id)
    .filter(id => !SPECIAL_LIST_IDS.has(id) && !id.startsWith('download'))
}

export const getUserPlaylistInputs = async(): Promise<LibraryPlaylistInput[]> => {
  await getUserLists()
  const inputs: LibraryPlaylistInput[] = []
  const loveTracks = await getListMusics(LIST_IDS.LOVE)
  inputs.push({ id: LIST_IDS.LOVE, name: 'love', isLove: true, tracks: loveTracks })
  for (const list of userLists) {
    if (SPECIAL_LIST_IDS.has(list.id) || list.id.startsWith('download')) continue
    const tracks = await getListMusics(list.id)
    inputs.push({
      id: list.id,
      name: list.name,
      source: list.source,
      sourceListId: list.sourceListId,
      tracks,
    })
  }
  return inputs
}

/**
 * 构建完整收藏与自建歌单索引。
 * 必须遍历所有自建歌单，而不是只检查 allMusicList 中当前已加载的列表。
 */
export const ensureLibraryIndex = async(force = false): Promise<LibraryIndexData> => {
  registerInvalidation()
  if (!force && libraryIndex) return libraryIndex
  if (loadingPromise) return loadingPromise
  loadingPromise = getUserPlaylistInputs().then(inputs => {
    libraryIndex = buildLibraryIndexData(inputs)
    return libraryIndex
  }).finally(() => {
    loadingPromise = null
  })
  return loadingPromise
}

export const getLibraryIndex = (): LibraryIndexData | null => libraryIndex

export const buildLibraryKeySet = (): Set<string> => {
  return libraryIndex ? new Set(libraryIndex.keys) : new Set()
}

export const isLibraryTrack = (trackKey: string): boolean => {
  return libraryIndex?.keys.has(trackKey) ?? false
}

/** 这首本地歌来自哪些网络歌单（索引未就绪时为空）。 */
export const getLibraryTrackOrigins = (trackKey: string): string[] => {
  return libraryIndex?.entries.get(trackKey)?.origins ?? []
}

export const isDiscoveryTrack = (trackKey: string): boolean => {
  if (!libraryIndex) return true
  return !libraryIndex.keys.has(trackKey)
}

export const refreshLibraryIndex = async(): Promise<LibraryIndexData> => {
  return ensureLibraryIndex(true)
}

export const getLibraryPlaylistInputs = getUserPlaylistInputs
export { buildTrackKey }

