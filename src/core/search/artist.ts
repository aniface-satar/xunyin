import searchArtistState, { type Source, type ArtistSearchItem } from '@/store/search/artist/state'
import searchArtistActions, { type SearchResult } from '@/store/search/artist/action'
import musicSdk from '@/utils/musicSdk'

export const setSource: typeof searchArtistActions['setSource'] = (source) => {
  searchArtistActions.setSource(source)
}
export const setSearchText: typeof searchArtistActions['setSearchText'] = (text) => {
  searchArtistActions.setSearchText(text)
}
const setListInfo: typeof searchArtistActions.setListInfo = (result, page, text) => {
  return searchArtistActions.setListInfo(result, page, text)
}

export const clearListInfo: typeof searchArtistActions['clearListInfo'] = (source) => {
  searchArtistActions.clearListInfo(source)
}

export const search = async(text: string, page: number, sourceId: Source): Promise<ArtistSearchItem[]> => {
  const listInfo = searchArtistState.listInfos[sourceId]!
  const key = `${page}__${sourceId}__${text}`
  if (listInfo.key == key && listInfo.list.length) return listInfo.list
  if (sourceId == 'all') {
    listInfo.key = key
    let task = []
    for (const source of searchArtistState.sources) {
      if (source == 'all' || (page > 1 && page > (searchArtistState.maxPages[source]!))) continue
      task.push(((musicSdk[source]?.artist?.search(text, page, searchArtistState.listInfos.all.limit) as Promise<SearchResult>) ?? Promise.reject(new Error('source not found: ' + source))).catch((error: any) => {
        console.log(error)
        return {
          list: [],
          total: 0,
          limit: searchArtistState.listInfos.all.limit,
          source,
        }
      }))
    }
    return Promise.all(task).then((results: SearchResult[]) => {
      if (key != listInfo.key) return []
      setSearchText(text)
      setSource(sourceId)
      return setListInfo(results, page, text)
    })
  } else {
    if (listInfo?.key == key && listInfo?.list.length) return listInfo?.list
    listInfo.key = key
    return ((musicSdk[sourceId]?.artist?.search(text, page, listInfo.limit) as Promise<SearchResult>).then((data: SearchResult) => {
      if (key != listInfo.key) return []
      return setListInfo(data, page, text)
    }) ?? Promise.reject(new Error('source not found: ' + sourceId))).catch((err: any) => {
      if (listInfo.list.length && page == 1) clearListInfo(sourceId)
      throw err
    })
  }
}
