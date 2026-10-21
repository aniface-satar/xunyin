import { getData, saveData } from '@/plugins/storage'
import { createHistory, type HistoryItem } from './history.ts'

// 历史识曲的单例：面板往里记，历史页从里读，两边都通过 global.app_event 收到同一份列表。
// 规则都在 history.ts，这一层只负责「存到盘上」和「通知出去」。

const HISTORY_STORAGE_KEY = 'musicRecognition.history'

const storage = {
  get: async() => getData<unknown>(HISTORY_STORAGE_KEY),
  set: async(list: HistoryItem[]) => {
    await saveData(HISTORY_STORAGE_KEY, list)
  },
}

export const recognitionHistory = createHistory({
  storage,
  now: Date.now,
  // 广播的是副本：history.ts 每次写入都换新数组，但列表内容归它自己管，
  // 页面拿到的一定是只读快照，改不动存储里的行。
  onUpdated: list => { global.app_event.musicRecognitionHistoryUpdated([...list]) },
})
