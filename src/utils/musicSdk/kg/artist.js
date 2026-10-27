import { httpFetch } from '../../request'
import {
  hasMoreByTotal,
  normalizeKgArtistAlbums,
  normalizeKgArtistDetail,
  normalizeKgArtistSearch,
} from '../artistNormalizers'
import singer from './singer'

const PAGE_SIZE = 10

export default {
  // 该接口忽略 page 参数，只能拿到前 10 条
  search(text) {
    return httpFetch(`http://mobilecdn.kugou.com/api/v3/search/singer?format=json&keyword=${encodeURIComponent(text)}&page=1&pagesize=${PAGE_SIZE}`).promise.then(({ body }) => {
      if (body?.status !== 1) throw new Error('搜索失败')
      return {
        ...normalizeKgArtistSearch(body),
        limit: PAGE_SIZE,
        source: 'kg',
      }
    })
  },
  getDetail(id) {
    return httpFetch(`http://mobiles.kugou.com/api/v5/singer/info?singerid=${id}`).promise.then(({ statusCode, body }) => {
      if (statusCode !== 200 || !body?.data) throw new Error('获取歌手信息失败')
      return normalizeKgArtistDetail(body)
    })
  },
  getSongs(id, page = 1, limit = 30, sort = 'hot') {
    return singer.getSingerSongList(id, page, limit, sort).then(result => ({
      list: result.list,
      total: result.total,
      limit,
      source: 'kg',
      hasMore: hasMoreByTotal(result.total, page * limit),
    }))
  },
  getAlbums(id, page = 1, limit = 30) {
    return httpFetch(`http://mobiles.kugou.com/api/v5/singer/album?singerid=${id}&page=${page}&pagesize=${limit}`).promise.then(({ statusCode, body }) => {
      if (statusCode !== 200 || !Array.isArray(body?.data?.info)) throw new Error('获取歌手专辑失败')
      const result = normalizeKgArtistAlbums(body)
      return {
        ...result,
        limit,
        source: 'kg',
        hasMore: hasMoreByTotal(result.total, page * limit),
      }
    })
  },
}
