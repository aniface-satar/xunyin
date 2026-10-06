import { buildTrackKey } from './trackKey.ts'
import type { RecommendQueueItem } from './types.ts'

export interface RadioQueueSnapshot {
  version: number
  size: number
  items: RecommendQueueItem[]
  keys: string[]
}

/**
 * 本地候选队列：异步生成结果带版本号，旧请求返回时整批丢弃；
 * 同一首歌不会并发插入多次。
 */
export const createRadioQueue = () => {
  let version = 1
  let items: RecommendQueueItem[] = []
  let knownKeys = new Set<string>()

  const rebuildKeys = () => {
    knownKeys = new Set(items.map(item => buildTrackKey(item.musicInfo)))
  }

  return {
    getVersion: () => version,
    invalidate: () => {
      version += 1
      items = []
      knownKeys.clear()
      return version
    },
    clear: () => {
      items = []
      knownKeys.clear()
    },
    size: () => items.length,
    has: (trackKey: string) => knownKeys.has(trackKey),
    keys: () => [...knownKeys],
    peek: (count = 5) => items.slice(0, count),
    snapshot: (): RadioQueueSnapshot => ({ version, size: items.length, items: [...items], keys: [...knownKeys] }),
    /** 只有版本匹配时才接收异步生成结果，防止旧请求把旧队列写回来。 */
    enqueue: (next: RecommendQueueItem[], token: number): boolean => {
      if (token != version) return false
      const accepted: RecommendQueueItem[] = []
      for (const item of next) {
        const key = buildTrackKey(item.musicInfo)
        if (knownKeys.has(key)) continue
        knownKeys.add(key)
        accepted.push(item)
      }
      items.push(...accepted)
      return accepted.length > 0
    },
    /** 切歌优先消费本地候选；版本不匹配返回空，不阻塞网络。 */
    shift: (count: number, token: number): RecommendQueueItem[] => {
      if (token != version || count <= 0) return []
      const taken = items.splice(0, count)
      for (const item of taken) knownKeys.delete(buildTrackKey(item.musicInfo))
      return taken
    },
    removeTrackKey: (trackKey: string) => {
      const before = items.length
      items = items.filter(item => buildTrackKey(item.musicInfo) != trackKey)
      if (items.length != before) rebuildKeys()
      return before - items.length
    },
    removeMany: (trackKeys: ReadonlySet<string>, token?: number) => {
      if (token != null && token != version) return 0
      const before = items.length
      items = items.filter(item => !trackKeys.has(buildTrackKey(item.musicInfo)))
      if (items.length != before) rebuildKeys()
      return before - items.length
    },
  }
}

export type RadioQueue = ReturnType<typeof createRadioQueue>
