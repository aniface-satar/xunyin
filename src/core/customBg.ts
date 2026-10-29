/**
 * 自定义图片背景：多套图片 + 每套自己的剪裁与模糊度。
 *
 * 为什么图片列表不塞进 setting：`config/setting.ts` 的 mergeSetting 只认 string/boolean/number
 * 这类原始值，数组在启动合并那一步会被整条跳过 —— 存进去看着有、重启就没了。
 * 所以列表单独走 storage（AsyncStorage 分片），setting 里只留 enabled / applyToPlayer / activeId 这几个原语。
 *
 * 图片文件落在私有目录 `custom_bg/`：`<id>.jpg` 是剪裁后拿去铺底的那张，`<id>_src.jpg` 是原图，
 * 留着给「重新剪裁」用。删一套时两个一起删。
 */
import { useEffect, useMemo, useState } from 'react'
import { getData, saveData } from '@/plugins/storage'
import { storageDataPrefix } from '@/config/constant'
import { copyFile, existsFile, mkdir, privateStorageDirectoryPath, temporaryDirectoryPath, unlink } from '@/utils/fs'
import { setCustomBgSource } from '@/utils/customBgBridge'
import { MAX_WALLPAPER_VEIL, clampWallpaperVeil } from '@/utils/wallpaper/palette'
import settingState from '@/store/setting/state'
import { updateSetting } from '@/core/common'

export interface CustomBgCrop {
  /** 相对铺满尺寸的缩放倍数，1 = 刚好铺满 */
  zoom: number
  /** 旋转角度（度），-180 ~ 180 */
  rot: number
  /** 位移，按裁剪框宽高的比例记，换屏幕尺寸不会跑位 */
  x: number
  y: number
}

export interface CustomBgItem {
  id: string
  name: string
  /** 剪裁后的图片绝对路径，铺底用这张 */
  file: string
  /** 用户选的原始图片绝对路径，重新剪裁用 */
  src: string
  crop: CustomBgCrop
  /** 模糊半径（px），运行时生效，不烘进图片里 */
  blur: number
  /**
   * 深色柔光深度（0 ~ 0.85），也是这一张自己的。
   * 以前它归全局（所有图片共用一档），但"明信片一样亮的图"和"夜景"要压的量差太多，
   * 一档兼顾不了两张 —— 所以跟着 blur 一起进条目，换图时整套回到这张自己的设定。
   */
  veil: number
}

export const CUSTOM_BG_DIR = `${privateStorageDirectoryPath}/custom_bg`
export const MAX_CUSTOM_BG = 8
export const DEFAULT_CUSTOM_BG_BLUR = 0
export const MAX_CUSTOM_BG_BLUR = 40
/** 单独定 0.3，不跟 WALLPAPER 那档走：新图默认只压一点，不喜欢再去滑块里加 */
export const DEFAULT_CUSTOM_BG_VEIL = 0.3
export const MAX_CUSTOM_BG_VEIL = MAX_WALLPAPER_VEIL

let items: CustomBgItem[] = []
let loaded = false
let loadTask: Promise<void> | null = null
const listeners = new Set<() => void>()

const emit = () => {
  listeners.forEach((fn) => { fn() })
}

export const subscribeCustomBg = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** RN 的 Image 只认带 scheme 的 uri，裸路径在安卓上会当成资源名去找 */
export const toImageUri = (path: string) => {
  if (!path) return path
  if (/^(file|content|http|https|data):/.test(path)) return path
  return `file://${path}`
}

/** 反过来的那一半：文件读写要的是裸路径，view-shot 有时会把 file:// 一起带回来 */
const toFsPath = (path: string) => {
  if (!path) return path
  if (!path.startsWith('file://')) return path
  const bare = path.slice(7)
  try {
    return decodeURIComponent(bare)
  } catch (err) {
    return bare
  }
}

export const getCustomBgItems = () => items

export const getActiveCustomBg = (): CustomBgItem | null => {
  const activeId = settingState.setting['theme.customBg.activeId']
  return items.find((item) => item.id === activeId) ?? items[0] ?? null
}

/**
 * 柔光深度落到 setting 上的那一份「镜像」。
 *
 * 真相是每一套背景自己的 `veil`；`theme.customBg.veil` 退化成"当前这套是多少"，只是为了让
 * 消费侧不必改：播控页那支是反编译代码，它同步读的只有 setting 这一个键，改不动；
 * PageContent / GlassBackdrop 也早就订阅这个值。于是每次切换/增删/改图时顺手把它对齐一次。
 */
const syncVeilSetting = (veil: number) => {
  const next = clampWallpaperVeil(veil)
  if (settingState.setting['theme.customBg.veil'] === next) return
  updateSetting({ 'theme.customBg.veil': next })
}

