import he from 'he'

import type { AlbumSearchItem } from './albumNormalizers'

// 纯函数：不得引入 request/config/store，测试会直接 import 本模块

export type ArtistSource = 'kg' | 'kw' | 'tx' | 'wy' | 'mg'

export type ArtistSongSort = 'hot' | 'new'

// 各源歌手歌曲接口的热门/最新参数；mg 接口没有最新参数，不参与
export const ARTIST_SONG_SORT_PARAMS = {
  kg: { hot: 2, new: 1 },
  kw: { hot: 0, new: 1 },
  tx: { hot: 5, new: 2 },
  wy: { hot: 'hot', new: 'time' },
} as const

export interface ArtistSearchItem {
  id: string
  name: string
  alias: string
  img: string
  songCount: string
  albumCount: string
  source: ArtistSource
}

export interface ArtistSearchPage {
  list: ArtistSearchItem[]
  total: number
}

export interface ArtistDetail {
  name: string
  alias: string
  img: string
  songCount: string
  albumCount: string
  desc: string
}

export interface ArtistAlbumPage {
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
  return he.decode(text).replace(/<[^>]+>/g, '').trim()
}

const countText = (value: unknown): string => value == null ? '' : String(value)

const joinAlias = (alias: unknown): string => {
  if (Array.isArray(alias)) return alias.map(toText).filter(Boolean).join('、')
  return toText(alias)
}

