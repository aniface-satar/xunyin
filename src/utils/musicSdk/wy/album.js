import { httpFetch } from '../../request'
import { weapi } from './utils/crypto'

const formatPublishDate = (time) => {
  if (!time) return null
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return String(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export default {
  /**
   * 通过AlbumId获取专辑信息
   * @param {*} id
   */
  async getAlbumInfo(id) {
    const { body, statusCode } = await httpFetch(`https://music.163.com/weapi/v1/album/${id}`, {
      method: 'post',
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
        origin: 'https://music.163.com',
      },
      form: weapi({
        id: Number(id),
        n: 0,
        s: 0,
      }),
    }).promise

    if (statusCode != 200 || body.code !== 200 || !body.album) return Promise.reject(new Error('Get album info failed.'))

    return {
      name: body.album.name,
      publishDate: formatPublishDate(body.album.publishTime),
    }
  },
}
