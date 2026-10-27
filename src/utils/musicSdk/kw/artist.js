import { httpFetch } from '../../request'
import {
  ARTIST_SONG_SORT_PARAMS,
  hasMoreByTotal,
  normalizeKwArtistAlbums,
  normalizeKwArtistDetail,
  normalizeKwArtistSearch,
  normalizeKwArtistSongItem,
} from '../artistNormalizers'
import musicSearch from './musicSearch'
import { objStr2JSON } from './util'

const MAX_RETRY = 3

const parseKw = (body) => {
  if (typeof body !== 'string') return body
  try {
    return objStr2JSON(body)
  } catch {
    return null
  }
}

export default {
  search(text, page = 1, limit = 20) {
    return httpFetch(`http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(text)}&pn=${page - 1}&rn=${limit}&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&ft=artist&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1`).promise.then(({ body }) => ({
      ...normalizeKwArtistSearch(body),
      limit,
      source: 'kw',
    }))
  },
  getDetail(id, retryNum = 0) {
    return httpFetch(`http://search.kuwo.cn/r.s?stype=artistinfo&artistid=${id}&rformat=json&encoding=utf8`).promise.then(({ statusCode, body }) => {
      const data = parseKw(body)
      if (statusCode !== 200 || !data?.name) {
        if (retryNum < MAX_RETRY) return this.getDetail(id, ++retryNum)
        throw new Error('获取歌手信息失败')
      }
      return normalizeKwArtistDetail(data)
    })
  },
  // artist2music 同时支持热门和新歌排序，也避开了旧 ft=music 接口在 25 条与完整曲库之间摇摆的问题
  getSongs(id, page = 1, limit = 30, sort = 'hot', retryNum = 0) {
    const sortby = ARTIST_SONG_SORT_PARAMS.kw[sort] ?? ARTIST_SONG_SORT_PARAMS.kw.hot
    const url = `http://search.kuwo.cn/r.s?stype=artist2music&ft=music&client=kt&pn=${page - 1}&rn=${limit}&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1&artistid=${id}&sortby=${sortby}`
    return httpFetch(url).promise.then(({ statusCode, body }) => {
      const data = parseKw(body)
      const rawList = Array.isArray(data?.musiclist) ? data.musiclist : []
      const total = parseInt(data?.total) || 0
      if (statusCode !== 200 || !data) {
        if (retryNum < MAX_RETRY) return this.getSongs(id, page, limit, sort, ++retryNum)
        throw new Error('获取歌手歌曲失败')
      }
      if (!rawList.length) {
        if (total > 0) {
          if (retryNum < MAX_RETRY) return this.getSongs(id, page, limit, sort, ++retryNum)
          throw new Error('获取歌手歌曲失败')
        }
        return { list: [], total, limit, source: 'kw', hasMore: false }
      }
      const list = musicSearch.handleResult(rawList.map(normalizeKwArtistSongItem).filter(Boolean))
      if (!list?.length) {
        if (retryNum < MAX_RETRY) return this.getSongs(id, page, limit, sort, ++retryNum)
        throw new Error('获取歌手歌曲失败')
      }
      return { list, total, limit, source: 'kw', hasMore: hasMoreByTotal(total, page * limit) }
    })
  },
  getAlbums(id, page = 1, limit = 30, retryNum = 0) {
    return httpFetch(`http://search.kuwo.cn/r.s?stype=albumlist&artistid=${id}&pn=${page - 1}&rn=${limit}&rformat=json&encoding=utf8`).promise.then(({ statusCode, body }) => {
      const data = parseKw(body)
      if (statusCode !== 200 || !Array.isArray(data?.albumlist)) {
        if (retryNum < MAX_RETRY) return this.getAlbums(id, page, limit, ++retryNum)
        throw new Error('获取歌手专辑失败')
      }
      const result = normalizeKwArtistAlbums(data)
      return {
        ...result,
        limit,
        source: 'kw',
        hasMore: hasMoreByTotal(result.total, page * limit),
      }
    })
  },
}
