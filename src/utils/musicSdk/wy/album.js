import { eapiRequest } from './utils/index'
import { normalizeWyAlbumSearch, normalizeWyAlbumSongs } from '../albumNormalizers'

const formatPublishDate = (time) => {
  if (!time) return null
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return String(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const getRawAlbum = async(id) => {
  const { body, statusCode } = await eapiRequest(`/api/v1/album/${id}`, {
    id: Number(id),
    n: 1000,
    s: 8,
  }).promise
  if (statusCode !== 200 || body.code !== 200 || !body.album) throw new Error('Get album info failed.')
  return body
}

const formatArtists = (artists) => Array.isArray(artists) ? artists.map(artist => artist?.name).filter(Boolean).join('、') : ''

export default {
  /**
   * 搜索专辑
   * @param {*} text
   * @param {*} page
   * @param {*} limit
   */
  search(text, page, limit = 20, retryNum = 0) {
    if (retryNum > 2) return Promise.reject(new Error('try max num'))
    return eapiRequest('/api/cloudsearch/pc', {
      s: text,
      type: 10, // 10: 专辑
      limit,
      total: page == 1,
      offset: limit * (page - 1),
    })
      .promise.then(({ statusCode, body }) => {
        if (statusCode !== 200 || body.code !== 200 || !body.result) return this.search(text, page, limit, ++retryNum)
        return {
          ...normalizeWyAlbumSearch(body),
          limit,
          source: 'wy',
        }
      })
  },
  /**
   * 通过AlbumId获取专辑信息
   * @param {*} id
   */
  async getAlbumInfo(id) {
    const { album } = await getRawAlbum(id)
    return {
      name: album.name,
      image: album.picUrl,
      desc: album.description || album.briefDesc || '',
      author: formatArtists(album.artists),
      publishDate: formatPublishDate(album.publishTime),
    }
  },
  /**
   * 通过AlbumId获取专辑歌曲
   * @param {*} id
   */
  async getAlbumDetail(id) {
    const { album, songs } = await getRawAlbum(id)
    const list = normalizeWyAlbumSongs(songs, album)

    return {
      list,
      page: 1,
      limit: 1000,
      total: list.length,
      source: 'wy',
      info: {
        name: album.name,
        img: album.picUrl,
        desc: album.description || album.briefDesc || '',
        author: formatArtists(album.artists),
        publishDate: formatPublishDate(album.publishTime),
      },
    }
  },
}
