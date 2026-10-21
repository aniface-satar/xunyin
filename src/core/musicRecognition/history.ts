import { songKey } from './session.ts'
import type { RecognizedSong } from './types.ts'

// 历史识曲的全部判断都放在这个纯模块里：存储（AsyncStorage）与广播（app_event）从外面接进来，
// 于是去重、封顶、按天分组这些规则能离线跑单测，不用起 React Native。

// 一屏一屏往下翻也翻不完的量，又能把常驻内存钉住：200 行。
export const HISTORY_LIMIT = 200

export interface HistoryItem {
  // 一行就是一首歌，标识直接用结果列表那套 songKey，所以同一首再听到只顶到最前、不新增行。
  key: string
  engineId: string
  song: RecognizedSong
  recognizedAt: number
  // 已经查到过的歌条。历史页要能直接点开播，靠的就是它：没有它得重新联网查一遍。
  musicInfo: LX.Music.MusicInfoOnline | null
}

// 读写都在外面接，单测里塞个内存数组就行。get 的返回类型故意放宽：
// 盘上躺着什么版本的数据都有可能，脏的一律交给 sanitizeHistory 处理。
export interface HistoryStorage {
  get: () => Promise<unknown>
  set: (list: HistoryItem[]) => Promise<void>
}

export interface HistoryGroup {
  dayKey: string
  // 这一组里最晚的一条，拿它当分组标题的时间基准。
  at: number
  items: HistoryItem[]
}

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value == 'object' && value != null
}

const toText = (value: unknown): string => {
  if (typeof value == 'string') return value
  if (typeof value == 'number') return String(value)
  return ''
}

const sanitizeSong = (raw: unknown): RecognizedSong | null => {
  if (!isObject(raw)) return null
  const name = toText(raw.name)
  // 歌名空着的行在列表里既没法定位也没法查，留着只会让历史页出现一行空白。
  if (name.trim() == '') return null
  const startTimeMs = raw.startTimeMs
  return {
    name,
    singer: toText(raw.singer),
    albumName: toText(raw.albumName),
    neteaseSongId: toText(raw.neteaseSongId),
    startTimeMs: typeof startTimeMs == 'number' && isFinite(startTimeMs) ? startTimeMs : 0,
  }
}

const sanitizeMusicInfo = (raw: unknown): LX.Music.MusicInfoOnline | null => {
  if (!isObject(raw)) return null
  // 没有 id 的歌条点不开，按「还没查到」处理，让历史页回落到「点一下去找」。
  const id = toText(raw.id)
  if (id == '') return null
  return raw as unknown as LX.Music.MusicInfoOnline
}

export const sanitizeHistory = (raw: unknown): HistoryItem[] => {
  if (!Array.isArray(raw)) return []
  const list: HistoryItem[] = []
  for (const entry of raw) {
    if (!isObject(entry)) continue
    const engineId = toText(entry.engineId)
    if (engineId == '') continue
    const recognizedAt = entry.recognizedAt
    if (typeof recognizedAt != 'number' || !isFinite(recognizedAt)) continue
    const song = sanitizeSong(entry.song)
    if (song == null) continue
    // key 一律用 song 现算，不认盘上存的那份：它是去重的依据，跟歌本身对不上就会长出一行重复的。
    list.push({
      key: songKey(song),
      engineId,
      song,
      recognizedAt,
      musicInfo: sanitizeMusicInfo(entry.musicInfo),
    })
  }
  return list
}

const pad2 = (num: number): string => num < 10 ? `0${num}` : `${num}`