/** 把「当前这套 + 两个开关」同步到窄桥上，主题侧拼 bg-image 时同步读它 */
const syncBridge = () => {
  const item = getActiveCustomBg()
  if (!settingState.setting['theme.customBg.enabled'] || !item) {
    setCustomBgSource(null)
    return
  }
  setCustomBgSource({
    uri: toImageUri(item.file),
    blur: item.blur,
    applyToPlayer: settingState.setting['theme.customBg.applyToPlayer'],
  })
  syncVeilSetting(item.veil)
}

export const setCustomBgEnabled = (enabled: boolean) => {
  updateSetting({ 'theme.customBg.enabled': enabled })
  syncBridge()
  emit()
}

export const setCustomBgApplyToPlayer = (applyToPlayer: boolean) => {
  updateSetting({ 'theme.customBg.applyToPlayer': applyToPlayer })
  syncBridge()
  emit()
}

export const setActiveCustomBg = (id: string) => {
  updateSetting({ 'theme.customBg.activeId': id })
  syncBridge()
  emit()
}

/**
 * 壁纸模式的柔光深度 —— 只写"当前这套"，不再有全局那一档。
 *
 * 不用走 refreshTheme：柔光是运行时叠在背景层上的一层，PageContent / GlassBackdrop / 播控页
 * 都直接读 setting 上那份镜像 —— 拖滑块时页面立刻跟上，不用重拼主题。
 */
export const setCustomBgVeil = (veil: number) => {
  const item = getActiveCustomBg()
  const next = clampWallpaperVeil(veil)
  if (!item) {
    updateSetting({ 'theme.customBg.veil': next })
    return
  }
  void updateCustomBg(item.id, { veil: next })
  updateSetting({ 'theme.customBg.veil': next })
}

const persist = async() => {
  syncBridge()
  emit()
  await saveData(storageDataPrefix.customBg, items)
}

const ensureDir = async() => {
  if (await existsFile(CUSTOM_BG_DIR)) return
  await mkdir(CUSTOM_BG_DIR)
}

/** 截图落在缓存目录，拷进私有目录之后就没用了 */
const discardTemp = (path: string) => {
  if (!path || path.startsWith(CUSTOM_BG_DIR)) return
  unlink(path).catch(() => { /* 缓存目录里的残留由系统自己回收 */ })
}

/** 编号只按现有的「背景N」往最大数上接，删掉中间一套不会让新的一套撞名 */
const nextSeq = () => items.reduce((max, item) => {
  const match = /^背景(\d+)$/.exec(item.name)
  return match ? Math.max(max, Number(match[1])) : max
}, 0) + 1

export const loadCustomBg = async() => {
  if (loaded) return
  // 启动时 initTheme 与设置页会同时问一次，这里把并发收成同一个任务
  loadTask ??= (async() => {
    const saved = await getData<CustomBgItem[]>(storageDataPrefix.customBg)
    // 柔光曾经是全局一档；老数据里没有 item.veil，把它们统一继承当时的那档，观感不至于突变
    const legacyVeil = clampWallpaperVeil(settingState.setting['theme.customBg.veil'])
    const alive: CustomBgItem[] = []
    for (const item of Array.isArray(saved) ? saved : []) {
      if (!item?.file || !item?.id) continue
      // 用户可能在文件管理器里把图删了，缺图的那套直接丢掉，别在列表里留个空壳
      if (!await existsFile(item.file)) continue
      alive.push({
        id: item.id,
        name: item.name || `背景${alive.length + 1}`,
        file: item.file,
        src: item.src || '',
        crop: {
          zoom: Number(item.crop?.zoom) || 1,
          rot: Number(item.crop?.rot) || 0,
          x: Number(item.crop?.x) || 0,
          y: Number(item.crop?.y) || 0,
        },
        blur: Math.min(MAX_CUSTOM_BG_BLUR, Math.max(0, Number(item.blur) || 0)),
        veil: Number.isFinite(Number(item.veil)) ? clampWallpaperVeil(item.veil) : legacyVeil,
      })
    }
    items = alive
    loaded = true
    if (!items.some((item) => item.id === settingState.setting['theme.customBg.activeId'])) {
      updateSetting({ 'theme.customBg.activeId': items[0]?.id ?? '' })
    }
    syncBridge()
    emit()
  })().catch((err) => {
    // 读失败不能让后续调用永远吊在这个 promise 上，当成"没有背景"继续跑
    console.log('load custom bg failed', err)
    loaded = true
    emit()
  })
  await loadTask
}

