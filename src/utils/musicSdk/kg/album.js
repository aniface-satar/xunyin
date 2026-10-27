import { httpFetch } from '../../request'
import { getMusicInfosByList } from './musicInfo'
import { createHttpFetch } from './util'
import { normalizeKgAlbumSearch } from '../albumNormalizers'

export default {
  /**
   * 通过AlbumId获取专辑信息
   * @param {*} id
   */
  async getAlbumInfo(id) {
    const albumInfoRequest = await createHttpFetch('http://kmrserviceretry.kugou.com/container/v1/album?dfid=1tT5He3kxrNC4D29ad1MMb6F&mid=22945702112173152889429073101964063697&userid=0&appid=1005&clientver=11589', {
      method: 'POST',
      body: {
        appid: 1005,
        clienttime: 1681833686,
        clientver: 11589,
        data: [{ album_id: id }],
        fields: 'language,grade_count,intro,mix_intro,heat,category,sizable_cover,cover,album_name,type,quality,publish_company,grade,special_tag,author_name,publish_date,language_id,album_id,exclusive,is_publish,trans_param,authors,album_tag',
        isBuy: 0,
        key: 'e6f3306ff7e2afb494e89fbbda0becbf',
        mid: '22945702112173152889429073101964063697',
        show_album_tag: 0,
      },
    })
    if (!albumInfoRequest?.[0]) return Promise.reject(new Error('get album info failed.'))
    const albumInfo = albumInfoRequest[0]

    return {
      name: albumInfo.album_name,
      image: albumInfo.sizable_cover ? String(albumInfo.sizable_cover).replace('{size}', 500) : null,
      desc: albumInfo.intro,
      authorName: albumInfo.author_name,
      publishDate: albumInfo.publish_date ?? null,
      // play_count: this.formatPlayCount(info.count),
    }
  },
  /**
   * 搜索专辑
   * @param {*} text
   * @param {*} page
   * @param {*} limit
   */
  async search(text, page, limit = 20, retryNum = 0) {
    if (retryNum > 2) throw new Error('try max num')
    const { statusCode, body } = await httpFetch(`https://mobilecdn.kugou.com/api/v3/search/album?format=json&keyword=${encodeURIComponent(text)}&page=${page}&pagesize=${limit}`).promise
    if (statusCode !== 200 || body.status !== 1 || !body.data) return this.search(text, page, limit, ++retryNum)
    return {
      ...normalizeKgAlbumSearch(body),
      limit,
      source: 'kg',
    }
  },
  /**
   * 通过AlbumId获取专辑
   * @param {*} id
   * @param {*} page
   */
  async getAlbumDetail(id, page = 1, limit = 200) {
    const albumList = await createHttpFetch(`http://mobiles.kugou.com/api/v5/album/song?version=9108&albumid=${id}&plat=0&pagesize=${limit}&area_code=0&page=${page}&with_res_tag=0`)
    if (!albumList?.info) return Promise.reject(new Error('Get album list failed.'))

    const songs = await getMusicInfosByList(albumList.info)

    const info = await this.getAlbumInfo(id)

    return {
      list: songs || [],
      page,
      limit,
      total: Number(albumList.total) || songs.length,
      source: 'kg',
      info: {
        name: info.name,
        img: info.image,
        desc: info.desc,
        author: info.authorName,
        publishDate: info.publishDate,
        // play_count: this.formatPlayCount(info.count),
      },
    }
  },
}
