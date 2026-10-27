import { httpFetch } from '../../request'
import { signRequest } from './utils'
import musicSearch from './musicSearch'
import { normalizeTxAlbumSearch, normalizeTxAlbumSongs } from '../albumNormalizers'

const successCode = 0

export default {
  /**
   * 搜索专辑
   * @param {*} text
   * @param {*} page
   * @param {*} limit
   */
  search(text, page, limit = 20, retryNum = 0) {
    if (retryNum > 5) return Promise.reject(new Error('搜索失败'))
    return signRequest({
      comm: {
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
      },
      'music.search.SearchCgiService': {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicDesktop',
        param: {
          grp: 1,
          num_per_page: limit,
          page_num: page,
          query: text,
          remoteplace: 'txt.newclient.top',
          search_type: 2,
          searchid: musicSearch.getSearchId(),
        },
      },
    }).then(({ body }) => {
      const req = body?.['music.search.SearchCgiService'] ?? body?.req
      if (!req || body.code != successCode || req.code != successCode) {
        return this.search(text, page, limit, ++retryNum)
      }
      return {
        ...normalizeTxAlbumSearch(body),
        limit,
        source: 'tx',
      }
    })
  },
  /**
   * 通过AlbumMid获取专辑信息
   * @param {*} id
   */
  async getAlbumInfo(id) {
    const { body } = await httpFetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'post',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)',
      },
      body: {
        comm: {
          ct: '19',
          cv: '1859',
          uin: '0',
        },
        req: {
          module: 'music.musichallAlbum.AlbumInfoServer',
          method: 'GetAlbumDetail',
          param: {
            albumMid: id,
            albumId: 0,
          },
        },
      },
    }).promise

    if (body.code != successCode || body.req.code != successCode) return Promise.reject(new Error('Get album info failed.'))

    const data = body.req.data ?? {}
    const basicInfo = data.basicInfo ?? {}
    const albumMid = basicInfo.albumMid ?? id
    return {
      name: basicInfo.albumName,
      image: basicInfo.albumPic ?? (albumMid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumMid}.jpg` : null),
      desc: basicInfo.desc ?? '',
      author: Array.isArray(data.singer) ? data.singer.map(s => s.name).filter(Boolean).join('、') : '',
      publishDate: basicInfo.publishDate ?? null,
    }
  },
  /**
   * 通过AlbumMid获取专辑歌曲
   * @param {*} id
   * @param {*} page
   */
  async getAlbumDetail(id, page = 1, limit = 100) {
    const { body } = await httpFetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'post',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)',
      },
      body: {
        comm: {
          ct: '19',
          cv: '1859',
          uin: '0',
        },
        req: {
          module: 'music.musichallAlbum.AlbumSongList',
          method: 'GetAlbumSongList',
          param: {
            albumMid: id,
            begin: (page - 1) * limit,
            num: limit,
            order: 2,
          },
        },
      },
    }).promise

    const req = body?.req
    if (body.code != successCode || req?.code != successCode || !Array.isArray(req?.data?.songList)) {
      return Promise.reject(new Error('Get album list failed.'))
    }

    const rawList = req.data.songList.map(item => item.songInfo ?? item)
    const list = normalizeTxAlbumSongs(rawList)
    const info = await this.getAlbumInfo(id)

    return {
      list,
      page,
      limit,
      total: Number(req.data.totalNum ?? req.data.total) || list.length,
      source: 'tx',
      info: {
        name: info.name,
        img: info.image,
        desc: info.desc,
        author: info.author,
        publishDate: info.publishDate,
      },
    }
  },
}
