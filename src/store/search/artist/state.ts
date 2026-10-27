import music from '@/utils/musicSdk'

import { type ArtistSearchItem } from '@/utils/musicSdk/artistNormalizers'
export type { ArtistSearchItem }

export interface SearchListInfo {
  page: number
  limit: number
  total: number
  list: ArtistSearchItem[]
  key: string | null
}

interface ListInfos extends Partial<Record<LX.OnlineSource, SearchListInfo>> {
  'all': SearchListInfo
}

export type Source = LX.OnlineSource | 'all'

export interface InitState {
  searchText: string
  source: Source
  sources: Source[]
  listInfos: ListInfos
  maxPages: Partial<Record<Source, number>>
}

const state: InitState = {
  searchText: '',
  source: 'kg',
  sources: [],
  listInfos: {
    all: {
      page: 1,
      limit: 15,
      total: 0,
      list: [],
      key: null,
    },
  },
  maxPages: {},
}

export const maxPages: Partial<Record<LX.OnlineSource, number>> = {}
for (const source of music.sources) {
  if (!music[source.id as LX.OnlineSource]?.artist?.search) continue
  state.sources.push(source.id as LX.OnlineSource)
  state.listInfos[source.id as LX.OnlineSource] = {
    page: 1,
    limit: 18,
    total: 0,
    list: [],
    key: null,
  }
  maxPages[source.id as LX.OnlineSource] = 0
}
state.sources.push('all')

export default state
