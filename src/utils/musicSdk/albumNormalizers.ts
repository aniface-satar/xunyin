import he from 'he'

// 纯函数：不得引入 request/config/store，测试会直接 import 本模块

export const ALBUM_LIST_ID_PREFIX = 'album__'

export const createAlbumListId = (rawId: unknown): string => `${ALBUM_LIST_ID_PREFIX}${String(rawId)}`

export const isAlbumListId = (id: string): boolean => id.startsWith(ALBUM_LIST_ID_PREFIX) && id.length > ALBUM_LIST_ID_PREFIX.length

export const getAlbumRawId = (id: string): string => isAlbumListId(id) ? id.slice(ALBUM_LIST_ID_PREFIX.length) : id

export type AlbumSource = 'kg' | 'kw' | 'tx' | 'wy' | 'mg'

export interface AlbumSearchItem {
  id: string
  name: string
  author: string
  img: string
  time: string
  desc: string
  total: string
  source: AlbumSource
}

export interface AlbumSearchPage {
  list: AlbumSearchItem[]
  total: number
}

const toText = (value: unknown): string => value == null ? '' : String(value)

const toNumber = (value: unknown): number => {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

const decodeHtml = (value: unknown): string => {
  const text = toText(value)
  if (!text) return ''
  return he.decode(text)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim()
}

const formatImage = (value: unknown, size = 480): string => toText(value).replace('{size}', String(size))

const formatDate = (value: unknown): string => {
  if (value == null || value === '' || value === 0) return ''
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const date = new Date(Number(value))
    if (Number.isNaN(date.getTime())) return ''
    return date.toISOString().slice(0, 10)
  }
  return String(value)
}

const artistName = (artist: any): string => {
  if (artist == null) return ''
  return typeof artist === 'string' ? artist : toText(artist.name)
}

const joinArtists = (artists: any): string => {
  if (Array.isArray(artists)) return artists.map(artistName).filter(Boolean).join('、')
  return artistName(artists)
}

const numFix = (num: number): string => num < 10 ? `0${num}` : String(num)

export const formatPlayTime = (time: unknown): string => {
  const seconds = toNumber(time)
  if (seconds <= 0) return '--/--'
  return `${numFix(Math.trunc(seconds / 60))}:${numFix(Math.trunc(seconds % 60))}`
}

export const formatSize = (size: unknown): string => {
  const bytes = toNumber(size)
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  const unit = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, unit)).toFixed(2)} ${units[unit]}`
}

interface QualityItem { type: string, size: string }
interface Qualitys {
  types: QualityItem[]
  _types: Record<string, { size: string }>
}

const createQualitys = (pairs: Array<[string, unknown]>): Qualitys => {
  const types: QualityItem[] = []
  const _types: Qualitys['_types'] = {}
  for (const [type, rawSize] of pairs) {
    const bytes = toNumber(rawSize)
    if (bytes <= 0) continue
    const size = formatSize(bytes)
    types.push({ type, size })
    _types[type] = { size }
  }
  return { types, _types }
}

export const normalizeKgAlbumSearch = (body: any): AlbumSearchPage => {
  const data = body?.data ?? body ?? {}
  const rawList: any[] = Array.isArray(data.info) ? data.info : []
  return {
    total: toNumber(data.total),
    list: rawList.map(item => ({
      id: createAlbumListId(item.albumid),
      name: decodeHtml(item.albumname),
      author: decodeHtml(item.singername),
      img: formatImage(item.imgurl),
      time: toText(item.publishtime),
      desc: decodeHtml(item.intro),
      total: item.songcount == null ? '' : String(item.songcount),
      source: 'kg',
    })),
  }
}

export const normalizeKwAlbumSearch = (body: any): AlbumSearchPage => {
  const rawList: any[] = Array.isArray(body?.albumlist) ? body.albumlist : []
  return {
    total: toNumber(body?.TOTAL),
    list: rawList.map(item => ({
      id: createAlbumListId(item.DC_TARGETID ?? item.albumid),
      name: decodeHtml(item.name),
      author: decodeHtml(item.artist),
      img: formatImage(item.img || item.hts_img),
      time: toText(item.pub),
      desc: decodeHtml(item.info),
      total: item.musiccnt == null ? '' : String(item.musiccnt),
      source: 'kw',
    })),
  }
}

export const normalizeTxAlbumSearch = (body: any): AlbumSearchPage => {
  const data = body?.['music.search.SearchCgiService']?.data ?? body?.req?.data ?? body ?? {}
  const rawList: any[] = Array.isArray(data?.body?.album?.list) ? data.body.album.list : []
  const total = toNumber(data?.meta?.sum ?? data?.meta?.estimate_sum)
  return {
    total,
    list: rawList.map(item => {
      const albumMid = toText(item.albumMID ?? item.albumMid)
      return {
        id: createAlbumListId(albumMid),
        name: decodeHtml(item.albumName),
        author: decodeHtml(item.singerName),
        img: albumMid
          ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumMid}.jpg`
          : toText(item.albumPic),
        time: toText(item.publicTime),
        desc: '',
        total: item.song_count == null ? '' : String(item.song_count),
        source: 'tx' as const,
      }
    }),
  }
}

