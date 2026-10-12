/* eslint-disable require-atomic-updates */
import { getData, saveData, removeData } from '@/plugins/storage'
import { recommendationConfig } from './config.ts'
import { updateArtistLangTable } from './language.ts'
import type { ArtistLangTable, LangBucket } from './language.ts'

const ARTIST_LANG_KEY = 'xunyin_recommend_artist_lang_v1'

let table: ArtistLangTable | null = null
let pendingLoad: Promise<ArtistLangTable> | null = null

export const loadArtistLangTable = async(): Promise<ArtistLangTable> => {
  if (table) return table
  let loaded: ArtistLangTable | null = null
  try {
    loaded = await getData<ArtistLangTable>(ARTIST_LANG_KEY)
  } catch {
    loaded = null
  }
  table = loaded && typeof loaded == 'object' ? loaded : {}
  return table
}

/** 未 load 完成时返回空表而不是抛错：打分路径不该被存储时序卡住。 */
export const getArtistLangTable = (): ArtistLangTable => table ?? {}

let saveTimer: ReturnType<typeof setTimeout> | null = null

const scheduleSave = () => {
  if (!table || saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (!table) return
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
  const write = (target: ArtistLangTable) => {
    updateArtistLangTable(target, artists, bucket, source, recommendationConfig.language.artistTableLimit, Date.now())
    scheduleSave()
  }
  if (table) {
    write(table)
    return
  }
  pendingLoad ??= loadArtistLangTable()
  void pendingLoad.then(write).catch(() => {})
  void pendingLoad.finally(() => {
    pendingLoad = null
  })
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
  if (!table) return
  await saveData(ARTIST_LANG_KEY, table).catch(() => {})
}

export const clearArtistLangTable = async() => {
  table = {}
  await removeData(ARTIST_LANG_KEY).catch(() => {})
}

export const getArtistLangKey = () => ARTIST_LANG_KEY
