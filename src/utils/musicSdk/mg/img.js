const MG_PIC_HOST = 'https://d.musicapp.migu.cn'
const IMG_SIZE_RANK = { '01': 1, '02': 2, '03': 3 }

/**
 * 咪咕各接口返回的封面地址不统一：
 * - 搜索 / 歌单 / 歌手接口给的是相对路径（/data/oss/resource/xx.webp）
 * - 部分接口给的是 http 明文或 // 开头的协议相对地址
 * 这里统一补全成可以直接给 Image 组件使用的 https 绝对地址
 */
export const normalizeMgPicUrl = (url) => {
  if (typeof url != 'string') return null
  const target = url.trim()
  if (!target) return null
  if (target.startsWith('//')) return `https:${target}`
  if (/^https?:\/\//i.test(target)) {
    // 只对咪咕自家域名升级到 https，避免第三方 http 图源没有 https 时被改坏
    return /migu\.cn/i.test(target) ? target.replace(/^http:\/\//i, 'https://') : target
  }
  return `${MG_PIC_HOST}${target.startsWith('/') ? '' : '/'}${target}`
}

const pickBiggest = (candidates) => {
  return candidates.reduce((prev, cur) => (IMG_SIZE_RANK[cur.imgSizeType] ?? 0) >= (IMG_SIZE_RANK[prev.imgSizeType] ?? 0) ? cur : prev)
}

/**
 * 从 albumImgs / imgItems 中挑一张封面
 * @param {Array} imgs
 * @param {'medium'|'large'} mode 列表用 medium（400），播放页 / 分享图用 large（原图）
 */
export const pickMgAlbumImg = (imgs, mode = 'medium') => {
  if (!Array.isArray(imgs)) return null
  const candidates = imgs.filter(item => typeof item?.img == 'string' && item.img.trim())
  if (!candidates.length) return null
  if (mode != 'large') {
    const medium = candidates.find(item => item.imgSizeType == '02')
    if (medium) return normalizeMgPicUrl(medium.img)
  }
  return normalizeMgPicUrl(pickBiggest(candidates).img)
}

/**
 * 取一首歌的封面：优先 albumImgs，其次 img1 / img2 / img3（咪咕的 img3 是最大图）
 */
export const pickMgSongImg = (item, mode = 'medium') => {
  if (!item) return null
  if (mode == 'large') return normalizeMgPicUrl(item.img3) ?? pickMgAlbumImg(item.albumImgs, 'large') ?? normalizeMgPicUrl(item.img2 || item.img1)
  return pickMgAlbumImg(item.albumImgs, 'medium') ?? normalizeMgPicUrl(item.img2 || item.img1 || item.img3)
}
