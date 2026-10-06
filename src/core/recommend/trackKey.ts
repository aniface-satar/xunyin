const VERSION_MARKERS = [
  'live', 'remix', 'cover', 'acoustic', 'instrumental', '伴奏', '现场', '翻唱', '纯音乐',
  'dj', 'piano', 'demo', 'karaoke', '演唱会', '演奏', '不插电', '清唱', '人声版',
]

export const normalizeText = (text: string | null | undefined) => {
  return String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/【/g, '[')
    .replace(/】/g, ']')
    .replace(/[·・•]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*[-–—]\s*/g, ' - ')
    .trim()
}

const hasMarker = (text: string) => VERSION_MARKERS.some(marker => text.includes(marker))

/**
 * 提取版本标记，保留 Live、Remix、伴奏、现场等差异。
 * 无版本标记时返回空字符串。
 */
export const getVersionLabel = (name: string | null | undefined): string => {
  const raw = String(name ?? '').trim()
  if (!raw) return ''
  const lower = raw.toLowerCase()

  // 括号 / 方括号中的内容
  const bracketMatches = raw.match(/[([](.*?)[)\]]/g) ?? []
  for (const part of bracketMatches) {
    const inner = normalizeText(part.replace(/^[([]|[)\]]$/g, ''))
    if (inner && hasMarker(inner)) return inner
  }

  // 尾部 " - Live" / " Live版" / "Remix" 等
  const tailMatch = lower.match(/(?:\s*[-–—]\s*|\s+)([a-z0-9\u4e00-\u9fa5\s]+?)(?:版|version|ver\.?)?$/)
  if (tailMatch && hasMarker(tailMatch[1])) return normalizeText(tailMatch[1])

  // 任何位置出现版本关键词，取紧凑的标记词
  for (const marker of VERSION_MARKERS) {
    if (lower.includes(marker)) return marker
  }
  return ''
}

/** 去掉版本括号/后缀后的基础歌名，用于判断是否同一作品的版本差异。 */
export const getBaseName = (name: string | null | undefined): string => {
  let base = String(name ?? '').trim()
  base = base.replace(/[([][^)\]]*[)\]]/g, ' ')
  base = base.replace(/\s*[-–—]\s*(?:live|remix|cover|acoustic|instrumental|伴奏|现场|翻唱|纯音乐|dj|piano|demo|karaoke|演唱会|演奏|不插电|清唱)\s*版?\s*$/i, ' ')
  base = base.replace(/\s*(?:live|remix|cover|acoustic|instrumental|伴奏|现场|翻唱|纯音乐|dj|piano|demo|karaoke|演唱会|演奏|不插电|清唱)\s*版?$/i, ' ')
  return normalizeText(base) || normalizeText(name)
}

export const canonicalTrackKey = (name: string, singer: string) => {
  const base = getBaseName(name)
  const version = getVersionLabel(name)
  const artist = normalizeText(singer)
  return version ? `ns:${base}[${version}]__${artist}` : `ns:${base}__${artist}`
}

/** 忽略版本差异的作品级 key，用于软降频/相似判断，不用于严格去重。 */
export const canonicalWorkKey = (name: string, singer: string) => {
  return `work:${getBaseName(name)}__${normalizeText(singer)}`
}

const parseDurationSeconds = (interval: string | null | undefined): number | undefined => {
  if (!interval) return undefined
  const parts = String(interval).trim().split(':').map(part => parseInt(part, 10))
  if (!parts.length || parts.some(part => Number.isNaN(part))) return undefined
  let seconds = 0
  for (const part of parts) seconds = seconds * 60 + part
  return seconds > 0 ? seconds : undefined
}

export const getDurationSeconds = (musicInfo: { interval?: string | null, meta?: { interval?: string | null } | null }) => {
  return parseDurationSeconds(musicInfo.interval ?? musicInfo.meta?.interval)
}

export const getDurationMs = (musicInfo: { interval?: string | null, meta?: { interval?: string | null } | null }) => {
  const seconds = getDurationSeconds(musicInfo)
  return seconds != null ? seconds * 1000 : undefined
}

export const getAlbumName = (musicInfo: { meta?: { albumName?: string | null } | null, albumName?: string | null }) => {
  return String(musicInfo.meta?.albumName ?? musicInfo.albumName ?? '').trim()
}