// 只认本地日界：用户看的是自己手机上的日历，用 UTC 会在月末把同一天劈成两组。
export const dayKeyOf = (ts: number): string => {
  const date = new Date(ts)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

// 列表本身新→旧，所以按首次出现的先后就是按天倒序；组内顺序照输入不动。
export const groupByDay = (items: HistoryItem[]): HistoryGroup[] => {
  const groups: HistoryGroup[] = []
  const index = new Map<string, HistoryGroup>()
  for (const item of items) {
    const dayKey = dayKeyOf(item.recognizedAt)
    let group = index.get(dayKey)
    if (group == null) {
      group = { dayKey, at: item.recognizedAt, items: [] }
      index.set(dayKey, group)
      groups.push(group)
    }
    if (item.recognizedAt > group.at) group.at = item.recognizedAt
    group.items.push(item)
  }
  return groups
}

export interface HistorySession {
  dayKey: string
  // 这一次里最晚的一条：标题的时分从它算，而不是从第一条算 —— 同一次里几首歌的时间并不相同。
  at: number
  items: HistoryItem[]
}

// 按下一次只听一分钟，两个引擎各出一批，同一次内部的间隔到不了三分钟；
// 10 分钟是留了余量的：这么久没新歌声明就是又按了一次。
export const SESSION_GAP_MS = 10 * 60 * 1000

// 先按天切开（跨天肯定不是同一次），再在当天内按相邻两条的时间间隔切次。
// 间隔取绝对值：列表本该新→旧，但同一首重听会被摘到最前并刷新时间，
// 顺序上的一点意外不该多切出一节。
export const groupBySession = (items: HistoryItem[], gap: number = SESSION_GAP_MS): HistorySession[] => {
  const sessions: HistorySession[] = []
  for (const group of groupByDay(items)) {
    let current: HistorySession | null = null
    let previous = 0
    for (const item of group.items) {
      if (current == null || Math.abs(item.recognizedAt - previous) > gap) {
        current = { dayKey: group.dayKey, at: item.recognizedAt, items: [] }
        sessions.push(current)
      }
      if (item.recognizedAt > current.at) current.at = item.recognizedAt
      current.items.push(item)
      previous = item.recognizedAt
    }
  }
  return sessions
}

export interface HistoryHandle {
  add: (engineId: string, song: RecognizedSong) => Promise<void>
  attach: (key: string, musicInfo: LX.Music.MusicInfoOnline | null) => Promise<void>
  clear: () => Promise<void>
  list: () => Promise<HistoryItem[]>
}

export const createHistory = (deps: {
  storage: HistoryStorage
  now: () => number
  limit?: number
  onUpdated?: (list: HistoryItem[]) => void
}): HistoryHandle => {
  const { storage, now, onUpdated } = deps
  const limit = deps.limit ?? HISTORY_LIMIT
  let cache: HistoryItem[] | null = null
  let loading: Promise<HistoryItem[]> | null = null

  // 读一次就够：面板每轮都记一笔，不能每次落盘前回趟盘。读失败当空表，识曲不该被历史带崩。
  const load = async(): Promise<HistoryItem[]> => {
    if (cache != null) return cache
    loading ??= storage.get().then(raw => {
      cache = sanitizeHistory(raw)
      return cache
    }).catch(() => {
      cache = []
      return cache
    })
    return loading
  }

  // 内存先行、写盘尽力：盘满、存储没起来这些故障只丢这一笔持久化，
  // 识别循环和界面那一行都还得照常长。
  const write = async(list: HistoryItem[]) => {
    cache = list
    try {
      await storage.set(list)
    } catch { }
    onUpdated?.(list)
  }

  const add = async(engineId: string, song: RecognizedSong) => {
    const key = songKey(song)
    const current = await load()
    // 同一首再听到：把旧行摘掉，带着原来的歌条顶到最前，只刷新时间。
    // 歌条不能退回 null —— 否则用户刚能点开的那一行又变回「点一下去找」。
    const previous = current.find(item => item.key == key)
    const item: HistoryItem = {
      key,
      engineId,
      song,
      recognizedAt: now(),
      musicInfo: previous?.musicInfo ?? null,
    }
    await write([item, ...current.filter(i => i.key != key)].slice(0, limit))
  }

  const attach = async(key: string, musicInfo: LX.Music.MusicInfoOnline | null) => {
    const current = await load()
    const index = current.findIndex(item => item.key == key)
    if (index == -1) return
    const target = current[index]
    // 回填是幂等的：后台解析会把同一首反复交进来，id 没变就别写盘别广播。
    if ((target.musicInfo?.id ?? '') == (musicInfo?.id ?? '')) return
    const next = [...current]
    // 只换这一行，不动先后 —— 补歌条不是「又听到一次」。
    next[index] = { ...target, musicInfo }
    await write(next)
  }

  const clear = async() => {
    await write([])
  }

  const list = async() => {
    return load()
  }

  return { add, attach, clear, list }
}
