import { eapiRequest } from './utils/index'
import {
  ARTIST_SONG_SORT_PARAMS,
  hasMoreByTotal,
  normalizeWyArtistAlbums,
  normalizeWyArtistDetail,
  normalizeWyArtistSearch,
} from '../artistNormalizers'
import { normalizeWyAlbumSongs } from '../albumNormalizers'

const MAX_RETRY = 3

export default {
  search(text, page = 1, limit = 20, retryNum = 0) {
    if (retryNum > 3) return Promise.reject(new Error('try max num'))
    return eapiRequest('/api/cloudsearch/pc', {
      s: text,
      type: 100,
      limit,
      total: page == 1,
      offset: limit * (page - 1),
    }).promise.then(({ body }) => {
      if (!body || body.code !== 200) return this.search(text, page, limit, ++retryNum)
      return {
        ...normalizeWyArtistSearch(body),
        limit,
        source: 'wy',
      }
    })
  },
  getDetail(id, retryNum = 0) {
    return eapiRequest(`/api/v1/artist/${id}`, {}).promise.then(({ statusCode, body }) => {
      if (statusCode !== 200 || body?.code !== 200 || !body.artist) {
        if (retryNum < MAX_RETRY) return this.getDetail(id, ++retryNum)
        throw new Error('获取歌手信息失败')
      }
      return normalizeWyArtistDetail(body)
    })
  },
  getSongs(id, page = 1, limit = 30, sort = 'hot', retryNum = 0) {
    return eapiRequest('/api/v1/artist/songs', {
      id: Number(id),
      private_cloud: true,
      work_type: 1,
      order: ARTIST_SONG_SORT_PARAMS.wy[sort] ?? ARTIST_SONG_SORT_PARAMS.wy.hot,
      offset: (page - 1) * limit,
      limit,
    }).promise.then(({ statusCode, body }) => {
      if (statusCode !== 200 || body?.code !== 200 || !Array.isArray(body.songs)) {
        if (retryNum < MAX_RETRY) return this.getSongs(id, page, limit, sort, ++retryNum)
        throw new Error('获取歌手歌曲失败')
      }
      const total = Number(body.total) || 0
      return {
        list: normalizeWyAlbumSongs(body.songs),
        total,
        limit,
        source: 'wy',
        hasMore: typeof body.more === 'boolean' ? body.more : hasMoreByTotal(total, page * limit),
      }
    })
  },
  getAlbums(id, page = 1, limit = 30, retryNum = 0) {
    return eapiRequest(`/api/artist/albums/${id}`, {
      limit,
      offset: (page - 1) * limit,
      total: page === 1,
    }).promise.then(({ statusCode, body }) => {
      if (statusCode !== 200 || body?.code !== 200 || !Array.isArray(body.hotAlbums)) {
        if (retryNum < MAX_RETRY) return this.getAlbums(id, page, limit, ++retryNum)
        throw new Error('获取歌手专辑失败')
      }
      const result = normalizeWyArtistAlbums(body)
      return {
        ...result,
        limit,
        source: 'wy',
        hasMore: typeof body.more === 'boolean' ? body.more : hasMoreByTotal(result.total, page * limit),
      }
    })
  },
}