export const buildTrackKey = (musicInfo: LX.Music.MusicInfo) => {
  if (musicInfo.source == 'local') return `local:${musicInfo.id}`
  return canonicalTrackKey(musicInfo.name, musicInfo.singer)
}

/** 跨源判断同一录音：作品 key 相同、版本标记一致、时长接近（允许 5 秒误差）。 */
export const isSameRecording = (
  a: { name?: string | null, singer?: string | null, interval?: string | null, meta?: { albumName?: string | null } | null },
  b: { name?: string | null, singer?: string | null, interval?: string | null, meta?: { albumName?: string | null } | null },
) => {
  const keyA = canonicalTrackKey(String(a.name ?? ''), String(a.singer ?? ''))
  const keyB = canonicalTrackKey(String(b.name ?? ''), String(b.singer ?? ''))
  if (keyA != keyB) return false
  const durA = parseDurationSeconds(a.interval)
  const durB = parseDurationSeconds(b.interval)
  if (durA != null && durB != null && Math.abs(durA - durB) > 5) return false
  // 专辑不同且时长都已知时，若差异也明显，则不视作同一录音。
  const albumA = getAlbumName(a)
  const albumB = getAlbumName(b)
  if (albumA && albumB && normalizeText(albumA) != normalizeText(albumB) && durA != null && durB != null && durA != durB) {
    return false
  }
  return true
}

/** 同一作品但可能是不同版本，用于软降频而不是硬排除。 */
export const isLikelyVersionOfSameWork = (
  a: { name?: string | null, singer?: string | null },
  b: { name?: string | null, singer?: string | null },
) => {
  return canonicalWorkKey(String(a.name ?? ''), String(a.singer ?? '')) ==
    canonicalWorkKey(String(b.name ?? ''), String(b.singer ?? ''))
}

const CJK_RXP = /[\u3400-\u9fff]/
const ACDC_RXP = /^[A-Z]{1,4}\/[A-Z]{1,4}$/

/**
 * 谨慎拆分歌手：不拆坏 AC/DC，也不把 "Simon & Garfunkel" 这类组合名拆开。
 * 对明确的多人分隔符（、；| 等）总是拆分。
 */
export const splitSinger = (singer: string | null | undefined): string[] => {
  const raw = String(singer ?? '').trim()
  if (!raw) return []

  // 先处理 feat./ft./with 这类对唱标记
  const parts = raw
    .replace(/\s+(?:feat\.?|ft\.?|with)\s+/gi, '、')
    .split(/[、;；|]/)

  const result: string[] = []
  for (const part of parts) {
    // 斜杠：AC/DC 这类全大写短名不拆
    if (part.includes('/')) {
      const slashParts = part.split('/').map(s => s.trim()).filter(Boolean)
      if (slashParts.length == 2 && ACDC_RXP.test(part.replace(/\s+/g, ''))) {
        result.push(part.trim())
      } else {
        result.push(...slashParts)
      }
    } else {
      result.push(part.trim())
    }
  }

  const expanded: string[] = []
  for (const part of result) {
    const hasCjk = CJK_RXP.test(part)
    const pieces = part.split(/[,，&]/).map(s => s.trim()).filter(Boolean)
    if (pieces.length <= 1) {
      expanded.push(part)
      continue
    }
    // "Simon & Garfunkel" 这种带空格的拉丁组合名保留整体；中文/无空格分隔则拆
    if (!hasCjk && /\s&\s/.test(part) && !/[,，]/.test(part)) {
      expanded.push(part)
    } else {
      expanded.push(...pieces)
    }
  }

  return [...new Set(expanded.map(s => s.trim()).filter(Boolean))]
}

export const getArtistKeys = (singer: string | null | undefined): string[] => {
  return splitSinger(singer).map(s => normalizeText(s)).filter(Boolean)
}

export const getPrimaryArtist = (musicInfo: LX.Music.MusicInfo): string => {
  return splitSinger(musicInfo.singer)[0] ?? ''
}

export const getArtistOf = (musicInfo: LX.Music.MusicInfo): string[] => {
  return getArtistKeys(musicInfo.singer)
}

export const normalizeArtistKey = (artist: string | null | undefined) => normalizeText(artist)