export const normalizeWyAlbumSearch = (body: any): AlbumSearchPage => {
  const result = body?.result ?? body ?? {}
  const rawList: any[] = Array.isArray(result.albums) ? result.albums : []
  return {
    total: toNumber(result.albumCount),
    list: rawList.map(item => ({
      id: createAlbumListId(item.id),
      name: decodeHtml(item.name),
      author: joinArtists(item.artists),
      img: toText(item.picUrl),
      time: formatDate(item.publishTime),
      desc: decodeHtml(item.description || item.briefDesc),
      total: item.size == null ? '' : String(item.size),
      source: 'wy',
    })),
  }
}

export const normalizeMgAlbumSearch = (body: any): AlbumSearchPage => {
  const data = body?.albumResultData ?? body?.data?.albumResultData ?? body ?? {}
  const rawList: any[] = Array.isArray(data.result) ? data.result : []
  return {
    total: toNumber(data.totalCount),
    list: rawList.map(item => ({
      id: createAlbumListId(item.id),
      name: decodeHtml(item.name),
      author: decodeHtml(item.singer),
      img: toText(item.imgItems?.[0]?.img ?? item.img),
      time: toText(item.publishDate),
      desc: decodeHtml(item.desc),
      total: item.songCount == null ? '' : String(item.songCount),
      source: 'mg',
    })),
  }
}

export const normalizeTxAlbumSongs = (rawList: any = []): any[] => {
  if (!Array.isArray(rawList)) return []
  return rawList.map(item => {
    const file = item.file ?? {}
    const albumMid = toText(item.album?.mid ?? item.albumMid)
    const { types, _types } = createQualitys([
      ['128k', file.size_128mp3],
      ['320k', file.size_320mp3],
      ['flac', file.size_flac],
      ['flac24bit', file.size_hires],
    ])
    return {
      singer: joinArtists(item.singer),
      name: toText(item.title ?? item.name),
      albumName: toText(item.album?.name),
      albumId: albumMid,
      source: 'tx',
      lang: item.language ?? null,
      interval: formatPlayTime(item.interval),
      songId: item.id,
      albumMid,
      strMediaMid: toText(file.media_mid ?? item.strMediaMid),
      songmid: item.mid,
      img: albumMid && albumMid !== '空'
        ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumMid}.jpg`
        : item.singer?.length
          ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${item.singer[0].mid}.jpg`
          : '',
      lrc: null,
      otherSource: null,
      types,
      _types,
      typeUrl: {},
    }
  })
}

export const normalizeWyAlbumSongs = (rawList: any = [], album: any = null): any[] => {
  if (!Array.isArray(rawList)) return []
  return rawList.map(item => {
    const al = item.al ?? {}
    const { types, _types } = createQualitys([
      ['128k', item.l?.size],
      ['320k', item.h?.size],
      ['flac', item.sq?.size],
      ['flac24bit', item.hr?.size],
    ])
    return {
      singer: joinArtists(item.ar),
      name: toText(item.name),
      albumName: toText(al.name ?? album?.name),
      albumId: al.id ?? album?.id,
      source: 'wy',
      interval: formatPlayTime(toNumber(item.dt) / 1000),
      songmid: item.id,
      img: toText(al.picUrl ?? album?.picUrl),
      lrc: null,
      otherSource: null,
      types,
      _types,
      typeUrl: {},
    }
  })
}
