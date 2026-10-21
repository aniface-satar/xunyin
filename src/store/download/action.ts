import { getData, saveData } from '@/plugins/storage'
import { storageDataPrefix } from '@/config/constant'
import { event } from './event'
import { mergeLoadedList } from './merge'
import { state } from './state'

let isLoaded = false
let loadPromise: Promise<void> | undefined
let saveTimer: ReturnType<typeof setTimeout> | undefined

const save = () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    void saveData(storageDataPrefix.downloadList, state.list).catch(() => {})
  }, 200)
}

export const load = async() => {
  if (isLoaded) return
  loadPromise ??= getData<LX.Download.ListItem[]>(storageDataPrefix.downloadList).then((list) => {
    // 读盘期间用户点的下载不能被盘上的名单冲掉（见 merge.ts）
    state.list = mergeLoadedList(state.list, list ?? [])
    isLoaded = true
    event.download_changed()
  }).catch(() => {
    isLoaded = true
    event.download_changed()
  })
  await loadPromise
}

export const setList = (list: LX.Download.ListItem[]) => {
  state.list = list
  save()
  event.download_changed()
}

export const addItem = (item: LX.Download.ListItem) => {
  if (state.list.some(listItem => listItem.id == item.id)) return
  state.list = [item, ...state.list]
  save()
  event.download_changed()
}

export const updateItem = (id: string, data: Partial<LX.Download.ListItem>) => {
  const index = state.list.findIndex(item => item.id == id)
  if (index < 0) return
  state.list = state.list.map((item, itemIndex) => {
    return itemIndex == index ? { ...item, ...data } : item
  })
  save()
  event.download_changed()
}

export const removeItem = (id: string) => {
  if (!state.list.some(item => item.id == id)) return
  state.list = state.list.filter(item => item.id != id)
  save()
  event.download_changed()
}
