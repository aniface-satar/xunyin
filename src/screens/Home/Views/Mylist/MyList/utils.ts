const getIntv = (musicInfo: LX.Music.MusicInfo) => {
  if (!musicInfo.interval) return 0
  // if (musicInfo._interval) return musicInfo._interval
  let intvArr = musicInfo.interval.split(':')
  let intv = 0
  let unit = 1
  while (intvArr.length) {
    intv += parseInt(intvArr.pop()!) * unit
    unit *= 60
  }
  return intv
}

export type ListSortId = 'name' | 'album' | 'duration_up' | 'duration_down' | 'add_time_up' | 'add_time_down' | 'singer' | 'year' | 'play_count'

export interface ListSortContext {
  /**
   * 获取歌曲添加到列表的时间戳（秒级毫秒），未记录时返回 0
   */
  getAddTime: (musicId: string) => number
  /**
   * 获取歌曲播放次数，未记录时返回 0
   */
  getPlayCount: (musicId: string) => number
}

const compareString = (a: string | null | undefined, b: string | null | undefined, localeId: string) => {
  if (a == null) return b == null ? 0 : -1
  if (b == null) return 1
  return a.localeCompare(b, localeId)
}

const getYear = (musicInfo: LX.Music.MusicInfo) => {
  const releaseDate = musicInfo.meta.releaseDate
  if (!releaseDate) return null
  const year = parseInt(releaseDate.slice(0, 4))
  return Number.isNaN(year) ? null : year
}

/**
 * 排序歌曲
 * @param list 歌曲列表
 * @param sortId 排序选项
 * @param localeId 排序语言
 * @param context 添加时间/播放次数查询
 * @returns
 */
export const sortListMusicInfo = (list: LX.Music.MusicInfo[], sortId: ListSortId, localeId: string, context: ListSortContext) => {
  localeId = localeId.replaceAll('_', '-')
  switch (sortId) {
    case 'name':
      list.sort((a, b) => compareString(a.name, b.name, localeId))
      break
    case 'singer':
      list.sort((a, b) => compareString(a.singer, b.singer, localeId))
      break
    case 'album':
      // 先按专辑名分组，同专辑内按歌曲名排序（数据中无音轨号，以歌名代替）
      list.sort((a, b) => {
        const byAlbum = compareString(a.meta.albumName, b.meta.albumName, localeId)
        return byAlbum != 0 ? byAlbum : compareString(a.name, b.name, localeId)
      })
      break
    case 'duration_up':
      list.sort((a, b) => {
        if (a.interval == null) {
          return b.interval == null ? 0 : -1
        } else return b.interval == null ? 1 : getIntv(a) - getIntv(b)
      })
      break
    case 'duration_down':
      list.sort((a, b) => {
        if (a.interval == null) {
          return b.interval == null ? 0 : 1
        } else return b.interval == null ? -1 : getIntv(b) - getIntv(a)
      })
      break
    case 'add_time_up':
      // 添加时间：早添加在前，未记录时间的歌曲保持原有相对顺序排在最前
      list.sort((a, b) => context.getAddTime(a.id) - context.getAddTime(b.id))
      break
    case 'add_time_down':
      // 添加时间降序：晚添加在前，未记录时间的歌曲保持原有相对顺序排在最后
      list.sort((a, b) => context.getAddTime(b.id) - context.getAddTime(a.id))
      break
    case 'year':
      // 发行年份：早年在前，无年份信息的歌曲排最后（保持原有相对顺序）
      list.sort((a, b) => {
        const yearA = getYear(a)
        const yearB = getYear(b)
        if (yearA == null) return yearB == null ? 0 : 1
        if (yearB == null) return -1
        return yearA - yearB
      })
      break
    case 'play_count':
      // 播放次数：播放多的在前，未播放的排最后（保持原有相对顺序）
      list.sort((a, b) => context.getPlayCount(b.id) - context.getPlayCount(a.id))
      break
  }
  return list
}


const variantRxp = /(\(|（).+(\)|）)/g
const variantRxp2 = /\s|'|\.|,|，|&|"|、|\(|\)|（|）|`|~|-|<|>|\||\/|\]|\[/g
export interface DuplicateMusicItem {
  id: string
  index: number
  group: string
  musicInfo: LX.Music.MusicInfo
}
/**
 * 过滤列表内重复的歌曲
 * @param list 歌曲列表
 * @param isFilterVariant 是否过滤 Live Explicit 等歌曲名
 * @returns
 */
export const filterDuplicateMusic = async(list: LX.Music.MusicInfo[], isFilterVariant: boolean = true) => {
  const listMap = new Map<string, DuplicateMusicItem[]>()
  const duplicateList = new Set<string>()
  const handleFilter = (name: string, index: number, musicInfo: LX.Music.MusicInfo) => {
    if (listMap.has(name)) {
      const targetMusicInfo = listMap.get(name)
      targetMusicInfo!.push({
        id: musicInfo.id,
        index,
        musicInfo,
        group: name,
      })
      duplicateList.add(name)
    } else {
      listMap.set(name, [{
        id: musicInfo.id,
        index,
        musicInfo,
        group: name,
      }])
    }
  }
  if (isFilterVariant) {
    list.forEach((musicInfo, index) => {
      let musicInfoName = musicInfo.name.toLowerCase().replace(variantRxp, '').replace(variantRxp2, '')
      musicInfoName ||= musicInfo.name.toLowerCase().replace(/\s+/g, '')
      handleFilter(musicInfoName, index, musicInfo)
    })
  } else {
    list.forEach((musicInfo, index) => {
      const musicInfoName = musicInfo.name.toLowerCase().trim()
      handleFilter(musicInfoName, index, musicInfo)
    })
  }
  // console.log(duplicateList)
  const duplicateNames = Array.from(duplicateList)
  duplicateNames.sort((a, b) => a.localeCompare(b))
  return duplicateNames.map(name => listMap.get(name)!).flat()
}
