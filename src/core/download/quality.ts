/** 音质档位从高到低；ape/wav 不在下载面板里出现，所以也不在这里 */
export const QUALITY_ORDER: LX.Quality[] = ['flac24bit', 'flac', '320k', '192k', '128k']

export type QualityMode = 'highest' | 'lowest'

/** 只用到档位表，所以不要求整条 MusicInfoOnline，测试与调用方都更好构造 */
export interface QualitySourceInfo {
  source: LX.Source
  meta: {
    _qualitys: LX.Music._MusicQualityType
  }
}

export const isQualitySupported = (musicInfo: QualitySourceInfo, qualityList: LX.Quality[], quality: LX.Quality) => {
  return qualityList.includes(quality) && musicInfo.meta._qualitys[quality] != null
}

/** 逐首取自己的最高/最低档，不受"这批歌共同支持"的限制；一首都不支持时返回 null */
export const pickQuality = (musicInfo: QualitySourceInfo, qualityList: LX.Quality[], mode: QualityMode) => {
  const supported = QUALITY_ORDER.filter(quality => isQualitySupported(musicInfo, qualityList, quality))
  if (!supported.length) return null
  return mode == 'lowest' ? supported[supported.length - 1] : supported[0]
}

/** 批量面板的档位列表：所有歌都支持的档，仍按从高到低排 */
export const getSharedQualities = (musicInfos: QualitySourceInfo[], qualityListFor: (source: LX.Source) => LX.Quality[]) => {
  return QUALITY_ORDER.filter(quality => {
    return musicInfos.every(musicInfo => isQualitySupported(musicInfo, qualityListFor(musicInfo.source), quality))
  })
}

export type QualityChoice = LX.Quality | QualityMode

/**
 * 入队前的分档：固定档位时不支持那首的直接跳过（面板本来就只列交集），
 * 全部最高/最低则是逐首各算各的，所以不会出现"一首缺无损整批降级"。
 */
export const assignQualities = <T extends QualitySourceInfo>(
  musicInfos: T[],
  choice: QualityChoice,
  qualityListFor: (source: LX.Source) => LX.Quality[],
) => {
  const assigned: Array<{ musicInfo: T, quality: LX.Quality }> = []
  const skipped: T[] = []

  musicInfos.forEach((musicInfo) => {
    const qualityList = qualityListFor(musicInfo.source)
    const quality = choice == 'highest' || choice == 'lowest'
      ? pickQuality(musicInfo, qualityList, choice)
      : isQualitySupported(musicInfo, qualityList, choice) ? choice : null
    if (!quality) skipped.push(musicInfo)
    else assigned.push({ musicInfo, quality })
  })

  return { assigned, skipped }
}