const decodeDesc = (value: unknown): string => {
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

const joinArtistObjects = (artists: unknown): string => {
  if (Array.isArray(artists)) return artists.map(artist => toText(artist?.name)).filter(Boolean).join('、')
  return toText((artists as any)?.name)
}

const countOrEmpty = (value: unknown): string => {
  const num = toNumber(value)
  return num > 0 ? String(num) : ''
}

const emptyDetail = (): ArtistDetail => ({
  name: '',
  alias: '',
  img: '',
  songCount: '',
  albumCount: '',
  desc: '',
})

export const hasMoreByTotal = (total: number, loaded: number): boolean => total > 0 && loaded < total

export const hasMoreByLength = (length: number, limit: number): boolean => length >= limit

// kg 的歌手搜索接口忽略 page 参数，只返回前 10 条，按单页收口
export const normalizeKgArtistSearch = (body: any): ArtistSearchPage => {
  const rawList: any[] = Array.isArray(body?.data) ? body.data : []
  const list = rawList.map(item => ({
    id: toText(item.singerid),
    name: decodeHtml(item.singername),
    alias: '',
    img: '',
    songCount: '',
    albumCount: '',
    source: 'kg' as const,
  })).filter(item => item.id && item.name)
  return {
    total: list.length,
    list,
  }
}

export const normalizeKwArtistSearch = (body: any): ArtistSearchPage => {
  const base = toText(body?.BASEPICPATH)
  const rawList: any[] = Array.isArray(body?.abslist) ? body.abslist : []
  const list = rawList.map(item => {
    const picPath = toText(item.PICPATH)
    return {
      id: toText(item.ARTISTID ?? item.DC_TARGETID),
      name: decodeHtml(item.ARTIST),
      alias: joinAlias(item.AARTIST),
      img: picPath
        ? (/^https?:\/\//.test(picPath) ? picPath : `${base}${picPath}`)
        : '',
      songCount: countText(item.SONGNUM),
      albumCount: countText(item.ALBUMNUM),
      source: 'kw' as const,
    }
  }).filter(item => item.id && item.name)
  return {
    total: toNumber(body?.TOTAL),
    list,
  }
}

export const normalizeTxArtistSearch = (body: any): ArtistSearchPage => {
  const data = body?.['music.search.SearchCgiService']?.data ?? body?.req?.data ?? body ?? {}
  const rawList: any[] = Array.isArray(data?.body?.singer?.list) ? data.body.singer.list : []
  const list = rawList.map(item => {
    const mid = toText(item.singerMID)
    return {
      id: mid || toText(item.singerID),
      name: decodeHtml(item.singerName),
      alias: '',
      img: mid
        ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${mid}.jpg`
        : toText(item.singerPic),
      songCount: countText(item.songNum),
      albumCount: countText(item.albumNum),
      source: 'tx' as const,
    }
  }).filter(item => item.id && item.name)
  return {
    total: toNumber(data?.meta?.sum),
    list,
  }
}

export const normalizeWyArtistSearch = (body: any): ArtistSearchPage => {
  const result = body?.result ?? body ?? {}
  const rawList: any[] = Array.isArray(result.artists) ? result.artists : []
  return {
    total: toNumber(result.artistCount),
    list: rawList.map(item => ({
      id: toText(item.id),
      name: decodeHtml(item.name),
      alias: joinAlias(item.alias),
      img: toText(item.picUrl),
      songCount: countText(item.musicSize),
      albumCount: countText(item.albumSize),
      source: 'wy' as const,
    })).filter(item => item.id && item.name),
  }
}

export const normalizeMgArtistSearch = (body: any): ArtistSearchPage => {
  const data = body?.singerResultData ?? body?.data?.singerResultData ?? body ?? {}
  const rawList: any[] = Array.isArray(data.result) ? data.result : []
  return {
    total: toNumber(data.totalCount),
    list: rawList.map(item => {
      const pics: any[] = Array.isArray(item.singerPicUrl) ? item.singerPicUrl : []
      const pic = pics.find(pic => pic?.imgSizeType === '03') ?? pics[pics.length - 1] ?? pics[0]
      return {
        id: toText(item.id),
        name: decodeHtml(item.name),
        alias: '',
        img: toText(pic?.img),
        songCount: countText(item.songCount),
        albumCount: countText(item.albumCount),
        source: 'mg' as const,
      }
    }).filter(item => item.id && item.name),
  }
}

export const normalizeKgArtistDetail = (body: any): ArtistDetail => {
  const data = body?.data ?? body ?? {}
  return {
    ...emptyDetail(),
    name: decodeHtml(data.singername),
    alias: joinAlias(data.alias),
    img: formatImage(data.imgurl),
    songCount: countText(data.songcount),
    albumCount: countText(data.albumcount),
    desc: decodeDesc(data.profile || data.intro),
  }
}

export const normalizeKwArtistDetail = (body: any): ArtistDetail => {
  return {
    ...emptyDetail(),
    name: decodeHtml(body?.name),
    alias: joinAlias(body?.aartist),
    img: toText(body?.hts_pic),
    songCount: countText(body?.musicnum),
    albumCount: countText(body?.albumnum),
    desc: decodeDesc(body?.desc),
  }
}

export const normalizeTxArtistDetail = (body: any): ArtistDetail => {
  const data = body?.['music.musichallSinger.SingerInfoInter']?.data ?? body?.req_1?.data ?? {}
  const singer = Array.isArray(data.singer_list) ? data.singer_list[0] ?? {} : {}
  return {
    ...emptyDetail(),
    name: decodeHtml(singer.basic_info?.name),
    alias: toText(singer.ex_info?.foreign_name),
    desc: decodeDesc(singer.ex_info?.desc),
  }
}

export const normalizeWyArtistDetail = (body: any): ArtistDetail => {
  const artist = body?.artist ?? body ?? {}
  return {
    ...emptyDetail(),
    name: decodeHtml(artist.name),
    alias: joinAlias(artist.alias),
    img: toText(artist.picUrl),
    songCount: countText(artist.musicSize),
    albumCount: countText(artist.albumSize),
    desc: decodeDesc(artist.briefDesc),
  }
}

export const normalizeMgArtistDetail = (body: any): ArtistDetail => {
  const contents: any[] = Array.isArray(body?.data?.contents) ? body.data.contents : []
  const scroll = contents.find(item => item?.view == 'ZJ-Singer-Intro-Scroll')
  const items: any[] = Array.isArray(scroll?.contents) ? scroll.contents : []
  const intro = items.find(item => item?.view == 'ZJ-Singer-Intro-Item') ?? {}
  return {
    ...emptyDetail(),
    desc: decodeDesc(intro.txt2),
  }
}

export const mergeArtistDetail = (base: ArtistSearchItem, detail: ArtistDetail): ArtistDetail => ({
  name: detail.name || base.name,
  alias: detail.alias || base.alias,
  img: detail.img || base.img,
  songCount: detail.songCount || base.songCount,
  albumCount: detail.albumCount || base.albumCount,
  desc: detail.desc,
})

export const normalizeKgArtistAlbums = (body: any): ArtistAlbumPage => {
  const data = body?.data ?? {}
  const rawList: any[] = Array.isArray(data.info) ? data.info : []
  return {
    total: toNumber(data.total),
    list: rawList.map(item => ({
      id: toText(item.albumid),
      name: decodeHtml(item.albumname),
      author: decodeHtml(item.singername),
      img: formatImage(item.imgurl),
      time: toText(item.publishtime),
      desc: decodeDesc(item.intro),
      total: countText(item.songcount),
      source: 'kg' as const,
    })),
  }
}

export interface KwArtistSongItem {
  MUSICRID: string
  SONGNAME: string
  ARTIST: string
  ALBUM: string
  ALBUMID: string
  DURATION: string
  N_MINFO: string
  web_albumpic_short: string
}

// artist2music 返回小写字段，musicSearch.handleResult 需要旧接口的大写形状
export const normalizeKwArtistSongItem = (item: any): KwArtistSongItem | null => {
  const musicrid = toText(item?.musicrid)
  const nInfo = toText(item?.N_MINFO)
  if (!musicrid || !nInfo) return null
  return {
    MUSICRID: musicrid,
    SONGNAME: toText(item.name),
    ARTIST: toText(item.artist),
    ALBUM: toText(item.album),
    ALBUMID: toText(item.albumid),
    DURATION: toText(item.duration),
    N_MINFO: nInfo,
    web_albumpic_short: toText(item.web_albumpic_short),
  }
}

export const normalizeKwArtistAlbums = (body: any): ArtistAlbumPage => {
  const rawList: any[] = Array.isArray(body?.albumlist) ? body.albumlist : []
  return {
    total: toNumber(body?.total),
    list: rawList.map(item => ({
      id: toText(item.albumid),
      name: decodeHtml(item.name),
      author: decodeHtml(item.artist),
      img: toText(item.img || item.hts_img),
      time: toText(item.pub),
      desc: decodeDesc(item.info),
      total: countText(item.musiccnt),
      source: 'kw' as const,
    })),
  }
}

export const normalizeTxArtistAlbums = (body: any): ArtistAlbumPage => {
  const data = body?.['music.musichallAlbum.AlbumListServer']?.data ?? body?.req_1?.data ?? {}
  const rawList: any[] = Array.isArray(data.albumList) ? data.albumList : []
  return {
    total: toNumber(data.total),
    list: rawList.map(item => {
      const mid = toText(item.albumMid)
      return {
        id: mid,
        name: decodeHtml(item.albumName),
        author: decodeHtml(item.singerName),
        img: mid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${mid}.jpg` : '',
        time: toText(item.publishDate),
        desc: '',
        total: countOrEmpty(item.totalNum),
        source: 'tx' as const,
      }
    }),
  }
}

export const normalizeWyArtistAlbums = (body: any): ArtistAlbumPage => {
  const rawList: any[] = Array.isArray(body?.hotAlbums) ? body.hotAlbums : []
  return {
    total: toNumber(body?.total),
    list: rawList.map(item => ({
      id: toText(item.id),
      name: decodeHtml(item.name),
      author: joinArtistObjects(item.artists) || toText(item.artist?.name),
      img: toText(item.picUrl),
      time: formatDate(item.publishTime),
      desc: decodeDesc(item.description || item.briefDesc),
      total: countText(item.size),
      source: 'wy' as const,
    })),
  }
}

export const normalizeMgArtistAlbums = (body: any): ArtistAlbumPage => {
  const contents: any[] = Array.isArray(body?.data?.contents) ? body.data.contents : []
  const rawList = contents.filter(item => item?.view == 'ZJ-Album-Item')
  return {
    total: 0,
    list: rawList.map(item => ({
      id: toText(item.resId),
      name: decodeHtml(item.txt),
      author: decodeHtml(item.txt2),
      img: toText(item.img),
      time: toText(item.txt3),
      desc: '',
      total: '',
      source: 'mg' as const,
    })),
  }
}
