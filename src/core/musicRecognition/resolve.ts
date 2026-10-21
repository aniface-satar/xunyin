import type { RecognizedSong } from './types'
import { songKey } from './session.ts'

export type { RecognizedSong }

// 识别只给回「一首歌的名字」，歌曲条要的是能播、有封面有时长的 musicInfo。
// 这个模块把命中的 RecognizedSong 变成歌条：查、挑、缓存，全在后台排队跑。
//
// 两条设计约束，都是硬约束（无自建后端 + 用户量涨了不能崩）直接决定的：
// 1. 每首歌的解析要往外发请求（Shazam 那条要打五个音源），所以队列必须串行，
//    一屏七首同时开查就是几十笔并发请求。
// 2. 一次按下最多听约 6 轮、每轮两个引擎，命中数没有上限，所以每会话解析
//    PER_SESSION_LIMIT 首就停手，多出来的挂在 waiting 等用户点。
//    用户的手是唯一能突破上限的入口 —— 那笔请求是用户自己要的。

export type ResolveStatus = 'waiting' | 'pending' | 'ready' | 'failed'

export interface ResolveEntry {
  key: string
  engineId: string
  song: RecognizedSong
  status: ResolveStatus
  musicInfo: LX.Music.MusicInfoOnline | null
}

/** 音源搜索接口给回的旧格式行：来自 .js，字段只能按「可能是任何东西」处理 */
export type SearchRow = Record<string, unknown>

export interface ResolveDeps {
  /** 网易云搜索，返回旧格式行（含 songmid，就是识别结果里的 neteaseSongId） */
  searchNcm: (query: string) => Promise<SearchRow[]>
  /** 五个音源并发搜索，返回按匹配度排好序的旧格式行 */
  searchAllSources: (song: RecognizedSong) => Promise<SearchRow[]>
  /** 旧格式行 → 歌条用的新格式；页面上传真·toNewMusicInfo，测试里传记号包装 */
  toMusicInfo: (row: SearchRow) => LX.Music.MusicInfoOnline
}

// 每首新命中要打的请求：ncm 一笔、Shazam 五笔。5 首封顶把每次按下的
// 解析请求钉在「个位数到二十几笔」之间，而不是跟着命中数无限涨。
export const PER_SESSION_LIMIT = 5

const trim = (str: string) => (str || '').trim()

// 搜索行的字段来自 .js，什么都可能是。一个字段坏了不该让整首歌挑不出来，
// 所以先归一成可比较的文本再比。
const asText = (value: unknown): string => typeof value == 'string' ? value : value == null ? '' : String(value)

// ncm 挑行：先认 id（识别接口给的就是网易云自己的 songmid，这是唯一不会认错的键），
// 再退到歌名+歌手都相等，都不满足也不能空手——识别结果本身带着真的网易云 id，
// 合成一行只是没封面没时长，点了照样能播。
const pickNcmRow = (rows: SearchRow[], song: RecognizedSong): SearchRow | null => {
  if (song.neteaseSongId) {
    const exact = rows.find(item => asText(item.songmid) == song.neteaseSongId)
    if (exact) return exact
  }
  const name = trim(song.name)
  const singer = trim(song.singer)
  return rows.find(item => trim(asText(item.name)) == name && trim(asText(item.singer)) == singer) ?? null
}

const fallbackRow = (song: RecognizedSong) => ({
  source: 'wy',
  songmid: song.neteaseSongId,
  name: song.name,
  singer: song.singer,
  albumName: song.albumName,
  // 合成行只有识别给的四个字段，封面与时长宁可空着也不许编：
  // 歌曲条对空封面有空态占位，对瞎填的时长没有。
  img: '',
  interval: '',
  types: [],
  _types: {},
})

