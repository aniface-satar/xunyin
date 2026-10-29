import { getMusicInfo } from './musicInfo'
import { pickMgAlbumImg } from './img'
import { createHttpFetch } from './utils'

/**
 * 专辑封面兜底：resourceinfo 的 resourceType=2003 支持 albumId
 */
const getAlbumCover = async(albumId) => {
  if (!albumId) return null
  try {
    const resource = await createHttpFetch('https://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?resourceType=2003', {
      method: 'POST',
      form: {
        resourceId: albumId,
      },
    })
    const detail = Array.isArray(resource) ? resource[0] : resource
    return pickMgAlbumImg(detail?.imgItems, 'large')
  } catch (err) {
    console.log('get mg album cover failed', err)
    return null
  }
}

export default {
  async getPic(songInfo) {
    // resourceinfo 只认咪咕 songId / contentId，传 copyrightId 会返回空数组，
    // 按 songId → contentId → copyrightId 依次尝试，最后再用 albumId 取专辑封面兜底
    const ids = [songInfo.songmid, songInfo.contentId, songInfo.copyrightId].filter(Boolean)
    for (const id of ids) {
      try {
        const info = await getMusicInfo(id, 'large')
        if (info?.img) return info.img
      } catch (err) {
        console.log('get mg pic failed', id, err)
      }
    }
    const img = await getAlbumCover(songInfo.albumId)
    if (img) return img
    throw new Error('获取咪咕封面失败')
  },
}