export const addCustomBg = async(capturedPath: string, src: string, crop: CustomBgCrop, blur: number, veil: number) => {
  await loadCustomBg()
  if (items.length >= MAX_CUSTOM_BG) throw new Error('custom_bg_limit')
  await ensureDir()
  const id = `bg_${Date.now()}`
  const file = `${CUSTOM_BG_DIR}/${id}.jpg`
  await copyFile(toFsPath(capturedPath), file)
  discardTemp(toFsPath(capturedPath))
  const item: CustomBgItem = {
    id,
    name: `背景${nextSeq()}`,
    file,
    src: await storeSource(src, id),
    crop,
    blur: Math.min(MAX_CUSTOM_BG_BLUR, Math.max(0, Math.round(blur))),
    veil: clampWallpaperVeil(veil),
  }
  items = [...items, item]
  updateSetting({
    'theme.customBg.activeId': id,
    'theme.customBg.enabled': true,
  })
  await persist()
  return item
}

/** 重新剪裁：同一套直接换图，编号与名称都不动 */
export const replaceCustomBg = async(id: string, capturedPath: string, src: string, crop: CustomBgCrop, blur: number, veil: number) => {
  await loadCustomBg()
  const target = items.find((item) => item.id === id)
  if (!target) return null
  await ensureDir()
  const file = `${CUSTOM_BG_DIR}/${id}.jpg`
  await copyFile(toFsPath(capturedPath), file)
  discardTemp(toFsPath(capturedPath))
  const storedSrc = await storeSource(src, id)
  items = items.map((item) => item.id === id
    ? {
        ...item,
        file,
        src: storedSrc || item.src,
        crop,
        blur: Math.min(MAX_CUSTOM_BG_BLUR, Math.max(0, Math.round(blur))),
        veil: clampWallpaperVeil(veil),
      }
    : item)
  await persist()
  return items.find((item) => item.id === id) ?? null
}

export const updateCustomBg = async(id: string, patch: Partial<CustomBgItem>) => {
  await loadCustomBg()
  items = items.map((item) => item.id === id ? { ...item, ...patch } : item)
  await persist()
}

export const removeCustomBg = async(id: string) => {
  await loadCustomBg()
  const target = items.find((item) => item.id === id)
  if (!target) return
  items = items.filter((item) => item.id !== id)
  if (settingState.setting['theme.customBg.activeId'] === id) {
    updateSetting({ 'theme.customBg.activeId': items[0]?.id ?? '' })
  }
  await persist()
  // 删文件放在持久化之后：哪怕这里失败，列表也已经干净了，不会留个点不开的空壳
  try {
    if (target.file) await unlink(target.file)
    if (target.src && target.src.startsWith(CUSTOM_BG_DIR)) await unlink(target.src)
  } catch (err) {
    console.log('remove custom bg file failed', err)
  }
}

export const pruneCustomBg = async(keepId: string) => {
  await loadCustomBg()
  for (const item of [...items]) {
    if (item.id === keepId) continue
    await removeCustomBg(item.id)
  }
}

/**
 * 把用户选的图收进临时目录，作为「原图」交给剪裁页。
 *
 * 系统选择器给的路径在临时目录/别的 app 沙箱里，重启后就不保证还在，所以先落一份自己的。
 * 落在临时目录而不是 custom_bg/：用户可能剪到一半就退出，那一份没有条目引用它，
 * 留在私有目录里就是永远清不掉的垃圾（临时目录由系统与启动清理负责）。
 */
export const importCustomBgSource = async(pickedPath: string) => {
  const target = `${temporaryDirectoryPath}/custom_bg_src_${Date.now()}.jpg`
  await copyFile(pickedPath, target)
  return target
}

/** 原图落到正式目录里，重新剪裁时才有得用 */
const storeSource = async(src: string, id: string) => {
  if (!src) return ''
  if (src.startsWith(CUSTOM_BG_DIR)) return src
  await ensureDir()
  const target = `${CUSTOM_BG_DIR}/${id}_src.jpg`
  await copyFile(src, target)
  discardTemp(src)
  return target
}

export const useCustomBgItems = () => {
  const [list, setList] = useState<CustomBgItem[]>(items)
  useEffect(() => {
    void loadCustomBg()
    const off = subscribeCustomBg(() => { setList(items) })
    // 订阅之前可能已经加载完并 emit 过，这里补一次
    if (loaded) setList(items)
    return off
  }, [])
  return list
}

export const useActiveCustomBg = () => {
  const list = useCustomBgItems()
  const activeId = settingState.setting['theme.customBg.activeId']
  const [currentId, setCurrentId] = useState(activeId)
  useEffect(() => {
    setCurrentId(settingState.setting['theme.customBg.activeId'])
    const handleUpdate = (keys: Array<keyof LX.AppSetting>) => {
      if (!keys.includes('theme.customBg.activeId')) return
      setCurrentId(settingState.setting['theme.customBg.activeId'])
    }
    global.state_event.on('configUpdated', handleUpdate)
    return () => {
      global.state_event.off('configUpdated', handleUpdate)
    }
  }, [])
  return useMemo(() => list.find((item) => item.id === currentId) ?? list[0] ?? null, [list, currentId])
}
