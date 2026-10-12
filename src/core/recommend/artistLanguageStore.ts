/* eslint-disable require-atomic-updates */
import { getData, saveData, removeData } from '@/plugins/storage'
import { recommendationConfig } from './config.ts'
import { updateArtistLangTable } from './language.ts'
import type { ArtistLangTable, LangBucket } from './language.ts'

const ARTIST_LANG_KEY = 'xunyin_recommend_artist_lang_v1'

let table: ArtistLangTable | null = null
let pendingLoad: Promise<ArtistLangTable> | null = null
/**
 * 读盘失败时置 false：此刻内存里的表是从空表起步的，磁盘上那份积累了数周的旧表我们没见过，
 * 照常落盘就会把它整张覆写成近似空表。降级方向是"观察只在内存里累积、什么都不持久化"，
 * 而不是"磁盘表被销毁"。
 */
let persistAllowed = true

/** 真正的读盘只发生在这里；调用方负责保证同一时刻只有一次在途。 */
const readDisk = async(): Promise<ArtistLangTable> => {
  let loaded: ArtistLangTable | null = null
  try {
    loaded = await getData<ArtistLangTable>(ARTIST_LANG_KEY)
  } catch {
    persistAllowed = false
  }
  // await 期间 clearArtistLangTable() 可能已经把 table 换成清盘后的新空表：
  // 此时不能再把这次读到的旧内容写回去，那等于复活一份已被删除的数据。
  // 数组之类的畸形载荷按空表处理（与 candidateStore 的 Array.isArray 守卫同形）。
  if (!table) table = loaded && typeof loaded == 'object' && !Array.isArray(loaded) ? loaded : {}
  return table
}

/**
 * 并发调用必须共用同一次读盘，且只留一份内存表。早先的写法是 `if (table) return table`，
 * 但 table 要等 await 之后才被赋值，于是两次重叠的读盘会各跑一次 getData、各赋值一次 table，
 * 后完成的那次赢；而观察写在先完成的那份对象上，就成了静默丢数据。
 * 挂在 recommend/index.ts doInitialize 的直接调用与 observe() 的排队调用正好会重叠
 * （冷启动恢复播放 handleRestorePlay 就是那个窗口）。
 */
export const loadArtistLangTable = async(): Promise<ArtistLangTable> => {
  if (table) return table
  // pendingLoad 在下面这一行、第一个 await 之前同步置位：所以并发的调用者（doInitialize 的直接
  // 调用与 observe() 的排队调用）必然拿到同一个在途 promise，读盘只会发生一次。
  const load = pendingLoad ??= readDisk().finally(() => {
    pendingLoad = null
  })
  return await load
}

/** 未 load 完成时返回空表而不是抛错：打分路径不该被存储时序卡住。 */
export const getArtistLangTable = (): ArtistLangTable => table ?? {}

let saveTimer: ReturnType<typeof setTimeout> | null = null

const scheduleSave = () => {
  if (!table || !persistAllowed || saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (!table || !persistAllowed) return
    void saveData(ARTIST_LANG_KEY, table).catch(() => {})
  }, recommendationConfig.language.saveDebounceMs)
}

/**
 * 观察写入。table 还没载完时必须排队等同一份 promise：
 * 直接 table ??= {} 会让稍后的 loadArtistLangTable() 命中内存副本、把磁盘上的旧表整张丢掉。
 * 桶能不能入库（unknown / instr 的排除）由 language.ts 的 updateArtistLangTable 入口把关，
 * 这里只挡"什么都不必写"的空观察，避免为一次无效观察起一次磁盘写。
 */
const observe = (artists: readonly string[], bucket: LangBucket | null, source: 'lyric' | 'field') => {
  if (!bucket || !artists.length) return
  // 写入只认此刻的模块级 table，不认 promise 带回来的那份对象：
  // 内存表可能被更晚完成的读盘替换，写进已被丢弃的对象就是一次静默丢失的观察。
  const write = () => {
    if (!table) return
    updateArtistLangTable(table, artists, bucket, source, recommendationConfig.language.artistTableLimit, Date.now())
    scheduleSave()
  }
  if (table) {
    write()
    return
  }
  // 与 doInitialize 里那次直接调用共用同一次在途读盘（见 loadArtistLangTable）。
  void loadArtistLangTable().then(write).catch(() => {})
}

export const observeArtistLyric = (artists: readonly string[], bucket: LangBucket | null) => {
  observe(artists, bucket, 'lyric')
}

export const observeArtistLangField = (artists: readonly string[], bucket: LangBucket | null) => {
  observe(artists, bucket, 'field')
}

export const saveArtistLangTableNow = async() => {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!table || !persistAllowed) return
  await saveData(ARTIST_LANG_KEY, table).catch(() => {})
}

export const clearArtistLangTable = async() => {
  // 先撤掉已排队的防抖写盘：它在 removeData 之后触发会把刚删掉的键又建回来。
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  // 再把内存表换成清盘后的新空表并断开在途读盘，最后才删键：
  // 那次还在途的读盘恢复时看到 table 非空就不会再赋值，清盘前的旧表不会被复活。
  pendingLoad = null
  table = {}
  await removeData(ARTIST_LANG_KEY).catch(() => {})
}

export const getArtistLangKey = () => ARTIST_LANG_KEY
