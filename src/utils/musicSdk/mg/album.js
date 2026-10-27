import { httpFetch } from '../../request'
import { createHttpFetch } from './utils'
import { filterMusicInfoList } from './musicInfo'
import { createSignature } from './musicSearch'
import { formatPlayCount } from '../../index'
import { normalizeMgAlbumSearch } from '../albumNormalizers'

export default {
  /**
   * 搜索专辑
   * @param {*} text
   * @param {*} page
   * @param {*} limit
   */
  async search(text, page, limit = 20, retryNum = 0) {
    if (retryNum > 2) throw new Error('try max num')
    const time = Date.now().toString()
    const signData = createSignature(time, text)
    const searchSwitch = encodeURIComponent(JSON.stringify({
      song: 0,
      album: 1,
      singer: 0,
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
      ...normalizeMgAlbumSearch(body),
      limit,
      source: 'mg',
    }
  },
  /**
   * 通过AlbumId获取专辑
   * @param {*} id
   * @param {*} page
   */
  async getAlbumDetail(id, page = 1) {
    const list = await createHttpFetch(`http://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/queryAlbumSong?albumId=${id}&pageNo=${page}`)
    if (!list.songList) return Promise.reject(new Error('Get album list error.'))

    const songList = filterMusicInfoList(list.songList)
    const listInfo = await this.getAlbumInfo(id)

    return {
      list: songList || [],
      page,
      limit: 30,
      total: Number(list.totalCount ?? listInfo.total) || songList.length,
      source: 'mg',
      info: {
        name: listInfo.name,
        img: listInfo.image,
        desc: listInfo.desc,
        author: listInfo.author,
        publishDate: listInfo.publishDate,
        play_count: listInfo.play_count,
      },
    }
  },
  /**
   * 通过AlbumId获取专辑信息
   * @param {*} id
   * @param {*} page
   */
  async getAlbumInfo(id) {
    const info = await createHttpFetch(`https://app.c.nf.migu.cn/MIGUM3.0/resource/album/v2.0?albumId=${id}`)
    if (!info) return Promise.reject(new Error('Get album info error.'))

    return {
      name: info.title,
      image: info.imgItems?.length ? info.imgItems[0].img : null,
      desc: info.summary,
      author: info.singer,
      publishDate: info.publishTime ?? info.publishDate ?? null,
      play_count: info.opNumItem ? formatPlayCount(info.opNumItem.playNum) : '',
      total: Number(info.totalCount) || 0,
    }
  },
}
