import musicSdk, { findMusic } from '@/utils/musicSdk'
import { toNewMusicInfo } from '@/utils'
import type { ResolveDeps, SearchRow } from './resolve.ts'

// 命中 → 歌条的后台解析依赖，真·接线（五个音源 + 网易云搜索）。
// 从面板里搬出来是因为历史页也要能点开同一批歌条：它自己造一个 resolver，
// 而这两处必须用同一套查法，不然同一首歌在两个页面会挑出不同的行。
//
// createResolver 的会话状态在它自己手里，这里只有无状态的查法。

// 识曲结果要变成能播的歌条，ncm 那条靠网易云自己的 songmid 对回原曲，
// 所以只搜一个音源、拿前几条候选就够；Shazam 那条只有文本，必须五源并发。
const NCM_SEARCH_LIMIT = 8

export const resolveDeps: ResolveDeps = {
  searchNcm: async(query) => {
    const result = await musicSdk.wy.musicSearch.search(query, 1, NCM_SEARCH_LIMIT)
    return result.list as SearchRow[]
  },
  // source 传空串是刻意的：searchMusic 只按 `source.id == s` 排除音源，空串一个都不排除，
  // 于是五个音源都参与匹配。interval 与 albumName 留空会让 findMusic 的时长闸门变成 no-op ——
  // 识曲只给回歌名歌手，编一个时长出来只会把对的那条筛掉。
  searchAllSources: async(song) => findMusic({
    name: song.name,
    singer: song.singer,
    albumName: '',
    interval: '',
    source: '',
  }) as Promise<SearchRow[]>,
  toMusicInfo: row => toNewMusicInfo(row) as LX.Music.MusicInfoOnline,
}