export const createResolver = (deps: ResolveDeps) => {
  const entries = new Map<string, ResolveEntry>()
  const queue: string[] = []
  const listeners = new Set<() => void>()
  // 本会话已开查的「首」数（不是请求笔数）。beginSession 复位，tap 不受限。
  let started = 0
  let running = false

  const notify = () => {
    for (const listener of listeners) listener()
  }

  const setEntry = (key: string, entry: ResolveEntry) => {
    entries.set(key, entry)
    notify()
  }

  const search = async(entry: ResolveEntry): Promise<LX.Music.MusicInfoOnline | null> => {
    if (entry.engineId == 'ncm') {
      const rows = await deps.searchNcm(`${trim(entry.song.name)} ${trim(entry.song.singer)}`.trim())
      return deps.toMusicInfo(pickNcmRow(rows, entry.song) ?? fallbackRow(entry.song))
    }
    // Shazam 只给回文本（它的 neteaseSongId 恒为空串，见 shazamApi.ts），
    // 所以必须查到某个音源里有同名同歌手的歌才有歌条可画；查不到就是查不到，
    // 合成一行会画出一张点了必崩的条。
    const rows = await deps.searchAllSources(entry.song)
    const best = rows[0]
    return best ? deps.toMusicInfo(best) : null
  }

  // 串行：一首查完才轮到下一首。
  const drain = async() => {
    if (running) return
    running = true
    while (queue.length) {
      const key = queue.shift()!
      const entry = entries.get(key)
      if (!entry || entry.status != 'pending') continue
      let musicInfo: LX.Music.MusicInfoOnline | null = null
      try {
        musicInfo = await search(entry)
      } catch {
        musicInfo = null
      }
      // 期间用户可能又点了一次同一首（tap 会把它重新入队），落定前先确认它还在 pending。
      if (entries.get(key)?.status != 'pending') continue
      setEntry(key, { ...entry, status: musicInfo ? 'ready' : 'failed', musicInfo })
    }
    running = false
  }

  const start = (entry: ResolveEntry) => {
    setEntry(entry.key, { ...entry, status: 'pending' })
    queue.push(entry.key)
    started += 1
    void drain()
  }

  return {
    /** 新的按下：上限计数复位。已解析好的歌条留在缓存里不重查——同一首在下一轮又被听到时不该再打五源。 */
    beginSession: () => { started = 0 },

    /**
     * 一轮的命中进来。同一首（songKey 相同）重复命中只查第一次。
     *
     * options 是给历史页用的：翻旧账不该派请求，所以
     * - musicInfo 已经查到过的行直接落成 ready，点了就能播，不再打一次搜索；
     * - autoStart: false 只登记一行，挂着等用户点（tap 才是开查的入口）。
     * 两者都不占每会话那 5 个名额 —— 名额是留给「刚听到的歌」的。
     */
    request: (engineId: string, song: RecognizedSong, options?: { autoStart?: boolean, musicInfo?: LX.Music.MusicInfoOnline | null }) => {
      const key = songKey(song)
      if (entries.has(key)) return
      const entry: ResolveEntry = { key, engineId, song, status: 'waiting', musicInfo: null }
      if (options?.musicInfo) {
        setEntry(key, { ...entry, status: 'ready', musicInfo: options.musicInfo })
        return
      }
      if (options?.autoStart === false) {
        setEntry(key, entry)
        return
      }
      if (started < PER_SESSION_LIMIT) {
        start(entry)
      } else {
        setEntry(key, entry)
      }
    },

    /**
     * 点一行：waiting 的那首开始查，failed 的那首重查。
     * 这是唯一能越过 PER_SESSION_LIMIT 的入口——那笔请求是用户自己伸手要的。
     */
    tap: (key: string) => {
      const entry = entries.get(key)
      if (!entry || entry.status == 'pending' || entry.status == 'ready') return
      start(entry)
    },

    get: (key: string): ResolveEntry | undefined => entries.get(key),

    hasPending: () => running || queue.length > 0,

    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

export type Resolver = ReturnType<typeof createResolver>

export type RowAction =
  { kind: 'play', musicInfo: LX.Music.MusicInfoOnline }
  | { kind: 'lookup' }
  | { kind: 'none' }

/**
 * 一行点下去该干什么。抽出来是因为这是结果页唯一会崩人的分支：
 * 对着还没解析出歌条的命中调 handlePlay 就是传 null 进去。
 */
export const rowAction = (entry: ResolveEntry | undefined): RowAction => {
  if (!entry) return { kind: 'none' }
  if (entry.status == 'ready' && entry.musicInfo) return { kind: 'play', musicInfo: entry.musicInfo }
  // 正在查的那行点了不该再捅一次：同一首歌再打五个音源等于用户手滑就多五笔请求。
  if (entry.status == 'pending') return { kind: 'none' }
  return { kind: 'lookup' }
}
