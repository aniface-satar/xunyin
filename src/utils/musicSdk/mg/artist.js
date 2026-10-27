import { httpFetch } from '../../request'
import { createSignature } from './musicSearch'
import { filterMusicInfoListV5 } from './musicInfo'
import {
  normalizeMgArtistAlbums,
  normalizeMgArtistDetail,
  normalizeMgArtistSearch,
} from '../artistNormalizers'

const MAX_RETRY = 3
const headers = { Referer: 'https://app.c.nf.migu.cn/' }

const request = (url, retryNum = 0) => httpFetch(url, { headers }).promise.then(({ statusCode, body }) => {
  if (statusCode !== 200 || body?.code !== '000000' || !body.data) {
    if (retryNum < MAX_RETRY) return request(url, ++retryNum)
    throw new Error('获取歌手信息失败')
  }
  return body
})

export default {
  async search(text, page = 1, limit = 20, retryNum = 0) {
    if (retryNum > 2) throw new Error('try max num')
    const time = Date.now().toString()
    const signData = createSignature(time, text)
    const searchSwitch = encodeURIComponent(JSON.stringify({
      song: 0,
      album: 0,
      singer: 1,
      tagSong: 0,
      mvSong: 0,
      bestShow: 0,
      songlist: 0,
      lyricSong: 0,
    }))
    const { statusCode, body } = await httpFetch(`https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1&searchSwitch=${searchSwitch}&pageSize=${limit}&text=${encodeURIComponent(text)}&pageNo=${page}&sort=0&sid=USS`, {
      headers: {
        uiVersion: 'A_music_3.6.1',
        deviceId: signData.deviceId,
        timestamp: time,
        sign: signData.sign,
        channel: '0146921',
        'User-Agent': 'Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
      },
    }).promise
    if (statusCode !== 200 || body.code !== '000000') return this.search(text, page, limit, ++retryNum)
    return {
      ...normalizeMgArtistSearch(body),
      limit,
      source: 'mg',
    }
  },
  getDetail(id) {
    return request(`https://app.c.nf.migu.cn/bmw/singer/index/v1.0?singerId=${id}`).then(body => normalizeMgArtistDetail(body))
  },
  getSongs(id, page = 1, limit = 30) {
    return request(`https://app.c.nf.migu.cn/bmw/singer/song/v1.0?pageNo=${page}&singerId=${id}&type=1`).then(body => {
      const contents = Array.isArray(body.data.contents) ? body.data.contents : []
      const scroll = contents.find(item => item?.view == 'ZJ-Singer-Song-Scroll')
      const rawList = (Array.isArray(scroll?.contents) ? scroll.contents : [])
        .map(item => item?.songItem)
        .filter(Boolean)
      return {
        list: filterMusicInfoListV5(rawList),
        total: 0,
        limit,
        source: 'mg',
        hasMore: Boolean(body.data.header?.nextPageUrl),
      }
    })
  },
  getAlbums(id, page = 1, limit = 30) {
    return request(`https://app.c.nf.migu.cn/bmw/singer/album/v1.0?singerId=${id}&pageNo=${page}`).then(body => {
      const result = normalizeMgArtistAlbums(body)
      return {
        ...result,
        limit,
        source: 'mg',
        hasMore: Boolean(body.data.header?.nextPageUrl),
      }
    })
  },
}
