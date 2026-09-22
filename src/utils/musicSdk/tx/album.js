import { httpFetch } from '../../request'

export default {
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

    if (body.code != 0 || body.req.code != 0) return Promise.reject(new Error('Get album info failed.'))

    return {
      name: body.req.data.basicInfo?.albumName,
      publishDate: body.req.data.basicInfo?.publishDate ?? null,
    }
  },
}
