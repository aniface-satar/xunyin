import { signRequest } from './utils'
import musicSearch from './musicSearch'
import {
  ARTIST_SONG_SORT_PARAMS,
  hasMoreByTotal,
  normalizeTxArtistAlbums,
  normalizeTxArtistDetail,
  normalizeTxArtistSearch,
} from '../artistNormalizers'
import { normalizeTxAlbumSongs } from '../albumNormalizers'

const successCode = 0
const MAX_RETRY = 5

const createComm = () => ({
  _channelid: '0',
  _os_version: '6.2.9200-2',
  ct: '19',
  cv: '2151',
  guid: '1F70E520B2EAA7D25E11760783C53CA9',
  patch: '118',
  psrf_access_token_expiresAt: 0,
  psrf_qqaccess_token: '',
  psrf_qqopenid: '',
  psrf_qqunionid: '',
  tmeAppID: 'qqmusic',
  tmeLoginType: 0,
  uin: '0',
  wid: '7223299733393904640',
})

const request = (module, method, param) => signRequest({
  comm: createComm(),
  [module]: { module, method, param },
}).then(({ body }) => {
  const req = body?.[module] ?? body?.req
  if (body.code != successCode || req?.code != successCode) return null
  return req.data ?? {}
})

export default {
  search(text, page = 1, limit = 20, retryNum = 0) {
    if (retryNum > 5) return Promise.reject(new Error('搜索失败'))
    return signRequest({
      comm: createComm(),
      'music.search.SearchCgiService': {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicDesktop',
        param: {
          grp: 1,
          num_per_page: limit,
          page_num: page,
          query: text,
          remoteplace: 'txt.newclient.top',
          search_type: 1,
          searchid: musicSearch.getSearchId(),
        },
      },
    }).then(({ body }) => {
      const req = body?.['music.search.SearchCgiService'] ?? body?.req
      if (!req || body.code != successCode || req.code != successCode) {
        return this.search(text, page, limit, ++retryNum)
      }
      return {
        ...normalizeTxArtistSearch(body),
        limit,
        source: 'tx',
      }
    })
  },
  getDetail(id, retryNum = 0) {
    return request('music.musichallSinger.SingerInfoInter', 'GetSingerDetail', {
      singer_mids: [id],
      groups: 1,
      wikis: 1,
      ex_singer: 1,
      pics: 1,
      area: 1,
      tag: 1,
    }).then(data => {
      if (!Array.isArray(data?.singer_list) && retryNum < MAX_RETRY) return this.getDetail(id, ++retryNum)
      if (!Array.isArray(data?.singer_list)) throw new Error('获取歌手信息失败')
      return normalizeTxArtistDetail({
        'music.musichallSinger.SingerInfoInter': { code: successCode, data },
      })
    })
  },
  getSongs(id, page = 1, limit = 30, sort = 'hot', retryNum = 0) {
    return request('music.web_singer_info_svr', 'get_singer_detail_info', {
      sort: ARTIST_SONG_SORT_PARAMS.tx[sort] ?? ARTIST_SONG_SORT_PARAMS.tx.hot,
      singermid: id,
      sin: (page - 1) * limit,
      num: limit,
    }).then(data => {
      if (!Array.isArray(data?.songlist)) {
        if (retryNum < MAX_RETRY) return this.getSongs(id, page, limit, sort, ++retryNum)
        throw new Error('获取歌手歌曲失败')
      }
      const total = Number(data.total_song) || 0
      return {
        list: normalizeTxAlbumSongs(data.songlist),
        total,
        limit,
        source: 'tx',
        hasMore: total > 0 ? hasMoreByTotal(total, page * limit) : data.songlist.length >= limit,
      }
    })
  },
  getAlbums(id, page = 1, limit = 30, retryNum = 0) {
    return request('music.musichallAlbum.AlbumListServer', 'GetAlbumList', {
      sort: 5,
      singermid: id,
      begin: (page - 1) * limit,
      num: limit,
    }).then(data => {
      if (!Array.isArray(data?.albumList)) {
        if (retryNum < MAX_RETRY) return this.getAlbums(id, page, limit, ++retryNum)
        throw new Error('获取歌手专辑失败')
      }
      const result = normalizeTxArtistAlbums({
        'music.musichallAlbum.AlbumListServer': { code: successCode, data },
      })
      return {
        ...result,
        limit,
        source: 'tx',
        hasMore: hasMoreByTotal(result.total, page * limit),
      }
    })
  },
}
